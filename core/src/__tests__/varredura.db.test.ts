/**
 * Contra um Postgres LOCAL descartável (APAGA o schema dp_processos_trabalhistas).
 * Pulado sem DP_PROCESSOS_TEST_DATABASE_URL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import {
  buscarProcesso,
  criarProcesso,
  digitoCnj,
  emailsDoProcesso,
  historicoDoProcesso,
  leiturasDasCaixas,
  lerCaixa,
  listarProcessos,
  marcarEmailsVistos,
  type LeitorCaixa,
  type MensagemEmail,
} from "../index.ts";

const URL_TESTE = process.env.DP_PROCESSOS_TEST_DATABASE_URL;
const SQL = ["001_init.sql", "002_conexao_email.sql", "003_andamento_tribunal.sql", "004_robo_email.sql"]
  .map((f) => readFileSync(join(import.meta.dir, "../../sql", f), "utf8"))
  .join("\n");
const numero = (n: string) => `${n}-${digitoCnj(n, "2026", "5", "01", "0265")}.2026.5.01.0265`;
const ANA = "ana@example.com";
const AGORA = new Date("2026-10-28T12:00:00Z");

const msg = (id: string, recebido: string, texto: string, extra: Partial<MensagemEmail> = {}): MensagemEmail => ({
  id,
  messageId: `<${id}@x>`,
  assunto: texto,
  deNome: "Advogado",
  deEmail: "advogado@escritorio.example",
  recebidoEm: new Date(recebido),
  temAnexos: false,
  corpo: `Corpo do ${id}`,
  link: null,
  ...extra,
});

/** Caixa falsa: guarda o "desde" de cada leitura e entrega só o que chegou depois dele. */
const leitor = (caixa: string, pastas: Record<string, MensagemEmail[]>, falhar = false) => {
  const desdes: Date[] = [];
  const l: LeitorCaixa = {
    caixa,
    pastas: async () => Object.keys(pastas).map((nome) => ({ id: nome, nome })),
    mensagens: async function* (pasta, desde) {
      desdes.push(desde);
      for (const m of pastas[pasta]!) if (m.recebidoEm >= desde) yield m;
      if (falhar) throw new Error("Microsoft respondeu 429: TooManyRequests");
    },
    anexos: async () => ["relatorio.pdf"],
  };
  return { l, desdes };
};

describe.skipIf(!URL_TESTE)("robô de e-mail no banco", () => {
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

  it("primeira leitura: 3 meses, liga aos processos sem selo e cria o que não existe; depois, a partir de onde parou, com selo", async () => {
    const existente = await criarProcesso(pool, ANA, { empresaNome: "SPE TLMC 22 Ltda", numero: numero("0100413") });
    const caixa = {
      "Caixa de Entrada": [
        msg("m1", "2026-10-20T10:00:00Z", `Processo ${numero("0100413")}`, { temAnexos: true }),
        msg("m2", "2026-10-21T10:00:00Z", "Almoço de sexta"),
      ],
      "Caixa de Entrada/Processos": [msg("m3", "2026-10-26T14:20:18Z", `Inclusão ${numero("0101637")} ref. ${numero("0100413")}`)],
    };
    const { l, desdes } = leitor("Carla@example.com", caixa);
    expect(await lerCaixa(pool, l, AGORA)).toEqual({ caixa: "carla@example.com", emails: 3, comProcesso: 2, processosNovos: 1, erro: null });
    expect(desdes[0]).toEqual(new Date(AGORA.getTime() - 92 * 864e5));

    const processos = await listarProcessos(pool);
    const novo = processos.find((p) => p.numero === numero("0101637"))!;
    expect(novo).toMatchObject({ empresaNome: "Empresa a identificar", etapaNome: "Novo", origem: "EMAIL", responsavel: null, emails: 1, novoEmail: false });
    expect(novo.criadoPor).toBe("robô de e-mail (carla@example.com)");
    expect((await historicoDoProcesso(pool, novo.id))[0]!.autor).toBe("robô de e-mail (carla@example.com)");
    expect(processos.find((p) => p.id === existente.id)).toMatchObject({ emails: 2, novoEmail: false });

    const linha = await emailsDoProcesso(pool, existente.id);
    expect(linha.map((e) => e.assunto)).toEqual([`Inclusão ${numero("0101637")} ref. ${numero("0100413")}`, `Processo ${numero("0100413")}`]);
    expect(linha[1]).toMatchObject({ anexos: ["relatorio.pdf"], pasta: "Caixa de Entrada", caixa: "carla@example.com", resumo: "Corpo do m1" });
    expect(linha[0]!.anexos).toEqual([]);

    // segunda leitura: um dia antes do último e-mail visto; o que já estava não duplica, o novo ganha selo
    caixa["Caixa de Entrada"].push(msg("m4", "2026-10-28T09:00:00Z", `Audiência ${numero("0100413")}`));
    expect(await lerCaixa(pool, l, AGORA)).toMatchObject({ emails: 2, comProcesso: 2, processosNovos: 0 });
    expect(desdes.at(-1)).toEqual(new Date("2026-10-25T14:20:18Z"));
    expect((await buscarProcesso(pool, existente.id))!).toMatchObject({ emails: 3, novoEmail: true });
    expect((await buscarProcesso(pool, novo.id))!).toMatchObject({ emails: 1, novoEmail: false });

    await marcarEmailsVistos(pool, existente.id);
    expect((await buscarProcesso(pool, existente.id))!.novoEmail).toBe(false);
    expect(await leiturasDasCaixas(pool)).toMatchObject([{ caixa: "carla@example.com", lidoAte: new Date("2026-10-28T09:00:00Z"), emails: 2, comProcesso: 2, erro: null }]);
  });

  it("mesmo e-mail em duas caixas = uma vez só; falha guarda o erro e não avança", async () => {
    const m = msg("m1", "2026-10-26T10:00:00Z", `Processo ${numero("0100413")}`);
    await lerCaixa(pool, leitor("carla@example.com", { Inbox: [m] }).l, AGORA);
    await lerCaixa(pool, leitor("dp@example.com", { Inbox: [m] }).l, AGORA);
    const [p] = await listarProcessos(pool);
    expect(p).toMatchObject({ emails: 1 });
    expect((await emailsDoProcesso(pool, p!.id))[0]!.caixa).toBe("carla@example.com");

    const antes = (await leiturasDasCaixas(pool)).find((x) => x.caixa === "dp@example.com")!;
    const r = await lerCaixa(pool, leitor("dp@example.com", { Inbox: [msg("m9", "2026-10-28T10:00:00Z", "x")] }, true).l, AGORA);
    expect(r.erro).toBe("Microsoft respondeu 429: TooManyRequests");
    const depois = (await leiturasDasCaixas(pool)).find((x) => x.caixa === "dp@example.com")!;
    expect(depois.lidoAte).toEqual(antes.lidoAte);
    expect(depois.erro).toBe("Microsoft respondeu 429: TooManyRequests");
  });
});
