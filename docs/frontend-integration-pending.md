# Integração futura do frontend com publicação manual

O backend local foi validado por HTTP. Esta etapa não alterou o frontend.

## Formulários

- Usar `GET /api/sectors/:sectorId/form-draft` para carregar o editor e `GET /api/sectors/:sectorId/form-draft/readiness` para exibir requisitos pendentes.
- Salvar com `PUT /api/sectors/:sectorId/form-draft` e `expectedRevision`; tratar `409 DRAFT_CONFLICT` recarregando o rascunho. Descartar com `DELETE` na mesma rota.
- Publicar somente por `POST /api/sectors/:sectorId/form-draft/publish`, com `expectedRevision`. Tratar `FORM_NOT_READY` e apresentar os requisitos devolvidos pelo backend.
- Consultar histórico em `GET /api/sectors/:sectorId/form-versions`, detalhar por `/:versionId` e restaurar para rascunho por `POST /:versionId/restore`. Restaurar não publica automaticamente.
- As rotas antigas de escrita de perguntas retornam `409 FORM_DRAFT_REQUIRED`. O frontend deve editar a composição no rascunho, mantendo a leitura de catálogo e de perguntas por setor.

## Sessões públicas e horários

- Criar sessão em `POST /api/public/sectors/:sectorId/submissions`; guardar a capability retornada apenas pelo tempo necessário à sessão. Enviar `x-session-capability` nas rotas de resposta, refresh, restart e close.
- Exibir as perguntas na ordem da versão publicada recebida. A versão vigente pode mudar entre sessões; cada sessão continua associada à versão com que foi criada.
- Importar CSV por `POST /api/shift-sheets` com corpo binário, `application/octet-stream` e CSRF; baixar modelo em `GET /api/shift-sheets/template` e vigente em `GET /api/shift-sheets/current/export`. O CSV usa BOM UTF-8, `;`, `SEM_TURNO` e `FECHADO`.

## Acesso e erros

- Rotas administrativas usam sessão real, cookie e CSRF nas mutações. Gestão de horários exige superusuário; rascunho e catálogo por setor aceitam gestor apenas no setor vinculado.
- Tratar separadamente `401` (login necessário), `403` (sem escopo ou CSRF inválido), `404` (recurso ausente) e `409` (conflito ou fluxo legado bloqueado). Não tentar nova publicação automaticamente após conflito.
