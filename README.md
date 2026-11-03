# Controle de processos trabalhistas

Módulo que junta num lugar só **todos os processos trabalhistas que chegam por e-mail** ao Departamento Pessoal: uma
linha por processo (pelo número CNJ), com etapa, prazo, responsável, a linha do tempo dos e-mails e o **andamento no
tribunal** consultado no DataJud do CNJ.

> Módulo real, em produção, extraído de um monorepo maior (console interno em React + API GraphQL) e publicado aqui
> sem dados da empresa. E-mails, nomes e números de processo nos testes são fictícios.

## Ideia central: o robô coleta, o DP decide

- O robô **cria o processo** quando acha um número CNJ novo e **junta os e-mails** na linha do tempo.
- Etapa, prazo, tipo e responsável são do DP. **O robô nunca muda a etapa sozinho.**
- Processo novo entra em "Novo" com a empresa "a identificar". E-mail novo num processo ganha um selo até alguém
  abrir.

## Peças

**`core/`**: domínio, banco e integrações (TypeScript, Bun, `pg`)
- `dominio.ts`: normalização e **validação do número CNJ pelo dígito verificador** (módulo 97). Só entra processo da
  Justiça do Trabalho (segmento 5).
- `conexoes.ts` + `microsoft.ts`: **"Conectar meu e-mail"**, OAuth2 delegado no Microsoft Entra (`Mail.Read` +
  `offline_access`), com `state` assinado (HMAC) e expiração, conta restrita ao domínio da empresa e **caixas
  compartilhadas** que só entram se a conta conectada consegue lê-las.
- `cifra.ts`: refresh tokens guardados com **AES-256-GCM**. A chave fica fora do banco, então quem lê o banco não lê
  e-mail de ninguém.
- `varredura.ts`: o **robô de e-mail**. Lê Caixa de Entrada e subpastas pelo Microsoft Graph, de onde parou. A
  primeira leitura volta 3 meses. A gravação é idempotente (o mesmo trecho pode ser relido) e os erros ficam por
  caixa.
- `datajud.ts`: **andamento no tribunal** pela API pública do DataJud. Escolhe o índice pelo TRT do número e lê os
  movimentos codificados pela TPU do CNJ (audiência, liminar, sentença, acordo, recurso). A situação é o marco mais
  recente entre os graus.
- `processos.ts` / `listas.ts`: CRUD, histórico de alterações, etapas e tipos editáveis pelo DP.
- `sql/`: schema e migrações (role e schema próprios, nunca o `postgres`).

**`api/`**: resolvers GraphQL do módulo no servidor do console. O robô de e-mail roda de hora em hora dentro do
próprio serviço, e o andamento do DataJud é atualizado semanalmente.

**`web/`**: tela no console (React): agrupado por empresa, uma aba por etapa mais "Todos", "Vencendo" e
"Descartados", filtros "Sem responsável" e "Meus processos", e o diálogo do processo com a linha do tempo e o
andamento.

## Testes

60 testes com `bun test`: domínio, DataJud (com `fetch` simulado), cifra e `state`, leitura do Graph, e testes de
banco (`*.db.test.ts`) contra Postgres real.

```bash
cd core && bun install && bun test
```

`api/` e `web/` importam peças do console onde rodam (contexto GraphQL, componentes de UI). Estão aqui para leitura,
não rodam sozinhos.
