-- Processos trabalhistas — andamento no tribunal (API pública do DataJud/CNJ)
-- Banco: Supabase | Schema: dp_processos_trabalhistas | Role: dp_processos_app
--
-- Pedido em 24/10/2026 (Q35/Q36): um campo só de leitura com a situação do processo no tribunal,
-- tirada das movimentações do DataJud e atualizada sozinha uma vez por semana. Não mexe na etapa (a etapa é
-- do DP). Tabela à parte para a atualização semanal não encher o histórico do processo.

CREATE TABLE IF NOT EXISTS andamento_tribunal (
  processo_id          BIGINT PRIMARY KEY REFERENCES processo (id) ON DELETE CASCADE,
  -- última consulta que deu certo; null = nunca deu certo (ver erro)
  consultado_em        TIMESTAMPTZ,
  -- false = o número (ainda) não está no DataJud
  encontrado           BOOLEAN,
  -- "Audiência de instrução designada", "Liquidação iniciada"...; data do movimento que a definiu
  situacao             TEXT,
  situacao_em          DATE,
  ultima_movimentacao  DATE,
  -- vara/turma do grau com a movimentação mais recente
  orgao                TEXT,
  -- última tentativa (com ou sem sucesso) e a falha dela; numa falha o andamento anterior continua
  tentado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  erro                 TEXT
);

ALTER TABLE andamento_tribunal ENABLE ROW LEVEL SECURITY;
