/**
 * "Conectar meu e-mail" no subgraph: acesso, aviso de não configurado e a URL do login da Microsoft.
 * O fluxo completo (troca do código, banco) é testado no pacote dp-processos-trabalhistas.
 */
import { describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { sign } from "hono/jwt";

const SEGREDO = "segredo-de-teste";
process.env.JWT_SECRET = SEGREDO;

const { default: app } = await import("../index.ts");

const DP = { role: "user", platforms: ["dp"], email: "Ana@example.com" };
const VARS = ["DP_PROCESSOS_EMAIL_TENANT_ID", "DP_PROCESSOS_EMAIL_CLIENT_ID", "DP_PROCESSOS_EMAIL_CLIENT_SECRET", "DP_PROCESSOS_EMAIL_CHAVE"];

const gql = async (query: string, claims?: Record<string, unknown>) => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (claims) headers.authorization = `Bearer ${await sign({ sub: "u1", exp: Math.floor(Date.now() / 1000) + 600, ...claims }, SEGREDO, "HS256")}`;
  const r = await app.fetch(new Request("http://x/graphql", { method: "POST", headers, body: JSON.stringify({ query }) }));
  return (await r.json()) as { data?: Record<string, any>; errors?: Array<{ message: string; extensions?: { code?: string } }> };
};

const comAmbiente = async (valores: Record<string, string>, fn: () => Promise<void>) => {
  const antes = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
  Object.assign(process.env, valores);
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(antes)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
};

describe("conectar e-mail", () => {
  it("sem sessão: UNAUTHENTICATED; sem dp: FORBIDDEN", async () => {
    expect((await gql("mutation { dpEmailIniciarConexao }")).errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
    expect((await gql("mutation { dpEmailIniciarConexao }", { role: "user", platforms: ["fiscal"] })).errors?.[0]?.extensions?.code).toBe("FORBIDDEN");
  });

  it("sem o app do Entra configurado: iniciar avisa com código próprio", async () => {
    await comAmbiente({}, async () => {
      for (const v of VARS) delete process.env[v];
      const r = await gql("mutation { dpEmailIniciarConexao }", DP);
      expect(r.errors?.[0]?.extensions?.code).toBe("DP_PROCESSOS_EMAIL_NOT_CONFIGURED");
    });
  });

  it("configurado: devolve o login da Microsoft com o state de quem pediu", async () => {
    const vars = {
      DP_PROCESSOS_EMAIL_TENANT_ID: "tenant-x",
      DP_PROCESSOS_EMAIL_CLIENT_ID: "cliente-x",
      DP_PROCESSOS_EMAIL_CLIENT_SECRET: "s",
      DP_PROCESSOS_EMAIL_CHAVE: randomBytes(32).toString("base64"),
    };
    await comAmbiente(vars, async () => {
      const url = new URL((await gql("mutation { dpEmailIniciarConexao }", DP)).data!.dpEmailIniciarConexao);
      expect(url.host).toBe("login.microsoftonline.com");
      expect(url.pathname).toBe("/tenant-x/oauth2/v2.0/authorize");
      expect(url.searchParams.get("client_id")).toBe("cliente-x");
      const corpo = url.searchParams.get("state")!.split(".")[0]!;
      expect(JSON.parse(Buffer.from(corpo, "base64url").toString()).u).toBe("ana@example.com");
    });
  });

  it("id inválido responde antes de olhar banco ou Microsoft", async () => {
    expect((await gql('mutation { dpEmailTestar(id: "x") { id } }', DP)).errors?.[0]?.extensions?.code).toBe("BAD_USER_INPUT");
  });
});
