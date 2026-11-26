# Pesquisa pública: formulário e sessão por primeira resposta

## Arquitetura encontrada

Antes desta alteração, `POST /api/public/sectors/:sectorId/submissions` consultava o apontador `sector_current_forms`, copiava o snapshot imutável de `submission_form_versions` e criava imediatamente uma linha em `submission_sessions`. O frontend recebia as perguntas e uma capability, mesmo sem responder. `POST /api/public/submissions/:sessionId/answers` gravava uma pergunta por vez em `submission_form_answers`, mas aceitava sobrescrever respostas confirmadas e somava dois minutos ao prazo anterior. `refresh` também somava dois minutos, até três vezes. Uma sessão preservava `form_version_id` após republicação. Drafts em `submission_form_drafts` não eram usados na pesquisa pública.

Não havia atraso artificial, debounce ou espera por pergunta no backend. A proteção pública é o rate limit por IP (padrão 180 requisições por minuto, Redis opcional com fallback local), além de locks transacionais para a sessão e publicação. A transação de cada resposta consultava a sessão com `FOR UPDATE`, o snapshot publicado, uma resposta anterior, a contagem de obrigatórias e atualizava resposta, sessão e fila de dashboard. O cache local de snapshots é indexado por versão imutável.

## Arquitetura atual

`GET /api/public/sectors/:sectorId/current-form` consulta o setor ativo e o apontador vigente sem escrita ou sessão. Retorna `sectorId`, `formVersionId` e `questions` ordenadas por `position`. Cada pergunta inclui `questionId`, `questionVersionId`, `text`, `questionKind`, `isNps`, `position`, `required`, `options`, `minScore` e `maxScore`. Perguntas setoriais aceitam `skipped`; perguntas padrão e NPS exigem nota. A escala publicada é 1–5 ou 0–10 para NPS.

O frontend deve gerar um UUID `attemptId` e 32 bytes aleatórios codificados em base64url como `capability`, guardá-los apenas durante a tentativa e enviar a primeira resposta:

```http
POST /api/public/sectors/7/submissions
Content-Type: application/json

{"formVersionId":42,"attemptId":"00000000-0000-4000-8000-000000000001","capability":"<43 caracteres base64url>","answer":{"questionId":12,"questionVersionId":31,"status":"answered","score":5}}
```

O retorno `201` contém `data.capability.sessionId`, `data.capability.token`, `data.session` (`id`, `sectorId`, `formVersionId`, `expiresAt`, dados de turno), `data.answer` (confirmação) e `data.replayed=false`. A primeira resposta e a sessão são gravadas na mesma transação. Se a versão vigente mudou desde o GET, retorna `409 FORM_VERSION_CHANGED`; o frontend deve buscar o formulário novamente. Repetir exatamente o mesmo `attemptId`, capability e resposta retorna `200` com `replayed=true`, sem criar ou renovar sessão. Outro uso do identificador retorna `409`.

As próximas respostas usam `POST /api/public/submissions/:sessionId/answers`, cabeçalho `x-session-capability` e corpo `{questionId,questionVersionId,status,score}`. O servidor exige a próxima pergunta na ordem publicada. A mesma resposta repetida retorna confirmação sem novo registro ou extensão; uma alteração retorna `409 ANSWER_ALREADY_CONFIRMED`. Pular uma pergunta obrigatória, usar versão alheia ou responder após encerramento/expiração falha. A sessão guarda a versão original, inclusive após nova publicação. O endpoint `restart` encerra a tentativa atual e retorna o formulário vigente; a sessão seguinte começa na primeira resposta.

O POST antigo sem corpo deixa de criar sessão e retorna `400`. O frontend precisa trocar a abertura da página pelo GET e enviar a primeira resposta no POST. As respostas continuam individuais. Não há migração: `submission_sessions` já tinha versão, expiração, capability hash e estado; `submission_form_answers` já tinha chave primária `(session_id, question_id)`. As constraints históricas e a política de publicação não foram alteradas.

O contrato complementar de pulo e encerramento descreve a disputa com a última resposta, o reenvio após encerramento voluntário e os novos erros de conclusão e expiração no `close`. [Contrato do frontend](analytics-and-tv-wall.md#pesquisa-pública)

## Prazos, cache e segurança

A primeira resposta confirmada define `expiresAt = instante de criação + 3 minutos`. Cada resposta nova seguinte define `expiresAt = instante da confirmação + 2 minutos`, sem acumular prazo. Rejeições e repetições não renovam. O endpoint explícito `refresh` permanece para compatibilidade, limitado a três usos, e agora define o prazo em dois minutos após a chamada. O rate limit público permanece em 180/min por IP por padrão; não há `setTimeout` no fluxo.

O GET retorna `ETag` SHA-256 do identificador de versão e dos campos públicos do formulário, aceita `If-None-Match` e retorna `304` quando não houve mudança. Envia `Cache-Control: public, max-age=0, must-revalidate`; o frontend pode usar `staleTime: 5 * 60_000` no TanStack Query. O ponteiro vigente é lido a cada revalidação; a publicação nova produz outro ETag. A resposta cacheável não inclui token ou dados de paciente. O POST da primeira resposta envia `Cache-Control: no-store`.

`PERFORMANCE_MEASUREMENTS=true` em `NODE_ENV=development` ativa logs JSON com identificador de correlação, duração monotônica, status HTTP, quantidade de comandos SQL e eventos `CURRENT_FORM_REQUEST`, `CURRENT_FORM_RESOLVED`, `FIRST_ANSWER_RECEIVED`, `SESSION_CREATED`, `ANSWER_VALIDATED`, `ANSWER_PERSISTED`, `SESSION_RENEWED`, `SESSION_EXPIRED`, `ANSWER_REJECTED` e `SUBMISSION_COMPLETED`. Há medições de estágios de transação e cache. Não são registrados tokens, corpos, textos de resposta nem parâmetros SQL.

## Testes e desempenho

A validação completa usou somente o banco PostgreSQL local descartável `fhdod_test` com marcador de segurança; nenhuma migration remota foi aplicada. `npm run typecheck`, `npm run lint` e `npm run build` passaram. A suíte completa passou com **63 suítes e 235 testes**, mais uma suíte e quatro testes ignorados preexistentes (64 suítes, 239 testes definidos). Os testes cobrem criação com primeira resposta, rollback em falha, idempotência, prazo inicial, sequência, concorrência, versão publicada e regressões dos demais módulos.

`node scripts/benchmark-public-survey.mjs` executou um aquecimento e 20 amostras sequenciais por operação no banco local descartável, dentro de uma transação revertida. Tempos de serviço e PostgreSQL em ms, sem rede HTTP, carga concorrente ou Redis:

| Operação | Média | p50 | p95 |
|---|---:|---:|---:|
| GET lógico do formulário vigente | 0,37 | 0,27 | 0,53 |
| Criação de sessão no fluxo legado da branch atual | 2,60 | 1,86 | 3,78 |
| Criação com primeira resposta atômica | 3,31 | 2,52 | 7,22 |
| Confirmação da resposta seguinte | 1,86 | 1,64 | 3,33 |

A medição de criação legada serve como referência operacional local; não é uma medição anterior de produção. A auditoria de 23/11/2026 mediu rotas administrativas, não a pesquisa pública, portanto não existe comparação causal antes/depois da latência desta rota. A meta inicial de 1.200 ms foi atendida neste banco pequeno, mas não foi comprovada sob rede remota ou carga hospitalar. A validação sequencial também eliminou uma consulta de contagem SQL por resposta.

## Planejamento futuro, até 27/11/2026

Planejar a edição de respostas anteriores com contrato explícito de revisão, autorização pela capability, versionamento ou auditoria das alterações, recomputação de dashboard e regras de concorrência. O fluxo atual mantém respostas confirmadas imutáveis; a edição não faz parte desta entrega.
