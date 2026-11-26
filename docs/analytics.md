# Indicadores de experiência do paciente

> Registro da versão anterior do dashboard. Para a integração atual, use as definições de sessão avaliada, turnos, escopo da Ouvidoria e filtros múltiplos do [contrato de indicadores e TV Wall](analytics-and-tv-wall.md).

`GET /api/analytics/dashboard` exige cookie autenticado de superusuário ou gestor. Parâmetros obrigatórios `from` e `to`: ISO datetime com offset, janela crescente de até 366 dias, intervalo `[from,to)`. `sectorId` e `shiftRangeId` são filtros opcionais; o turno identifica a faixa histórica exata, não uma equipe. Gestor sem filtro recebe somente os setores com vínculo ativo; filtro fora do escopo retorna 403. A resposta usa `Cache-Control: no-store`.

O envelope `{data}` contém `sessions`, `nps`, `questions`, `distribution`, `daily`, `dailyAnswers`, `sectors` e `ombudsman`. Sem respostas, contagens são zero e médias/NPS são null. Listas vazias são `[]`. Os campos das linhas agregadas usam nomes SQL (`question_id`, `question_version_id`, `is_nps`, `sector_id`, `nps_responses`). Não retornam identificadores de pacientes, capabilities, textos de manifestações nem telefones.

- Sessões iniciadas: COUNT das sessões por started_at. Completas/incompletas usam o status persistido; `closedIncomplete` é o subconjunto incompleto com ended_at. A leitura não modifica nem reconcilia sessões vencidas.
- Respostas: inclui answered de sessões completas e incompletas; skipped é contado à parte. Sobrescrita representa o último valor persistido por pergunta/sessão.
- Média: AVG de notas respondidas comuns, separada por identidade e versão da pergunta. Não mistura NPS na escala 1–5.
- NPS: 100 × (promotores − detratores) / respondentes NPS. Detratores 0–6, neutros 7–8 e promotores 9–10. A média da nota não é o NPS.
- Tempo: a data de started_at da sessão em America/Sao_Paulo determina o dia das pesquisas/respostas; occurred_at determina o período da Ouvidoria. dailyAnswers agrega a média comum e NPS por dia; daily conta sessões sem join com respostas.
- Histórico: respostas atuais usam o snapshot do formulário; respostas legadas entram somente para sessões sem form_version_id, evitando contagem dupla. A migration 0017 permite SELECT das tabelas legadas, preserva RLS e não concede escrita.
- `responseRate=null`: não há número de atendimentos para fornecer denominador válido. `teamAttributionAvailable=false`: CSV atual não cadastra equipe. Sem faixa, sessões entram no agregado geral, e ficam fora apenas se houver filtro de faixa.
- Amostras pequenas recebem aviso explícito e não devem ser usadas como avaliação individual de profissionais. Nenhum limiar de supressão foi inventado; eventual política organizacional precisa ser definida antes de distribuição ampla dos painéis.

Consultas parametrizadas agregam no PostgreSQL e usam uma única instrução para manter consistência do snapshot. Não há Redis obrigatório, job, materialized view ou fila nova. O plano antigo descrevia resumos horários; a missão atual admite agregação direta e exige evitar infraestrutura sem evidência. A transição para resumos e a cobertura dos registros sem turno precisam de decisão operacional futura, caso o volume demande.
