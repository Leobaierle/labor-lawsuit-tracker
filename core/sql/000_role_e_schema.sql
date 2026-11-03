-- Processos trabalhistas do DP — role e schema no Supabase
--
-- Roda UMA vez, como `postgres` (admin do Supabase), antes do 001. Os arquivos
-- seguintes rodam já como o role do serviço.
--
--   docker exec -i supabase-db psql -U postgres \
--        -v senha="'<gerar e guardar no gerenciador de segredos>'" < 000_role_e_schema.sql
--
-- Padrão dos outros serviços :
--   * role e schema próprios, nunca o `postgres`;
--   * `grant <role> to postgres` ANTES do `create schema ... authorization`;
--   * conexão do serviço: dp_processos_app.<tenant>@db.example.internal:6543 (Supavisor).

CREATE ROLE dp_processos_app LOGIN PASSWORD :senha;
GRANT dp_processos_app TO postgres;
CREATE SCHEMA dp_processos_trabalhistas AUTHORIZATION dp_processos_app;
ALTER ROLE dp_processos_app SET search_path = dp_processos_trabalhistas;

-- A única porta de entrada é o dp-console-graphql (plataforma `dp` do JWT do
-- console) e, depois, o robô de e-mail. PostgREST (anon/authenticated) fica de fora.
REVOKE ALL ON SCHEMA dp_processos_trabalhistas FROM PUBLIC;
