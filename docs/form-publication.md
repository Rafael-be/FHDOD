# Publicação manual de formulários

As migrations `0014` a `0016` devem ser aplicadas juntas antes de executar este backend em um banco existente. A `0015` cria `sector_current_forms` e copia para o ponteiro a última versão por `version_number` **somente** quando seu snapshot possui exatamente um NPS e ao menos uma pergunta padrão. A `0016` impede que o ponteiro passe a referenciar um snapshot incompleto. Versões incompletas permanecem históricas, sem ponteiro vigente; elas exigem revisão e publicação manual. Confirme os setores sem ponteiro antes da implantação remota. As sessões existentes preservam seus `form_version_id`.

## Contratos para o React

Todas as rotas abaixo exigem cookie de sessão de superusuário ou gestor vinculado ao setor. `PUT`, `DELETE` e `POST` exigem `x-csrf-token`. O gestor usa `expectedRevision` para evitar sobrescrever edições concorrentes.

| Método | Rota | Resultado |
|---|---|---|
| GET | `/api/sectors/:sectorId/form-draft` | Estado operacional (`active`/`preparing`), `draftStatus`, versão vigente, revisão, itens e `canEditContent`. |
| PUT | `/api/sectors/:sectorId/form-draft` | Salva a lista completa de itens sem publicar. |
| DELETE | `/api/sectors/:sectorId/form-draft` | Remove fisicamente o rascunho e seus itens. |
| GET | `/api/sectors/:sectorId/form-draft/readiness` | Prontidão da configuração candidata e requisitos pendentes. |
| POST | `/api/sectors/:sectorId/form-draft/publish` | Publica atomicamente a revisão indicada. |
| GET | `/api/sectors/:sectorId/form-versions` | Histórico em ordem decrescente de `versionNumber`, com indicação da vigente. |
| GET | `/api/sectors/:sectorId/form-versions/:versionId` | Snapshot imutável de uma versão do setor. |
| POST | `/api/sectors/:sectorId/form-versions/:versionId/restore` | Copia a versão histórica para o rascunho; não publica. |

Exemplo de publicação: `POST /api/sectors/2/form-draft/publish`, corpo `{ "expectedRevision": 3 }`. A resposta `data` informa `published`, `formVersionId` e, se houve nova versão, `versionNumber`. `published: false` significa que a composição era equivalente à vigente; o rascunho foi limpo. Para restaurar, envie `{ "expectedRevision": 0 }` à rota `restore`; revise o rascunho retornado por `GET` e publique separadamente.

Erros relevantes: `DRAFT_CONFLICT` (409), `FORM_NOT_READY` (409, `error.details.missingRequirements`), `FORM_VERSION_NOT_FOUND` (404), `DRAFT_CONTENT_FORBIDDEN` (403), `DRAFT_QUESTION_SCOPE` (403), `FORM_NOT_PUBLISHED` (409 para nova sessão). CSRF inválido retorna `CSRF_INVALID` (403). O status `drafting` é independente de `active`/`preparing`; enquanto há rascunho, novas sessões continuam usando `sector_current_forms.form_version_id`.

As rotas antigas de escrita em `/api/questions`, `/api/standard-questions`, `/api/nps-questions` e `/api/sectors/:id/questions` retornam `409 FORM_DRAFT_REQUIRED`; suas leituras continuam disponíveis. O frontend deve migrar para as rotas de rascunho. Perguntas novas no rascunho são locais e não NPS. Alterações de conteúdo de pergunta global ou NPS exigem superusuário; alterações de conteúdo compartilhado exigem autorização sobre todos os setores afetados. Toda publicação revalida isso dentro da transação.

## Implantação futura

Não execute `0014` a `0016` no Supabase sem backup e verificação específica. Aplique migrations em ordem pelo mecanismo oficial, confira o ledger, a lista de setores sem ponteiro e os vínculos das sessões, então implante o backend coordenadamente. A reversão segura consiste em voltar ao código anterior somente após analisar publicações feitas com o novo código; remover as tabelas ou reescrever versões históricas não é um rollback aceitável.
