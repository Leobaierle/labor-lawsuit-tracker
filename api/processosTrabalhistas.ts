import { getCadastroPool, listarEmpresas } from "@app/cadastro";
import {
  alterarProcesso,
  arquivarItem,
  buscarProcesso,
  criarItem,
  criarProcesso,
  descartarProcesso,
  emailsDoProcesso,
  EntradaInvalida,
  getProcessosPool,
  historicoDoProcesso,
  hojeEmBrasilia,
  listarItens,
  listarProcessos,
  marcarEmailsVistos,
  moverItem,
  renomearItem,
  responsaveisConhecidos,
  restaurarProcesso,
  situacaoPrazo,
  type DadosProcesso,
  type Lista,
  type Processo,
  type ProcessosPool,
} from "@app/dp-processos-trabalhistas";
import { GraphQLError } from "graphql";
import { exigirDp } from "./acesso.ts";
import type { SubgraphContext } from "./context.ts";

/**
 * Processos trabalhistas do DP (schema `dp_processos_trabalhistas` no Supabase). Uma linha por processo; etapa,
 * prazo, tipo e responsável são do DP; etapas e tipos o DP edita pelo site. Os processos entram à mão ou pelo robô de e-mail (roboEmail.ts), que também
 * monta a linha do tempo; o andamento no tribunal vem do DataJud (andamentoTribunal.ts).
 */
export const processosTrabalhistasTypeDefs = /* GraphQL */ `
  enum DpProcessoSituacaoPrazo {
    SEM_PRAZO
    VENCIDO
    "Até 3 dias úteis a partir de hoje"
    PROXIMO
    NO_PRAZO
  }

  enum DpProcessosLista {
    ETAPA
    TIPO
  }

  type DpProcessoItemLista {
    id: ID!
    nome: String!
    ordem: Int!
    "Só etapa: processos nela não contam prazo"
    encerra: Boolean!
    "Processos (não descartados) com este item"
    processos: Int!
  }

  type DpProcessoMudanca {
    campo: String!
    antes: String
    depois: String
  }

  type DpProcessoEvento {
    em: DateTime!
    autor: String!
    acao: String!
    mudancas: [DpProcessoMudanca!]!
  }

  "Situação no tribunal pela API pública do DataJud (CNJ), atualizada uma vez por semana. Só leitura."
  type DpProcessoAndamento {
    "false = o número (ainda) não está no DataJud"
    encontrado: Boolean!
    "Ex.: Audiência de instrução designada, Liquidação iniciada"
    situacao: String
    "AAAA-MM-DD do movimento que definiu a situação"
    situacaoEm: String
    "AAAA-MM-DD"
    ultimaMovimentacao: String
    "Vara/turma com a movimentação mais recente"
    orgao: String
    "Última consulta que deu certo"
    consultadoEm: DateTime
    "Falha da última tentativa (o andamento anterior continua valendo)"
    erro: String
  }

  "Um e-mail da linha do tempo do processo (lido pelo robô de e-mail)"
  type DpProcessoEmail {
    id: ID!
    recebidoEm: DateTime!
    deNome: String
    deEmail: String
    assunto: String
    "Começo do corpo"
    resumo: String
    "Nomes dos anexos ([] = sem anexos)"
    anexos: [String!]!
    "Caixa e pasta onde o robô achou"
    caixa: String!
    pasta: String!
    "Abre no Outlook na web (só para quem tem acesso à caixa)"
    link: String
    "Chegou depois que o processo já estava na tela e ninguém abriu ainda"
    novo: Boolean!
  }

  type DpProcesso {
    id: ID!
    "NNNNNNN-DD.AAAA.J.TR.OOOO"
    numero: String
    empresaNome: String!
    "Id no cadastro central de empresas, quando a empresa está lá"
    empresaCadastroId: ID
    empresaDocumento: String
    reclamante: String
    tipoId: ID
    tipoNome: String
    etapaId: ID!
    etapaNome: String!
    "AAAA-MM-DD"
    prazo: String
    situacaoPrazo: DpProcessoSituacaoPrazo!
    "E-mail de quem cuida; nulo = sem responsável"
    responsavel: String
    "MANUAL ou EMAIL"
    origem: String!
    descartadoEm: DateTime
    descartadoPor: String
    criadoEm: DateTime!
    criadoPor: String!
    atualizadoEm: DateTime!
    "Nulo = ainda não consultado no DataJud"
    andamento: DpProcessoAndamento
    "E-mails na linha do tempo"
    emails: Int!
    "Selo: e-mail novo que ninguém viu (some quando alguém abre o processo)"
    novoEmail: Boolean!
    "Linha do tempo dos e-mails, do mais recente para o mais antigo"
    linhaDoTempo: [DpProcessoEmail!]!
    historico: [DpProcessoEvento!]!
  }

  type DpProcessosPainel {
    etapas: [DpProcessoItemLista!]!
    tipos: [DpProcessoItemLista!]!
    processos: [DpProcesso!]!
    "Quem já aparece como responsável"
    responsaveis: [String!]!
    "E-mail de quem está logado"
    eu: String
    "AAAA-MM-DD em Brasília"
    hoje: String!
  }

  type DpProcessoEmpresaSugestao {
    id: ID!
    nome: String!
    documento: String!
    sigla: String
  }

  "Campos do processo. Na alteração, só os campos enviados mudam (null limpa)."
  input DpProcessoDados {
    numero: String
    empresaNome: String
    empresaCadastroId: ID
    empresaDocumento: String
    reclamante: String
    tipoId: ID
    etapaId: ID
    prazo: String
    responsavel: String
  }

  extend type Query {
    "Tudo que a tela precisa: etapas, tipos e os processos ativos (ou só os descartados)"
    dpProcessosPainel(descartados: Boolean): DpProcessosPainel!
    dpProcesso(id: ID!): DpProcesso
    "Empresas do cadastro central para vincular ao processo (até 10)"
    dpProcessosEmpresas(busca: String!): [DpProcessoEmpresaSugestao!]!
  }

  extend type Mutation {
    dpProcessoCriar(dados: DpProcessoDados!): DpProcesso!
    dpProcessoAlterar(id: ID!, dados: DpProcessoDados!): DpProcesso!
    "Não é processo: vai para Descartados"
    dpProcessoDescartar(id: ID!): DpProcesso!
    dpProcessoRestaurar(id: ID!): DpProcesso!
    "Abriu o processo: tira o selo de novo e-mail (para todos)"
    dpProcessoMarcarVisto(id: ID!): DpProcesso!
    dpProcessosListaCriar(lista: DpProcessosLista!, nome: String!): [DpProcessoItemLista!]!
    dpProcessosListaRenomear(lista: DpProcessosLista!, id: ID!, nome: String!): [DpProcessoItemLista!]!
    "direcao: -1 sobe, 1 desce"
    dpProcessosListaMover(lista: DpProcessosLista!, id: ID!, direcao: Int!): [DpProcessoItemLista!]!
    "Remove da tela (só sem processos)"
    dpProcessosListaRemover(lista: DpProcessosLista!, id: ID!): [DpProcessoItemLista!]!
  }
`;

const entradaInvalida = (m: string): never => {
  throw new GraphQLError(m, { extensions: { code: "BAD_USER_INPUT" } });
};

const id = (v: string): number => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : entradaInvalida(`id inválido: ${v}`);
};

/** Mantém a diferença entre campo ausente (não mexe) e null (limpa). */
const idOpcional = (v: string | null | undefined): number | null | undefined => (v == null ? v : id(v));

const exigirBanco = (): ProcessosPool => {
  try {
    return getProcessosPool();
  } catch {
    throw new GraphQLError("Banco dos processos trabalhistas não está configurado (DP_PROCESSOS_DATABASE_URL)", {
      extensions: { code: "DP_PROCESSOS_NOT_CONFIGURED" },
    });
  }
};

/** Regra de negócio recusada vira BAD_USER_INPUT com a mensagem para a tela. */
const comEntrada = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof EntradaInvalida) return entradaInvalida(e.message);
    throw e;
  }
};

const autor = (ctx: SubgraphContext): string => ctx.currentUser?.email ?? ctx.currentUser?.sub ?? "desconhecido";

type DadosEntrada = {
  numero?: string | null;
  empresaNome?: string | null;
  empresaCadastroId?: string | null;
  empresaDocumento?: string | null;
  reclamante?: string | null;
  tipoId?: string | null;
  etapaId?: string | null;
  prazo?: string | null;
  responsavel?: string | null;
};

const dados = (d: DadosEntrada): DadosProcesso => ({
  ...d,
  empresaCadastroId: idOpcional(d.empresaCadastroId),
  tipoId: idOpcional(d.tipoId),
  etapaId: idOpcional(d.etapaId),
});

const processoGraphQL = (p: Processo) => ({
  ...p,
  id: String(p.id),
  empresaCadastroId: p.empresaCadastroId == null ? null : String(p.empresaCadastroId),
  tipoId: p.tipoId == null ? null : String(p.tipoId),
  etapaId: String(p.etapaId),
  situacaoPrazo: situacaoPrazo(p.prazo, hojeEmBrasilia(), p.etapaEncerra),
});

const itemGraphQL = <T extends { id: number }>(i: T) => ({ ...i, id: String(i.id) });

const lista = (l: string): Lista => (l === "ETAPA" || l === "TIPO" ? l : entradaInvalida(`lista inválida: ${l}`));

export const processosTrabalhistasResolvers = {
  Query: {
    dpProcessosPainel: async (_: unknown, a: { descartados?: boolean | null }, ctx: SubgraphContext) => {
      exigirDp(ctx);
      const db = exigirBanco();
      const [etapas, tipos, processos, responsaveis] = await Promise.all([
        listarItens(db, "ETAPA"),
        listarItens(db, "TIPO"),
        listarProcessos(db, { descartados: a.descartados === true }),
        responsaveisConhecidos(db),
      ]);
      return {
        etapas: etapas.map(itemGraphQL),
        tipos: tipos.map(itemGraphQL),
        processos: processos.map(processoGraphQL),
        responsaveis,
        eu: ctx.currentUser?.email ?? null,
        hoje: hojeEmBrasilia(),
      };
    },
    dpProcesso: async (_: unknown, a: { id: string }, ctx: SubgraphContext) => {
      exigirDp(ctx);
      const n = id(a.id); // entrada errada responde antes de olhar o banco
      const p = await buscarProcesso(exigirBanco(), n);
      return p ? processoGraphQL(p) : null;
    },
    dpProcessosEmpresas: async (_: unknown, a: { busca: string }, ctx: SubgraphContext) => {
      exigirDp(ctx);
      const busca = a.busca.trim().slice(0, 120);
      if (busca.length < 2) return [];
      let pool;
      try {
        pool = getCadastroPool();
      } catch {
        return []; // sem cadastro configurado, a empresa entra só pelo nome
      }
      const r = await listarEmpresas(pool, { competencia: hojeEmBrasilia().slice(0, 7), filtro: "TODAS", busca });
      return r.itens.slice(0, 10).map((e) => ({ id: String(e.id), nome: e.nome ?? e.razaoSocial, documento: e.documento, sigla: e.sigla }));
    },
  },

  Mutation: {
    dpProcessoCriar: async (_: unknown, a: { dados: DadosEntrada }, ctx: SubgraphContext) => {
      exigirDp(ctx);
      const d = dados(a.dados);
      return processoGraphQL(await comEntrada(() => criarProcesso(exigirBanco(), autor(ctx), d)));
    },
    dpProcessoAlterar: async (_: unknown, a: { id: string; dados: DadosEntrada }, ctx: SubgraphContext) => {
      exigirDp(ctx);
      const d = dados(a.dados);
      const n = id(a.id);
      return processoGraphQL(await comEntrada(() => alterarProcesso(exigirBanco(), autor(ctx), n, d)));
    },
    dpProcessoDescartar: async (_: unknown, a: { id: string }, ctx: SubgraphContext) => {
      exigirDp(ctx);
      const n = id(a.id);
      return processoGraphQL(await comEntrada(() => descartarProcesso(exigirBanco(), autor(ctx), n)));
    },
    dpProcessoRestaurar: async (_: unknown, a: { id: string }, ctx: SubgraphContext) => {
      exigirDp(ctx);
      const n = id(a.id);
      return processoGraphQL(await comEntrada(() => restaurarProcesso(exigirBanco(), autor(ctx), n)));
    },
    dpProcessoMarcarVisto: async (_: unknown, a: { id: string }, ctx: SubgraphContext) => {
      exigirDp(ctx);
      const n = id(a.id);
      const db = exigirBanco();
      await marcarEmailsVistos(db, n);
      const p = await buscarProcesso(db, n);
      return p ? processoGraphQL(p) : entradaInvalida(`Processo ${n} não existe`);
    },
    dpProcessosListaCriar: async (_: unknown, a: { lista: string; nome: string }, ctx: SubgraphContext) => {
      exigirDp(ctx);
      return (await comEntrada(() => criarItem(exigirBanco(), autor(ctx), lista(a.lista), a.nome))).map(itemGraphQL);
    },
    dpProcessosListaRenomear: async (_: unknown, a: { lista: string; id: string; nome: string }, ctx: SubgraphContext) => {
      exigirDp(ctx);
      const n = id(a.id);
      return (await comEntrada(() => renomearItem(exigirBanco(), autor(ctx), lista(a.lista), n, a.nome))).map(itemGraphQL);
    },
    dpProcessosListaMover: async (_: unknown, a: { lista: string; id: string; direcao: number }, ctx: SubgraphContext) => {
      exigirDp(ctx);
      if (a.direcao !== -1 && a.direcao !== 1) entradaInvalida("direcao deve ser -1 ou 1");
      const n = id(a.id);
      return (await comEntrada(() => moverItem(exigirBanco(), autor(ctx), lista(a.lista), n, a.direcao as -1 | 1))).map(itemGraphQL);
    },
    dpProcessosListaRemover: async (_: unknown, a: { lista: string; id: string }, ctx: SubgraphContext) => {
      exigirDp(ctx);
      const n = id(a.id);
      return (await comEntrada(() => arquivarItem(exigirBanco(), autor(ctx), lista(a.lista), n))).map(itemGraphQL);
    },
  },

  DpProcesso: {
    historico: async (p: { id: string }) => historicoDoProcesso(exigirBanco(), Number(p.id)),
    linhaDoTempo: async (p: { id: string }) =>
      (await emailsDoProcesso(exigirBanco(), Number(p.id))).map((e) => ({ ...e, id: String(e.id) })),
  },
};
