/**
 * A Microsoft devolve o login do "Conectar meu e-mail" em /conectar-email?code=&state= (ou ?error=). O app usa
 * HashRouter, então a volta é guardada na sessionStorage e a página segue para a tela dos processos, que
 * conclui a conexão. Assim o código não fica na barra de endereço nem no histórico.
 */

export const CAMINHO_RETORNO = '/conectar-email';
export const ROTA_PROCESSOS = '#/app/processos-trabalhistas';
const CHAVE = 'dp-processos-email-retorno';

export type RetornoEmail = { tipo: 'codigo'; code: string; state: string } | { tipo: 'erro'; mensagem: string };

/** Lê a query da volta. `access_denied` = a pessoa cancelou ou não aceitou. */
export const lerRetorno = (search: string): RetornoEmail => {
  const q = new URLSearchParams(search);
  const code = q.get('code');
  const state = q.get('state');
  if (code && state) return { tipo: 'codigo', code, state };
  const erro = q.get('error');
  if (erro === 'access_denied') return { tipo: 'erro', mensagem: 'A conexão foi cancelada na Microsoft.' };
  const detalhe = (q.get('error_description') ?? '').split(/\r?\n/)[0]?.trim();
  return { tipo: 'erro', mensagem: `A Microsoft não concluiu a conexão${erro ? ` (${erro}${detalhe ? `: ${detalhe}` : ''})` : ''}.` };
};

/** Chamado antes de montar o app. true = estava na volta da Microsoft e a página já foi redirecionada. */
export const guardarRetornoDaMicrosoft = (): boolean => {
  if (typeof window === 'undefined' || window.location.pathname !== CAMINHO_RETORNO) return false;
  try {
    window.sessionStorage.setItem(CHAVE, JSON.stringify(lerRetorno(window.location.search)));
  } catch {
    // sem sessionStorage não há como concluir; a tela segue normal e a pessoa tenta de novo
  }
  window.location.replace(`/${ROTA_PROCESSOS}`);
  return true;
};

let pego: RetornoEmail | null | undefined;

/** Pega (e apaga) a volta guardada, se houver. Mesma resposta durante a página (StrictMode chama duas vezes). */
export const pegarRetorno = (): RetornoEmail | null => {
  if (pego !== undefined) return pego;
  try {
    const bruto = window.sessionStorage.getItem(CHAVE);
    window.sessionStorage.removeItem(CHAVE);
    pego = bruto ? (JSON.parse(bruto) as RetornoEmail) : null;
  } catch {
    pego = null;
  }
  return pego;
};
