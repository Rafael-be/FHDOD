# Inicialização segura do banco

1. Revise o `FHDOD.sql` de referência e aplique-o **uma única vez** em um banco PostgreSQL vazio com uma conexão administrativa. Nunca use `DATABASE_URL` para DDL.
2. Configure a senha da role `fhdod_api` interativamente e use essa role em `DATABASE_URL`; mantenha a conta administrativa somente em `DATABASE_URL_MIGRATIONS`.
3. Execute `npx drizzle-kit pull --init` somente depois de confirmar que o destino é o banco recém-inicializado. Revise todo arquivo gerado e não aplique migrations geradas sem revisão.
4. Forneça as três variáveis `INITIAL_SUPERUSER_*` apenas no ambiente seguro e rode `npm run seed`. O seed é idempotente: não troca a senha da conta já existente. Ele cria a página LGPD com conteúdo vazio, que não é publicação jurídica.

Para testes, `DATABASE_URL_TEST` deve apontar para um destino diferente de `DATABASE_URL`. A suíte usa exclusivamente essa variável para integração e reverte os dados sintéticos de teste por transação.

Nenhum comando deste repositório aplica o bootstrap ou migrations automaticamente.
