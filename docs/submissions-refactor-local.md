# Formulários publicados e submissões

> Contrato atualizado: veja [Pesquisa pública: formulário e sessão por primeira resposta](public-survey-session-optimization.md). As notas abaixo documentam a primeira etapa histórica e não descrevem o contrato HTTP vigente.

## Contrato público (histórico)

`POST /api/public/sectors/:sectorId/submissions` cria uma sessão de três minutos e retorna `capability.token`, `session.formVersionId`, `session.expiresAt` e as perguntas (`questionId`, `questionVersionId`). O token é anônimo e efêmero.

Envie uma resposta por requisição a `POST /api/public/submissions/:sessionId/answers`, com `x-session-capability` e corpo:

```json
{"questionId":26,"questionVersionId":21,"status":"answered","score":5}
```

Perguntas comuns aceitam 1–5, NPS aceita 0–10 e somente perguntas de setor podem ser puladas com `{"status":"skipped","score":null}`. Uma gravação nova ou alteração efetiva acrescenta dois minutos ao prazo existente. Retry idêntico conserva o prazo.

`POST /api/public/submissions/:sessionId/refresh` exige a mesma capability, acrescenta dois minutos e informa `expiresAt`, `refreshesUsed` e `refreshesRemaining`. Há no máximo três renovações. `POST /api/public/submissions/:sessionId/close` encerra a sessão preservando respostas parciais. O frontend pode usar `session.expiresAt` para exibir o aviso antes do vencimento, sempre confirmando o prazo retornado pelo servidor.

## Persistência e cache

As migrations `0010`–`0012` criam `submission_form_versions`, `submission_form_questions` e `submission_form_answers` e acrescentam `form_version_id`, `expires_at` e `refresh_count` às sessões. Cada início compara a configuração efetiva com a última versão publicada do setor; configuração idêntica reutiliza a versão. Perguntas publicadas são carregadas por ID em cache limitado a 128 versões, com busca única por versão durante um processo. A configuração corrente é conferida no PostgreSQL a cada nova sessão, inclusive em múltiplas instâncias, evitando dependência de invalidação distribuída. Sessões antigas usam sua versão imutável.

As tabelas anteriores `submission_session_questions` e `submission_answers` permanecem exclusivamente para histórico; o fluxo novo não grava nelas. O banco continua a ser a fonte de verdade. A API ainda usa capability em memória, portanto sessões abertas não podem prosseguir após reinício do backend. Esse comportamento precisa ser considerado antes de operar com múltiplas instâncias.

## Implantação futura no Supabase

Nenhuma migration remota foi executada nesta etapa. Antes de aplicar `0010`–`0012` no Supabase, revisar o impacto das novas FKs, RLS e permissões sobre o schema remoto, confirmar backup restaurável e planejar a transição das poucas sessões/respostas fictícias antigas. Elas podem ser removidas **somente após autorização e backup específicos**; não é necessário migrá-las para o modelo novo. Preservar usuários, setores, perguntas, versões, planilhas, turnos, Ouvidoria e demais configurações. As migrations são aditivas e não removem esses dados; a limpeza opcional de `submission_answers`, `submission_session_questions` e `submission_sessions` antigas deve ser um procedimento separado e seletivo. Não executar bootstrap nem limpeza remota como parte da aplicação automática das migrations.
