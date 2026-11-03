-- Processos trabalhistas — parte 2: "Conectar meu e-mail"
-- Banco: Supabase | Schema: dp_processos_trabalhistas | Role: dp_processos_app
--
-- Cada pessoa do DP autoriza a leitura da própria caixa (app do Entra só com Mail.Read, Mail.Read.Shared,
-- offline_access e User.Read). O refresh token fica cifrado (AES-256-GCM, chave DP_PROCESSOS_EMAIL_CHAVE
-- fora do banco). Caixa compartilhada (ex. dp@) é lida pela conexão de quem tem acesso a ela.
-- O robô de varredura (parte 3) usa estas tabelas; aqui só conectar, testar e desconectar.

-- Uma linha por conta Microsoft que autorizou. Reconectar reaproveita a linha.
CREATE TABLE IF NOT EXISTS conexao_email (
  id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- e-mail da conta que autorizou (minúsculo), vindo do Graph /me
  caixa                  TEXT NOT NULL UNIQUE CHECK (caixa = lower(btrim(caixa)) AND caixa LIKE '%@%'),
  nome                   TEXT,
  -- null depois de desconectar
  refresh_token_cifrado  TEXT,
  conectado_por          TEXT NOT NULL,
  conectado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- último teste/uso do token: total da Caixa de Entrada ou o erro
  testado_em             TIMESTAMPTZ,
  total_caixa_entrada    INTEGER,
  ultimo_erro            TEXT,
  desconectado_em        TIMESTAMPTZ,
  desconectado_por       TEXT,
  CHECK ((desconectado_em IS NULL) = (refresh_token_cifrado IS NOT NULL))
);

-- Caixa compartilhada lida por uma conexão (Mail.Read.Shared). Endereço único: cada caixa é varrida uma vez.
CREATE TABLE IF NOT EXISTS caixa_compartilhada (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conexao_id           BIGINT NOT NULL REFERENCES conexao_email (id) ON DELETE CASCADE,
  endereco             TEXT NOT NULL UNIQUE CHECK (endereco = lower(btrim(endereco)) AND endereco LIKE '%@%'),
  adicionada_por       TEXT NOT NULL,
  adicionada_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  testado_em           TIMESTAMPTZ,
  total_caixa_entrada  INTEGER,
  ultimo_erro          TEXT
);
CREATE INDEX IF NOT EXISTS caixa_compartilhada_conexao_idx ON caixa_compartilhada (conexao_id);

ALTER TABLE conexao_email ENABLE ROW LEVEL SECURITY;
ALTER TABLE caixa_compartilhada ENABLE ROW LEVEL SECURITY;
