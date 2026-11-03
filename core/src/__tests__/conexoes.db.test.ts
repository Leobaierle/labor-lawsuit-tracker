/**
 * Conexões de e-mail contra um Postgres LOCAL descartável (APAGA o schema dp_processos_trabalhistas), com a
 * Microsoft simulada (fetch trocado). Pulado sem DP_PROCESSOS_TEST_DATABASE_URL.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import {
  adicionarCaixaCompartilhada,
  concluirConexao,
  decifrar,
  desconectar,
  iniciarConexao,
  listarConexoes,
  removerCaixaCompartilhada,
  testarConexao,
  type AmbienteEmail,
} from "../index.ts";

const URL_TESTE = process.env.DP_PROCESSOS_TEST_DATABASE_URL;
const SQL = ["001_init.sql", "002_conexao_email.sql", "003_andamento_tribunal.sql", "004_robo_email.sql"].map((f) => readFileSync(join(import.meta.dir, "../../sql", f), "utf8")).join("\n");
const ANA = "ana@example.com";

const amb: AmbienteEmail = {
  cfg: { tenantId: "t1", clientId: "c1", clientSecret: "s1", redirectUri: "https://dp.example.com/conectar-email" },
  chave: randomBytes(32),
  segredo: "segredo-de-teste",
};

/** Microsoft de mentira: conta logada, caixas que ela lê e a sequência de refresh tokens. */
const ms = { conta: ANA, nome: "Ana Souza", le: new Set([ANA]), refresh: 0, recusaRefresh: false, pedidos: [] as string[] };
const json = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
const fetchFalso = async (entrada: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = new URL(String(entrada instanceof Request ? entrada.url : entrada));
  if (url.pathname.endsWith("/oauth2/v2.0/token")) {
    const corpo = new URLSearchParams(String(init?.body));
    ms.pedidos.push(`${corpo.get("grant_type")}:${corpo.get("code") ?? corpo.get("refresh_token")}`);
    if (corpo.get("grant_type") === "refresh_token" && ms.recusaRefresh)
      return json(400, { error: "invalid_grant", error_description: "AADSTS700082: expired\r\nTrace" });
    if (corpo.get("grant_type") === "authorization_code" && corpo.get("code") === "ruim")
      return json(400, { error: "invalid_grant", error_description: "AADSTS54005: code already redeemed" });
    ms.refresh += 1;
    return json(200, { access_token: `at-${ms.conta}`, refresh_token: `rt-${ms.refresh}` });
  }
  if (url.pathname === "/v1.0/me") return json(200, { mail: null, userPrincipalName: ms.conta.toUpperCase(), displayName: ms.nome });
  const caixa = url.pathname.match(/^\/v1\.0\/users\/([^/]+)\/mailFolders\/inbox$/)?.[1];
  if (url.pathname === "/v1.0/me/mailFolders/inbox" || caixa) {
    const alvo = caixa ? decodeURIComponent(caixa) : ms.conta;
    return ms.le.has(alvo) ? json(200, { totalItemCount: alvo.length }) : json(403, { error: { code: "ErrorAccessDenied", message: "Access is denied." } });
  }
  return json(404, { error: { code: "naoSimulado", message: url.pathname } });
};

const stateDe = (usuario: string, agora = Date.now()) => new URL(iniciarConexao(amb, usuario, agora)).searchParams.get("state")!;

describe.skipIf(!URL_TESTE)("conexões de e-mail no banco", () => {
  let pool: pg.Pool;
  let espiao: ReturnType<typeof spyOn>;
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: URL_TESTE });
  });
  beforeEach(async () => {
    await pool.query("DROP SCHEMA IF EXISTS dp_processos_trabalhistas CASCADE; CREATE SCHEMA dp_processos_trabalhistas;");
    await pool.query(`SET search_path = dp_processos_trabalhistas; ${SQL}`);
    Object.assign(ms, { conta: ANA, nome: "Ana Souza", le: new Set([ANA]), refresh: 0, recusaRefresh: false, pedidos: [] });
    espiao = spyOn(globalThis, "fetch").mockImplementation(fetchFalso as typeof fetch);
  });
  afterEach(() => espiao.mockRestore());
  afterAll(async () => {
    await pool?.end();
  });

  it("conecta: guarda o token cifrado, o dono pelo /me e o total da caixa; reconectar reaproveita a linha", async () => {
    const c = await concluirConexao(pool, amb, ANA, "codigo-1", stateDe(ANA));
    expect(c).toMatchObject({ caixa: ANA, nome: "Ana Souza", conectada: true, conectadoPor: ANA, totalCaixaEntrada: ANA.length, ultimoErro: null });
    const { rows } = await pool.query("SELECT refresh_token_cifrado FROM dp_processos_trabalhistas.conexao_email");
    expect(rows[0].refresh_token_cifrado).not.toContain("rt-1");
    expect(decifrar(amb.chave, rows[0].refresh_token_cifrado)).toBe("rt-1");

    await desconectar(pool, c.id, ANA);
    const de_novo = await concluirConexao(pool, amb, ANA, "codigo-2", stateDe(ANA));
    expect(de_novo.id).toBe(c.id);
    expect(de_novo.conectada).toBe(true);
    expect((await listarConexoes(pool)).length).toBe(1);
  });

  it("recusa state de outra pessoa, vencido, código ruim e conta de fora", async () => {
    await expect(concluirConexao(pool, amb, ANA, "c", stateDe("bia@example.com"))).rejects.toThrow("outra sessão");
    await expect(concluirConexao(pool, amb, ANA, "c", stateDe(ANA, Date.now() - 11 * 60_000))).rejects.toThrow("expirou");
    await expect(concluirConexao(pool, amb, ANA, "c", "lixo.lixo")).rejects.toThrow("expirou");
    await expect(concluirConexao(pool, amb, ANA, "ruim", stateDe(ANA))).rejects.toThrow("A Microsoft recusou a conexão");
    ms.conta = "fulano@gmail.com";
    await expect(concluirConexao(pool, amb, ANA, "c", stateDe(ANA))).rejects.toThrow("Só contas @example.com");
    expect(await listarConexoes(pool)).toEqual([]);
  });

  it("testar renova e guarda o refresh novo; autorização revogada vira erro na conexão", async () => {
    const c = await concluirConexao(pool, amb, ANA, "codigo-1", stateDe(ANA));
    const t = await testarConexao(pool, amb, c.id);
    expect(t.ultimoErro).toBeNull();
    expect(ms.pedidos).toEqual(["authorization_code:codigo-1", "refresh_token:rt-1"]);
    const { rows } = await pool.query("SELECT refresh_token_cifrado FROM dp_processos_trabalhistas.conexao_email");
    expect(decifrar(amb.chave, rows[0].refresh_token_cifrado)).toBe("rt-2");

    ms.recusaRefresh = true;
    const falha = await testarConexao(pool, amb, c.id);
    expect(falha.conectada).toBe(true);
    expect(falha.ultimoErro).toContain("Conecte o e-mail de novo");
  });

  it("caixa compartilhada: entra só se a conta lê; não repete; conectar direto tira da compartilhada", async () => {
    const c = await concluirConexao(pool, amb, ANA, "codigo-1", stateDe(ANA));
    await expect(adicionarCaixaCompartilhada(pool, amb, c.id, "dp@example.com", ANA)).rejects.toThrow("não consegue ler dp@");
    await expect(adicionarCaixaCompartilhada(pool, amb, c.id, "dp@gmail.com", ANA)).rejects.toThrow("Só caixas");
    ms.le.add("dp@example.com");
    const com = await adicionarCaixaCompartilhada(pool, amb, c.id, " DP@example.com ", ANA);
    expect(com.compartilhadas).toMatchObject([{ endereco: "dp@example.com", adicionadaPor: ANA, totalCaixaEntrada: 21, ultimoErro: null }]);
    await expect(adicionarCaixaCompartilhada(pool, amb, c.id, "dp@example.com", ANA)).rejects.toThrow("já é lida pela conexão de ana@");
    await expect(adicionarCaixaCompartilhada(pool, amb, c.id, ANA, ANA)).rejects.toThrow("já está conectada");

    ms.le.delete("dp@example.com");
    const t = await testarConexao(pool, amb, c.id);
    expect(t.compartilhadas[0]?.ultimoErro).toContain("Sem acesso");

    const sem = await removerCaixaCompartilhada(pool, com.compartilhadas[0]!.id);
    expect(sem.compartilhadas).toEqual([]);

    ms.le.add("dp@example.com");
    await adicionarCaixaCompartilhada(pool, amb, c.id, "dp@example.com", ANA);
    Object.assign(ms, { conta: "dp@example.com", nome: "DP" });
    await concluirConexao(pool, amb, ANA, "codigo-dp", stateDe(ANA));
    const todas = await listarConexoes(pool);
    expect(todas.map((x) => [x.caixa, x.compartilhadas.length])).toEqual([
      [ANA, 0],
      ["dp@example.com", 0],
    ]);
  });

  it("desconectar apaga o token e não deixa desconectar duas vezes", async () => {
    const c = await concluirConexao(pool, amb, ANA, "codigo-1", stateDe(ANA));
    const d = await desconectar(pool, c.id, "bia@example.com");
    expect(d).toMatchObject({ conectada: false, desconectadoPor: "bia@example.com" });
    await expect(desconectar(pool, c.id, ANA)).rejects.toThrow("já está desconectada");
    await expect(testarConexao(pool, amb, c.id)).rejects.toThrow("está desconectada");
  });
});
