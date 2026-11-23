# Auditoria de submissão, performance e cache — 23/11/2026

## Correção crítica

- Base `8904e76`, branch `fix/backend-submission-performance`. O `.env` aponta runtime `fhdod_api` e migrador administrativo para o pooler Supabase (schema public). O processo HTTP encontrado não tinha override DATABASE_URL e carregava `.env`. A configuração padrão do Vite encaminha `/api` para localhost:3000. Nenhum arquivo do frontend foi alterado.
- Duas consultas remotas estritamente de leitura, autorizadas pela investigação do anexo vigente, confirmaram runtime `postgres/fhdod_api/public`, search_path `"$user", public`, ausência de `public.sector_current_forms` e ledger administrativo de 14 entradas (até 0013). A primeira aprovação automática havia interpretado uma restrição antiga; após conferir a autorização atual de consulta ao ledger, a revisão permitiu os dois SELECTs com default_transaction_read_only=on e timeout. Nenhuma migration/seed/alteração remota foi executada.
- PostgreSQL 18.6 local foi preparado em `.local/postgres`, porta 55440, banco descartável fhdod_test, runtime fhdod_api. Bootstrap único, migrador oficial até 0017 (18 entradas), role de retenção pelos scripts oficiais. Dados e logs de `.local/` e `.env.development.local` são ignorados pelo Git.
- `npm run dev` e `npm run migrate:local` agora exigem `.env.development.local` com runtime e migrador no mesmo banco loopback fhdod_test. `dev:configured` preserva o modo explícito por `.env`; start de produção continua separado. Nenhuma senha real foi modificada.
- A prontidão verifica tabelas 0014/0015, capability persistida, policies de leitura legada da 0017 e grants exigidos. Banco incompleto produz DATABASE_SCHEMA_NOT_READY/503 com orientação segura e impede o listen inicial. A API não executa migrations. Não se exige acesso administrativo ao ledger da role runtime.
- Regressão real: sessão no setor 1 retornou 201; notas [5,10] persistidas, status complete e mesma versão de formulário. NPS do demo mudou de 25 para 40, matematicamente correto. Capability inválida 403, sessão expirada 410, setor 2 sem publicação 409 FORM_NOT_PUBLISHED; restart 201. Importação CSV por HTTP 201 preservou a versão histórica da sessão.

## Causa de performance e comparação local

Cada rota recebeu 1 aquecimento e 15 amostras sequenciais com login real, mesmo banco pequeno e cliente Node local. Tempos em ms. Redis desabilitado. As consultas incluem autenticação; não são apenas a query do módulo.

| Rota | Mediana antes | Mediana depois | p95 antes | p95 depois | SQL antes | SQL depois |
|---|---:|---:|---:|---:|---:|---:|
| `/api/sectors` | 9.62 | 9.56 | 18.64 | 14.96 | 3 | 3 |
| `/api/sectors/1/status` | 10.18 | 10.08 | 11.21 | 11.11 | 4 | 4 |
| `/api/audit-logs` | 15.02 | 7.75 | 16.61 | 8.28 | 7 | 3 |
| `/api/analytics/dashboard` | 27.02 | 11.36 | 34.48 | 12.72 | 13 | 3 |
| `/api/questions` | 18.88 | 9.27 | 21.28 | 10.7 | 9 | 3 |

- Os routers administrativos sob /api reautenticavam a mesma requisição. A regressão reproduziu quatro autenticações no arranjo mínimo de routers; o servidor completo fazia seis no dashboard. Uma fronteira comum agora autentica uma vez, mantendo guards de papel, CSRF e escopo. Rotas públicas terminam antes dessa fronteira. Setores/status já atravessavam só uma autenticação, portanto a contagem não mudou.
- A consulta agregada do dashboard continua única. EXPLAIN (ANALYZE, BUFFERS) com role runtime no dataset local: planejamento 2,651 ms e execução 1,530 ms. Sem evidência para índice novo ou alteração arriscada da agregação. CTEs filtram sessões e respostas antes das agregações; sessões não são multiplicadas pelos joins de respostas. Histórico legado entra somente em sessões sem form_version_id.
- As latências remotas de segundos não foram reproduzidas localmente. Reduzir round trips tem benefício estrutural, mas não é uma medição causal de ganho remoto. Não foram inventadas métricas remotas antes/depois.
- Instrumentação opt-in: total HTTP, contagem SQL por AsyncLocalStorage, estágio de autenticação e os estágios SQL/serviço existentes. Não registra texto SQL, parâmetros, cookies ou corpos. As contagens representam comandos enviados pelo driver. Tempo de aquisição isolado fora de transações e serialização não foram separados; EXPLAIN não mede rede/pool. Evidências locais estão em `.local/*benchmark.json`, logs HTTP e analytics-plan.json, excluídos do Git.

## Redis e decisões de cache

| Dado | Decisão | Consistência |
|---|---|---|
| Snapshot publicado | Manter cache limitado por formVersionId | Fonte PostgreSQL imutável; nova sessão consulta ponteiro vigente no banco; publicação cria outro ID; restauração exige nova publicação |
| Perguntas efetivas | Manter Redis opcional existente | Autorização antes do cache; chave setor+versão global; TTL 30–120s; incremento versionado após alteração; falha consulta PostgreSQL |
| Setores/status personalizados | Não adicionar cache | Consulta pequena; permissão e estado operacional exigem leitura atual |
| Dashboard | Não adicionar cache neste dataset | SQL local 1,53ms; custo de invalidação por resposta/escopo supera ganho comprovado |
| Tokens/capabilities/cookies/credenciais | Não cachear em armazenamento compartilhado de respostas | Persistência/validação existentes continuam fonte de autenticação |
| Respostas individuais e dados pessoais da Ouvidoria | Não cachear | Apenas consultas autorizadas e agregados sem dados pessoais |

- Rate limiting distribuído preservado: chaves HMAC, incremento/TTL atômicos, fallback local limitado, sem FLUSH/SCAN. Redis não estava instalado; integração com Redis real não foi executada. Testes usam doubles para falhas, isolamento e invalidação; não equivalem a persistência real Redis.
- Publicação manual agora invalida o cache de perguntas efetivas após o commit, usando o mesmo incremento de versão global do catálogo. Restaurar para rascunho não altera dados efetivos; publicar a restauração invalida novamente. Regressão com PostgreSQL real usa uma segunda conexão para comprovar que o novo ponteiro já está visível ao invalidar; erro simulado de Redis não desfaz a publicação persistida.
- Cache ganha contadores locais de hits/misses/erros/invalidações/fallback e médias de leitura/escrita, sem armazenar chaves ou valores nos contadores. Snapshot por metrics() e relatório de encerramento somente com instrumentação habilitada. A atualização de permissão é conferida antes de cada leitura personalizada; publicar não cacheia o ponteiro vigente.

## Logs e complexidade

- Refresh inválido: cookie ausente, expirado, revogado ou consumido deve continuar produzindo 401. Não foram afrouxadas regras. O cliente já faz single-flight de refresh/CSRF e trata expiração; investigar repetição exige correlacionar ciclo de vida da tela.
- LGPD: o seed inicial mantém placeholder indisponível até publicação; GET 404 é esperado quando conteúdo vazio. O demo separado contém texto rotulado fictício, exclusivo para desenvolvimento. Nenhum texto jurídico foi criado para produção.
- Frontend em StrictMode e effects de montagem pode refazer leituras em desenvolvimento. SectorsPage faz uma consulta de status por setor após listar; refetch após mutações também existe. Há deduplicação de requisições em voo no cliente. Nenhum polling infinito foi comprovado; não houve alteração de ETag nem tratamento de 304 como erro. Documentar eventual batching/deduplicação de status para fase frontend.
- Revisão focal dos módulos de auth/admin/perguntas/formulários/submissões/Ouvidoria/CSV/analytics/auditoria/conteúdo/configuração/cache: SQL parametrizado e autorização permanecem separados. Alta prioridade: configuração errada, readiness insuficiente e autenticação repetida foram corrigidas. Arquivos grandes de OpenAPI/schema são coesos e não foram fragmentados por estética. Status por setor e catálogo são candidatos médios a batching; nenhum endpoint novo foi inventado.

## Testes e limites

- Antes das correções de fixtures: suíte local nova com 3 suítes falhando (6 testes) e 225 aprovados; os testes presumiam usuário 5, setor 2 e perguntas 8/26/12/20 de banco histórico.
- Fixtures próprias agora criam IDs dinâmicos, publicações, NPS, relações e faixas dentro de preparação transacional; limpam somente seus registros. Assertions de escopo, concorrência, conteúdo, versão histórica e descarte físico foram preservadas. Nenhum RLS foi desabilitado. Uma revalidação com CSV formato 2 revelou também que runtime-rls-phase3 restaurava a planilha antes de remover seu setor temporário; a ordem foi corrigida e conexões são fechadas em finally mesmo se a limpeza falhar. A reprodução dirigida passou 2/2 e a suíte final inteira passou novamente.
- Suíte integrada final executada com todos os arquivos presentes: **63 suítes e 236 testes aprovados, zero falhas, zero ignorados**, incluindo retenção e os três testes de destino local. Typecheck, lint, build e diff-check passaram. Smoke final adicional: 20 checagens de login real/CSRF/escopo/revisão/publicação/restauração/Ouvidoria/refresh e 17 chamadas do fluxo público, com CSV importado via HTTP. Uma nova resposta NPS elevou o demo de 40 a 50 conforme a fórmula; os números são do dataset fictício local.
- O banco e os dados demonstrativos são locais descartáveis, sem dados hospitalares. A recuperação via Supabase e o deploy remoto não fazem parte desta validação. A auditoria não equivale a teste de carga nem prova desempenho em volume hospitalar real.

## Estado Git e encerramento

Correções registradas na branch `fix/backend-submission-performance`, derivada de `8904e76` (analytics). `origin/develop` continua em `6f21cc7`, ancestral da branch, sem commits concorrentes no destino na referência consultada. Não foi feito merge/rebase nem alteração da main. A integração depende das mudanças anteriores de publicação/analytics; não omitir essas dependências na revisão. Dados PostgreSQL, configurações locais e evidências brutas permaneceram fora do Git.

Push da branch de correção foi tentado e recusado por falta de autenticação Git HTTPS. Os commits permanecem locais, sem force push ou merge. Comando para publicar após autenticar: `git push -u origin fix/backend-submission-performance`.
