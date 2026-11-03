import { atualizarAndamentos, getProcessosPool } from "@app/dp-processos-trabalhistas";

/**
 * Andamento no tribunal dos processos trabalhistas (API pública do DataJud/CNJ). De hora em hora o pod olha quem
 * está com a consulta vencida (mais de 7 dias, ou falha há mais de 6 horas, ou nunca consultado) — na prática
 * cada processo é consultado uma vez por semana e um processo novo entra na hora seguinte. Só grava a tabela
 * andamento_tribunal: a etapa é do DP e o robô não mexe nela.
 * Desligar: DP_PROCESSOS_ANDAMENTO=desligado. Chave do DataJud: a pública do CNJ, ou DATAJUD_API_KEY se o CNJ trocar.
 */
const HORA = 60 * 60 * 1000;

let rodando = false;

const rodar = async () => {
  if (rodando) return;
  rodando = true;
  const inicio = Date.now();
  try {
    const r = await atualizarAndamentos(getProcessosPool(), { chave: process.env.DATAJUD_API_KEY || undefined });
    if (r.consultados || r.erros) {
      console.log(
        `[andamento-tribunal] ${r.consultados} consultados (${r.encontrados} no DataJud), ${r.erros} com erro, ${Math.round((Date.now() - inicio) / 1000)}s`,
      );
    }
  } catch (e) {
    console.error("[andamento-tribunal] falhou:", e);
  } finally {
    rodando = false;
  }
};

export const iniciarAndamentoTribunal = () => {
  if (!process.env.DP_PROCESSOS_DATABASE_URL || process.env.DP_PROCESSOS_ANDAMENTO === "desligado") return;
  setTimeout(() => void rodar(), 60_000); // primeira rodada um minuto depois de subir
  setInterval(() => void rodar(), HORA);
  console.log("[andamento-tribunal] atualização do DataJud ligada (de hora em hora, cada processo uma vez por semana)");
};
