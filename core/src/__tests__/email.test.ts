import { describe, expect, it } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { assinar, cifrar, decifrar, lerAssinado } from "../cifra.ts";
import { iniciarConexao, type AmbienteEmail } from "../conexoes.ts";
import { ESCOPOS, explicarErro, ErroMicrosoft, verificadorPkce } from "../microsoft.ts";

const amb: AmbienteEmail = {
  cfg: { tenantId: "t1", clientId: "c1", clientSecret: "s1", redirectUri: "https://dp.example.com/conectar-email" },
  chave: randomBytes(32),
  segredo: "segredo-de-teste",
};

describe("cifra dos tokens", () => {
  it("ida e volta; outra chave ou texto adulterado não abrem", () => {
    const c = cifrar(amb.chave, "refresh-token-123");
    expect(c.startsWith("v1.")).toBe(true);
    expect(c).not.toContain("refresh-token-123");
    expect(decifrar(amb.chave, c)).toBe("refresh-token-123");
    expect(cifrar(amb.chave, "x")).not.toBe(cifrar(amb.chave, "x")); // iv novo a cada vez
    expect(() => decifrar(randomBytes(32), c)).toThrow();
    const partes = c.split(".");
    partes[3] = Buffer.from("outro texto").toString("base64url");
    expect(() => decifrar(amb.chave, partes.join("."))).toThrow();
  });

  it("assinatura do state: só volta o que o servidor assinou", () => {
    const s = assinar("k", { u: "ana@example.com", n: "1", exp: 9 });
    expect(lerAssinado<{ u: string }>("k", s)?.u).toBe("ana@example.com");
    expect(lerAssinado("outra", s)).toBeNull();
    const [corpo, sig] = s.split(".");
    const trocado = Buffer.from(JSON.stringify({ u: "bia@example.com", n: "1", exp: 9 })).toString("base64url");
    expect(lerAssinado("k", `${trocado}.${sig}`)).toBeNull();
    expect(lerAssinado("k", corpo!)).toBeNull();
  });
});

describe("início da conexão", () => {
  it("leva ao login da Microsoft do tenant com escopos, PKCE e state de quem clicou", () => {
    const url = new URL(iniciarConexao(amb, "ana@example.com", 1_000_000));
    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/t1/oauth2/v2.0/authorize");
    const q = url.searchParams;
    expect(q.get("client_id")).toBe("c1");
    expect(q.get("redirect_uri")).toBe(amb.cfg.redirectUri);
    expect(q.get("scope")).toBe(ESCOPOS);
    expect(q.get("prompt")).toBe("select_account");
    const state = lerAssinado<{ u: string; n: string; exp: number }>(amb.segredo, q.get("state")!);
    expect(state).toMatchObject({ u: "ana@example.com", exp: 1000 + 600 });
    const desafio = createHash("sha256").update(verificadorPkce(amb.segredo, state!.n)).digest("base64url");
    expect(q.get("code_challenge")).toBe(desafio);
    expect(q.get("code_challenge_method")).toBe("S256");
  });
});

describe("explicarErro", () => {
  it("traduz os erros comuns da Microsoft", () => {
    expect(explicarErro(new ErroMicrosoft("invalid_grant", "AADSTS70000", 400))).toContain("Conecte o e-mail de novo");
    expect(explicarErro(new ErroMicrosoft("ErrorAccessDenied", "Access is denied", 403))).toContain("Sem acesso");
    expect(explicarErro(new ErroMicrosoft("Outro", "detalhe", 500))).toBe("Outro: detalhe");
  });
});
