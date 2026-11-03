-- Processos trabalhistas do DP — schema inicial
-- Banco: Supabase | Schema: dp_processos_trabalhistas | Role: dp_processos_app
--
-- Desenho fechado em 23/10/2026:
-- uma linha por processo, etapa/prazo/tipo/responsável preenchidos pelo DP, etapas e tipos editáveis pelo
-- site, histórico automático. Parte 1 = cadastro manual; o robô de e-mail (linha do tempo, anexos, selo
-- "novo e-mail") entra num arquivo seguinte.

-- Etapas (as abas da tela). Arquivar em vez de apagar: o histórico continua apontando para elas.
CREATE TABLE IF NOT EXISTS etapa (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome          TEXT NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 60),
  ordem         INTEGER NOT NULL,
  -- processos nesta etapa não contam prazo (não aparecem em "Vencendo")
  encerra       BOOLEAN NOT NULL DEFAULT false,
  arquivada_em  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS etapa_nome_ativa_idx ON etapa (lower(btrim(nome))) WHERE arquivada_em IS NULL;

CREATE TABLE IF NOT EXISTS tipo (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome          TEXT NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 60),
  ordem         INTEGER NOT NULL,
  arquivada_em  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS tipo_nome_ativo_idx ON tipo (lower(btrim(nome))) WHERE arquivada_em IS NULL;

-- Listas iniciais (só na primeira vez; depois quem manda é o DP pelo site)
INSERT INTO etapa (nome, ordem, encerra)
SELECT * FROM (VALUES
  ('Novo', 1, false),
  ('Aguardando documentos / informações', 2, false),
  ('Em andamento', 3, false),
  ('Aguardando audiência / decisão', 4, false),
  ('Pós-decisão', 5, false),
  ('Encerrado', 6, true)) v
WHERE NOT EXISTS (SELECT 1 FROM etapa);

INSERT INTO tipo (nome, ordem)
SELECT * FROM (VALUES ('Reclamatória trabalhista', 1), ('Acordo extrajudicial', 2), ('Outros', 3)) v
WHERE NOT EXISTS (SELECT 1 FROM tipo);

CREATE TABLE IF NOT EXISTS processo (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- número único CNJ, formatado NNNNNNN-DD.AAAA.J.TR.OOOO; nulo quando o e-mail não traz o número
  numero               TEXT CHECK (numero IS NULL OR numero ~ '^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$'),
  -- empresa reclamada como veio; quando bate com o cadastro central, o id e o documento de lá
  empresa_nome         TEXT NOT NULL CHECK (length(btrim(empresa_nome)) BETWEEN 1 AND 200),
  empresa_cadastro_id  BIGINT,
  empresa_documento    TEXT CHECK (empresa_documento IS NULL OR empresa_documento ~ '^\d{11}$|^\d{14}$'),
  reclamante           TEXT CHECK (reclamante IS NULL OR length(reclamante) <= 200),
  tipo_id              BIGINT REFERENCES tipo (id),
  etapa_id             BIGINT NOT NULL REFERENCES etapa (id),
  prazo                DATE,
  -- e-mail de quem cuida (nasce vazio; o DP preenche)
  responsavel          TEXT CHECK (responsavel IS NULL OR responsavel ~ '^[^@\s]+@[^@\s]+$'),
  origem               TEXT NOT NULL CHECK (origem IN ('MANUAL', 'EMAIL')),
  -- "Não é processo": some das abas e vai para Descartados (dá para restaurar)
  descartado_em        TIMESTAMPTZ,
  descartado_por       TEXT,
  criado_em            TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por           TEXT NOT NULL,
  atualizado_em        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS processo_numero_idx ON processo (numero) WHERE numero IS NOT NULL;
CREATE INDEX IF NOT EXISTS processo_etapa_idx ON processo (etapa_id) WHERE descartado_em IS NULL;

-- Histórico: toda mudança em processo, gravada por trigger, com quem fez.
CREATE TABLE IF NOT EXISTS evento (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  processo_id  BIGINT NOT NULL,
  acao         TEXT NOT NULL CHECK (acao IN ('INSERT', 'UPDATE', 'DELETE')),
  antes        JSONB,
  depois       JSONB,
  autor        TEXT NOT NULL,
  em           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evento_processo_idx ON evento (processo_id, em DESC);

-- Quem está escrevendo vem por set_config(..., true) dentro da transação (funciona atrás do Supavisor).
CREATE OR REPLACE FUNCTION registrar_evento() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  linha_nova JSONB := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  linha_velha JSONB := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
BEGIN
  -- UPDATE que não muda nada além do carimbo não é evento
  IF TG_OP = 'UPDATE' AND (linha_nova - 'atualizado_em') = (linha_velha - 'atualizado_em') THEN
    RETURN NEW;
  END IF;
  INSERT INTO evento (processo_id, acao, antes, depois, autor)
  VALUES (
    (COALESCE(linha_nova, linha_velha) ->> 'id')::bigint, TG_OP, linha_velha, linha_nova,
    COALESCE(NULLIF(current_setting('dp_processos.autor', true), ''), current_user)
  );
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS processo_evento ON processo;
CREATE TRIGGER processo_evento AFTER INSERT OR UPDATE OR DELETE ON processo
  FOR EACH ROW EXECUTE FUNCTION registrar_evento();

ALTER TABLE etapa ENABLE ROW LEVEL SECURITY;
ALTER TABLE tipo ENABLE ROW LEVEL SECURITY;
ALTER TABLE processo ENABLE ROW LEVEL SECURITY;
ALTER TABLE evento ENABLE ROW LEVEL SECURITY;
