import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Cifra dos refresh tokens das caixas (AES-256-GCM). A chave fica fora do banco, em
 * DP_PROCESSOS_EMAIL_CHAVE (32 bytes em base64): quem lê o banco sozinho não lê e-mail de ninguém.
 */

export const chaveDoAmbiente = (): Buffer => {
  const bruta = process.env.DP_PROCESSOS_EMAIL_CHAVE;
  if (!bruta) throw new Error("DP_PROCESSOS_EMAIL_CHAVE is not set");
  const chave = Buffer.from(bruta, "base64");
  if (chave.length !== 32) throw new Error("DP_PROCESSOS_EMAIL_CHAVE deve ter 32 bytes em base64");
  return chave;
};

/** `v1.<iv>.<tag>.<texto cifrado>`, tudo base64url. */
export const cifrar = (chave: Buffer, texto: string): string => {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave, iv);
  const cifrado = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return ["v1", iv, c.getAuthTag(), cifrado].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
};

export const decifrar = (chave: Buffer, valor: string): string => {
  const [versao, iv, tag, cifrado] = valor.split(".");
  if (versao !== "v1" || !iv || !tag || cifrado === undefined) throw new Error("token cifrado em formato desconhecido");
  const d = createDecipheriv("aes-256-gcm", chave, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(cifrado, "base64url")), d.final()]).toString("utf8");
};

/** Texto assinado (HMAC-SHA256) que viaja pela Microsoft e volta: `<dados>.<assinatura>`. */
export const assinar = (segredo: string, dados: object): string => {
  const corpo = Buffer.from(JSON.stringify(dados)).toString("base64url");
  return `${corpo}.${createHmac("sha256", segredo).update(corpo).digest("base64url")}`;
};

export const lerAssinado = <T>(segredo: string, valor: string): T | null => {
  const [corpo, assinatura] = valor.split(".");
  if (!corpo || !assinatura) return null;
  const esperada = createHmac("sha256", segredo).update(corpo).digest();
  const recebida = Buffer.from(assinatura, "base64url");
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) return null;
  try {
    return JSON.parse(Buffer.from(corpo, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
};
