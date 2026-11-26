# Rascunhos de formulários — etapa 1

Esta etapa persiste edições candidatas sem alterar perguntas efetivas, versões publicadas, sessões ou respostas. A migration `0014_submission_form_drafts.sql` cria tabelas vazias; não exige backfill e não altera dados históricos. A etapa 2, documentada em [form-publication.md](form-publication.md), adiciona publicação manual e substitui o fluxo automático.

## Contrato HTTP

Todas as rotas exigem sessão autenticada (`superuser` ou `sector_manager`). Gestores só acessam setores com vínculo ativo. `PUT` e `DELETE` exigem `x-csrf-token`.

| Método | Rota | Finalidade |
|---|---|---|
| GET | `/api/sectors/:sectorId/form-draft` | Lê o rascunho persistido ou uma proposta baseada na última publicação, sem criar registros. |
| PUT | `/api/sectors/:sectorId/form-draft` | Substitui a composição candidata completa com controle de revisão. |
| DELETE | `/api/sectors/:sectorId/form-draft` | Descarta fisicamente o rascunho e seus itens temporários. |

`GET` devolve `data.sectorId`, `publishedVersionId`, `operationalStatus` (`active` ou `preparing`), `missingRequirements`, `draftStatus` (`unpublished`, `published` ou `drafting`), `revision` e `items`. Cada item inclui `questionId`, `sourceQuestionVersionId`, `questionKind`, `isNps`, `text`, `position`, `canEditContent` e, quando aplicável, `editRestrictionReason`. O estado operacional reutiliza a avaliação existente do setor; `drafting` é derivado da existência de um rascunho persistido.

Exemplo de `PUT`:

```json
{
  "expectedRevision": 0,
  "items": [
    { "questionId": 8, "sourceQuestionVersionId": 2, "questionKind": "sector", "isNps": false, "text": "Atendimento", "position": 1 },
    { "questionId": null, "sourceQuestionVersionId": null, "questionKind": "sector", "isNps": false, "text": "Nova pergunta local", "position": 2 }
  ]
}
```

O cliente envia a lista completa em ordem; o servidor normaliza `position`. Uma nova pergunta temporária só pode ser local e não NPS. A resposta contém `revision` e `draftStatus`. Salvar sem mudança efetiva não incrementa a revisão. Se o conteúdo voltar à base publicada, o rascunho é removido. `DELETE` recebe `{ "expectedRevision": 1 }` e devolve `{ "data": { "discarded": true } }`.

Erros relevantes: `401 UNAUTHENTICATED`, `403 FORBIDDEN`, `403 CSRF_INVALID`, `403 DRAFT_QUESTION_SCOPE`, `403 DRAFT_CONTENT_FORBIDDEN`, `400 INVALID_FORM_DRAFT`, `404 SECTOR_NOT_FOUND`, `409 DRAFT_CONFLICT`. O frontend deve recarregar após `DRAFT_CONFLICT`, sem sobrescrever silenciosamente a revisão de outro gestor.

## Escopo e histórico

Um gestor pode editar conteúdo local de setor autorizado. Para pergunta compartilhada, precisa ter vínculo ativo com **todos** os setores envolvidos. Perguntas globais e NPS exigem superusuário para edição de conteúdo. Incluir ou ordenar uma pergunta não concede permissão de alterar sua definição. O servidor verifica que cada referência de pergunta e versão corresponde à configuração ativa do setor; campos `canEditContent` enviados pelo cliente são ignorados.

`sourceQuestionVersionId` é somente a versão imutável de origem. O texto editado fica em `submission_form_draft_questions.text`; a versão original nunca é atualizada. A próxima etapa de publicação deverá criar uma nova `question_versions` para conteúdo diferente antes de vinculá-lo a `submission_form_questions`. Descartar remove a linha do rascunho e seus itens por `ON DELETE CASCADE`, sem tocar tabelas históricas.

## Integração

O frontend deve tratar `PUT` como salvamento do rascunho, não como publicação. Consulte [form-publication.md](form-publication.md) para a operação explícita de publicação. O frontend ainda não consome estas rotas.
