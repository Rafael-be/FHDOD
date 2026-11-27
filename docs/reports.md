# Relatórios manuais

Os relatórios são gerados sob demanda e não são armazenados. Todos os endpoints exigem cookie `access_token` e senha definitiva. POST exige `x-csrf-token` da sessão. Respostas e arquivos usam `Cache-Control: no-store`.

| Endpoint | Retorno |
| --- | --- |
| `GET /api/reports/types` | `data` com tipos disponíveis ao perfil, descrição, formatos e filtros |
| `POST /api/reports/preview` | `{data: ReportModel}` em JSON |
| `POST /api/reports/download` | PDF ou XLSX binário, com `Content-Disposition: attachment` |

Corpo da prévia com seletores de data: `{"type":"general","from":"2026-11-01","to":"2026-11-26"}`. Para download, acrescente `"format":"pdf"` ou `"xlsx"`. Exemplo com setor: `{"type":"sector","sectorId":3,"from":"2026-11-01","to":"2026-11-15"}`. Tipos: `general`, `sector`, `questions`, `ombudsman`. `sectorId` é obrigatório em `sector`, opcional em `questions` e `ombudsman`, e inválido em `general`.

A prévia contém `type`, `title`, `filters` (inclusive `timeZone: America/Sao_Paulo`), `generatedAt`, `indicators`, `tables`, `recordCount`, `warnings` e `minimumResponses`. Números sem denominador são `null`; contagens vazias são zero. A prévia mantém as chaves técnicas da API. PDF e XLSX aplicam rótulos em português e formatos de apresentação, sem alterar os números. Taxas são exibidas em porcentagem; satisfação média usa a escala real de 1 a 5 e NPS médio a escala real de 0 a 10. Valores numéricos continuam numéricos nas células; texto iniciado por caracteres de fórmula é neutralizado.

## Apresentação das exportações

O PDF usa a fonte Unicode DejaVu Sans, identificação FHDOD, título, abrangência, período local, data de geração, indicadores, gráficos vetoriais, dados detalhados paginados e rodapé com número da página. O XLSX inclui `Resumo`, `Indicadores`, `Gráficos` quando há dados, e uma aba por conjunto de dados. Os gráficos do Excel são **imagens PNG**, pois o ExcelJS 4.4.0 instalado não oferece criação nativa de gráficos; os dados correspondentes ficam em células editáveis na mesma aba. A planilha conserva o limite existente de 8 MB.

Por tipo, os gráficos possíveis são: geral — andamento e evolução das pesquisas, distribuição de notas, nota média NPS, comparação entre setores e turnos; setor — andamento, evolução, distribuição, NPS e satisfação por pergunta; perguntas — andamento, evolução, distribuição, NPS e satisfação por pergunta; Ouvidoria — manifestações por tipo, situação e evolução. Cada gráfico aparece somente quando seus dados contêm valores. Na evolução das pesquisas, a linha tracejada representa pesquisas iniciadas e a contínua, concluídas.

Não há logotipo oficial no backend. Para usar o arquivo autorizado, configure `REPORT_LOGO_PATH` com o caminho absoluto de um PNG ou JPEG oficial acessível ao processo Node; ele será incluído no PDF e no XLSX. Até lá, o cabeçalho usa identificação textual FHDOD. `REPORT_ORGANIZATION_NAME` permite usar o nome institucional já aprovado; na ausência dele, aparece FHDOD. Não configure nome ou marca sem autorização institucional. Os arquivos não armazenam dados privados da Ouvidoria.

Para datas de calendário normalizadas, o fim exclusivo à meia-noite local é exibido como o último dia incluído. Para timestamps que não delimitam dias completos, as exportações exibem data e hora de ambas as pontas com a indicação de fim exclusivo. O fuso é `America/Sao_Paulo`.

`from` e `to` aceitam **datas de calendário `AAAA-MM-DD`** ou **timestamps ISO 8601 com offset**. Com datas de calendário, ambos os dias são incluídos integralmente em `America/Sao_Paulo`: `from=2026-11-01`, `to=2026-11-26` corresponde ao intervalo interno `[2026-11-01T03:00:00Z, 2026-11-27T03:00:00Z)`. A prévia retorna esse intervalo normalizado em `filters`; PDF e XLSX recebem exatamente o mesmo modelo. Timestamps continuam seguindo o contrato anterior: `[from,to)`, com `to` exclusivo. Envie **ambos** os campos ou omita **ambos**. Na omissão, o padrão são os últimos **30 dias de calendário, incluindo hoje**, no fuso de São Paulo. A data final não pode preceder a inicial; o limite é de 366 dias de calendário para datas simples ou 366 × 24 horas para timestamps. Datas inválidas, apenas uma data, período invertido ou excessivo retornam 400 `VALIDATION_ERROR`.

`sectorId` deve ser inteiro positivo. O gestor vê apenas setores vinculados e não acessa Ouvidoria. Somente superusuário recebe o relatório de Ouvidoria e seu resumo no geral. Nenhum relatório contém nomes de pacientes, telefones ou texto de manifestação. Um setor fora do escopo gera 403; tipo/formato inválido gera 400. Um setor inexistente gera 404. Um período válido sem registros retorna indicadores zerados, médias nulas e avisos; não gera erro.

## Cálculos e histórico

Pesquisas iniciadas e concluídas pertencem ao período pela **data de início da sessão** (`submission_sessions.started_at`), inclusive quando a conclusão ocorreu depois do período; taxa de conclusão é `100 × concluídas / iniciadas`. Respostas de satisfação e NPS pertencem ao período pela data de início da sessão associada, não pela data da resposta. Satisfação média usa respostas comuns válidas 1–5; NPS médio usa respostas NPS válidas 0–10. Avaliações positivas são notas 4 ou 5 divididas pelas respostas comuns válidas. A evolução usa dias de São Paulo. Perguntas são as do formulário vigente e respostas históricas entram somente com `sectorId`, `questionId` e `questionVersionId` iguais; as cinco faixas incluem zeros. O ranking respeita `ANALYTICS_MIN_RESPONSES` (padrão técnico 5). Turnos são consolidados pelo nome da faixa, sem dividir por setor; sessões sem faixa aparecem como não classificadas. Ouvidoria pertence ao período por **`ombudsman_tickets.occurred_at`**, usa status `resolved` como resolvido e os demais como pendentes.

O máximo de 5.000 perguntas por relatório é aplicado antes da exportação; XLSX acima de 8 MB falha. Um período menor ou setor específico reduz o volume. Não há fila, agendamento ou URL permanente.

## Integração futura com o frontend

1. Consulte `GET /api/reports/types` após autenticar e monte os filtros a partir da resposta.
2. Ofereça dois seletores `AAAA-MM-DD` e envie ambos no POST para `/api/reports/preview` com cookie, JSON e `x-csrf-token`; apresente `indicators`, `tables`, `warnings` e estados vazios. O backend inclui os dois dias completos.
3. Envie o mesmo corpo com `format` para `/api/reports/download` e leia o retorno como `Blob`.
4. Use `Content-Disposition` para nomear o arquivo, crie uma URL temporária no navegador, acione o download e revogue a URL.
5. Em 401, renove a sessão; em 403, trate permissão ou CSRF; em 400, corrija filtros; em 413, reduza o escopo.
