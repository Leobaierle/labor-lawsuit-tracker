/**
 * Contra um Postgres LOCAL descartável (APAGA o schema dp_processos_trabalhistas).
 * Pulado sem DP_PROCESSOS_TEST_DATABASE_URL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import {
  alterarProcesso,
  arquivarItem,
  criarItem,
  criarProcesso,
  descartarProcesso,
  digitoCnj,
  historicoDoProcesso,
  listarItens,
  listarProcessos,
  moverItem,
  renomearItem,
  responsaveisConhecidos,
  restaurarProcesso,
} from "../index.ts";

const URL_TESTE = process.env.DP_PROCESSOS_TEST_DATABASE_URL;
const SQL = ["001_init.sql", "003_andamento_tribunal.sql", "004_robo_email.sql"].map((f) => readFileSync(join(import.meta.dir, "../../sql", f), "utf8")).join("\n");
const numero = (n: string) => `${n}-${digitoCnj(n, "2026", "5", "04", "0001")}.2026.5.04.0001`;
const ANA = "ana@example.com";

describe.skipIf(!URL_TESTE)("processos trabalhistas no banco", () => {
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

  it("listas iniciais: seis etapas (Encerrado conta como fim) e três tipos; rodar o 001 de novo não duplica", async () => {
    await pool.query(`SET search_path = dp_processos_trabalhistas; ${SQL}`);
    const etapas = await listarItens(pool, "ETAPA");
    expect(etapas.map((e) => e.nome)).toEqual([
      "Novo",
      "Aguardando documentos / informações",
      "Em andamento",
      "Aguardando audiência / decisão",
      "Pós-decisão",
      "Encerrado",
    ]);
    expect(etapas.filter((e) => e.encerra).map((e) => e.nome)).toEqual(["Encerrado"]);
    expect((await listarItens(pool, "TIPO")).map((t) => t.nome)).toEqual(["Reclamatória trabalhista", "Acordo extrajudicial", "Outros"]);
  });

  it("cria na primeira etapa, sem responsável; histórico guarda quem criou", async () => {
    const p = await criarProcesso(pool, ANA, { empresaNome: "  Empresa   Exemplo Ltda ", numero: numero("0001234").replace(/\D/g, ""), reclamante: "Fulano" });
    expect(p).toMatchObject({ etapaNome: "Novo", responsavel: null, origem: "MANUAL", numero: numero("0001234"), empresaNome: "Empresa Exemplo Ltda", criadoPor: ANA });
    const h = await historicoDoProcesso(pool, p.id);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ acao: "INSERT", autor: ANA });
    expect(h[0]!.mudancas).toContainEqual({ campo: "Etapa", antes: null, depois: "Novo" });
  });

  it("número repetido é recusado, inclusive contra os descartados", async () => {
    const p = await criarProcesso(pool, ANA, { empresaNome: "A", numero: numero("0000001") });
    await expect(criarProcesso(pool, ANA, { empresaNome: "B", numero: numero("0000001") })).rejects.toThrow(/Já existe o processo/);
    await descartarProcesso(pool, ANA, p.id);
    await expect(criarProcesso(pool, ANA, { empresaNome: "B", numero: numero("0000001") })).rejects.toThrow(/nos descartados/);
    // sem número pode repetir
    await criarProcesso(pool, ANA, { empresaNome: "C" });
    await criarProcesso(pool, ANA, { empresaNome: "C" });
  });

  it("alteração muda só o que veio, null limpa, e o histórico mostra etapa e tipo pelo nome", async () => {
    const p = await criarProcesso(pool, ANA, { empresaNome: "A", prazo: "2026-10-30" });
    const [, , andamento] = await listarItens(pool, "ETAPA");
    const [reclamatoria] = await listarItens(pool, "TIPO");
    const a = await alterarProcesso(pool, "bia@example.com", p.id, { etapaId: andamento!.id, tipoId: reclamatoria!.id, responsavel: ANA });
    expect(a).toMatchObject({ etapaNome: "Em andamento", tipoNome: "Reclamatória trabalhista", responsavel: ANA, prazo: "2026-10-30" });
    const b = await alterarProcesso(pool, ANA, p.id, { prazo: null });
    expect(b.prazo).toBeNull();
    const h = await historicoDoProcesso(pool, p.id);
    expect(h[1]).toMatchObject({ autor: "bia@example.com" });
    expect(h[1]!.mudancas).toEqual([
      { campo: "Tipo", antes: null, depois: "Reclamatória trabalhista" },
      { campo: "Etapa", antes: "Novo", depois: "Em andamento" },
      { campo: "Responsável", antes: null, depois: ANA },
    ]);
    expect(h[0]!.mudancas).toEqual([{ campo: "Prazo", antes: "2026-10-30", depois: null }]);
    // alteração sem mudança não vira evento
    await alterarProcesso(pool, ANA, p.id, { prazo: null });
    expect(await historicoDoProcesso(pool, p.id)).toHaveLength(3);
    expect(await responsaveisConhecidos(pool)).toEqual([ANA]);
  });

  it("descartar tira da lista e restaurar devolve; etapa removida nesse meio tempo volta para a primeira", async () => {
    const etapa = (await criarItem(pool, ANA, "ETAPA", "Perícia")).find((e) => e.nome === "Perícia")!;
    const p = await criarProcesso(pool, ANA, { empresaNome: "A", etapaId: etapa.id });
    await descartarProcesso(pool, ANA, p.id);
    expect(await listarProcessos(pool)).toHaveLength(0);
    expect((await listarProcessos(pool, { descartados: true })).map((x) => x.id)).toEqual([p.id]);
    await arquivarItem(pool, ANA, "ETAPA", etapa.id);
    const r = await restaurarProcesso(pool, ANA, p.id);
    expect(r).toMatchObject({ etapaNome: "Novo", descartadoEm: null });
    await expect(restaurarProcesso(pool, ANA, p.id)).rejects.toThrow(/não está nos descartados/);
  });

  it("etapas: nova entra antes de Encerrado, renomeia, troca de lugar; não remove com processo nem nome repetido", async () => {
    let etapas = await criarItem(pool, ANA, "ETAPA", "Perícia");
    expect(etapas.map((e) => e.nome).slice(-2)).toEqual(["Perícia", "Encerrado"]);
    const pericia = etapas.find((e) => e.nome === "Perícia")!;
    etapas = await moverItem(pool, ANA, "ETAPA", pericia.id, -1);
    expect(etapas.map((e) => e.nome).slice(-3)).toEqual(["Perícia", "Pós-decisão", "Encerrado"]);
    etapas = await renomearItem(pool, ANA, "ETAPA", pericia.id, "Perícia técnica");
    expect(etapas.some((e) => e.nome === "Perícia técnica")).toBe(true);
    await expect(criarItem(pool, ANA, "ETAPA", "novo")).rejects.toThrow(/Já existe etapa/);
    await criarProcesso(pool, ANA, { empresaNome: "A", etapaId: pericia.id });
    await expect(arquivarItem(pool, ANA, "ETAPA", pericia.id)).rejects.toThrow(/tem 1 processo/);
    // na ponta não mexe
    const novo = etapas[0]!;
    expect((await moverItem(pool, ANA, "ETAPA", novo.id, -1)).map((e) => e.id)).toEqual(etapas.map((e) => e.id));
  });

  it("tipos: novo vai para o fim e removido some da lista", async () => {
    const tipos = await criarItem(pool, ANA, "TIPO", "Execução");
    expect(tipos.at(-1)!.nome).toBe("Execução");
    expect((await arquivarItem(pool, ANA, "TIPO", tipos.at(-1)!.id)).map((t) => t.nome)).not.toContain("Execução");
    // nome de removido pode voltar
    await criarItem(pool, ANA, "TIPO", "Execução");
  });
});
