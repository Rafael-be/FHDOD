# Integração frontend — Fase 3

## Situação verificada

O workspace contém `FHDOD-front`. A inspeção de `src/features/questions.ts`
confirmou consumo das rotas administrativas de perguntas e ordenação. Os campos
`displayOrder` enviados na criação são ignorados pelo backend, que calcula a
posição automaticamente; isso é compatível com o contrato atual e não altera a
sequência resultante.

Não há cliente, tela ou teste no frontend para os fluxos públicos da Fase 3:

- `POST /api/public/sectors/{sectorId}/submissions`;
- `POST /api/public/submissions/{sessionId}/answers`;
- `POST /api/public/submissions/{sessionId}/restart`.

## Contrato para a implementação pendente no frontend

O início da sessão não usa cookie administrativo nem CSRF e retorna uma
capability efêmera com `sessionId` UUID e `token`. As respostas e o reinício
devem enviar esse token no header `x-session-capability`. O cliente deve usar
somente os `sessionQuestionId` recebidos no snapshot e enviar `score` inteiro
de 1 a 5 para perguntas comuns, de 0 a 10 para NPS, ou `null` ao pular pergunta
setorial opcional.

O backend valida `sessionId` como UUID, rejeita capability ausente ou inválida
com `403`, e não expõe sessão de terceiros. A referência normativa detalhada
está em `src/docs/openapi.ts`.

## Limite desta verificação

Nenhum arquivo do frontend foi modificado. A integração ponta a ponta depende
da implementação desses consumidores pelo responsável do `FHDOD-front`.
