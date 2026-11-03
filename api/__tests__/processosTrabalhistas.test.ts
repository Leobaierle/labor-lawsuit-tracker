/**
 * Processos trabalhistas no subgraph do DP. A parte de banco usa um Postgres LOCAL descartável (APAGA o schema
 * dp_processos_trabalhistas) e é pulada sem DP_PROCESSOS_TEST_DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sign } from "hono/jwt";
import pg from "pg";

const SEGREDO = "segredo-de-teste";
const URL_TESTE = process.env.DP_PROCESSOS_TEST_DATABASE_URL;
process.env.JWT_SECRET = SEGREDO;
if (URL_TESTE) process.env.DP_PROCESSOS_DATABASE_URL = URL_TESTE;

const { default: app } = await import("../index.ts");
const { closeProcessosPool, digitoCnj } = await import("@app/dp-processos-trabalhistas");

const DP = { role: "user", platforms: ["dp"], email: "ana@example.com" };

const gql = async (query: string, variables?: Record<string, unknown>, claims?: Record<string, unknown>) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (claims) headers.authorization = `Bearer ${await sign({ sub: "u1", exp: Math.floor(Date.now() / 1000) + 600, ...claims }, SEGREDO, "HS256")}`;
  const r = await app.fetch(new Request("http://x/graphql", { method: "POST", headers, body: JSON.stringify({ query, variables }) }));
  return (await r.json()) as { data?: Record<string, any>; errors?: Array<{ message: string; extensions?: { code?: string } }> };
};

const PAINEL = "{ dpProcessosPainel { hoje eu etapas { id nome processos } processos { id numero etapaNome } } }";

describe("acesso aos processos trabalhistas", () => {
  it("sem sessão: UNAUTHENTICATED; sem dp: FORBIDDEN; id inválido: BAD_USER_INPUT (antes do banco)", async () => {
    expect((await gql(PAINEL)).errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
    expect((await gql(PAINEL, {}, { role: "user", platforms: ["fiscal"] })).errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
    expect((await gql('{ dpProcesso(id: "abc") { id } }', {}, DP)).errors?.[0]?.extensions?.code).toBe("BAD_USER_INPUT");
  });
});

describe.skipIf(!URL_TESTE)("processos trabalhistas com banco", () => {
  let pool: pg.Pool;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: URL_TESTE });
    const sql = ["001_init.sql", "003_andamento_tribunal.sql", "004_robo_email.sql"]
      .map((f) => readFileSync(join(import.meta.dir, "../../../dp-processos-trabalhistas/sql", f), "utf8"))
      .join("\n");
    await pool.query("DROP SCHEMA IF EXISTS dp_processos_trabalhistas CASCADE; CREATE SCHEMA dp_processos_trabalhistas;");
    await pool.query(`SET search_path = dp_processos_trabalhistas; ${sql}`);
  });
  afterAll(async () => {
    await closeProcessosPool();
    await pool?.end();
  });

  it("cria, altera a etapa, vê no painel e no histórico com o e-mail de quem mexeu", async () => {
    const numero = `0004567-${digitoCnj("0004567", "2026", "5", "04", "0012")}.2026.5.04.0012`;
    const criado = await gql(
      `mutation($d: DpProcessoDados!) { dpProcessoCriar(dados: $d) { id numero etapaNome situacaoPrazo responsavel } }`,
      { d: { empresaNome: "Empresa Exemplo Ltda", numero, prazo: "2020-01-01" } },
      DP,
    );
    expect(criado.errors).toBeUndefined();
    const p = criado.data!.dpProcessoCriar;
    expect(p).toMatchObject({ numero, etapaNome: "Novo", situacaoPrazo: "VENCIDO", responsavel: null });

    const painel = (await gql(PAINEL, {}, DP)).data!.dpProcessosPainel;
    expect(painel.eu).toBe("ana@example.com");
    expect(painel.hoje).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(painel.processos.map((x: { id: string }) => x.id)).toEqual([p.id]);
    const encerrado = painel.etapas.find((e: { nome: string }) => e.nome === "Encerrado");

    const alterado = await gql(
      `mutation($id: ID!, $d: DpProcessoDados!) { dpProcessoAlterar(id: $id, dados: $d) { etapaNome situacaoPrazo historico { autor mudancas { campo antes depois } } } }`,
      { id: p.id, d: { etapaId: encerrado.id } },
      { ...DP, email: "bia@example.com" },
    );
    expect(alterado.data!.dpProcessoAlterar).toMatchObject({ etapaNome: "Encerrado", situacaoPrazo: "SEM_PRAZO" });
    expect(alterado.data!.dpProcessoAlterar.historico[0]).toEqual({
      autor: "bia@example.com",
      mudancas: [{ campo: "Etapa", antes: "Novo", depois: "Encerrado" }],
    });
  });

  it("andamento no tribunal: nulo antes da consulta, depois o que o DataJud trouxe", async () => {
    const { id } = (await gql(`mutation { dpProcessoCriar(dados: { empresaNome: "C" }) { id andamento { situacao } } }`, {}, DP)).data!.dpProcessoCriar;
    expect((await gql(`query($id: ID!) { dpProcesso(id: $id) { andamento { situacao } } }`, { id }, DP)).data!.dpProcesso.andamento).toBeNull();
    await pool.query(
      `INSERT INTO dp_processos_trabalhistas.andamento_tribunal (processo_id, consultado_em, encontrado, situacao, situacao_em, ultima_movimentacao, orgao)
       VALUES ($1, now(), true, 'Liquidação iniciada', '2026-08-25', '2026-09-16', '1ª VARA DO TRABALHO DE EXEMPLO')`,
      [id],
    );
    const r = await gql(`query($id: ID!) { dpProcesso(id: $id) { andamento { encontrado situacao situacaoEm ultimaMovimentacao orgao consultadoEm erro } } }`, { id }, DP);
    expect(r.data!.dpProcesso.andamento).toMatchObject({
      encontrado: true,
      situacao: "Liquidação iniciada",
      situacaoEm: "2026-08-25",
      ultimaMovimentacao: "2026-09-16",
      orgao: "1ª VARA DO TRABALHO DE EXEMPLO",
      erro: null,
    });
    expect(r.data!.dpProcesso.andamento.consultadoEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("linha do tempo e selo: e-mail novo aparece no processo e some ao marcar visto", async () => {
    const { id } = (await gql(`mutation { dpProcessoCriar(dados: { empresaNome: "D" }) { id emails novoEmail linhaDoTempo { id } } }`, {}, DP)).data!.dpProcessoCriar;
    const { rows } = await pool.query(
      `INSERT INTO dp_processos_trabalhistas.email (message_id, caixa, pasta, recebido_em, de_nome, assunto, resumo, anexos)
       VALUES ('<m1@x>', 'carla@example.com', 'Caixa de Entrada', '2026-10-26T14:20:18Z', 'Advogado', 'Inclusão', 'Dr. Silva', '["relatorio.pdf"]') RETURNING id`,
    );
    await pool.query(`INSERT INTO dp_processos_trabalhistas.email_processo (email_id, processo_id, novo) VALUES ($1, $2, true)`, [rows[0].id, id]);
    const q = `query($id: ID!) { dpProcesso(id: $id) { emails novoEmail linhaDoTempo { id recebidoEm deNome assunto resumo anexos caixa pasta link novo } } }`;
    const p = (await gql(q, { id }, DP)).data!.dpProcesso;
    expect(p).toMatchObject({ emails: 1, novoEmail: true });
    expect(p.linhaDoTempo).toEqual([
      {
        id: String(rows[0].id),
        recebidoEm: "2026-10-26T14:20:18.000Z",
        deNome: "Advogado",
        assunto: "Inclusão",
        resumo: "Dr. Silva",
        anexos: ["relatorio.pdf"],
        caixa: "carla@example.com",
        pasta: "Caixa de Entrada",
        link: null,
        novo: true,
      },
    ]);
    const visto = await gql(`mutation($id: ID!) { dpProcessoMarcarVisto(id: $id) { novoEmail emails } }`, { id }, DP);
    expect(visto.data!.dpProcessoMarcarVisto).toEqual({ novoEmail: false, emails: 1 });
  });

  it("regra recusada volta como BAD_USER_INPUT com a mensagem", async () => {
    const r = await gql(`mutation { dpProcessoCriar(dados: { empresaNome: "A", numero: "123" }) { id } }`, {}, DP);
    expect(r.errors?.[0]?.extensions?.code).toBe("BAD_USER_INPUT");
    expect(r.errors?.[0]?.message).toMatch(/20 dígitos/);
    const etapas = await gql(`mutation { dpProcessosListaCriar(lista: ETAPA, nome: "Novo") { id } }`, {}, DP);
    expect(etapas.errors?.[0]?.message).toBe('Já existe etapa "Novo"');
  });

  it("descartar e restaurar", async () => {
    const { id } = (await gql(`mutation { dpProcessoCriar(dados: { empresaNome: "B" }) { id } }`, {}, DP)).data!.dpProcessoCriar;
    await gql(`mutation($id: ID!) { dpProcessoDescartar(id: $id) { id } }`, { id }, DP);
    const descartados = (await gql("{ dpProcessosPainel(descartados: true) { processos { id descartadoPor } } }", {}, DP)).data!.dpProcessosPainel;
    expect(descartados.processos).toEqual([{ id, descartadoPor: "ana@example.com" }]);
    const r = await gql(`mutation($id: ID!) { dpProcessoRestaurar(id: $id) { descartadoEm } }`, { id }, DP);
    expect(r.data!.dpProcessoRestaurar.descartadoEm).toBeNull();
  });
});
