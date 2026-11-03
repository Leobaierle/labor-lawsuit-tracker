import {
  EntradaInvalida,
  normalizarNumeroCnj,
  normalizarPrazo,
  normalizarResponsavel,
  textoObrigatorio,
  textoOpcional,
} from "./dominio.ts";
import type { Executor, ProcessosPool } from "./pgClient.ts";
import { withTransaction } from "./pgClient.ts";
import type { Andamento } from "./datajud.ts";

export type Processo = {
  id: number;
  numero: string | null;
  empresaNome: string;
  empresaCadastroId: number | null;
  empresaDocumento: string | null;
  reclamante: string | null;
  tipoId: number | null;
  tipoNome: string | null;
  etapaId: number;
  etapaNome: string;
  etapaEncerra: boolean;
  /** AAAA-MM-DD */
  prazo: string | null;
  responsavel: string | null;
  origem: "MANUAL" | "EMAIL";
  descartadoEm: Date | null;
  descartadoPor: string | null;
  criadoEm: Date;
  criadoPor: string;
  atualizadoEm: Date;
  /** Situação no tribunal pelo DataJud; null = ainda não consultado. Só leitura (atualização semanal). */
  andamento: AndamentoTribunal | null;
  /** E-mails na linha do tempo e se algum tem o selo "novo e-mail" (some quando alguém abre o processo). */
  emails: number;
  novoEmail: boolean;
};

export type AndamentoTribunal = Andamento & { consultadoEm: Date | null; erro: string | null };

export type Mudanca = { campo: string; antes: string | null; depois: string | null };
export type EventoProcesso = { em: Date; autor: string; acao: "INSERT" | "UPDATE" | "DELETE"; mudancas: Mudanca[] };

/** O que o DP preenche. Na alteração, só as chaves presentes mudam (null limpa o campo). */
export type DadosProcesso = {
  numero?: string | null;
  empresaNome?: string | null;
  empresaCadastroId?: number | null;
  empresaDocumento?: string | null;
  reclamante?: string | null;
  tipoId?: number | null;
  etapaId?: number | null;
  prazo?: string | null;
  responsavel?: string | null;
};

const SELECT = `
  SELECT p.id, p.numero, p.empresa_nome, p.empresa_cadastro_id, p.empresa_documento, p.reclamante,
         p.tipo_id, t.nome AS tipo_nome, p.etapa_id, e.nome AS etapa_nome, e.encerra AS etapa_encerra,
         to_char(p.prazo, 'YYYY-MM-DD') AS prazo, p.responsavel, p.origem, p.descartado_em, p.descartado_por,
         p.criado_em, p.criado_por, p.atualizado_em,
         a.processo_id AS andamento_de, a.consultado_em AS andamento_consultado_em, a.encontrado AS andamento_encontrado,
         a.situacao AS andamento_situacao, to_char(a.situacao_em, 'YYYY-MM-DD') AS andamento_situacao_em,
         to_char(a.ultima_movimentacao, 'YYYY-MM-DD') AS andamento_ultima_movimentacao, a.orgao AS andamento_orgao,
         a.erro AS andamento_erro,
         (SELECT count(*) FROM dp_processos_trabalhistas.email_processo ep WHERE ep.processo_id = p.id) AS emails,
         EXISTS (SELECT 1 FROM dp_processos_trabalhistas.email_processo ep WHERE ep.processo_id = p.id AND ep.novo) AS novo_email
    FROM dp_processos_trabalhistas.processo p
    JOIN dp_processos_trabalhistas.etapa e ON e.id = p.etapa_id
    LEFT JOIN dp_processos_trabalhistas.tipo t ON t.id = p.tipo_id
    LEFT JOIN dp_processos_trabalhistas.andamento_tribunal a ON a.processo_id = p.id`;

const linha = (r: Record<string, any>): Processo => ({
  id: Number(r.id),
  numero: r.numero,
  empresaNome: r.empresa_nome,
  empresaCadastroId: r.empresa_cadastro_id == null ? null : Number(r.empresa_cadastro_id),
  empresaDocumento: r.empresa_documento,
  reclamante: r.reclamante,
  tipoId: r.tipo_id == null ? null : Number(r.tipo_id),
  tipoNome: r.tipo_nome,
  etapaId: Number(r.etapa_id),
  etapaNome: r.etapa_nome,
  etapaEncerra: r.etapa_encerra,
  prazo: r.prazo,
  responsavel: r.responsavel,
  origem: r.origem,
  descartadoEm: r.descartado_em,
  descartadoPor: r.descartado_por,
  criadoEm: r.criado_em,
  criadoPor: r.criado_por,
  atualizadoEm: r.atualizado_em,
  andamento:
    r.andamento_de == null
      ? null
      : {
          encontrado: r.andamento_encontrado === true,
          situacao: r.andamento_situacao,
          situacaoEm: r.andamento_situacao_em,
          ultimaMovimentacao: r.andamento_ultima_movimentacao,
          orgao: r.andamento_orgao,
          consultadoEm: r.andamento_consultado_em,
          erro: r.andamento_erro,
        },
  emails: Number(r.emails ?? 0),
  novoEmail: r.novo_email === true,
});

/** Os processos ativos (ou só os descartados), por empresa e número. São poucos: a tela filtra as abas. */
export const listarProcessos = async (db: Executor, opcoes: { descartados?: boolean } = {}): Promise<Processo[]> => {
  const { rows } = await db.query(
    `${SELECT} WHERE (p.descartado_em IS NOT NULL) = $1 ORDER BY lower(p.empresa_nome), p.numero NULLS LAST, p.id`,
    [opcoes.descartados === true],
  );
  return rows.map(linha);
};

export const buscarProcesso = async (db: Executor, id: number): Promise<Processo | null> => {
  const { rows } = await db.query(`${SELECT} WHERE p.id = $1`, [id]);
  return rows[0] ? linha(rows[0]) : null;
};

const ROTULO: Record<string, string> = {
  numero: "Número",
  empresa_nome: "Empresa",
  reclamante: "Reclamante",
  tipo_id: "Tipo",
  etapa_id: "Etapa",
  prazo: "Prazo",
  responsavel: "Responsável",
  descartado_em: "Descartado",
};

/** Histórico em linguagem de gente: etapa e tipo pelo nome, prazo como data, descarte como sim/não. */
export const historicoDoProcesso = async (db: Executor, id: number): Promise<EventoProcesso[]> => {
  const [ev, etapas, tipos] = await Promise.all([
    db.query(`SELECT em, autor, acao, antes, depois FROM dp_processos_trabalhistas.evento WHERE processo_id = $1 ORDER BY em DESC, id DESC`, [id]),
    db.query(`SELECT id, nome FROM dp_processos_trabalhistas.etapa`),
    db.query(`SELECT id, nome FROM dp_processos_trabalhistas.tipo`),
  ]);
  const nomes = {
    etapa_id: new Map(etapas.rows.map((r) => [String(r.id), r.nome as string])),
    tipo_id: new Map(tipos.rows.map((r) => [String(r.id), r.nome as string])),
  };
  const texto = (campo: string, v: unknown): string | null => {
    if (v == null || v === "") return null;
    if (campo === "etapa_id" || campo === "tipo_id") return nomes[campo].get(String(v)) ?? `#${v}`;
    if (campo === "descartado_em") return "sim";
    return String(v);
  };
  return ev.rows.map((r) => ({
    em: r.em,
    autor: r.autor,
    acao: r.acao,
    mudancas: Object.keys(ROTULO)
      .map((c) => ({ campo: ROTULO[c]!, antes: texto(c, r.antes?.[c]), depois: texto(c, r.depois?.[c]) }))
      .filter((m) => m.antes !== m.depois),
  }));
};

const exigirAtivo = async (db: Executor, tabela: "etapa" | "tipo", id: number, rotulo: string) => {
  const { rows } = await db.query(`SELECT 1 FROM dp_processos_trabalhistas.${tabela} WHERE id = $1 AND arquivada_em IS NULL`, [id]);
  if (!rows[0]) throw new EntradaInvalida(`${rotulo} ${id} não existe (ou foi removida)`);
};

const primeiraEtapa = async (db: Executor): Promise<number> => {
  const { rows } = await db.query(`SELECT id FROM dp_processos_trabalhistas.etapa WHERE arquivada_em IS NULL ORDER BY ordem, id LIMIT 1`);
  if (!rows[0]) throw new Error("Nenhuma etapa ativa no banco");
  return Number(rows[0].id);
};

const numeroRepetido = async (db: Executor, numero: string, menos: number | null) => {
  const { rows } = await db.query(
    `SELECT id, empresa_nome, descartado_em FROM dp_processos_trabalhistas.processo WHERE numero = $1 AND id IS DISTINCT FROM $2`,
    [numero, menos],
  );
  const r = rows[0];
  if (r) {
    throw new EntradaInvalida(
      `Já existe o processo ${numero} (${r.empresa_nome}${r.descartado_em ? ", nos descartados" : ""})`,
    );
  }
};

/** Valida só as chaves presentes; devolve as colunas a gravar. */
const colunas = async (db: Executor, d: DadosProcesso, id: number | null): Promise<Record<string, unknown>> => {
  const c: Record<string, unknown> = {};
  if (d.numero !== undefined) {
    c.numero = d.numero == null || !d.numero.trim() ? null : normalizarNumeroCnj(d.numero);
    if (c.numero) await numeroRepetido(db, c.numero as string, id);
  }
  if (d.empresaNome !== undefined) c.empresa_nome = textoObrigatorio("Empresa", d.empresaNome, 200);
  if (d.empresaCadastroId !== undefined) c.empresa_cadastro_id = d.empresaCadastroId;
  if (d.empresaDocumento !== undefined) {
    const doc = (d.empresaDocumento ?? "").replace(/\D/g, "");
    if (doc && doc.length !== 11 && doc.length !== 14) throw new EntradaInvalida(`CNPJ/CPF da empresa inválido: "${d.empresaDocumento}"`);
    c.empresa_documento = doc || null;
  }
  if (d.reclamante !== undefined) c.reclamante = textoOpcional("Reclamante", d.reclamante, 200);
  if (d.tipoId !== undefined) {
    if (d.tipoId != null) await exigirAtivo(db, "tipo", d.tipoId, "Tipo");
    c.tipo_id = d.tipoId;
  }
  if (d.etapaId !== undefined) {
    if (d.etapaId == null) throw new EntradaInvalida("Etapa é obrigatória");
    await exigirAtivo(db, "etapa", d.etapaId, "Etapa");
    c.etapa_id = d.etapaId;
  }
  if (d.prazo !== undefined) c.prazo = normalizarPrazo(d.prazo);
  if (d.responsavel !== undefined) c.responsavel = normalizarResponsavel(d.responsavel);
  return c;
};

/** Cadastro manual. Sem etapa, entra na primeira (Novo). */
export const criarProcesso = async (pool: ProcessosPool, autor: string, dados: DadosProcesso): Promise<Processo> =>
  withTransaction(pool, autor, async (db) => {
    if (dados.empresaNome === undefined) throw new EntradaInvalida("Empresa é obrigatória");
    const c = await colunas(db, dados, null);
    if (c.etapa_id == null) c.etapa_id = await primeiraEtapa(db);
    const nomes = Object.keys(c);
    const { rows } = await db.query(
      `INSERT INTO processo (${nomes.join(", ")}, origem, criado_por)
       VALUES (${nomes.map((_, i) => `$${i + 1}`).join(", ")}, 'MANUAL', $${nomes.length + 1}) RETURNING id`,
      [...Object.values(c), autor],
    );
    return (await buscarProcesso(db, Number(rows[0].id)))!;
  });

export const alterarProcesso = async (pool: ProcessosPool, autor: string, id: number, dados: DadosProcesso): Promise<Processo> =>
  withTransaction(pool, autor, async (db) => {
    const { rows } = await db.query(`SELECT 1 FROM processo WHERE id = $1 FOR UPDATE`, [id]);
    if (!rows[0]) throw new EntradaInvalida(`Processo ${id} não existe`);
    const c = await colunas(db, dados, id);
    const nomes = Object.keys(c);
    if (nomes.length > 0) {
      await db.query(
        `UPDATE processo SET ${nomes.map((n, i) => `${n} = $${i + 2}`).join(", ")}, atualizado_em = now() WHERE id = $1`,
        [id, ...Object.values(c)],
      );
    }
    return (await buscarProcesso(db, id))!;
  });

/** "Não é processo": vai para Descartados. */
export const descartarProcesso = async (pool: ProcessosPool, autor: string, id: number): Promise<Processo> =>
  withTransaction(pool, autor, async (db) => {
    const { rowCount } = await db.query(
      `UPDATE processo SET descartado_em = now(), descartado_por = $2, atualizado_em = now() WHERE id = $1 AND descartado_em IS NULL`,
      [id, autor],
    );
    if (!rowCount) throw new EntradaInvalida(`Processo ${id} não existe ou já está nos descartados`);
    return (await buscarProcesso(db, id))!;
  });

/** Volta dos descartados; se a etapa dele foi removida nesse meio tempo, volta para a primeira. */
export const restaurarProcesso = async (pool: ProcessosPool, autor: string, id: number): Promise<Processo> =>
  withTransaction(pool, autor, async (db) => {
    const { rows } = await db.query(
      `SELECT p.etapa_id, e.arquivada_em FROM processo p JOIN etapa e ON e.id = p.etapa_id WHERE p.id = $1 AND p.descartado_em IS NOT NULL FOR UPDATE OF p`,
      [id],
    );
    if (!rows[0]) throw new EntradaInvalida(`Processo ${id} não existe ou não está nos descartados`);
    const etapa = rows[0].arquivada_em ? await primeiraEtapa(db) : Number(rows[0].etapa_id);
    await db.query(
      `UPDATE processo SET descartado_em = NULL, descartado_por = NULL, etapa_id = $2, atualizado_em = now() WHERE id = $1`,
      [id, etapa],
    );
    return (await buscarProcesso(db, id))!;
  });

/** Quem já aparece como responsável (para sugerir no campo). */
export const responsaveisConhecidos = async (db: Executor): Promise<string[]> => {
  const { rows } = await db.query(
    `SELECT DISTINCT responsavel FROM dp_processos_trabalhistas.processo WHERE responsavel IS NOT NULL ORDER BY 1`,
  );
  return rows.map((r) => r.responsavel as string);
};
