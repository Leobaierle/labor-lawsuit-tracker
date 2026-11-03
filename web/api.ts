import { gqlRequest } from '../../lib/graphql';
import { useConsulta } from '../importacao-xml/api';

/**
 * Processos trabalhistas do DP. Uma linha por processo; etapa, prazo, tipo e responsável são do DP, e as
 * etapas (as abas) e os tipos o DP edita pela própria tela. O robô de e-mail vem numa parte seguinte.
 */

export type SituacaoPrazo = 'SEM_PRAZO' | 'VENCIDO' | 'PROXIMO' | 'NO_PRAZO';
export type Lista = 'ETAPA' | 'TIPO';

export type ItemLista = { id: string; nome: string; ordem: number; encerra: boolean; processos: number };

export type Processo = {
  id: string;
  numero: string | null;
  empresaNome: string;
  empresaCadastroId: string | null;
  empresaDocumento: string | null;
  reclamante: string | null;
  tipoId: string | null;
  tipoNome: string | null;
  etapaId: string;
  etapaNome: string;
  prazo: string | null;
  situacaoPrazo: SituacaoPrazo;
  responsavel: string | null;
  origem: 'MANUAL' | 'EMAIL';
  descartadoEm: string | null;
  descartadoPor: string | null;
  criadoEm: string;
  criadoPor: string;
  /** Situação no tribunal pelo DataJud (só leitura, atualizada uma vez por semana); null = ainda não consultado. */
  andamento: Andamento | null;
  /** E-mails na linha do tempo; selo "novo e-mail" até alguém abrir o processo. */
  emails: number;
  novoEmail: boolean;
};

export type EmailDoProcesso = {
  id: string;
  recebidoEm: string;
  deNome: string | null;
  deEmail: string | null;
  assunto: string | null;
  resumo: string | null;
  anexos: string[];
  caixa: string;
  pasta: string;
  link: string | null;
  novo: boolean;
};

export type Andamento = {
  encontrado: boolean;
  situacao: string | null;
  situacaoEm: string | null;
  ultimaMovimentacao: string | null;
  orgao: string | null;
  consultadoEm: string | null;
  erro: string | null;
};

export type Evento = {
  em: string;
  autor: string;
  acao: 'INSERT' | 'UPDATE' | 'DELETE';
  mudancas: Array<{ campo: string; antes: string | null; depois: string | null }>;
};

export type Painel = {
  etapas: ItemLista[];
  tipos: ItemLista[];
  processos: Processo[];
  responsaveis: string[];
  eu: string | null;
  hoje: string;
};

/** Campos do formulário. Na alteração, só os enviados mudam (null limpa). */
export type DadosProcesso = Partial<{
  numero: string | null;
  empresaNome: string;
  empresaCadastroId: string | null;
  empresaDocumento: string | null;
  reclamante: string | null;
  tipoId: string | null;
  etapaId: string;
  prazo: string | null;
  responsavel: string | null;
}>;

export type EmpresaSugestao = { id: string; nome: string; documento: string; sigla: string | null };

const CAMPOS_PROCESSO = /* GraphQL */ `
  id numero empresaNome empresaCadastroId empresaDocumento reclamante tipoId tipoNome etapaId etapaNome
  prazo situacaoPrazo responsavel origem descartadoEm descartadoPor criadoEm criadoPor
  andamento { encontrado situacao situacaoEm ultimaMovimentacao orgao consultadoEm erro }
  emails novoEmail
`;
const CAMPOS_ITEM = 'id nome ordem encerra processos';

const Q_PAINEL = /* GraphQL */ `
  query DpProcessosPainel($descartados: Boolean) {
    dpProcessosPainel(descartados: $descartados) {
      etapas { ${CAMPOS_ITEM} }
      tipos { ${CAMPOS_ITEM} }
      processos { ${CAMPOS_PROCESSO} }
      responsaveis eu hoje
    }
  }
`;

/** `ativo` falso não consulta (a aba Descartados só busca quando aberta). */
export const usePainel = (descartados: boolean, recarga: number, ativo = true) =>
  useConsulta(ativo ? `processos:${descartados}` : null, recarga, (signal) =>
    gqlRequest<{ dpProcessosPainel: Painel }>(Q_PAINEL, { descartados }, signal).then((d) => d.dpProcessosPainel),
  );

export const useHistorico = (id: string, recarga: number) =>
  useConsulta(`processo:${id}`, recarga, (signal) =>
    gqlRequest<{ dpProcesso: { historico: Evento[] } | null }>(
      /* GraphQL */ `query($id: ID!) { dpProcesso(id: $id) { historico { em autor acao mudancas { campo antes depois } } } }`,
      { id },
      signal,
    ).then((d) => d.dpProcesso?.historico ?? []),
  );

export const useLinhaDoTempo = (id: string) =>
  useConsulta(`emails:${id}`, 0, (signal) =>
    gqlRequest<{ dpProcesso: { linhaDoTempo: EmailDoProcesso[] } | null }>(
      /* GraphQL */ `query($id: ID!) { dpProcesso(id: $id) { linhaDoTempo { id recebidoEm deNome deEmail assunto resumo anexos caixa pasta link novo } } }`,
      { id },
      signal,
    ).then((d) => d.dpProcesso?.linhaDoTempo ?? []),
  );

/** Abriu o processo: o selo "novo e-mail" sai para todos. */
export const marcarVisto = (id: string) =>
  gqlRequest<{ dpProcessoMarcarVisto: { id: string } }>(/* GraphQL */ `mutation($id: ID!) { dpProcessoMarcarVisto(id: $id) { id } }`, { id });

export const buscarEmpresas = (busca: string, signal?: AbortSignal) =>
  gqlRequest<{ dpProcessosEmpresas: EmpresaSugestao[] }>(
    /* GraphQL */ `query($busca: String!) { dpProcessosEmpresas(busca: $busca) { id nome documento sigla } }`,
    { busca },
    signal,
  ).then((d) => d.dpProcessosEmpresas);

export const criarProcesso = (dados: DadosProcesso) =>
  gqlRequest<{ dpProcessoCriar: Processo }>(
    /* GraphQL */ `mutation($d: DpProcessoDados!) { dpProcessoCriar(dados: $d) { ${CAMPOS_PROCESSO} } }`,
    { d: dados },
  ).then((d) => d.dpProcessoCriar);

export const alterarProcesso = (id: string, dados: DadosProcesso) =>
  gqlRequest<{ dpProcessoAlterar: Processo }>(
    /* GraphQL */ `mutation($id: ID!, $d: DpProcessoDados!) { dpProcessoAlterar(id: $id, dados: $d) { ${CAMPOS_PROCESSO} } }`,
    { id, d: dados },
  ).then((d) => d.dpProcessoAlterar);

export const descartarProcesso = (id: string) =>
  gqlRequest<{ dpProcessoDescartar: Processo }>(
    /* GraphQL */ `mutation($id: ID!) { dpProcessoDescartar(id: $id) { ${CAMPOS_PROCESSO} } }`,
    { id },
  ).then((d) => d.dpProcessoDescartar);

export const restaurarProcesso = (id: string) =>
  gqlRequest<{ dpProcessoRestaurar: Processo }>(
    /* GraphQL */ `mutation($id: ID!) { dpProcessoRestaurar(id: $id) { ${CAMPOS_PROCESSO} } }`,
    { id },
  ).then((d) => d.dpProcessoRestaurar);

type AcaoLista =
  | { acao: 'criar'; nome: string }
  | { acao: 'renomear'; id: string; nome: string }
  | { acao: 'mover'; id: string; direcao: -1 | 1 }
  | { acao: 'remover'; id: string };

/** Uma alteração em etapas ou tipos; devolve a lista como ficou. */
export const alterarLista = (lista: Lista, a: AcaoLista): Promise<ItemLista[]> => {
  const [campo, args, vars] =
    a.acao === 'criar'
      ? ['dpProcessosListaCriar', 'lista: $lista, nome: $nome', { nome: a.nome }]
      : a.acao === 'renomear'
        ? ['dpProcessosListaRenomear', 'lista: $lista, id: $id, nome: $nome', { id: a.id, nome: a.nome }]
        : a.acao === 'mover'
          ? ['dpProcessosListaMover', 'lista: $lista, id: $id, direcao: $direcao', { id: a.id, direcao: a.direcao }]
          : ['dpProcessosListaRemover', 'lista: $lista, id: $id', { id: a.id }];
  const decl = Object.keys(vars)
    .map((k) => `$${k}: ${k === 'id' ? 'ID!' : k === 'direcao' ? 'Int!' : 'String!'}`)
    .join(', ');
  return gqlRequest<Record<string, ItemLista[]>>(
    `mutation($lista: DpProcessosLista!, ${decl}) { ${campo}(${args}) { ${CAMPOS_ITEM} } }`,
    { lista, ...vars },
  ).then((d) => d[campo]!);
};

/* ---- Conectar meu e-mail (parte 2) ---- */

export type CaixaCompartilhada = {
  id: string;
  endereco: string;
  adicionadaPor: string;
  adicionadaEm: string;
  testadoEm: string | null;
  totalCaixaEntrada: number | null;
  ultimoErro: string | null;
};

export type ConexaoEmail = {
  id: string;
  caixa: string;
  nome: string | null;
  conectada: boolean;
  conectadoPor: string;
  conectadoEm: string;
  testadoEm: string | null;
  totalCaixaEntrada: number | null;
  ultimoErro: string | null;
  desconectadoEm: string | null;
  desconectadoPor: string | null;
  compartilhadas: CaixaCompartilhada[];
};

/** Última leitura do robô numa caixa (ele passa de hora em hora). */
export type LeituraCaixa = { caixa: string; varridoEm: string; lidoAte: string | null; emails: number; comProcesso: number; erro: string | null };

export type PainelEmail = { configurado: boolean; conexoes: ConexaoEmail[]; leituras: LeituraCaixa[] };

const CAMPOS_CONEXAO = /* GraphQL */ `
  id caixa nome conectada conectadoPor conectadoEm testadoEm totalCaixaEntrada ultimoErro desconectadoEm desconectadoPor
  compartilhadas { id endereco adicionadaPor adicionadaEm testadoEm totalCaixaEntrada ultimoErro }
`;

export const usePainelEmail = (recarga: number) =>
  useConsulta('email', recarga, (signal) =>
    gqlRequest<{ dpEmailPainel: PainelEmail }>(
      /* GraphQL */ `query { dpEmailPainel { configurado conexoes { ${CAMPOS_CONEXAO} } leituras { caixa varridoEm lidoAte emails comProcesso erro } } }`,
      undefined,
      signal,
    ).then((d) => d.dpEmailPainel),
  );

/** URL do login da Microsoft; a página segue para ela. */
export const iniciarConexaoEmail = () =>
  gqlRequest<{ dpEmailIniciarConexao: string }>(/* GraphQL */ `mutation { dpEmailIniciarConexao }`).then((d) => d.dpEmailIniciarConexao);

const mutacaoConexao = (campo: string, args: string, decl: string, vars: Record<string, string>) =>
  gqlRequest<Record<string, ConexaoEmail>>(`mutation(${decl}) { ${campo}(${args}) { ${CAMPOS_CONEXAO} } }`, vars).then((d) => d[campo]!);

export const concluirConexaoEmail = (code: string, state: string) =>
  mutacaoConexao('dpEmailConcluirConexao', 'code: $code, state: $state', '$code: String!, $state: String!', { code, state });
export const testarConexaoEmail = (id: string) => mutacaoConexao('dpEmailTestar', 'id: $id', '$id: ID!', { id });
export const desconectarEmail = (id: string) => mutacaoConexao('dpEmailDesconectar', 'id: $id', '$id: ID!', { id });
export const adicionarCompartilhada = (conexaoId: string, endereco: string) =>
  mutacaoConexao('dpEmailAdicionarCompartilhada', 'conexaoId: $conexaoId, endereco: $endereco', '$conexaoId: ID!, $endereco: String!', {
    conexaoId,
    endereco,
  });
export const removerCompartilhada = (id: string) => mutacaoConexao('dpEmailRemoverCompartilhada', 'id: $id', '$id: ID!', { id });
