# Inicialização segura do banco

1. Revise o `FHDOD.sql` de referência e aplique-o **uma única vez** em um banco PostgreSQL vazio com uma conexão administrativa. Nunca use `DATABASE_URL` para DDL.
2. Configure a senha da role `fhdod_api` interativamente e use essa role em `DATABASE_URL`; mantenha a conta administrativa somente em `DATABASE_URL_MIGRATIONS`.
3. Execute `npx drizzle-kit pull --init` somente depois de confirmar que o destino é o banco recém-inicializado. Revise todo arquivo gerado e não aplique migrations geradas sem revisão.
4. Forneça as três variáveis `INITIAL_SUPERUSER_*` apenas no ambiente seguro e rode `npm run seed`. O seed é idempotente: não troca a senha nem reativa a conta já existente. Uma conta criada pelo seed recebe senha temporária, com troca obrigatória e validade de 48 horas. Ele cria a página LGPD com conteúdo vazio, que não é publicação jurídica.

Para testes, `DATABASE_URL_TEST` deve apontar para um destino diferente de `DATABASE_URL`. A suíte usa exclusivamente essa variável para integração e reverte os dados sintéticos de teste por transação.

Nenhum comando deste repositório aplica o bootstrap ou migrations automaticamente.

## Limite de falhas de login

São contabilizadas somente falhas de credenciais válidas no formato esperado (`401 INVALID_CREDENTIALS`). A quinta falha efetiva de um mesmo IP em uma janela deslizante de 15 minutos ainda retorna `401`; a sexta requisição é bloqueada antes da verificação de credenciais com `429 LOGIN_FAILED_RATE_LIMITED`. A janela é renovada a cada nova falha e expira 15 minutos após a última delas. Um login bem-sucedido limpa apenas o atraso progressivo associado ao identificador, nunca a contagem por IP.

O contador atual usa memória do processo. Portanto, é reiniciado quando a API reinicia e não é compartilhado entre instâncias. Em produção com múltiplas réplicas, adote um armazenamento compartilhado para esse estado antes de tratar o bloqueio como proteção global.
