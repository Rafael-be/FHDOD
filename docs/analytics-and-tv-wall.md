# Indicadores, pesquisa pública e TV Wall

## Auditoria e impacto de integração

Base auditada em 25/11/2026, `origin/develop` em `a2fb9ef`, com a pesquisa por primeira resposta integrada pelo PR #10. A consulta de preparação ao GitHub encontrou zero PRs abertos. O formulário vigente vem de `sector_current_forms`. Cada tentativa guarda a versão publicada e a faixa histórica da planilha, quando identificada. O GET público consulta o formulário sem criar sessão.

| Contrato | Impacto para o consumidor |
|---|---|
| Pular | A API já aceitava `skipped` com nota nula no POST inicial e no individual. Use a mesma tentativa em reenvios. |
| Encerrar | **Mudança incompatível em dois estados.** Antes, `close` retornava 200 para uma sessão completa ou vencida. Agora a conclusão já confirmada retorna 409 `SUBMISSION_COMPLETED`. O vencimento retorna 410 `SUBMISSION_EXPIRED`. Um fechamento voluntário válido continua retornando 200 em reenvios, inclusive após o prazo original. |
| Iniciadas e séries | A unidade passa de qualquer linha de sessão para uma sessão com pelo menos uma avaliação válida. Os totais históricos podem diminuir. Uma tentativa que só confirmou pulos preserva o progresso mas ainda não entra no denominador. Ao receber a primeira nota, passa a contar no período de criação da tentativa. |
| NPS | A consulta anterior já calculava a diferença entre promotores e detratores usando respostas individuais. O JOIN do snapshot tem chave única por formulário e pergunta. A leitura legada usa apenas sessões sem versão de formulário. A implementação acrescenta seleção múltipla e valida a escala inclusive no histórico. |
| Frontend inspecionado | No checkout local de `FHDOD-front`, `AnalyticsPage.tsx` exibe `data.nps.value` com até uma casa decimal. O cliente consultado enviava no máximo um setor. Não foi reproduzido crescimento indevido por soma de NPS no código auditado. Para o rótulo “NPS médio”, exiba o valor do servidor arredondado a inteiro. |
| Ouvidoria | O dashboard retornava contagens de manifestações a gestores. Agora `ombudsman` é `[]` para esse perfil. O frontend deve ocultar o indicador para gestores. Lista, detalhe, alteração de status e auditoria administrativa exigem superusuário. A rota pública de registro continua exigindo consentimento. Não há rota administrativa de exportação ou atribuição de manifestação no inventário auditado. |

## Definições das métricas

O dashboard usa `started_at` para incluir sessões no intervalo semiaberto `[from,to)`, inclusive quando a conclusão ocorre depois. As contagens e respostas refletem o estado persistido no momento da leitura. Uma avaliação válida tem status `answered`, nota inteira e valor dentro da escala do snapshot. Entram avaliações de pesquisas parciais e completas. Um pulo só participa da contagem explícita `questions[].skipped`.

- **NPS** = `100 × (promotores − detratores) / respostas NPS válidas`. O campo `is_nps` do snapshot identifica a escala 0–10, inclusive em overrides setoriais. Os grupos são 9–10, 7–8 e 0–6. As respostas dos setores selecionados compartilham um denominador. Sem avaliações NPS, `value=null`. A distribuição de notas comuns usa a escala 1–5.
- **Conclusão** = `100 × complete / started`. **Não conclusão** = `100 × incomplete / started`. As taxas são `null` com denominador zero. `incomplete = started − complete`. A classificação “em andamento” exige sessão incompleta, sem encerramento, com prazo vigente. `endedOrExpired` inclui encerramento antecipado, reinício ou vencimento, inclusive antes da reconciliação. `unknownDeadline` preserva sessões legadas abertas sem prazo conhecido. Esses três grupos somam `incomplete`. O campo anterior `closedIncomplete` informa quantas já têm `ended_at` e se sobrepõe a `endedOrExpired`. Um gráfico binário deve rotular o grupo inteiro como “não concluídas”.
- **Turnos** usam `submission_sessions.shift_range_id`, escolhido na criação via planilha e horário hospitalar. A associação sobrevive à troca de planilha e à virada da meia-noite. Cada faixa tem ID próprio, inclusive quando duas faixas têm o mesmo nome. Retornam faixas vigentes, inclusive zeradas, e faixas históricas com conclusões no período. `percentage = 100 × completed / soma das conclusões classificadas`, `null` se essa soma for zero. `sum(shifts[].completed) + unclassifiedCompleted = sessions.complete`. A seleção explícita de uma faixa restringe todo o relatório a ela.
- **Perguntas globais** têm `questions.scope='all_sectors'` no catálogo. A identidade é `questionId`, a linha comparável usa também `questionVersionId` e a escala de `isNps`. A resposta separa publicações vigentes por setor ativo e resultados históricos no período. Um setor pode aparecer em ambas as listas. O snapshot preserva versão, texto e escala. O escopo do catálogo é consultado hoje, pois os snapshots não armazenam uma cópia de `scope`. A distribuição conta avaliações por nota e calcula sua porcentagem sobre as avaliações da mesma linha ou do mesmo setor. A média é aritmética. O modelo publicado contém apenas notas. Não há limiar institucional cadastrado para classificar uma nota como “satisfeito”.
- **Participação** permanece indisponível. A base de avaliações não informa quantos pacientes foram atendidos e nunca responderam.

## Persistência, desempenho e publicação

A migration versionada `0018_tv_wall_configuration.sql` cria uma configuração única JSONB e a inicia com a exibição vazia. O runtime recebe SELECT e UPDATE da coluna de configuração com RLS. O HTTP autoriza alterações por perfil e CSRF. A prontidão da API verifica a tabela e os grants. A migration deve preceder a publicação desse backend. A reversão do código pode manter a tabela. Sua remoção física demanda preservar a configuração, retirar o backend dependente e coordenar a reversão do ledger pelo processo de migrations.

A leitura da TV consulta a configuração a cada requisição. O resultado agregado fica em memória por até 30 segundos por processo, identificado pela configuração completa e pelo dia hospitalar. Chamadas simultâneas para a mesma chave compartilham a consulta em andamento. Uma alteração de configuração é observada na próxima leitura, inclusive em outra instância. Respostas HTTP usam `Cache-Control: no-store`.

Cada indicador público considera somente os setores configurados e os últimos `periodDays` dias **completos** de São Paulo. O dia em curso fica fora. A amostra mínima adotada para esta entrega é **10 sessões distintas** por grupo não vazio. A conclusão considera completos e incompletos e exige pelo menos 10 sessões no total. O NPS e sua distribuição exigem pelo menos 10 participantes em cada faixa NPS não vazia. Qualquer falha de limiar suprime o indicador inteiro. O cliente recebe `null` tanto para supressão como para ausência de dados. Os resultados numéricos públicos são arredondados a inteiro. O payload público contém apenas os valores autorizados, sem contagens brutas, listas de setores, textos ou identificadores de sessão.

As consultas filtram o período e o escopo antes da agregação. As chaves de snapshot e os caminhos mutuamente exclusivos de histórico evitam multiplicar avaliações. A consulta de perguntas globais roda apenas quando solicitada e a TV usa uma consulta própria sem Ouvidoria. Na amostra local de 338 sessões, o mês de maior volume tinha 323. Uma execução de `EXPLAIN (ANALYZE, BUFFERS)` mediu 0,85 ms no dashboard, 0,38 ms em perguntas globais e 0,18 ms nos agregados da TV, excluindo planejamento e rede. Essas medições descrevem um banco pequeno e aquecido. Não foram adicionados índices.

## Validação e entrega local

Branch `feature/analytics-and-tv-wall-backend`, base `origin/develop@a2fb9ef`. Typecheck, ESLint e build aprovados. A suíte completa passou com **66 suítes e 244 testes**, todos executados, incluindo PostgreSQL real, autorização HTTP, concorrência, retenção e auditoria. O teste de ponta a ponta usa a API pública para pular, confirmar uma nota e encerrar a sessão. Depois verifica os contadores pelo dashboard autenticado. O ledger foi validado no banco descartável de loopback. A integração externa e a carga de produção ficaram fora desta validação.

Os commits de implementação e verificação estão abaixo. O último commit da entrega registra esta documentação e o OpenAPI.

```text
5fa684b fix(submissions): distinguish voluntary closure from completion and expiry
11c71d0 feat(analytics): pool valid sector scores and measure rated survey cohorts
098d0e5 feat(analytics): report completion by historical shift range
8bc04c6 feat(analytics): compare published global question versions by sector
54aa82f test(auth): enforce ombudsman scope on details and statistics
2b32477 feat(tv-wall): publish configured privacy-filtered aggregate indicators
0e20c43 fix(submissions): evaluate session deadlines after acquiring locks
4eefecc test(analytics): verify typed reports and public survey lifecycle end to end
```

Arquivos alterados desde a base:

```text
docs/analytics-and-tv-wall.md
docs/analytics.md
docs/public-survey-session-optimization.md
src/app.ts
src/db/migrations/0018_tv_wall_configuration.sql
src/db/migrations/meta/_journal.json
src/db/schema/baseline.ts
src/docs/analytics.openapi.ts
src/docs/openapi.ts
src/modules/analytics/analytics.repository.ts
src/modules/analytics/analytics.routes.ts
src/modules/analytics/analytics.service.ts
src/modules/analytics/analytics.types.ts
src/modules/analytics/tv-wall.routes.ts
src/modules/analytics/tv-wall.service.ts
src/modules/health/health.repository.ts
src/modules/submissions/submission.repository.ts
src/modules/submissions/submission.service.ts
src/server.ts
tests/analytics/analytics.http.test.ts
tests/analytics/analytics.integration.test.ts
tests/analytics/tv-wall.http.test.ts
tests/auth/runtime-rls-policies.integration.test.ts
tests/db/migration-integrity.test.ts
tests/ombudsman/ombudsman.http.test.ts
tests/submissions/form-draft.integration.test.ts
tests/submissions/form-publication.integration.test.ts
tests/submissions/submission.concurrency.integration.test.ts
tests/submissions/submission.first-answer.test.ts
tests/submissions/submission.integration.test.ts
tests/submissions/submission.shift-sheet-v2.integration.test.ts
tests/submissions/submission.skip-close.http.integration.test.ts
```

## Frontend Integration Contract

Todos os caminhos abaixo incluem o prefixo `/api`. Sucessos com corpo usam `{"data":...}`; erros usam `{"error":{"code":"...","message":"..."}}`. Decida o fluxo pelo código. Os tipos do dashboard e da satisfação estão em `src/modules/analytics/analytics.types.ts`. A especificação navegável fica em `/api-docs`.

### Pesquisa pública

| Método e caminho | Entrada | Sucesso |
|---|---|---|
| GET `/api/public/sectors/{sectorId}/current-form` | ID positivo. `If-None-Match` opcional | 200 com `{sectorId,formVersionId,questions}`, ou 304 sem corpo. Cada pergunta fornece `questionId,questionVersionId,position,text,questionKind,isNps,required,options,minScore,maxScore`. |
| POST `/api/public/sectors/{sectorId}/submissions` | JSON `{formVersionId,attemptId,capability,answer}`. Gere um UUID para `attemptId` e 32 bytes aleatórios em base64url para `capability`. Use a primeira pergunta em ordem de posição. | 201 com `{capability:{sessionId,token},session:{id,sectorId,formVersionId,expiresAt,shiftSheetVersionId,shiftRangeId},answer,replayed:false}`. Um reenvio idêntico retorna 200 com `replayed:true`. Campos de turno e `answer.replayed` podem estar ausentes no reenvio. A confirmação de criação reexibida não reabre a sessão. |
| POST `/api/public/submissions/{sessionId}/answers` | Cabeçalho `x-session-capability: <token>`, UUID na URL e JSON da próxima pergunta | 200 com `{sessionId,status,answered,expiresAt,replayed}`. `status` vale `incomplete` ou `complete`. `answered:false` confirma o pulo. |
| POST `/api/public/submissions/{sessionId}/close` | Mesmo cabeçalho, sem corpo | 200 com `{"data":{"sessionId":"<uuid>","status":"closed"}}`. O cliente pode descartar a tentativa depois dessa confirmação. |
| POST `/api/public/submissions/{sessionId}/refresh` | Mesmo cabeçalho, sem corpo | 200 com `{expiresAt,refreshesUsed,refreshesRemaining}`. Até três extensões explícitas por sessão ativa. |
| POST `/api/public/submissions/{sessionId}/restart` | Mesmo cabeçalho, sem corpo | 201 com o formulário vigente (`sectorId,formVersionId,questions,etag`). Fecha a tentativa ativa. A próxima começa no POST inicial com novos identificadores. |

Para pular a pergunta opcional retornada pelo servidor, envie os dois IDs recebidos e o seguinte formato, tanto no campo inicial `answer` quanto no POST individual.

```json
{"questionId":12,"questionVersionId":31,"status":"skipped","score":null}
```

Uma nota usa `{"questionId":12,"questionVersionId":31,"status":"answered","score":4}`. Não envie nota sentinela, não omita a propriedade `score` e não pule localmente para a pergunta seguinte antes da confirmação. A primeira confirmação grava sessão e progresso atomicamente com prazo inicial de três minutos. Cada confirmação nova seguinte define dois minutos a partir da confirmação. Um reenvio idêntico durante a sessão ativa preserva a linha e o prazo. Alterar uma nota ou converter pulo em nota é conflito. Cada operação usa o snapshot fixo da sessão, mesmo após republicação.

A última confirmação em ordem conclui a sessão. Um fechamento voluntário preserva as respostas existentes e o status persistido `incomplete`. Se a última resposta e o encerramento chegam juntos, a operação que obtém o lock primeiro define o resultado. Se a conclusão vencer, trate `SUBMISSION_COMPLETED` como conclusão. Se o fechamento vencer, uma nova resposta recebe `SUBMISSION_CLOSED`. Antes de ter uma sessão, sair do formulário requer apenas fechar a interface.

| HTTP | Códigos relevantes | Ação |
|---|---|---|
| 400 | `VALIDATION_ERROR`, `INVALID_JSON`, `INVALID_ANSWER`, `INVALID_ANSWER_SCORE`, `QUESTION_NOT_SKIPPABLE` | Corrigir IDs, formato, nota ou uso de pulo. Pular exige pergunta de setor opcional. |
| 403 | `SUBMISSION_CAPABILITY_INVALID` | Falta a capability correta desta sessão. Um UUID desconhecido com capability arbitrária também é negado. |
| 404 | `SECTOR_NOT_FOUND`, `SUBMISSION_QUESTION_NOT_FOUND`, `SUBMISSION_NOT_FOUND` | Verificar setor, identidade e versão da pergunta ou disponibilidade do snapshot. |
| 409 | `FORM_VERSION_CHANGED`, `FORM_NOT_PUBLISHED`, `FORM_INCOMPLETE`, `SHIFT_AMBIGUOUS` | Na criação, recarregar o formulário se a versão mudou. Configuração incompleta ou turno ambíguo exigem correção administrativa. |
| 409 | `QUESTION_OUT_OF_SEQUENCE`, `ANSWER_ALREADY_CONFIRMED`, `SUBMISSION_CONFLICT` | Respeitar a ordem e preservar os IDs, a capability e o conteúdo originais ao repetir a tentativa. |
| 409 | `SUBMISSION_CLOSED`, `SUBMISSION_COMPLETED`, `SUBMISSION_REFRESH_LIMIT` | Encerramento já efetivado impede novas respostas e renovações. O limite de renovações mantém o prazo vigente. |
| 410 | `SUBMISSION_EXPIRED` | Exibir expiração. Em `answers` e `refresh`, uma sessão já reconciliada pode retornar `409 SUBMISSION_CLOSED`. |
| 429 | `SUBMISSION_RATE_LIMITED` | Aguardar antes de repetir o mesmo comando. |

### Indicadores administrativos

GET `/api/analytics/dashboard` e GET `/api/analytics/global-questions` exigem cookie `access_token` de superusuário ou gestor com senha definitiva. Envie `from` e `to` em ISO 8601 com offset, intervalo crescente de até 366 dias. Uma consulta de dois setores pode usar `?from=2026-11-01T03:00:00Z&to=2026-12-01T03:00:00Z&sectorIds=2,7`. Use `sectorId` para um setor ou `sectorIds` para até 200 IDs distintos. A ausência desses filtros seleciona todos os setores autorizados. `shiftRangeId` é opcional nos dois endpoints. Um único setor solicitado fora do escopo do gestor invalida a solicitação inteira.

O dashboard retorna estes campos em `data`.

| Campo | Forma JSON |
|---|---|
| `sessions` | Objeto com inteiros `started,complete,incomplete,closedIncomplete,inProgress,endedOrExpired,unknownDeadline` e percentuais `completionRate,nonCompletionRate` numéricos ou nulos. |
| `nps` | `{responses,detractors,passives,promoters,value}`. Contagens inteiras e índice numérico ou nulo. |
| `shifts`, `unclassifiedCompleted` | Lista de `{id,name,sector_id,completed,percentage}` e inteiro de conclusões sem turno. |
| `questions`, `distribution` | Listas de `{question_id,question_version_id,is_nps,responses,skipped,mean}` e `{is_nps,score,responses}`. `mean` é nulo sem notas comuns. |
| `daily`, `dailyAnswers`, `sectors` | Listas de `{day,started,complete}`, `{day,mean,nps_responses,nps}` e `{sector_id,started,complete}`. Dias usam `YYYY-MM-DD` em São Paulo. Séries incluem dias com registros. |
| `ombudsman` | Lista de `{sector_id,ticket_type,status,tickets}` para superusuário. Período aplicado a `occurred_at`. Gestores recebem lista vazia. |
| Metadados | `responseRate:null`, `teamAttributionAvailable:false`, `timeZone:"America/Sao_Paulo"` e `privacyNotice` textual. |

A consulta de perguntas globais aceita ainda `questionId` opcional. Retorna em `data` uma lista de `{questionId,questionVersionId,text,isNps,publishedSectorIds,responses,mean,distribution,sectors}`. Cada item de `distribution` tem `{score,responses,percentage}`. Cada item de `sectors` tem `{sectorId,responses,mean,distribution}` e indica avaliações históricas no recorte. `publishedSectorIds` descreve a publicação **hoje**, independentemente das datas e do turno. Para uma versão vigente sem avaliações, espere `responses:0, mean:null, distribution:[], sectors:[]`. Para uma versão histórica sem publicação vigente, espere `publishedSectorIds:[]`. Uma pergunta fora do escopo retorna lista vazia.

Erros de consulta incluem 400 `VALIDATION_ERROR`, 401 `UNAUTHENTICATED` e 403 `FORBIDDEN` ou `PASSWORD_CHANGE_REQUIRED`. O limite administrativo pode retornar 429 `ADMIN_RATE_LIMITED`.

### TV Wall

| Método e caminho | Permissão e entrada | Resposta |
|---|---|---|
| GET `/api/tv-wall/config` | Cookie de superusuário | 200 com a configuração em `data`. |
| PUT `/api/tv-wall/config` | Cookie de superusuário e cabeçalho `x-csrf-token`. Envie a configuração completa em JSON | 200 com a configuração persistida em `data`. A última escrita confirmada define a configuração. |
| GET `/api/public/tv-wall` | Somente leitura, sem parâmetros. A televisão pode usar `credentials:"omit"` | 200 com `{periodDays,refreshSeconds,indicators:[{id,value}]}` em `data`, na ordem configurada. |

A configuração inicial é `{"indicators":[],"sectorIds":[],"periodDays":7,"refreshSeconds":60}`. Os indicadores aceitos são `completionRate`, `nps`, `npsGroups`. `sectorIds` contém até 200 setores ativos no momento da configuração. Para publicar um indicador é obrigatório escolher ao menos um setor. Ambas as listas exigem itens únicos. `periodDays` aceita inteiros de 1 a 90 e `refreshSeconds` de 30 a 3600. Uma lista vazia de indicadores desliga a exibição.

Para `completionRate` e `nps`, `value` é um número inteiro ou `null`. Para `npsGroups`, é `{promoters,passives,detractors}` em porcentagens inteiras ou `null`. Mostre o estado indisponível quando o valor for nulo. Use `refreshSeconds` para o próximo GET. O frontend administrativo pode obter o token CSRF com `GET /api/auth/csrf`. O navegador público só precisa da rota de exibição.

As rotas administrativas retornam os erros de autenticação e autorização descritos acima. O PUT também retorna 403 `CSRF_INVALID`, 400 `TV_WALL_SECTOR_INVALID` para setor inexistente ou inativo e 400 `VALIDATION_ERROR` para campos inválidos. Query na rota pública retorna 400 `VALIDATION_ERROR`.
