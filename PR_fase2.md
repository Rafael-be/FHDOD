# FHDOD — Fase 2: preparação do PR

## A. Resumo executivo

A Fase 2 possui a base de perguntas, versionamento, escopos, NPS e controles
de acesso implementada. Nesta revisão, o NPS global passou a ser herdado
dinamicamente, sem associações materializadas para cada setor.

## B. Escopo entregue

Além das perguntas efetivas por setor, a branch agora disponibiliza catálogo
administrativo paginado de perguntas padrão e NPS, detalhe individual e
associações vigentes. A branch é `feature/formularios-perguntas`; nenhum
commit, push ou merge foi realizado nesta preparação.

## C. Arquitetura

- Routes fazem somente parsing/autorização de borda, services concentram regras
  e repositories concentram SQL. O catálogo usa agregação lateral em uma única
  consulta, sem N+1.

## D. Banco e migrations

- Migration incremental `0003_make_global_nps_dynamic` encerra apenas vínculos
  globais ativos e conserva-os como histórico.
- Consultas efetivas priorizam override específico e, caso inexista, retornam
  o global com `npsSource: global` ou `specific`.
- Setores novos não recebem associação NPS artificial.
- Substituição global exige `replaceGlobal: true`; a operação é serializada por
  advisory lock. Overrides específicos são preservados.
- `DELETE /api/sectors/:sectorId/nps` encerra somente o override e permite que
  a herança global volte a vigorar.

Banco novo: aplicar `src/db/bootstrap/FHDOD.sql` uma única vez e então
`npm run migrate`. Banco existente: nunca reaplicar o bootstrap; executar o
preflight e aplicar migrations incrementais. A migration 0003 foi aplicada e
testada em PostgreSQL 16 local isolado. A introspecção comprovou que o banco
tem 30 tabelas, enquanto `src/db/schema/*.ts` descreve apenas parte delas e
`meta/0000_snapshot.json` ainda está vazio. Portanto, substituir esse snapshot
por introspecção seria inseguro: futuras gerações poderiam tratar tabelas não
modeladas como diferenças. O bootstrap SQL segue sendo a fonte canônica e a
estratégia bootstrap único + migrations é reproduzível, mas o baseline Drizzle
para geração futura ainda requer modelar integralmente o schema ou reduzir o
filtro do Drizzle a um subconjunto formalmente separado.

## E. NPS dinâmico

Existe no máximo um global ativo (índice parcial). Um override ativo por setor
é protegido por índice parcial. A resolução é: override ativo, senão global
ativo, senão setor em preparação. Desativar/remover override volta ao global;
substituir global não toca nos overrides; edição textual continua criando nova
versão imutável.

## F. Catálogo administrativo

- `GET /api/questions` — apenas superusuário; filtros `type`, `state`, `scope`,
  `sectorId`, `page` e `pageSize` (máximo 100).
- `GET /api/questions/:id` — detalhe administrativo de pergunta padrão ou NPS.
- Retorno paginado `{ data: { items, page, pageSize, total } }`, com versão
  vigente, estado cadastral e associações vigentes. Perguntas sem associação
  retornam `associations: []`.

## G. Segurança

As operações de NPS exigem superusuário e CSRF. Login/refresh retornam usuário
e CSRF, mantendo tokens somente em cookies HttpOnly e respostas sensíveis sem
cache. Não houve acesso a banco remoto nesta revisão.

## H. Contratos HTTP

- `POST /api/nps-questions`: aceita `replaceGlobal` para substituição explícita.
- `POST /api/sectors/:sectorId/nps`: cria/substitui override específico.
- `DELETE /api/sectors/:sectorId/nps`: remove override; retorna 204.
- Consultas efetivas e `GET /api/sectors/:id?include=questions` expõem a origem
  do NPS por `npsSource`.

## I. Desempenho

A resolução evita N+1 e usa os índices existentes de NPS global e override
atual. O global não gera mais uma linha por setor.

## J. Testes

Após a migration local: testes específicos de NPS, 2 suítes e 9 testes
aprovados. Regressão completa: 26 suítes aprovadas, 1 ignorada; 126 testes
aprovados, 4 ignorados; 0 falhas. Os quatro ignorados pertencem à manutenção
de retenção de auditoria, que exige URLs de manutenção isoladas não fornecidas.

## K. Pendências e riscos

- P1: baseline Drizzle completo para `generate` permanece bloqueado pela
  cobertura parcial de `src/db/schema`. Há evidência de 30 tabelas no catálogo
  local versus schema TypeScript parcial; não foi feita alteração insegura no
  snapshot/journal.
- P2: os quatro testes de retenção de auditoria continuam ignorados porque
  exigem banco local separado e três roles de manutenção provisionadas; o
  bootstrap atual não provisiona essas roles nem instala a função de retenção.
- P3: validar contratos finais no frontend React, que não foi alterado aqui.

## L. Impactos no frontend

Enviar `replaceGlobal: true` apenas em substituição confirmada. Exibir
`npsSource` para distinguir `global` de `specific`; usar DELETE no override em
vez de desativar a pergunta NPS.

## M. Critérios de aceite

- [x] NPS global único e override único por setor.
- [x] Herança dinâmica, remoção de override e preservação de histórico.
- [x] Migration incremental aplicada em PostgreSQL local isolado.
- [x] Typecheck e testes específicos executados.
- [x] Regressão completa no PostgreSQL local isolado.
- [x] Catálogo administrativo paginado, filtrável e restrito a superusuário.
- [ ] Baseline Drizzle completo para geração futura.
- [ ] Infraestrutura local dedicada para retenção de auditoria.

## N. Parecer final

**CORREÇÕES NECESSÁRIAS ANTES DO MERGE** — há pendências P1/P2 registradas e a
regressão completa desta revisão ainda precisa ser concluída.
