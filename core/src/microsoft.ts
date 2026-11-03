import { createHash, createHmac } from "node:crypto";

/**
 * Conversa com a Microsoft para ler as caixas de e-mail: app do Entra próprio dos processos trabalhistas
 * (não é o do login do console), fluxo de código com segredo do cliente + PKCE, permissões delegadas.
 * O verificador do PKCE é derivado do nonce do state com o segredo do servidor, então não precisa ser
 * guardado entre o início e a volta.
 */

export const ESCOPOS = "openid profile email offline_access User.Read Mail.Read Mail.Read.Shared";
const REDIRECT_PADRAO = "https://dp.example.com/conectar-email";
const GRAPH = "https://graph.microsoft.com/v1.0";

export type ConfigMicrosoft = { tenantId: string; clientId: string; clientSecret: string; redirectUri: string };

/** null quando o app do Entra ainda não foi configurado. */
export const configDoAmbiente = (): ConfigMicrosoft | null => {
  const tenantId = process.env.DP_PROCESSOS_EMAIL_TENANT_ID;
  const clientId = process.env.DP_PROCESSOS_EMAIL_CLIENT_ID;
  const clientSecret = process.env.DP_PROCESSOS_EMAIL_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) return null;
  return { tenantId, clientId, clientSecret, redirectUri: process.env.DP_PROCESSOS_EMAIL_REDIRECT_URI ?? REDIRECT_PADRAO };
};

/** Erro devolvido pela Microsoft (login ou Graph), com o código dela para a mensagem da tela. */
export class ErroMicrosoft extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
    readonly status: number,
  ) {
    super(mensagem);
    this.name = "ErroMicrosoft";
  }
}

export const verificadorPkce = (segredo: string, nonce: string): string =>
  createHmac("sha256", segredo).update(`pkce:${nonce}`).digest("base64url");

const desafioPkce = (verificador: string): string => createHash("sha256").update(verificador).digest("base64url");

export const urlDeAutorizacao = (cfg: ConfigMicrosoft, state: string, verificador: string): string => {
  const url = new URL(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", ESCOPOS);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", desafioPkce(verificador));
  url.searchParams.set("code_challenge_method", "S256");
  // sempre deixa escolher a conta: a pessoa pode estar logada como ela e querer conectar a dp@
  url.searchParams.set("prompt", "select_account");
  return url.toString();
};

export type Tokens = { accessToken: string; refreshToken: string };

const pedirToken = async (cfg: ConfigMicrosoft, campos: Record<string, string>): Promise<Tokens> => {
  const r = await fetch(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: ESCOPOS, ...campos }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await r.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!r.ok || !j.access_token || !j.refresh_token) {
    throw new ErroMicrosoft(j.error ?? `http_${r.status}`, (j.error_description ?? "").split("\r\n")[0] || `HTTP ${r.status}`, r.status);
  }
  return { accessToken: j.access_token, refreshToken: j.refresh_token };
};

export const trocarCodigo = (cfg: ConfigMicrosoft, code: string, verificador: string): Promise<Tokens> =>
  pedirToken(cfg, { grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri, code_verifier: verificador });

/** A Microsoft devolve um refresh token novo a cada renovação: guardar o novo. */
export const renovarToken = (cfg: ConfigMicrosoft, refreshToken: string): Promise<Tokens> =>
  pedirToken(cfg, { grant_type: "refresh_token", refresh_token: refreshToken });

export const graph = async <T>(accessToken: string, caminho: string): Promise<T> => {
  const r = await fetch(`${GRAPH}${caminho}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string } };
  if (!r.ok) throw new ErroMicrosoft(j.error?.code ?? `http_${r.status}`, j.error?.message ?? `HTTP ${r.status}`, r.status);
  return j;
};

export const quemSou = async (accessToken: string): Promise<{ email: string; nome: string | null }> => {
  const me = await graph<{ mail?: string | null; userPrincipalName?: string; displayName?: string | null }>(
    accessToken,
    "/me?$select=mail,userPrincipalName,displayName",
  );
  const email = (me.mail || me.userPrincipalName || "").trim().toLowerCase();
  if (!email) throw new ErroMicrosoft("sem_email", "A conta Microsoft não informou o e-mail", 200);
  return { email, nome: me.displayName?.trim() || null };
};

/** Total da Caixa de Entrada: prova que o token lê a caixa (a própria, ou uma compartilhada pelo endereço). */
export const totalCaixaEntrada = async (accessToken: string, caixaCompartilhada?: string): Promise<number> => {
  const dono = caixaCompartilhada ? `/users/${encodeURIComponent(caixaCompartilhada)}` : "/me";
  const pasta = await graph<{ totalItemCount?: number }>(accessToken, `${dono}/mailFolders/inbox?$select=totalItemCount`);
  return pasta.totalItemCount ?? 0;
};

/** Mensagem curta para a tela a partir do erro da Microsoft. */
export const explicarErro = (e: unknown): string => {
  if (!(e instanceof ErroMicrosoft)) return e instanceof Error ? e.message : String(e);
  if (e.codigo === "invalid_grant") return "A autorização expirou ou foi revogada. Conecte o e-mail de novo.";
  if (e.codigo === "ErrorAccessDenied" || e.codigo === "ErrorItemNotFound" || e.status === 403 || e.status === 404)
    return "Sem acesso a essa caixa (a conta conectada precisa ter permissão nela).";
  if (e.codigo === "MailboxNotEnabledForRESTAPI") return "Essa conta não tem caixa de e-mail no Exchange Online.";
  return `${e.codigo}: ${e.message}`.slice(0, 300);
};
