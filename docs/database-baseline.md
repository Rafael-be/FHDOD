# Baseline do banco

O bootstrap canônico está em [`src/db/bootstrap/FHDOD.sql`](../src/db/bootstrap/FHDOD.sql). Ele é o DDL inicial consolidado, incluindo estruturas de fases posteriores; execute-o somente uma vez em um banco PostgreSQL vazio e aprovado.

Ele não é uma migration e nunca deve ser reaplicado em bancos existentes. As migrations em `src/db/migrations` são incrementais e pressupõem que o bootstrap já criou as tabelas.

## Banco novo

1. Aplicar o bootstrap uma única vez com conexão administrativa.
2. Executar `npm run migrate` usando `DATABASE_URL_MIGRATIONS`.
3. Executar o seed apenas depois disso.

## Banco existente

1. Não executar o bootstrap.
2. Executar `scripts/db/verify-phase2-schema.sql` com conexão administrativa e registrar o resultado.
3. Comparar colunas, constraints, índices, grants e policies com o bootstrap antes de qualquer migration nova.
4. Só depois de uma introspecção autorizada gerar o baseline Drizzle. Nunca marque migrations como aplicadas sem verificar os efeitos correspondentes.

O schema TypeScript de perguntas em `src/db/schema/questions.ts` representa as quatro tabelas da Fase 2 e seus índices/constraints. O snapshot Drizzle atual continua sendo um baseline técnico pendente de geração contra um banco isolado; não execute `drizzle-kit generate` até concluir essa conferência.
