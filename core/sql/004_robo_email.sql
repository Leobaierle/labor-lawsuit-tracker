-- Processos trabalhistas — parte 3: robô de e-mail (de hora em hora)
-- Banco: Supabase | Schema: dp_processos_trabalhistas | Role: dp_processos_app
--
-- O robô lê a Caixa de Entrada + subpastas de cada caixa conectada (e das compartilhadas, como a dp@). E-mail
-- com número CNJ da Justiça do Trabalho (Q32) entra na linha do tempo do processo; número que ainda não existe
-- vira processo novo em "Novo", com a empresa "a identificar" até a IA (Q16) ou o DP preencher. E-mail novo em
-- processo que já existia ganha o selo "novo e-mail" até alguém abrir o processo (Q29). O robô nunca muda etapa.

-- Um e-mail, uma vez só: o mesmo e-mail em várias caixas tem o mesmo internetMessageId (Q22).
CREATE TABLE IF NOT EXISTS email (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message_id     TEXT NOT NULL UNIQUE,
  -- caixa onde o robô achou primeiro, e a pasta lá dentro
  caixa          TEXT NOT NULL,
  pasta          TEXT NOT NULL,
  recebido_em    TIMESTAMPTZ NOT NULL,
  de_nome        TEXT,
  de_email       TEXT,
  assunto        TEXT,
  -- começo do corpo, em texto, para a linha do tempo
  resumo         TEXT,
  -- nomes dos anexos ([] = sem anexos); o arquivo vai ao SharePoint na parte 4
  anexos         JSONB NOT NULL DEFAULT '[]',
  -- abre no Outlook na web (só para quem tem acesso à caixa)
  link           TEXT,
  lido_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Um e-mail pode citar vários processos.
CREATE TABLE IF NOT EXISTS email_processo (
  email_id      BIGINT NOT NULL REFERENCES email (id) ON DELETE CASCADE,
  processo_id   BIGINT NOT NULL REFERENCES processo (id) ON DELETE CASCADE,
  -- selo "novo e-mail": e-mail que chegou num processo que já existia; some quando alguém abre o processo
  novo          BOOLEAN NOT NULL DEFAULT false,
  vinculado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (email_id, processo_id)
);
CREATE INDEX IF NOT EXISTS email_processo_processo_idx ON email_processo (processo_id);
CREATE INDEX IF NOT EXISTS email_processo_novo_idx ON email_processo (processo_id) WHERE novo;

-- Até onde cada caixa já foi lida. Sem linha = nunca lida: a primeira leitura volta 3 meses e não põe selo.
CREATE TABLE IF NOT EXISTS varredura_caixa (
  caixa         TEXT PRIMARY KEY CHECK (caixa = lower(btrim(caixa))),
  -- maior recebido_em visto; a próxima leitura começa um dia antes (e-mail que demora a cair na pasta)
  lido_ate      TIMESTAMPTZ,
  varrido_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- e-mails olhados na última leitura e quantos citavam processo
  emails        INTEGER NOT NULL DEFAULT 0,
  com_processo  INTEGER NOT NULL DEFAULT 0,
  erro          TEXT
);

ALTER TABLE email ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_processo ENABLE ROW LEVEL SECURITY;
ALTER TABLE varredura_caixa ENABLE ROW LEVEL SECURITY;
