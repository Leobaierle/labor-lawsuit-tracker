import { createHmac, randomBytes } from "node:crypto";
import { assinar, chaveDoAmbiente, cifrar, decifrar, lerAssinado } from "./cifra.ts";
import { EntradaInvalida } from "./dominio.ts";
import {
  explicarErro,
  quemSou,
  renovarToken,
  totalCaixaEntrada,
  configDoAmbiente,
  trocarCodigo,
  urlDeAutorizacao,
  verificadorPkce,
  type ConfigMicrosoft,
} from "./microsoft.ts";
import type { Executor, ProcessosPool } from "./pgClient.ts";

/**
 * "Conectar meu e-mail": cada pessoa do DP autoriza a leitura da própria caixa; caixa compartilhada
 * (ex. dp@) entra pela conexão de quem tem acesso a ela. Aqui só conectar, testar e desconectar; o robô
 * de varredura (parte 3) pega o acesso por `acessoDaConexao`.
 */

const DOMINIO = "example.com";
const VALIDADE_INICIO_S = 10 * 60;

export type CaixaCompartilhada = {
  id: number;
  endereco: string;
  adicionadaPor: string;
  adicionadaEm: Date;
  testadoEm: Date | null;
  totalCaixaEntrada: number | null;
  ultimoErro: string | null;
};

export type ConexaoEmail = {
  id: number;
  caixa: string;
  nome: string | null;
  conectada: boolean;
  conectadoPor: string;
  conectadoEm: Date;
  testadoEm: Date | null;
  totalCaixaEntrada: number | null;
  ultimoErro: string | null;
  desconectadoEm: Date | null;
  desconectadoPor: string | null;
  compartilhadas: CaixaCompartilhada[];
};

/** O necessário para falar com a Microsoft e abrir os tokens. `segredo` assina o state e deriva o PKCE. */
export type AmbienteEmail = { cfg: ConfigMicrosoft; chave: Buffer; segredo: string };

/** Do ambiente do pod; null quando falta o app do Entra ou a chave. O segredo do state sai da própria chave. */
export const ambienteEmail = (): AmbienteEmail | null => {
  const cfg = configDoAmbiente();
  if (!cfg) return null;
  let chave: Buffer;
  try {
    chave = chaveDoAmbiente();
  } catch {
    return null;
  }
  return { cfg, chave, segredo: createHmac("sha256", chave).update("dp-processos-email-state").digest("base64url") };
};

type Inicio = { u: string; n: string; exp: number };

/** A Microsoft recusou o acesso de uma conexão (erro já gravado em `ultimo_erro`). */
export class ConexaoFalhou extends EntradaInvalida {}

const T = "dp_processos_trabalhistas";

const normalizarEndereco = (bruto: string): string => {
  const e = bruto.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(e)) throw new EntradaInvalida(`E-mail inválido: ${bruto}`);
  if (!e.endsWith(`@${DOMINIO}`)) throw new EntradaInvalida(`Só caixas @${DOMINIO}`);
  return e;
};

export const listarConexoes = async (db: Executor): Promise<ConexaoEmail[]> => {
  const [c, s] = await Promise.all([
    db.query(`SELECT * FROM ${T}.conexao_email ORDER BY desconectado_em IS NOT NULL, caixa`),
    db.query(`SELECT * FROM ${T}.caixa_compartilhada ORDER BY endereco`),
  ]);
  return c.rows.map((r) => ({
    id: Number(r.id),
    caixa: r.caixa,
    nome: r.nome,
    conectada: r.refresh_token_cifrado != null,
    conectadoPor: r.conectado_por,
    conectadoEm: r.conectado_em,
    testadoEm: r.testado_em,
    totalCaixaEntrada: r.total_caixa_entrada,
    ultimoErro: r.ultimo_erro,
    desconectadoEm: r.desconectado_em,
    desconectadoPor: r.desconectado_por,
    compartilhadas: s.rows
      .filter((x) => Number(x.conexao_id) === Number(r.id))
      .map((x) => ({
        id: Number(x.id),
        endereco: x.endereco,
        adicionadaPor: x.adicionada_por,
        adicionadaEm: x.adicionada_em,
        testadoEm: x.testado_em,
        totalCaixaEntrada: x.total_caixa_entrada,
        ultimoErro: x.ultimo_erro,
      })),
  }));
};

const conexao = async (db: Executor, id: number): Promise<ConexaoEmail> => {
  const c = (await listarConexoes(db)).find((x) => x.id === id);
  if (!c) throw new EntradaInvalida(`Conexão ${id} não encontrada`);
  return c;
};

/** Endereço da Microsoft para onde o botão leva. Vale 10 minutos e só para quem começou. */
export const iniciarConexao = (amb: AmbienteEmail, usuario: string, agora = Date.now()): string => {
  const nonce = randomBytes(16).toString("base64url");
  const state = assinar(amb.segredo, { u: usuario, n: nonce, exp: Math.floor(agora / 1000) + VALIDADE_INICIO_S } satisfies Inicio);
  return urlDeAutorizacao(amb.cfg, state, verificadorPkce(amb.segredo, nonce));
};

/** Volta da Microsoft: troca o código, descobre de quem é a caixa, prova a leitura e guarda o token cifrado. */
export const concluirConexao = async (
  pool: ProcessosPool,
  amb: AmbienteEmail,
  usuario: string,
  code: string,
  state: string,
  agora = Date.now(),
): Promise<ConexaoEmail> => {
  const inicio = lerAssinado<Inicio>(amb.segredo, state);
  if (!inicio || inicio.exp < agora / 1000)
    throw new EntradaInvalida("A conexão expirou. Clique em “Conectar meu e-mail” de novo.");
  if (inicio.u !== usuario)
    throw new EntradaInvalida("Essa conexão foi iniciada em outra sessão. Clique em “Conectar meu e-mail” de novo.");

  let caixa: string, nome: string | null, total: number, refresh: string;
  try {
    const tokens = await trocarCodigo(amb.cfg, code, verificadorPkce(amb.segredo, inicio.n));
    ({ email: caixa, nome } = await quemSou(tokens.accessToken));
    if (!caixa.endsWith(`@${DOMINIO}`)) throw new EntradaInvalida(`Só contas @${DOMINIO} (entrou como ${caixa})`);
    total = await totalCaixaEntrada(tokens.accessToken);
    refresh = tokens.refreshToken;
  } catch (e) {
    if (e instanceof EntradaInvalida) throw e;
    throw new EntradaInvalida(`A Microsoft recusou a conexão: ${explicarErro(e)}`);
  }

  const { rows } = await pool.query(
    `INSERT INTO ${T}.conexao_email (caixa, nome, refresh_token_cifrado, conectado_por, testado_em, total_caixa_entrada)
     VALUES ($1, $2, $3, $4, now(), $5)
     ON CONFLICT (caixa) DO UPDATE SET nome = EXCLUDED.nome, refresh_token_cifrado = EXCLUDED.refresh_token_cifrado,
       conectado_por = EXCLUDED.conectado_por, conectado_em = now(), testado_em = now(),
       total_caixa_entrada = EXCLUDED.total_caixa_entrada, ultimo_erro = NULL, desconectado_em = NULL, desconectado_por = NULL
     RETURNING id`,
    [caixa, nome, cifrar(amb.chave, refresh), usuario, total],
  );
  // conectada direto, deixa de ser lida como compartilhada por outra conexão (varrer uma vez só)
  await pool.query(`DELETE FROM ${T}.caixa_compartilhada WHERE endereco = $1`, [caixa]);
  return conexao(pool, Number(rows[0].id));
};

/**
 * Token de acesso da conexão (renova e guarda o refresh novo). Falha da Microsoft fica em `ultimo_erro`
 * e sobe como EntradaInvalida com a explicação.
 */
export const acessoDaConexao = async (pool: ProcessosPool, amb: AmbienteEmail, id: number): Promise<{ caixa: string; accessToken: string }> => {
  const { rows } = await pool.query(`SELECT caixa, refresh_token_cifrado FROM ${T}.conexao_email WHERE id = $1`, [id]);
  const r = rows[0];
  if (!r) throw new EntradaInvalida(`Conexão ${id} não encontrada`);
  if (!r.refresh_token_cifrado) throw new EntradaInvalida(`${r.caixa} está desconectada`);
  try {
    const tokens = await renovarToken(amb.cfg, decifrar(amb.chave, r.refresh_token_cifrado));
    await pool.query(`UPDATE ${T}.conexao_email SET refresh_token_cifrado = $2 WHERE id = $1 AND refresh_token_cifrado IS NOT NULL`, [
      id,
      cifrar(amb.chave, tokens.refreshToken),
    ]);
    return { caixa: r.caixa, accessToken: tokens.accessToken };
  } catch (e) {
    const erro = explicarErro(e);
    await pool.query(`UPDATE ${T}.conexao_email SET testado_em = now(), ultimo_erro = $2 WHERE id = $1`, [id, erro]);
    throw new ConexaoFalhou(erro);
  }
};

/** Renova o acesso e lê o total da Caixa de Entrada da conta e de cada compartilhada. Grava o resultado. */
export const testarConexao = async (pool: ProcessosPool, amb: AmbienteEmail, id: number): Promise<ConexaoEmail> => {
  let accessToken: string;
  try {
    ({ accessToken } = await acessoDaConexao(pool, amb, id));
  } catch (e) {
    if (e instanceof ConexaoFalhou) return conexao(pool, id); // erro já gravado em ultimo_erro
    throw e;
  }
  const resultado = async (caixa?: string): Promise<[number | null, string | null]> => {
    try {
      return [await totalCaixaEntrada(accessToken, caixa), null];
    } catch (e) {
      return [null, explicarErro(e)];
    }
  };
  const [total, erro] = await resultado();
  await pool.query(`UPDATE ${T}.conexao_email SET testado_em = now(), total_caixa_entrada = coalesce($2, total_caixa_entrada), ultimo_erro = $3 WHERE id = $1`, [
    id,
    total,
    erro,
  ]);
  for (const s of (await conexao(pool, id)).compartilhadas) {
    const [t, e] = await resultado(s.endereco);
    await pool.query(
      `UPDATE ${T}.caixa_compartilhada SET testado_em = now(), total_caixa_entrada = coalesce($2, total_caixa_entrada), ultimo_erro = $3 WHERE id = $1`,
      [s.id, t, e],
    );
  }
  return conexao(pool, id);
};

/** Apaga o token: o robô para de ler a caixa. Para revogar também na Microsoft, a pessoa remove o app em myapps. */
export const desconectar = async (pool: ProcessosPool, id: number, por: string): Promise<ConexaoEmail> => {
  const { rowCount } = await pool.query(
    `UPDATE ${T}.conexao_email SET refresh_token_cifrado = NULL, desconectado_em = now(), desconectado_por = $2
     WHERE id = $1 AND refresh_token_cifrado IS NOT NULL`,
    [id, por],
  );
  if (!rowCount) throw new EntradaInvalida("Essa conexão não existe ou já está desconectada");
  return conexao(pool, id);
};

/** Caixa compartilhada lida por uma conexão: só entra se a conta conectada consegue ler a Caixa de Entrada dela. */
export const adicionarCaixaCompartilhada = async (
  pool: ProcessosPool,
  amb: AmbienteEmail,
  conexaoId: number,
  enderecoBruto: string,
  por: string,
): Promise<ConexaoEmail> => {
  const endereco = normalizarEndereco(enderecoBruto);
  const ja = await pool.query(
    `SELECT 'direta' AS como, caixa AS quem FROM ${T}.conexao_email WHERE caixa = $1 AND refresh_token_cifrado IS NOT NULL
     UNION ALL SELECT 'compartilhada', c.caixa FROM ${T}.caixa_compartilhada s JOIN ${T}.conexao_email c ON c.id = s.conexao_id WHERE s.endereco = $1`,
    [endereco],
  );
  if (ja.rows[0])
    throw new EntradaInvalida(
      ja.rows[0].como === "direta" ? `${endereco} já está conectada` : `${endereco} já é lida pela conexão de ${ja.rows[0].quem}`,
    );
  const { caixa, accessToken } = await acessoDaConexao(pool, amb, conexaoId);
  if (caixa === endereco) throw new EntradaInvalida("Essa é a própria caixa da conexão");
  let total: number;
  try {
    total = await totalCaixaEntrada(accessToken, endereco);
  } catch (e) {
    throw new EntradaInvalida(`${caixa} não consegue ler ${endereco}: ${explicarErro(e)}`);
  }
  await pool.query(
    `INSERT INTO ${T}.caixa_compartilhada (conexao_id, endereco, adicionada_por, testado_em, total_caixa_entrada) VALUES ($1, $2, $3, now(), $4)`,
    [conexaoId, endereco, por, total],
  );
  return conexao(pool, conexaoId);
};

export const removerCaixaCompartilhada = async (pool: ProcessosPool, id: number): Promise<ConexaoEmail> => {
  const { rows } = await pool.query(`DELETE FROM ${T}.caixa_compartilhada WHERE id = $1 RETURNING conexao_id`, [id]);
  if (!rows[0]) throw new EntradaInvalida("Caixa compartilhada não encontrada");
  return conexao(pool, Number(rows[0].conexao_id));
};
