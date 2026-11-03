import { acessoDaConexao, type AmbienteEmail } from "./conexoes.ts";
import { normalizarNumeroCnj } from "./dominio.ts";
import { explicarErro } from "./microsoft.ts";
import type { Executor, ProcessosPool } from "./pgClient.ts";
import { withTransaction } from "./pgClient.ts";

/**
 * Robô de e-mail (parte 3): lê a Caixa de Entrada + subpastas de cada caixa conectada e das compartilhadas.
 * E-mail com número CNJ da Justiça do Trabalho entra na linha do tempo do processo; número novo vira processo em
 * "Novo" com a empresa "a identificar" (o DP, ou a IA da parte 5, completa). A primeira leitura de uma caixa
 * volta 3 meses sem selo; depois, todo e-mail ligado a um processo ganha o selo "novo e-mail" até alguém abrir.
 * O robô nunca muda etapa.
 */

const T = "dp_processos_trabalhistas";
const DIA = 864e5;
export const EMPRESA_A_IDENTIFICAR = "Empresa a identificar";

export type MensagemEmail = {
  id: string;
  messageId: string;
  assunto: string;
  deNome: string | null;
  deEmail: string | null;
  recebidoEm: Date;
  temAnexos: boolean;
  /** corpo em texto */
  corpo: string;
  link: string | null;
};

/** Uma caixa vista pelo robô. Separado do Graph para testar sem a Microsoft. */
export type LeitorCaixa = {
  caixa: string;
  /** Caixa de Entrada e subpastas, com o caminho ("Caixa de Entrada/Processos") */
  pastas: () => Promise<Array<{ id: string; nome: string }>>;
  mensagens: (pastaId: string, desde: Date) => AsyncIterable<MensagemEmail>;
  /** nomes dos anexos (sem as imagens do corpo) */
  anexos: (mensagemId: string) => Promise<string[]>;
};

const CNJ = /\b\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}\b/g;

/** Números CNJ válidos da Justiça do Trabalho (J=5) no texto, formatados e sem repetir (Q32). */
export const numerosTrabalhistas = (texto: string): string[] => {
  const achados = new Set<string>();
  for (const m of texto.matchAll(CNJ)) {
    try {
      const n = normalizarNumeroCnj(m[0]);
      if (n.split(".")[2] === "5") achados.add(n);
    } catch {
      // número com dígito verificador errado: não é processo
    }
  }
  return [...achados];
};

/** Começo do corpo para a linha do tempo: sem imagens embutidas, sem linhas em branco repetidas. */
export const resumoDoCorpo = (corpo: string, max = 600): string => {
  const t = corpo
    .replace(/\r/g, "")
    .replace(/\[cid:[^\]]*\]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** Leitor pelo Microsoft Graph. `endereco` = caixa compartilhada lida pela conexão (Mail.Read.Shared). */
export const leitorGraph = (accessToken: string, caixa: string, opcoes: { compartilhada?: boolean; fetch?: Fetch } = {}): LeitorCaixa => {
  const dono = opcoes.compartilhada ? `/users/${encodeURIComponent(caixa)}` : "/me";
  const get = async (url: string): Promise<any> => {
    const r = await (opcoes.fetch ?? fetch)(url.startsWith("http") ? url : `https://graph.microsoft.com/v1.0${dono}${url}`, {
      headers: { authorization: `Bearer ${accessToken}`, prefer: 'outlook.body-content-type="text"' },
      signal: AbortSignal.timeout(60_000),
    });
    const j = (await r.json().catch(() => ({}))) as any;
    if (!r.ok) throw new Error(`Microsoft respondeu ${r.status}: ${j.error?.code ?? ""} ${j.error?.message ?? ""}`.trim());
    return j;
  };
  async function* paginas(url: string) {
    for (let u: string | undefined = url; u; ) {
      const j = await get(u);
      yield* j.value as any[];
      u = j["@odata.nextLink"];
    }
  }
  return {
    caixa,
    pastas: async () => {
      const lista: Array<{ id: string; nome: string }> = [];
      const descer = async (id: string, nome: string) => {
        lista.push({ id, nome });
        for await (const f of paginas(`/mailFolders/${id}/childFolders?$select=id,displayName&$top=100`)) await descer(f.id, `${nome}/${f.displayName}`);
      };
      const inbox = await get("/mailFolders/inbox?$select=id");
      await descer(inbox.id, "Caixa de Entrada");
      return lista;
    },
    mensagens: async function* (pastaId, desde) {
      const campos = "id,internetMessageId,subject,from,receivedDateTime,hasAttachments,body,webLink";
      for await (const m of paginas(
        `/mailFolders/${pastaId}/messages?$filter=receivedDateTime ge ${desde.toISOString()}&$select=${campos}&$top=50`,
      )) {
        yield {
          id: m.id,
          messageId: m.internetMessageId || m.id,
          assunto: m.subject ?? "",
          deNome: m.from?.emailAddress?.name ?? null,
          deEmail: m.from?.emailAddress?.address?.toLowerCase() ?? null,
          recebidoEm: new Date(m.receivedDateTime),
          temAnexos: !!m.hasAttachments,
          corpo: m.body?.content ?? "",
          link: m.webLink ?? null,
        };
      }
    },
    anexos: async (mensagemId) => {
      const nomes: string[] = [];
      for await (const a of paginas(`/messages/${encodeURIComponent(mensagemId)}/attachments?$select=name,isInline`)) {
        if (!a.isInline && a.name) nomes.push(a.name);
      }
      return nomes;
    },
  };
};

const primeiraEtapa = async (db: Executor): Promise<number> => {
  const { rows } = await db.query(`SELECT id FROM ${T}.etapa WHERE arquivada_em IS NULL ORDER BY ordem, id LIMIT 1`);
  if (!rows[0]) throw new Error("Nenhuma etapa ativa no banco");
  return Number(rows[0].id);
};

export type ResultadoLeitura = { caixa: string; emails: number; comProcesso: number; processosNovos: number; erro: string | null };

/** Grava o e-mail (uma vez só), liga aos processos citados e cria os que não existem. */
const gravarEmail = async (
  pool: ProcessosPool,
  leitor: LeitorCaixa,
  pasta: string,
  m: MensagemEmail,
  numeros: string[],
  selo: boolean,
): Promise<number> => {
  const ja = await pool.query(`SELECT id FROM ${T}.email WHERE message_id = $1`, [m.messageId]);
  const anexos = ja.rows[0] || !m.temAnexos ? [] : await leitor.anexos(m.id);
  return withTransaction(pool, `robô de e-mail (${leitor.caixa})`, async (db) => {
    await db.query(
      `INSERT INTO email (message_id, caixa, pasta, recebido_em, de_nome, de_email, assunto, resumo, anexos, link)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (message_id) DO NOTHING`,
      [m.messageId, leitor.caixa, pasta, m.recebidoEm, m.deNome, m.deEmail, m.assunto.slice(0, 500), resumoDoCorpo(m.corpo), JSON.stringify(anexos), m.link],
    );
    const emailId = Number((await db.query(`SELECT id FROM email WHERE message_id = $1`, [m.messageId])).rows[0].id);
    let novos = 0;
    for (const numero of numeros) {
      let p = (await db.query(`SELECT id FROM processo WHERE numero = $1`, [numero])).rows[0];
      if (!p) {
        p = (
          await db.query(
            `INSERT INTO processo (numero, empresa_nome, etapa_id, origem, criado_por) VALUES ($1, $2, $3, 'EMAIL', $4)
             ON CONFLICT (numero) WHERE numero IS NOT NULL DO NOTHING RETURNING id`,
            [numero, EMPRESA_A_IDENTIFICAR, await primeiraEtapa(db), `robô de e-mail (${leitor.caixa})`],
          )
        ).rows[0] ?? (await db.query(`SELECT id FROM processo WHERE numero = $1`, [numero])).rows[0];
        novos++;
      }
      await db.query(
        `INSERT INTO email_processo (email_id, processo_id, novo) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [emailId, p.id, selo],
      );
    }
    return novos;
  });
};

/**
 * Lê uma caixa a partir de onde parou (um dia antes, para e-mail que demora a cair na pasta); na primeira vez,
 * 3 meses para trás e sem selo. Só avança o "lido até" se a leitura inteira deu certo: numa falha, a próxima
 * hora relê o mesmo trecho (gravar é idempotente).
 */
export const lerCaixa = async (pool: ProcessosPool, leitorBruto: LeitorCaixa, agora = new Date()): Promise<ResultadoLeitura> => {
  const caixa = leitorBruto.caixa.trim().toLowerCase();
  const leitor = { ...leitorBruto, caixa };
  const antes = (await pool.query(`SELECT lido_ate FROM ${T}.varredura_caixa WHERE caixa = $1`, [caixa])).rows[0];
  const primeira = !antes?.lido_ate;
  const desde = primeira ? new Date(agora.getTime() - 92 * DIA) : new Date(new Date(antes.lido_ate).getTime() - DIA);
  const r: ResultadoLeitura = { caixa, emails: 0, comProcesso: 0, processosNovos: 0, erro: null };
  let lidoAte: Date | null = antes?.lido_ate ? new Date(antes.lido_ate) : null;
  try {
    for (const pasta of await leitor.pastas()) {
      for await (const m of leitor.mensagens(pasta.id, desde)) {
        r.emails++;
        if (!lidoAte || m.recebidoEm > lidoAte) lidoAte = m.recebidoEm;
        const numeros = numerosTrabalhistas(`${m.assunto}\n${m.corpo}`);
        if (numeros.length === 0) continue;
        r.comProcesso++;
        r.processosNovos += await gravarEmail(pool, leitor, pasta.nome, m, numeros, !primeira);
      }
    }
    await pool.query(
      `INSERT INTO ${T}.varredura_caixa (caixa, lido_ate, varrido_em, emails, com_processo, erro) VALUES ($1, $2, now(), $3, $4, NULL)
       ON CONFLICT (caixa) DO UPDATE SET lido_ate = $2, varrido_em = now(), emails = $3, com_processo = $4, erro = NULL`,
      [caixa, lidoAte, r.emails, r.comProcesso],
    );
  } catch (e) {
    r.erro = explicarErro(e);
    await gravarErro(pool, caixa, r.erro);
  }
  return r;
};

const gravarErro = (pool: ProcessosPool, caixa: string, erro: string) =>
  pool.query(
    `INSERT INTO ${T}.varredura_caixa (caixa, varrido_em, erro) VALUES ($1, now(), $2)
     ON CONFLICT (caixa) DO UPDATE SET varrido_em = now(), erro = $2`,
    [caixa, erro.slice(0, 500)],
  );

/** Todas as caixas: a de cada conexão ativa e as compartilhadas que ela lê. Uma caixa que falha não para as outras. */
export const varrerCaixas = async (
  pool: ProcessosPool,
  amb: AmbienteEmail,
  opcoes: { fetch?: Fetch; agora?: Date } = {},
): Promise<ResultadoLeitura[]> => {
  const { rows } = await pool.query(
    `SELECT c.id, c.caixa, coalesce(array_agg(s.endereco ORDER BY s.endereco) FILTER (WHERE s.endereco IS NOT NULL), '{}') AS compartilhadas
       FROM ${T}.conexao_email c LEFT JOIN ${T}.caixa_compartilhada s ON s.conexao_id = c.id
      WHERE c.refresh_token_cifrado IS NOT NULL GROUP BY c.id, c.caixa ORDER BY c.id`,
  );
  const resultados: ResultadoLeitura[] = [];
  for (const c of rows) {
    let token: string;
    try {
      token = (await acessoDaConexao(pool, amb, Number(c.id))).accessToken;
    } catch (e) {
      for (const caixa of [c.caixa, ...c.compartilhadas]) {
        const erro = explicarErro(e);
        await gravarErro(pool, caixa, erro);
        resultados.push({ caixa, emails: 0, comProcesso: 0, processosNovos: 0, erro });
      }
      continue;
    }
    resultados.push(await lerCaixa(pool, leitorGraph(token, c.caixa, { fetch: opcoes.fetch }), opcoes.agora));
    for (const endereco of c.compartilhadas as string[]) {
      resultados.push(await lerCaixa(pool, leitorGraph(token, endereco, { compartilhada: true, fetch: opcoes.fetch }), opcoes.agora));
    }
  }
  return resultados;
};

// ---- o que a tela usa ----

export type EmailDoProcesso = {
  id: number;
  recebidoEm: Date;
  deNome: string | null;
  deEmail: string | null;
  assunto: string | null;
  resumo: string | null;
  anexos: string[];
  caixa: string;
  pasta: string;
  link: string | null;
  novo: boolean;
};

/** Linha do tempo: do mais recente para o mais antigo. */
export const emailsDoProcesso = async (db: Executor, processoId: number): Promise<EmailDoProcesso[]> => {
  const { rows } = await db.query(
    `SELECT e.*, ep.novo FROM ${T}.email_processo ep JOIN ${T}.email e ON e.id = ep.email_id
      WHERE ep.processo_id = $1 ORDER BY e.recebido_em DESC, e.id DESC`,
    [processoId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    recebidoEm: r.recebido_em,
    deNome: r.de_nome,
    deEmail: r.de_email,
    assunto: r.assunto,
    resumo: r.resumo,
    anexos: r.anexos ?? [],
    caixa: r.caixa,
    pasta: r.pasta,
    link: r.link,
    novo: r.novo,
  }));
};

/** Alguém abriu o processo: o selo "novo e-mail" sai (para todos). */
export const marcarEmailsVistos = async (db: Executor, processoId: number): Promise<void> => {
  await db.query(`UPDATE ${T}.email_processo SET novo = false WHERE processo_id = $1 AND novo`, [processoId]);
};

export type LeituraCaixa = { caixa: string; varridoEm: Date; lidoAte: Date | null; emails: number; comProcesso: number; erro: string | null };

export const leiturasDasCaixas = async (db: Executor): Promise<LeituraCaixa[]> => {
  const { rows } = await db.query(`SELECT * FROM ${T}.varredura_caixa ORDER BY caixa`);
  return rows.map((r) => ({
    caixa: r.caixa,
    varridoEm: r.varrido_em,
    lidoAte: r.lido_ate,
    emails: r.emails,
    comProcesso: r.com_processo,
    erro: r.erro,
  }));
};
