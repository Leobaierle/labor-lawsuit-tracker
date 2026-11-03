export { getProcessosPool, closeProcessosPool, withTransaction } from "./pgClient.ts";
export type { ProcessosPool, Executor } from "./pgClient.ts";
export {
  EntradaInvalida,
  normalizarNumeroCnj,
  digitoCnj,
  normalizarResponsavel,
  normalizarPrazo,
  hojeEmBrasilia,
  situacaoPrazo,
  type SituacaoPrazo,
} from "./dominio.ts";
export {
  listarProcessos,
  buscarProcesso,
  historicoDoProcesso,
  criarProcesso,
  alterarProcesso,
  descartarProcesso,
  restaurarProcesso,
  responsaveisConhecidos,
  type Processo,
  type DadosProcesso,
  type EventoProcesso,
  type Mudanca,
  type AndamentoTribunal,
} from "./processos.ts";
export {
  CHAVE_PUBLICA_DATAJUD,
  andamentoDosRegistros,
  consultarDataJud,
  atualizarAndamentos,
  type Andamento,
  type MovimentoDataJud,
  type RegistroDataJud,
  type ResultadoAtualizacao,
} from "./datajud.ts";
export { listarItens, criarItem, renomearItem, moverItem, arquivarItem, type Lista, type ItemLista } from "./listas.ts";
export { chaveDoAmbiente, cifrar, decifrar } from "./cifra.ts";
export { configDoAmbiente, ErroMicrosoft, ESCOPOS, type ConfigMicrosoft } from "./microsoft.ts";
export {
  listarConexoes,
  iniciarConexao,
  concluirConexao,
  acessoDaConexao,
  testarConexao,
  desconectar,
  adicionarCaixaCompartilhada,
  removerCaixaCompartilhada,
  ConexaoFalhou,
  ambienteEmail,
  type AmbienteEmail,
  type ConexaoEmail,
  type CaixaCompartilhada,
} from "./conexoes.ts";
export {
  EMPRESA_A_IDENTIFICAR,
  numerosTrabalhistas,
  resumoDoCorpo,
  leitorGraph,
  lerCaixa,
  varrerCaixas,
  emailsDoProcesso,
  marcarEmailsVistos,
  leiturasDasCaixas,
  type LeitorCaixa,
  type MensagemEmail,
  type ResultadoLeitura,
  type EmailDoProcesso,
  type LeituraCaixa,
} from "./varredura.ts";
