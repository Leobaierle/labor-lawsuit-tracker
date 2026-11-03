/**
 * Contra um Postgres LOCAL descartável (APAGA o schema dp_processos_trabalhistas).
 * Pulado sem DP_PROCESSOS_TEST_DATABASE_URL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { atualizarAndamentos, buscarProcesso, criarProcesso, descartarProcesso, digitoCnj, historicoDoProcesso, listarProcessos } from "../index.ts";

const URL_TESTE = process.env.DP_PROCESSOS_TEST_DATABASE_URL;
const SQL = ["001_init.sql", "003_andamento_tribunal.sql", "004_robo_email.sql"].map((f) => readFileSync(join(import.meta.dir, "../../sql", f), "utf8")).join("\n");
const numero = (n: string, j = "5") => `${n}-${digitoCnj(n, "2026", j, "04", "0261")}.2026.${j}.04.0261`;
const ANA = "ana@example.com";

const resposta = (movimentos: unknown[]) =>
  Response.json({ hits: { hits: movimentos.length ? [{ _source: { grau: "G1", orgaoJulgador: { nome: "VARA DE MONTENEGRO" }, movimentos } }] : [] } });

describe.skipIf(!URL_TESTE)("andamento no tribunal no banco", () => {
  let pool: pg.Pool;
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: URL_TESTE });
  });
  beforeEach(async () => {
    await pool.query("DROP SCHEMA IF EXISTS dp_processos_trabalhistas CASCADE; CREATE SCHEMA dp_processos_trabalhistas;");
    await pool.query(`SET search_path = dp_processos_trabalhistas; ${SQL}`);
  });
  afterAll(async () => {
    await pool?.end();
  });

  it("consulta só os da Justiça do Trabalho, não descartados; grava sem mexer no histórico; uma vez por semana", async () => {
    const achado = await criarProcesso(pool, ANA, { empresaNome: "HM", numero: numero("0020524") });
    const sumido = await criarProcesso(pool, ANA, { empresaNome: "HM", numero: numero("0020525") });
    await criarProcesso(pool, ANA, { empresaNome: "HM", numero: numero("0020526", "8") });
    await criarProcesso(pool, ANA, { empresaNome: "HM" });
    await descartarProcesso(pool, ANA, (await criarProcesso(pool, ANA, { empresaNome: "HM", numero: numero("0020527") })).id);

    const pedidos: string[] = [];
    const fetch = async (_url: string, init: RequestInit) => {
      const n = JSON.parse(String(init.body)).query.match.numeroProcesso as string;
      pedidos.push(n);
      return n.startsWith("0020524")
        ? resposta([{ dataHora: "2026-08-03T15:00:00Z", codigo: 12749, nome: "Audiência", complementosTabelados: [{ nome: "designada" }] }])
        : resposta([]);
    };
    expect(await atualizarAndamentos(pool, { fetch })).toEqual({ consultados: 2, encontrados: 1, erros: 0 });
    expect(pedidos.sort()).toEqual([numero("0020524"), numero("0020525")].map((n) => n.replace(/\D/g, "")));

    expect((await buscarProcesso(pool, achado.id))!.andamento).toMatchObject({
      encontrado: true,
      situacao: "Audiência de instrução designada",
      situacaoEm: "2026-08-03",
      ultimaMovimentacao: "2026-08-03",
      orgao: "VARA DE MONTENEGRO",
      erro: null,
    });
    expect((await buscarProcesso(pool, sumido.id))!.andamento).toMatchObject({ encontrado: false, situacao: null });
    expect((await listarProcessos(pool)).filter((p) => p.andamento == null)).toHaveLength(2);
    expect(await historicoDoProcesso(pool, achado.id)).toHaveLength(1);

    // logo depois não consulta de novo; com a consulta de 8 dias atrás, sim
    expect(await atualizarAndamentos(pool, { fetch })).toEqual({ consultados: 0, encontrados: 0, erros: 0 });
    await pool.query(`UPDATE dp_processos_trabalhistas.andamento_tribunal SET tentado_em = now() - interval '8 days' WHERE processo_id = $1`, [achado.id]);
    expect(await atualizarAndamentos(pool, { fetch })).toEqual({ consultados: 1, encontrados: 1, erros: 0 });
  });

  it("falha guarda o erro e mantém o andamento anterior; tenta de novo depois de 6 horas", async () => {
    const p = await criarProcesso(pool, ANA, { empresaNome: "HM", numero: numero("0020524") });
    const ok = async () => resposta([{ dataHora: "2026-08-25T15:00:00Z", codigo: 11384, nome: "Liquidação" }]);
    await atualizarAndamentos(pool, { fetch: ok });
    await pool.query(`UPDATE dp_processos_trabalhistas.andamento_tribunal SET tentado_em = now() - interval '8 days'`);

    let chamadas = 0;
    const fora = async () => (chamadas++, new Response("fora do ar", { status: 503 }));
    expect(await atualizarAndamentos(pool, { fetch: fora, tentativas: 2, esperaMs: 0 })).toEqual({ consultados: 0, encontrados: 0, erros: 1 });
    expect(chamadas).toBe(2);
    const a = (await buscarProcesso(pool, p.id))!.andamento!;
    expect(a).toMatchObject({ situacao: "Liquidação iniciada", erro: "DataJud respondeu 503: fora do ar" });

    expect(await atualizarAndamentos(pool, { fetch: ok })).toEqual({ consultados: 0, encontrados: 0, erros: 0 });
    await pool.query(`UPDATE dp_processos_trabalhistas.andamento_tribunal SET tentado_em = now() - interval '7 hours'`);
    expect(await atualizarAndamentos(pool, { fetch: ok })).toEqual({ consultados: 1, encontrados: 1, erros: 0 });
    expect((await buscarProcesso(pool, p.id))!.andamento!.erro).toBeNull();
  });
});
