# Baseline do banco

O DDL inicial canônico é [src/db/bootstrap/FHDOD.sql](../src/db/bootstrap/FHDOD.sql).
Execute-o uma única vez, somente em PostgreSQL vazio com conexão administrativa.
Ele não é migration e nunca deve ser reaplicado em banco existente.

## Banco novo

1. Aplique o bootstrap uma única vez.
2. Execute `npm run migrate` com `DATABASE_URL_MIGRATIONS`.
3. Execute o seed depois das migrations.

## Banco existente

1. Não execute o bootstrap.
2. Execute `scripts/db/verify-phase2-schema.sql` com conexão administrativa.
3. Compare tabelas, constraints, índices, grants e policies com o bootstrap.
4. Aplique apenas migrations incrementais via `npm run migrate`.

## Drizzle baseline reconciliado

`src/db/schema/baseline.ts` é a fonte de verdade do Drizzle Kit para as 30
tabelas, 10 enums, índices, FKs, checks e policies que o Kit suporta. Ela foi
introspectada de PostgreSQL 16 local após bootstrap e migrations `0000`–`0003`.
Os schemas `core.ts` e `questions.ts` permanecem como tipos focados na
aplicação e não participam da geração, evitando definições duplicadas.

`src/db/migrations/meta/0003_snapshot.json` é o snapshot reconciliado após
`0003_make_global_nps_dynamic.sql`. Funções, triggers, roles, grants e SQL
`SECURITY DEFINER` continuam no bootstrap e em migrations SQL manuais, pois não
são inferidos de forma completa pelo Drizzle.

## Gerar migration futura

1. Altere `src/db/schema/baseline.ts` e, se aplicável, o DDL canônico.
2. Execute `npx drizzle-kit generate --config drizzle.config.ts`.
3. Revise todo o SQL: interrompa diante de `DROP` inesperado, recriação de
   objeto ou mudança de roles, grants ou funções.
4. Aplique em banco local descartável com `npm run migrate` antes de qualquer
   ambiente compartilhado.

Não use `drizzle-kit push`. Não altere journal/snapshot para ocultar
divergências e nunca reexecute o bootstrap em banco já inicializado.
