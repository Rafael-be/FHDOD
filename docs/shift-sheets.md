# Planilha de horários

`POST /api/shift-sheets` exige sessão de superusuário, `x-csrf-token` e corpo binário `application/octet-stream` de até 5 MB. O arquivo é CSV UTF-8 com BOM e separador `;`:

```csv
codigo_setor;nome_setor;nome_turno;hora_inicio;hora_fim;dia_semana_iso
emergencia;Emergência;SEM_TURNO;08:00;17:00;1
emergencia;Emergência;FECHADO;00:00;00:00;2
```

Cada setor ativo deve ter uma situação explícita para cada dia ISO de 1 a 7. `FECHADO;00:00;00:00` é a única linha permitida em um dia fechado. `SEM_TURNO` indica um expediente sem divisão formal; campo vazio é inválido. Turnos com fim anterior ao início atravessam meia-noite. Faixas que se sobrepõem, inclusive entre dias adjacentes, são rejeitadas. Faixas parciais são permitidas; não há limite de expediente cadastrado, portanto o sistema não pode inferir se um intervalo parcial deixou uma lacuna indevida. A completude garantida é a declaração dos sete dias de cada setor ativo.

A importação cria nova versão e torna-a vigente em transação única. Erros retornam `INVALID_SHIFT_SHEET` e `error.details` com linha, campo, setor e mensagem, quando aplicáveis. Nomes divergentes do cadastro geram aviso; a identidade é o código do setor.

`GET /api/shift-sheets/current/export` baixa a versão vigente no mesmo formato, pronta para nova importação se o cadastro de setores não mudou. `GET /api/shift-sheets/template` baixa um modelo com cada setor ativo marcado `FECHADO` nos sete dias, para edição. A antiga rota `GET /api/shift-sheets` continua como alias da exportação. Todas as rotas de download exigem superusuário. A aplicação React pode usar as duas rotas GET para os botões de exportação e modelo.

A migration `0008_shift_sheets_without_employees` conserva as atribuições antigas de funcionários para histórico e usa `day_of_week` nas faixas novas. O dia fechado fica em `sector_shift_days`; respostas fora de uma faixa são permitidas e registram `shift_range_id = NULL` na sessão, mantendo a versão vigente. Um setor ativo com formulário válido também pode receber respostas sem versão vigente; nesse caso, as duas referências de horário são `NULL`. A próxima etapa analítica deve classificar essas sessões sem faixa e definir como agregá-las nos dashboards; elas não entram na fila `dashboard_dirty_groups` de respostas enquanto não houver essa regra.

O fluxo público existente usa `POST /api/public/sectors/{sectorId}/submissions` para iniciar o formulário e `POST /api/public/submissions/{sessionId}/answers` para registrar respostas com a capability da sessão. Uma URL ou QR Code do frontend pode apontar para o setor e iniciar por essa rota; este backend não gera QR Code. O snapshot de perguntas mantém as versões e a ordem de exibição na sessão. Setores inativos são rejeitados.

Para a futura Ouvidoria, `ombudsman_tickets` já possui texto (`body`), tipo, setor, telefone opcional, data/hora, versão de horários, faixa, status, consentimento de política e índices de consulta. Ainda faltam rotas e serviços de criação/gestão, regras de validação e autorização, identificação/acompanhamento administrativo e decisão sobre chamados fora de horário. Hoje `shift_range_id` e `shift_sheet_version_id` são obrigatórios nessa tabela; se chamados sem faixa ou sem versão forem permitidos, uma migration futura precisará adaptar essas colunas. Nenhum dado de contato foi acrescentado às respostas anônimas.
