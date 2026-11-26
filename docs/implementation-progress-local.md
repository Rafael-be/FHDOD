# Progresso local — publicação manual e auditoria

## Rodada final iniciada

O teste `tests/db/migration-integrity.test.ts` foi corrigido para preservar a âncora histórica `0013`, conferir índices contínuos e exigir a sequência `0014`–`0016`. Resultado direcionado: 3/3 testes aprovados. A suíte geral, a classificação dos testes ignorados e a validação nova das migrations em cópia local ainda não foram executadas nesta rodada.

Atualização da rodada final: suíte geral sem integração, com sockets locais liberados: 36 suítes aprovadas, 20 ignoradas; 184 testes aprovados, 38 ignorados, zero falhas. A primeira tentativa sem permissão de sockets falhou por `listen EPERM` do sandbox, não por código. Os 20 conjuntos ignorados são predominantemente testes PostgreSQL condicionados a `POSTGRES_INTEGRATION_TESTS=true` e URLs locais isoladas. Com integração habilitada no cluster temporário `/tmp/fhdod-migration-validation-mFIZoV/pg`, a suíte teve 52 suítes aprovadas, 3 falhas, 1 ignorada; 212 testes aprovados, 6 falhas, 4 ignorados. Falhas: fixtures de perguntas pressupõem ausência de NPS global pré-existente; banco temporário restaurado sem grants de bootstrap em `shift_sheet_versions`; expectativa RLS fixa de 65 políticas agora observa 75 após `0014`–`0015`. Próxima ação: corrigir as expectativas/fixtures com base no schema real, restaurar apenas os grants locais de teste e reexecutar os testes afetados.

Conclusão da reexecução integrada: 55 suítes aprovadas, 1 ignorada; 218 testes aprovados, 4 ignorados e zero falhas. A única suíte ignorada é `tests/db/audit-retention.integration.test.ts`, que exige URLs locais adicionais para a role de manutenção de auditoria; não foram configuradas. O migrador oficial foi reexecutado somente no banco temporário, confirmou 17 entradas no ledger sem duplicação. Typecheck, lint, build e `git diff --check` passaram. Checklist de implantação criado em `docs/manual-publish-deployment-checklist.md`.

Branch: `feature/backend-manual-publish-audit`, criada a partir de `8414b90` com alterações não commitadas preservadas. Não houve commit, push ou merge.

## Implementado antes da continuação

- Migrations locais `0014` (rascunhos), `0015` (ponteiro vigente e backfill) e `0016` (bloqueio de ponteiro incompleto). Aplicadas somente ao PostgreSQL temporário `fhdod_test`; ledger com 17 entradas.
- Publicação manual transacional, prontidão, histórico, restauração, bloqueio das rotas antigas de escrita e sessões vinculadas ao ponteiro vigente.
- Documentação em `docs/form-drafts-stage1.md` e `docs/form-publication.md`; OpenAPI atualizado.
- Testes direcionados: 9 suítes/18 testes de rascunhos, publicação e submissões; 2 suítes/11 testes unitários de sessão/cache, todos aprovados. Typecheck, lint, build e `git diff --check` aprovados antes desta continuação.
- Benchmark local: criação fria 24,63 ms; 30 criações quentes mediana 4,18 ms/p95 6,70 ms, mediana 8 queries; 16 concorrentes 43,05 ms no total; leitura do ponteiro mediana 0,19 ms/p95 0,35 ms; 5 publicações mediana 12,24 ms/p95 15,60 ms. Sem comparação causal com ambiente remoto.

## Continuação atual

- Investigação de permissão: `GET /api/questions` exigia superusuário mesmo com `sectorId` vinculado ao gestor. `QuestionsService.listCatalog` agora permite somente setor vinculado ao gestor e filtra vínculos de outros setores na resposta. Teste unitário de regressão aprovado (11/11 na suíte).
- CSV anexado: 80 linhas de dados, 3.865 bytes, quatro setores. Reprodução no `fhdod_test` com setores extras desativados dentro de transação revertida: 28 dias e 78 faixas. Antes: 114 queries, parser 1,29 ms, validação 6,71 ms, importação 42,60 ms. Depois do lote SQL: 10 queries, parser 2,29 ms, validação 6,65 ms, importação 15,45 ms. Redução de 63,7% no tempo local de importação; 40 segundos remotos não foram reproduzidos. Testes de horários: 4 suítes/10 testes aprovados.
- Auditoria inicial de rotas: inventário e status registrados em `docs/backend-audit-local.md`. Testes HTTP direcionados passaram (4 suítes/9 testes); a leitura do catálogo por gestor também passou via HTTP com banco local. Cinco rotas de leitura foram medidas por HTTP local com 20 amostras cada e identidade simulada; autenticação real e demais rotas ainda não foram medidas.
- Redis: configuração padrão local `127.0.0.1:6379`, cache de perguntas desabilitado por padrão e limite de segurança habilitado. `redis-cli` indisponível e nenhum `redis-server` ativo encontrado; métricas de capacidade não coletadas.
- Typecheck, lint, build e `git diff --check` aprovados após estas correções. Uma tentativa anterior de teste HTTP foi interrompida pelo limite da revisão automática, mas uma execução posterior passou.
- Instância PostgreSQL temporária em `/tmp/fhdod-migration-validation-mFIZoV/pg` foi encerrada após as medições; os arquivos foram preservados. `fhdod_dev` e o PostgreSQL original não foram alterados nesta continuação.

## Próxima ação

Medir latência HTTP por rota com credenciais de teste seguras quando disponíveis. Validar métricas Redis se o serviço for iniciado. Revisar diff final e confirmar todos os testes direcionados após eventual nova alteração.

## Auditoria HTTP local concluída nesta continuação

- Bancos temporários separados: instalação limpa com ledger `0000`–`0016` e cenário histórico iniciado em `0013`, migrado pelo mecanismo oficial a `0016` sem alteração nas contagens de setores, usuários, vínculos, versões, sessões e respostas. Reexecução do migrador manteve 17 entradas.
- Backend real em `127.0.0.1:3317`, PostgreSQL local `fhdod_test` em `127.0.0.1:55434`, login real, cookies e CSRF. Inventário dos routers: 66 rotas; 111 requisições HTTP finais, 66/66 rotas chamadas, zero falhas de status. 54 rotas tiveram sucesso 2xx; 12 rotas antigas de escrita retornaram o 409 contratual.
- Correções nesta rodada: montagem dos routers públicos de conteúdo/Ouvidoria antes da autenticação administrativa; escopo da permissão de horários; escopo dos limitadores de submissão. Regressão HTTP direcionada de escopo passou (2/2), assim como testes de conteúdo e Ouvidoria.
- Contagens após rodada HTTP final no banco local: 2 respostas de formulário, 3 sessões, 2 versões de formulário, 1 ponteiro vigente, 3 versões de planilha, 28 dias de turno e 2 faixas.
- Benchmark real com login, 25 leituras sequenciais por rota: p95 entre 3,31 e 10,92 ms em sete rotas. Redis não está instalado; backend foi executado com cache Redis e limitador Redis desabilitados.
- Typecheck, lint, build e `git diff --check` passaram. Suíte completa no fixture histórico local: 56 suítes/219 testes aprovados, 1 suíte/4 testes ignorados. A suíte em banco vazio falhou porque alguns testes de integração pressupõem IDs e dados históricos específicos; os quatro arquivos afetados passaram 9/9 no fixture histórico. A instalação limpa foi validada separadamente por migrador e HTTP real.
- Relatórios: `docs/local-backend-e2e-audit.md` e `docs/frontend-integration-pending.md`. Nenhum acesso ao Supabase, alteração em `.env`, commit, push ou merge.
