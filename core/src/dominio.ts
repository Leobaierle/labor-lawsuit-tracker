/** Erro de entrada do usuário: o subgraph devolve como BAD_USER_INPUT, com a mensagem como está. */
export class EntradaInvalida extends Error {}

/**
 * Número único do processo (Resolução CNJ 65/2008): NNNNNNN-DD.AAAA.J.TR.OOOO, com dígito verificador
 * DD = 98 − (NNNNNNN AAAA J TR OOOO 00 mod 97). Aceita com ou sem pontuação; devolve formatado.
 */
export const normalizarNumeroCnj = (entrada: string): string => {
  const d = entrada.replace(/\D/g, "");
  if (d.length !== 20) {
    throw new EntradaInvalida(`Número do processo deve ter 20 dígitos (NNNNNNN-DD.AAAA.J.TR.OOOO): "${entrada.trim()}"`);
  }
  const [n, dv, ano, j, tr, origem] = [d.slice(0, 7), d.slice(7, 9), d.slice(9, 13), d.slice(13, 14), d.slice(14, 16), d.slice(16)];
  if (digitoCnj(n, ano, j, tr, origem) !== dv) {
    throw new EntradaInvalida(`Número do processo com dígito verificador errado: "${entrada.trim()}" — confira o número`);
  }
  return `${n}-${dv}.${ano}.${j}.${tr}.${origem}`;
};

export const digitoCnj = (n: string, ano: string, j: string, tr: string, origem: string): string =>
  String(98n - (BigInt(`${n}${ano}${j}${tr}${origem}00`) % 97n)).padStart(2, "0");

/** Responsável é um e-mail da Êxito (minúsculo); vazio = sem responsável. */
export const normalizarResponsavel = (entrada: string | null | undefined): string | null => {
  const v = (entrada ?? "").trim().toLowerCase();
  if (!v) return null;
  if (!/^[^@\s]+@example\.com$/.test(v)) {
    throw new EntradaInvalida(`Responsável deve ser um e-mail @example.com: "${v}"`);
  }
  return v;
};

export const textoObrigatorio = (rotulo: string, v: string | null | undefined, max: number): string => {
  const t = (v ?? "").trim().replace(/\s+/g, " ");
  if (!t) throw new EntradaInvalida(`${rotulo} é obrigatório`);
  if (t.length > max) throw new EntradaInvalida(`${rotulo}: no máximo ${max} caracteres`);
  return t;
};

export const textoOpcional = (rotulo: string, v: string | null | undefined, max: number): string | null => {
  const t = (v ?? "").trim().replace(/\s+/g, " ");
  if (!t) return null;
  if (t.length > max) throw new EntradaInvalida(`${rotulo}: no máximo ${max} caracteres`);
  return t;
};

/** AAAA-MM-DD válido no calendário; vazio = sem prazo. */
export const normalizarPrazo = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  if (!t) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const data = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!m || !data || data.toISOString().slice(0, 10) !== t) throw new EntradaInvalida(`Prazo inválido: "${t}" (use AAAA-MM-DD)`);
  return t;
};

export type SituacaoPrazo = "SEM_PRAZO" | "VENCIDO" | "PROXIMO" | "NO_PRAZO";

/** Hoje no fuso de Brasília, AAAA-MM-DD. */
export const hojeEmBrasilia = (agora = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);

const somarDiasUteis = (dia: string, n: number): string => {
  const d = new Date(`${dia}T12:00:00Z`);
  let faltam = n;
  while (faltam > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const semana = d.getUTCDay();
    if (semana !== 0 && semana !== 6) faltam--;
  }
  return d.toISOString().slice(0, 10);
};

/**
 * Vencido = prazo antes de hoje; próximo = até 3 dias úteis a partir de hoje (sábado e domingo não contam;
 * feriados ainda não). Processo em etapa que encerra não conta prazo.
 */
export const situacaoPrazo = (prazo: string | null, hoje: string, encerrado = false): SituacaoPrazo => {
  if (!prazo || encerrado) return "SEM_PRAZO";
  if (prazo < hoje) return "VENCIDO";
  if (prazo <= somarDiasUteis(hoje, 3)) return "PROXIMO";
  return "NO_PRAZO";
};
