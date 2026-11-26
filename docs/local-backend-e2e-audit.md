# Auditoria HTTP local do backend FHDOD

## Ambiente e método

- Branch `feature/backend-manual-publish-audit`; servidor real `src/server.ts` em `127.0.0.1:3317`; Node 26.13.0; PostgreSQL 18.6 em cluster temporário na porta 55434; banco `fhdod_test`.
- Conexões de processo apontaram somente para `127.0.0.1`; `.env` não foi alterado. Login real com cookie, CSRF e gestor vinculado a um setor. Credenciais sintéticas ficaram em arquivo privado sob `/tmp`, fora do Git.
- Instalação limpa: bootstrap único e migrador oficial `npm run migrate`; 17 migrations (`0000`–`0016`). Fixture local: 2 usuários, 2 setores, 1 publicação, 14 dias de horário, 1 faixa.
- Migração histórica: banco separado na porta 55435, ledger inicial 14 (`0000`–`0013`), fixture histórico com 1 setor, 2 usuários, 1 vínculo de gestor, 1 versão, 1 sessão e 1 resposta. Aplicação oficial de `0014`–`0016` elevou o ledger a 17; contagens históricas permaneceram 1/2/1/1/1/1, ponteiro vigente foi criado, e 10 políticas novas foram registradas. Reexecutar o migrador manteve 17 entradas.
- Redis não está instalado (`redis-server` e `redis-cli` ausentes). A auditoria HTTP usou `CACHE_ENABLED=false` e `SECURITY_REDIS_ENABLED=false`; não há medição de Redis real. O fallback em memória de rate limiting foi observado no teste de regressão.

## Cobertura

- Inventário: **66 rotas registradas** nos routers montados e Swagger. **66/66 chamadas via HTTP real**, em **111 requisições**, todas com status esperado. **54 rotas** tiveram ao menos um 2xx; as outras **12** são endpoints antigos de escrita bloqueados por 409 `FORM_DRAFT_REQUIRED`. **32 rotas** tiveram também ao menos um cenário 4xx esperado. Não houve rota bloqueada por dependência externa.
- Os perfis cobertos foram público/anônimo, superusuário, gestor vinculado e gestor fora do escopo. CSRF inválido, capability ausente, resposta fora da escala, conflito de revisão, setor inativo e sessão revogada foram verificados. A auditoria não substitui teste de carga, expiração por tempo real nem Redis distribuído.

## Inventário e resultados HTTP

| Método | Rota | Módulo | Perfil observado | Status observado | Tempo mediano observado (ms) |
|---|---|---|---|---|---:|
| GET | `/api/audit-logs` | audit | superuser | 200 | 10.28 |
| GET | `/api/pages/:slug` | content | publico | 200/404 | 7.25 |
| PUT | `/api/pages/:slug` | content | superuser | 200/403 | 4.99 |
| GET | `/api/managers` | admin | superuser | 200 | 3.55 |
| GET | `/api/managers/:id` | admin | superuser | 200 | 4.56 |
| POST | `/api/managers` | admin | superuser | 201 | 39.96 |
| PATCH | `/api/managers/:id` | admin | superuser | 200 | 7.22 |
| POST | `/api/managers/:id/deactivate` | admin | superuser | 200 | 4.51 |
| POST | `/api/managers/:id/reactivate` | admin | superuser | 200 | 32.95 |
| GET | `/api/managers/:id/sectors` | admin | superuser | 200/404 | 5.43 |
| PUT | `/api/managers/:managerId/sectors/:sectorId` | admin | superuser | 204 | 5.61 |
| DELETE | `/api/managers/:managerId/sectors/:sectorId` | admin | superuser | 204 | 6.60 |
| GET | `/api/sectors` | admin | gestor/publico/superuser | 200/401 | 5.12 |
| GET | `/api/sectors/:id` | admin | gestor/superuser | 200/403 | 5.22 |
| GET | `/api/sectors/:id/status` | admin | gestor | 200/403 | 5.67 |
| POST | `/api/sectors` | admin | superuser | 201 | 8.68 |
| PATCH | `/api/sectors/:id` | admin | superuser | 200 | 5.92 |
| POST | `/api/sectors/:id/deactivate` | admin | superuser | 200 | 5.15 |
| POST | `/api/sectors/:id/reactivate` | admin | superuser | 200 | 5.29 |
| GET | `/health` | health | publico | 200 | 53.34 |
| GET | `/health/ready` | health | publico | 200 | 9.26 |
| POST | `/api/public/ombudsman/tickets` | ombudsman | publico | 201/400 | 4.68 |
| GET | `/api/ombudsman/tickets` | ombudsman | gestor/superuser | 200/403 | 4.50 |
| GET | `/api/ombudsman/tickets/:id` | ombudsman | superuser | 200 | 6.62 |
| PATCH | `/api/ombudsman/tickets/:id/status` | ombudsman | superuser | 200/403 | 7.19 |
| GET | `/api/shift-sheets/template` | shift-sheet | superuser | 200 | 6.12 |
| GET | `/api/shift-sheets/current/export` | shift-sheet | superuser | 200 | 7.21 |
| GET | `/api/shift-sheets` | shift-sheet | superuser | 200 | 5.03 |
| POST | `/api/shift-sheets` | shift-sheet | superuser | 201/400/403 | 8.39 |
| POST | `/api/auth/login` | auth | gestor/gestor temporario/publico/superuser | 200/401 | 38.71 |
| POST | `/api/auth/refresh` | auth | superuser | 200 | 9.46 |
| GET | `/api/auth/me` | auth | gestor/superuser | 200/401 | 7.13 |
| GET | `/api/auth/csrf` | auth | superuser | 200 | 10.19 |
| POST | `/api/auth/change-temporary-password` | auth | gestor temporario/superuser | 204/403 | 56.08 |
| POST | `/api/auth/change-password` | auth | superuser | 204 | 58.20 |
| POST | `/api/auth/change-email` | auth | superuser | 204 | 37.66 |
| POST | `/api/auth/logout` | auth | gestor | 204/403 | 3.00 |
| POST | `/api/public/submissions/:sessionId/restart` | submission.restart | publico | 201 | 7.18 |
| POST | `/api/public/submissions/:sessionId/refresh` | submission.restart | publico | 200 | 3.70 |
| POST | `/api/public/submissions/:sessionId/close` | submission.restart | publico | 200 | 3.94 |
| GET | `/api/sectors/:sectorId/form-draft` | form-draft | gestor | 200/403 | 15.71 |
| PUT | `/api/sectors/:sectorId/form-draft` | form-draft | gestor | 200/403/409 | 11.82 |
| DELETE | `/api/sectors/:sectorId/form-draft` | form-draft | gestor | 200 | 13.63 |
| GET | `/api/sectors/:sectorId/form-draft/readiness` | form-draft | gestor | 200 | 20.19 |
| POST | `/api/sectors/:sectorId/form-draft/publish` | form-draft | gestor | 200/403 | 21.27 |
| GET | `/api/sectors/:sectorId/form-versions` | form-draft | gestor | 200 | 14.91 |
| GET | `/api/sectors/:sectorId/form-versions/:versionId` | form-draft | gestor | 200 | 12.22 |
| POST | `/api/sectors/:sectorId/form-versions/:versionId/restore` | form-draft | gestor | 200 | 22.06 |
| POST | `/api/public/sectors/:sectorId/submissions` | submission | publico | 201/409 | 6.14 |
| POST | `/api/public/submissions/:sessionId/answers` | submission.answer | publico | 200/400/403 | 6.61 |
| GET | `/api/questions` | questions | gestor/superuser | 200/403 | 12.74 |
| GET | `/api/questions/:id` | questions | superuser | 200 | 13.81 |
| GET | `/api/sectors/:sectorId/questions` | questions | gestor | 200 | 16.04 |
| POST | `/api/sectors/:sectorId/questions` | questions | gestor | 409 | 9.96 |
| POST | `/api/standard-questions` | questions | superuser | 409 | 12.45 |
| POST | `/api/nps-questions` | questions | superuser | 409 | 12.35 |
| POST | `/api/sectors/:sectorId/nps` | questions | superuser | 409 | 10.96 |
| DELETE | `/api/sectors/:sectorId/nps` | questions | superuser | 409 | 11.21 |
| POST | `/api/sectors/:sectorId/questions/reorder` | questions | superuser | 409 | 8.60 |
| POST | `/api/sectors/:sectorId/standard-questions/reorder` | questions | superuser | 409 | 7.88 |
| POST | `/api/sectors/:sectorId/standard-questions/:questionId/deactivate` | questions | superuser | 409 | 9.50 |
| POST | `/api/sectors/:sectorId/standard-questions/:questionId/reactivate` | questions | superuser | 409 | 9.53 |
| PATCH | `/api/questions/:id` | questions | superuser | 409 | 8.32 |
| POST | `/api/questions/:id/deactivate` | questions | superuser | 409 | 9.01 |
| POST | `/api/questions/:id/reactivate` | questions | superuser | 409 | 9.94 |
| GET | `/api-docs/` | app.ts | publico | 200 | 5.58 |

Cada tempo desta tabela usa as chamadas funcionais disponíveis para a rota; quando há uma chamada, não representa p95. Os status 4xx listados são cenários negativos esperados.

## Persistência e segurança

- Após a rodada HTTP final, foram verificados diretamente no banco local 2 respostas de formulário, 3 sessões, 2 versões, 1 ponteiro vigente, 3 versões de planilha, 28 dias de turno e 2 faixas. A criação de sessão manteve a versão publicada, e a importação CSV válida retornou 201; a inválida retornou 400. O CSV exportado manteve `SEM_TURNO`.
- Publicar mudou o ponteiro, restaurar criou rascunho sem substituir o histórico, e descartar removeu o rascunho. A suíte de integração histórica cobre as asserções detalhadas de IDs, versões e integridade. O script HTTP verificou payloads essenciais, mas não fez uma comparação SQL antes/depois de cada uma das 111 requisições.
- As rotas administrativas rejeitaram gestor fora do escopo e CSRF inválido. As rotas públicas de LGPD e Ouvidoria responderam sem login após a correção da montagem dos routers.

## Falhas corrigidas

1. `src/app.ts`: routers públicos de conteúdo e Ouvidoria eram interceptados pelo middleware administrativo anterior; movidos antes dele. Regressões HTTP em `tests/content/content-audit.http.test.ts` e `tests/ombudsman/ombudsman.http.test.ts`.
2. `src/modules/shifts/shift-sheet.routes.ts`: middleware de superusuário montado na raiz `/api` bloqueava rotas de perguntas e rascunhos de gestores; escopo restrito a `/shift-sheets`. Verificado com login real de gestor.
3. `src/modules/submissions/submission*.routes.ts`: limitadores públicos montados em `/api` contavam requisições administrativas; escopo limitado aos caminhos públicos. Regressão em `tests/app/router-scope.http.test.ts` e rodada HTTP real.

## Latência local

| Rota | Amostras | Mediana (ms) | p95 (ms) |
|---|---:|---:|---:|
| `/health` | 25 | 3.86 | 6.03 |
| `/health/ready` | 25 | 1.96 | 3.31 |
| `/api/sectors` | 25 | 4.19 | 4.91 |
| `/api/questions` | 25 | 9.30 | 10.92 |
| `/api/shift-sheets` | 25 | 7.19 | 9.21 |
| `/api/audit-logs` | 25 | 7.69 | 10.31 |
| `/api/pages/lgpd` | 25 | 2.39 | 3.34 |

Medições sequenciais com cache aquecido, HTTP local e login real. Não houve carga concorrente nem Redis. No conjunto medido, `/api/questions` teve o maior p95 (10,92 ms), sem indicação de gargalo impeditivo. Métricas de queries e tempo SQL por rota não foram coletadas nessa rodada; os tempos incluem cliente HTTP e servidor.

## Verificações finais e limites

- Typecheck, lint, build e `git diff --check`: aprovados após as correções.
- Suíte completa no fixture histórico PostgreSQL local: **56 suítes e 219 testes aprovados; 1 suíte e 4 testes ignorados** (`audit-retention.integration.test.ts`, requer role local de manutenção). Zero falhas.
- A suíte em banco novo e no banco HTTP retornou falhas de testes de integração que pressupõem IDs e dados históricos fixos. Os quatro arquivos afetados passaram (9/9) no fixture histórico, e a suíte completa também. A instalação limpa em si foi validada separadamente por migração e E2E real; a reprodutibilidade da suíte em banco vazio ainda requer fixtures autossuficientes.
- As amostras HTTP foram geradas por scripts temporários arquivados fora do repositório em `/tmp/fhdod-e2e-MANwIH/e2e-fixture.ts` e `/tmp/fhdod-e2e-MANwIH/e2e-http.mjs`; não serão incluídos no Git. Eles usam porta e caminhos locais fixos e não constituem um harness genérico. A reprodução exige um cluster descartável, bootstrap, `npm run migrate` com `DATABASE_URL_MIGRATIONS` local, fixture, servidor com `DATABASE_URL` local e execução do cliente HTTP. Não execute contra banco com dados reais.
