import { ambienteEmail, getProcessosPool, varrerCaixas } from "@app/dp-processos-trabalhistas";

/**
 * Robô de e-mail dos processos trabalhistas (parte 3): de hora em hora lê, a partir de onde parou, a Caixa de
 * Entrada + subpastas de cada caixa conectada e das compartilhadas (dp@). Roda no próprio pod (e não num CronJob,
 * como previa o desenho) porque o PR de digest do build só atualiza Deployments: um CronJob ficaria com a imagem
 * velha. Desligar: DP_PROCESSOS_ROBO_EMAIL=desligado.
 */
const HORA = 60 * 60 * 1000;

let rodando = false;

const rodar = async () => {
  const amb = ambienteEmail();
  if (rodando || !amb) return;
  rodando = true;
  const inicio = Date.now();
  try {
    const rs = await varrerCaixas(getProcessosPool(), amb);
    for (const r of rs) {
      console.log(
        `[robo-email] ${r.caixa}: ${r.emails} e-mails, ${r.comProcesso} com processo, ${r.processosNovos} processos novos` +
          (r.erro ? ` — ERRO: ${r.erro}` : ""),
      );
    }
    if (rs.length) console.log(`[robo-email] ${rs.length} caixas em ${Math.round((Date.now() - inicio) / 1000)}s`);
  } catch (e) {
    console.error("[robo-email] falhou:", e);
  } finally {
    rodando = false;
  }
};

export const iniciarRoboEmail = () => {
  if (!process.env.DP_PROCESSOS_DATABASE_URL || process.env.DP_PROCESSOS_ROBO_EMAIL === "desligado") return;
  setTimeout(() => void rodar(), 2 * 60_000); // depois do primeiro DataJud, para não disputarem a subida
  setInterval(() => void rodar(), HORA);
  console.log("[robo-email] leitura das caixas ligada (de hora em hora)");
};
