# Integração futura do frontend com publicação manual

O backend local foi validado por HTTP. Esta etapa não alterou o frontend.

## Formulários

- Usar `GET /api/sectors/:sectorId/form-draft` para carregar o editor e `GET /api/sectors/:sectorId/form-draft/readiness` para exibir requisitos pendentes.
- Salvar com `PUT /api/sectors/:sectorId/form-draft` e `expectedRevision`; tratar `409 DRAFT_CONFLICT` recarregando o rascunho. Descartar com `DELETE` na mesma rota.
- Publicar somente por `POST /api/sectors/:sectorId/form-draft/publish`, com `expectedRevision`. Tratar `FORM_NOT_READY` e apresentar os requisitos devolvidos pelo backend.
- Consultar histórico em `GET /api/sectors/:sectorId/form-versions`, detalhar por `/:versionId` e restaurar para rascunho por `POST /:versionId/restore`. Restaurar não publica automaticamente.
- As rotas antigas de escrita de perguntas retornam `409 FORM_DRAFT_REQUIRED`. O frontend deve editar a composição no rascunho, mantendo a leitura de catálogo e de perguntas por setor.

## Sessões públicas e horários

- Carregar `GET /api/public/sectors/:sectorId/current-form` sem sessão e usar `staleTime` de cinco minutos. Na primeira resposta, gerar `attemptId` UUID e capability aleatória base64url de 32 bytes e enviar ambos, `formVersionId` e `answer` em `POST /api/public/sectors/:sectorId/submissions`. Guardar a capability somente durante a tentativa. Enviar `x-session-capability` nas respostas seguintes, refresh, restart e close. Consulte [o contrato atualizado](public-survey-session-optimization.md).
- Exibir as perguntas na ordem da versão publicada recebida. A versão vigente pode mudar entre sessões; cada sessão continua associada à versão com que foi criada.
- Importar CSV por `POST /api/shift-sheets` com corpo binário, `application/octet-stream` e CSRF; baixar modelo em `GET /api/shift-sheets/template` e vigente em `GET /api/shift-sheets/current/export`. O CSV usa BOM UTF-8, `;`, `SEM_TURNO` e `FECHADO`.

## Acesso e erros

- Rotas administrativas usam sessão real, cookie e CSRF nas mutações. Gestão de horários exige superusuário; rascunho e catálogo por setor aceitam gestor apenas no setor vinculado.
- Tratar separadamente `401` (login necessário), `403` (sem escopo ou CSRF inválido), `404` (recurso ausente) e `409` (conflito ou fluxo legado bloqueado). Não tentar nova publicação automaticamente após conflito.

## Analytics

Consumir `GET /api/analytics/dashboard` com `from`/`to` ISO com offset e filtros opcionais `sectorId`/`shiftRangeId`. Veja `docs/analytics.md`: o backend retorna sessões, NPS, médias por versão de pergunta, distribuições, séries por data e manifestações. Gráficos devem diferenciar ausência de dados (null) de nota/NPS zero. A taxa de resposta sobre atendimentos e a atribuição individual de equipe não estão disponíveis. Gestor não pode escolher setor fora do vínculo.

## Diagnóstico de chamadas repetidas

A revisão identificou StrictMode e effects de montagem, refetch após mutações e uma chamada de status para cada setor listado. O cliente já deduplica requisições em voo e refresh; conferir esse ciclo antes de propor cache. Respostas 304 são revalidação normal. Nenhuma mudança foi feita no frontend. O backend local agora é iniciado com `npm run dev` e override local; confirme que o proxy Vite aponta à porta 3000 e evite iniciar o modo `dev:configured` com `.env` do Supabase sem schema compatível.
