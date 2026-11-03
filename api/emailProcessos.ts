import { createHmac } from "node:crypto";
import {
  adicionarCaixaCompartilhada,
  chaveDoAmbiente,
  concluirConexao,
  configDoAmbiente,
  desconectar,
  EntradaInvalida,
  getProcessosPool,
  iniciarConexao,
  leiturasDasCaixas,
  listarConexoes,
  removerCaixaCompartilhada,
  testarConexao,
  type AmbienteEmail,
  type ConexaoEmail,
  type ProcessosPool,
} from "@app/dp-processos-trabalhistas";
import { GraphQLError } from "graphql";
import { exigirDp } from "./acesso.ts";
import type { SubgraphContext } from "./context.ts";

/**
 * "Conectar meu e-mail" dos processos trabalhistas (parte 2). O botão pede a URL do login da Microsoft
 * (`dpEmailIniciarConexao`), a Microsoft volta em dp.example.com/conectar-email e a tela
 * entrega o código aqui (`dpEmailConcluirConexao`). O app do Entra é próprio (Mail.Read, Mail.Read.Shared,
 * offline_access, User.Read) e o refresh token fica cifrado no banco. O robô que lê as caixas de hora em hora
 * está em roboEmail.ts.
 */

export const emailProcessosTypeDefs = /* GraphQL */ `
  type DpEmailCaixaCompartilhada {
    id: ID!
    endereco: String!
    adicionadaPor: String!
    adicionadaEm: DateTime!
    testadoEm: DateTime
    totalCaixaEntrada: Int
    ultimoErro: String
  }

  "Uma conta Microsoft que autorizou a leitura da própria caixa"
  type DpEmailConexao {
    id: ID!
    "E-mail da conta que autorizou"
    caixa: String!
    nome: String
    "false depois de desconectar (o token foi apagado)"
    conectada: Boolean!
    conectadoPor: String!
    conectadoEm: DateTime!
    testadoEm: DateTime
    totalCaixaEntrada: Int
    "Último erro ao usar o acesso (null = funcionando)"
    ultimoErro: String
    desconectadoEm: DateTime
    desconectadoPor: String
    "Caixas compartilhadas (ex. dp@) lidas por esta conexão"
    compartilhadas: [DpEmailCaixaCompartilhada!]!
  }

  "Última leitura do robô numa caixa (a da conexão ou uma compartilhada)"
  type DpEmailLeitura {
    caixa: String!
    varridoEm: DateTime!
    "Data do e-mail mais recente já lido"
    lidoAte: DateTime
    "E-mails olhados na última leitura e quantos citavam processo"
    emails: Int!
    comProcesso: Int!
    "Falha da última leitura (a próxima hora tenta de novo do mesmo ponto)"
    erro: String
  }

  type DpEmailPainel {
    "false enquanto o app do Entra não estiver configurado no servidor"
    configurado: Boolean!
    conexoes: [DpEmailConexao!]!
    "O robô lê de hora em hora; uma linha por caixa já lida"
    leituras: [DpEmailLeitura!]!
  }

  extend type Query {
    dpEmailPainel: DpEmailPainel!
  }

  extend type Mutation {
    "URL do login da Microsoft para conectar a caixa (vale 10 minutos, só para quem pediu)"
    dpEmailIniciarConexao: String!
    "Volta da Microsoft: code e state que vieram em /conectar-email"
    dpEmailConcluirConexao(code: String!, state: String!): DpEmailConexao!
    dpEmailTestar(id: ID!): DpEmailConexao!
    dpEmailDesconectar(id: ID!): DpEmailConexao!
    dpEmailAdicionarCompartilhada(conexaoId: ID!, endereco: String!): DpEmailConexao!
    dpEmailRemoverCompartilhada(id: ID!): DpEmailConexao!
  }
`;

const id = (v: string): number => {
  const n = Number(v);
  if (Number.isSafeInteger(n) && n > 0) return n;
  throw new GraphQLError(`id inválido: ${v}`, { extensions: { code: "BAD_USER_INPUT" } });
};

const naoConfigurado = (o_que: string) =>
  new GraphQLError(`Conexão de e-mail não está configurada no servidor (${o_que})`, {
    extensions: { code: "DP_PROCESSOS_EMAIL_NOT_CONFIGURED" },
  });

const banco = (): ProcessosPool => {
  try {
    return getProcessosPool();
  } catch {
    throw naoConfigurado("DP_PROCESSOS_DATABASE_URL");
  }
};

/** App do Entra + chave de cifra. O segredo do state/PKCE sai da mesma chave, sem mais uma variável. */
const ambiente = (): AmbienteEmail => {
  const cfg = configDoAmbiente();
  if (!cfg) throw naoConfigurado("DP_PROCESSOS_EMAIL_TENANT_ID/CLIENT_ID/CLIENT_SECRET");
  let chave: Buffer;
  try {
    chave = chaveDoAmbiente();
  } catch {
    throw naoConfigurado("DP_PROCESSOS_EMAIL_CHAVE");
  }
  return { cfg, chave, segredo: createHmac("sha256", chave).update("dp-processos-email-state").digest("base64url") };
};

const configurado = (): boolean => {
  try {
    ambiente();
    return true;
  } catch {
    return false;
  }
};

const comEntrada = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof EntradaInvalida) throw new GraphQLError(e.message, { extensions: { code: "BAD_USER_INPUT" } });
    throw e;
  }
};

/** Quem está na sessão; a conexão fica ligada a essa pessoa (state assinado com o e-mail dela). */
const usuario = (ctx: SubgraphContext): string => {
  const email = ctx.currentUser?.email?.trim().toLowerCase();
  if (!email) throw new GraphQLError("Sessão sem e-mail", { extensions: { code: "FORBIDDEN" } });
  return email;
};

const conexaoGraphQL = (c: ConexaoEmail) => ({
  ...c,
  id: String(c.id),
  compartilhadas: c.compartilhadas.map((s) => ({ ...s, id: String(s.id) })),
});

export const emailProcessosResolvers = {
  Query: {
    dpEmailPainel: async (_: unknown, __: unknown, ctx: SubgraphContext) => {
      exigirDp(ctx);
      let pool: ProcessosPool;
      try {
        pool = getProcessosPool();
      } catch {
        return { configurado: false, conexoes: [], leituras: [] };
      }
      const [conexoes, leituras] = await Promise.all([listarConexoes(pool), leiturasDasCaixas(pool)]);
      return { configurado: configurado(), conexoes: conexoes.map(conexaoGraphQL), leituras };
    },
  },

  Mutation: {
    dpEmailIniciarConexao: (_: unknown, __: unknown, ctx: SubgraphContext) => {
      exigirDp(ctx);
      return iniciarConexao(ambiente(), usuario(ctx));
    },
    dpEmailConcluirConexao: async (_: unknown, a: { code: string; state: string }, ctx: SubgraphContext) => {
      exigirDp(ctx);
      const amb = ambiente();
      return conexaoGraphQL(await comEntrada(() => concluirConexao(banco(), amb, usuario(ctx), a.code, a.state)));
    },
    dpEmailTestar: async (_: unknown, a: { id: string }, ctx: SubgraphContext) => {
      exigirDp(ctx);
      const n = id(a.id);
      const amb = ambiente();
      return conexaoGraphQL(await comEntrada(() => testarConexao(banco(), amb, n)));
    },
    dpEmailDesconectar: async (_: unknown, a: { id: string }, ctx: SubgraphContext) => {
      exigirDp(ctx);
      const n = id(a.id);
      return conexaoGraphQL(await comEntrada(() => desconectar(banco(), n, usuario(ctx))));
    },
    dpEmailAdicionarCompartilhada: async (_: unknown, a: { conexaoId: string; endereco: string }, ctx: SubgraphContext) => {
      exigirDp(ctx);
      const n = id(a.conexaoId);
      const amb = ambiente();
      return conexaoGraphQL(await comEntrada(() => adicionarCaixaCompartilhada(banco(), amb, n, a.endereco, usuario(ctx))));
    },
    dpEmailRemoverCompartilhada: async (_: unknown, a: { id: string }, ctx: SubgraphContext) => {
      exigirDp(ctx);
      const n = id(a.id);
      return conexaoGraphQL(await comEntrada(() => removerCaixaCompartilhada(banco(), n)));
    },
  },
};
