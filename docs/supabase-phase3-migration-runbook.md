# Runbook — atualização da Fase 3 no Supabase

## Escopo e regra de autorização

Este runbook prepara uma futura aplicação da migration `0007`. Ele não autoriza conexão, SQL, backup, migration, deploy ou alteração
de configuração no Supabase. Use somente conexão administrativa aprovada; nunca
use a URL runtime `fhdod_api`, o bootstrap, seed ou SQL manual para marcar o
ledger. Não grave URLs, dumps, tokens ou credenciais no repositório.

O único SQL fora do journal é o órfão histórico documentado
`0001_shift_sheet_versions.sql`; não o aplique nem o adicione ao journal.

## Contrato local e migrador

O journal contém `0000` a `0007`, nessa ordem. `npm run migrate` é o único
mecanismo de aplicação: após o Drizzle executar o journal, [migrate.ts](../src/db/migrate.ts) lê `drizzle.__drizzle_migrations`, ordena por
`created_at` e exige igualdade exata de quantidade, hash e timestamp. Ele não
repara divergências. Uma entrada inesperada, ausente, reordenada ou com hash ou
timestamp distinto bloqueia a operação.

| Migration | Hash SHA-256 | Efeito e risco operacional |
| --- | --- | --- |
| `0000` | `b642fb03d4c9b7a6058adc35f89d55faae427dfea122ad19d9e1d058997dde73` | Policies RLS iniciais. |
| `0001` | `2fd073c471546c8dc202f4ad12b6f49082e49844b6e256030416351791221dc1` | Policies de perguntas. |
| `0002` | `9ea865b9f2e509496bec3f19c0de48c17ae3e133bd0b77aa5bcbd8e1ff8d9726` | `UPDATE` em versões de perguntas. |
| `0003` | `90954af8cff4f995c7194fd31f5a10ad42e17e74229517777afbd7bbbeaf9539` | Fecha histórico NPS global materializado. |
| `0004` | `dd79954fcea2b059ad855fa3fe18cc56100c9f62c1ad40f4922f9feac62a3aeb` | RLS nas 30 tabelas e 16 policies de runtime. |
| `0005` | `a88fbac69749a7a705428dd415ad53440692ef820471032a77462252befb2403` | Retropreenchimento de atribuições e DDL com locks. |
| `0006` | `d4f6245133125beddd6f92dc8ac863d1c0a4b4cbbd0a4648335b3aeab6c7c88a` | Valida tipo de pergunta nos vínculos comuns/NPS e bloqueia reclassificação incompatível. |
| `0007` | `134ec5a9170bd258b2ba5be14a423cd3c71a2f6d75239f951eec9223ed2688b6` | Impede materializar NPS global por setor, exige overrides ativos `selected_sectors`/`specific`, bloqueia reativação de histórico incompatível e bloqueia troca de scope com histórico. |

Os timestamps são os valores `when` de
`src/db/migrations/meta/_journal.json`; o script de pré-verificação os inclui
para comparação. O snapshot `0005_snapshot.json` e o baseline representam a
estrutura declarativa após `0005`; `0006` e `0007` acrescentam funções e triggers
PostgreSQL, que não são representadas pelo schema Drizzle.

## Fase 1 — pré-verificação produtiva, somente leitura

**Não execute sem autorização explícita de leitura e confirmação independente
do projeto produtivo.** Abra uma sessão administrativa com transação somente
leitura e execute [verify-0007-nps-scope-readiness.sql](../scripts/db/verify-0007-nps-scope-readiness.sql). Ele usa `BEGIN READ
ONLY`, `SET LOCAL statement_timeout`, `SET LOCAL lock_timeout` e apenas
catálogos ou `SELECT`; não chama funções da aplicação. O script anterior
`verify-phase3-production-readiness.sql` é histórico (pré-`0003`–`0005`) e não
substitui esta verificação.

Registre com acesso restrito: operador, data/hora, identificador não sensível do
projeto, resultado do ledger e contagens retornadas. Não registre conteúdo de
pacientes, funcionários, connection strings ou dumps.

### Critério de decisão

| Resultado | Condição |
| --- | --- |
| **APTO** | Ledger contém exatamente `0000`–`0006`; `0007` está ausente; 30 tabelas existem com RLS; grants/role são compatíveis; não há vínculos NPS incompatíveis com o scope da `0007`. |
| **BLOQUEADO** | Divergência de ledger, tabela ausente, policy homônima, RLS/grant/owner inesperado, atributo privilegiado em `fhdod_api`, dado inválido, colisão, schema parcial ou backup indisponível. Não remova ou substitua policy existente automaticamente. |
| **INDETERMINADO** | Consulta não executada, conexão/projeto não confirmados, schema não reconhecido, resultado truncado ou evidência insuficiente. |

Presença de tabela, coluna ou índice não prova que uma migration foi registrada.
Não insira ou edite linhas em `drizzle.__drizzle_migrations`.

### Migration 0003 — NPS global dinâmico

A consulta do script usa exatamente o predicado do `UPDATE`: associação ativa,
fonte `global`, pergunta `is_nps = true` e `scope = 'all_sectors'`. Ela retorna
somente contagens, IDs técnicos e datas agregadas. Zero linhas elegíveis é
válido. Associações `specific` ativas são apenas reportadas; não são fechadas.

`0003` não atualiza `submission_session_questions`: snapshots existentes são
preservados. Ainda assim, o backend antigo pode esperar NPS global materializado;
isso exige confirmação da versão implantada antes da janela.

### Migration 0004 — RLS e policies

A migration habilita RLS nas 30 tabelas do script e cria exatamente 16 policies:

- `fhdod_api_dashboard_dirty_groups_insert`
- `fhdod_api_employee_shift_assignments_insert`
- `fhdod_api_employee_shift_assignments_select`
- `fhdod_api_employees_select`
- `fhdod_api_sector_shift_ranges_insert`
- `fhdod_api_shift_sheet_versions_update`
- `fhdod_api_shift_sheet_versions_insert`
- `fhdod_api_shift_upload_attempts_insert`
- `fhdod_api_submission_answers_update`
- `fhdod_api_submission_answers_insert`
- `fhdod_api_submission_answers_select`
- `fhdod_api_submission_session_questions_insert`
- `fhdod_api_submission_session_questions_select`
- `fhdod_api_submission_sessions_update`
- `fhdod_api_submission_sessions_insert`
- `fhdod_api_submission_sessions_select`

Qualquer policy homônima retornada pelo script bloqueia `0004`, mesmo se parecer
equivalente: os `CREATE POLICY` históricos não usam `IF NOT EXISTS`. Avalie a
origem da divergência antes de autorizar uma migration corretiva futura. Confirme
também que `fhdod_api` não é superuser, não possui `BYPASSRLS`, não é owner e
não recebe `DELETE` indevido. Policies permissivas para a role runtime não são
isolamento por setor; a autorização continua no backend.

SQL confirma RLS, roles, ownership, policies e grants. A exposição da Data API,
roles de API e schemas expostos exigem conferência separada no Dashboard do
Supabase; RLS habilitado não comprova esse isolamento.

### Migration 0005 — dados, normalização e estado parcial

O script classifica separadamente funcionário inexistente, código/nome `NULL`,
vazio e composto apenas por espaços. A primeira validação histórica de `0005`
captura referência inexistente e valores vazios/apenas espaços; `NULL` também é
diagnosticado porque falharia na validação posterior após o retropreenchimento.
Isso não exige alterar a migration: uma falha aborta a migration, devendo ser
resolvida antes da janela.

As consultas de colisão reproduzem exatamente os novos índices: `shift_range_id`,
`lower(btrim(employee_code))`, `lower(btrim(employee_name))` e, separadamente,
`work_date IS NOT NULL` ou `day_of_week IS NOT NULL`. Não expõem códigos ou
nomes, somente IDs técnicos, faixa, data/dia e contagem.

Antes de `0005`, espera-se `employee_id` não nulo, ausência de
`employee_code`/`employee_name` e os dois índices antigos presentes. Colunas
novas, índices recriados, constraints novas ou valores retropreenchidos sem
ledger correspondente são estado parcial/incompatível: **bloqueie**, não tente
reconciliar por SQL avulso.

`0005` usa `ALTER TABLE`, `DROP INDEX`, `UPDATE` e criação de índices não
concorrente. Planeje janela com escritas suspensas e monitore locks; ela não é
segura para atualização gradual sem esse controle.

### Migration 0006 — integridade de vínculos de perguntas

Antes de criar as triggers, `0006` valida os registros existentes e aborta sem
alterações se encontrar vínculo comum que não aponte para pergunta padrão
não-NPS, ou vínculo NPS que não aponte para NPS. Ela não exclui nem reescreve
histórico válido. As triggers também impedem reclassificar uma pergunta que já
possui vínculos históricos incompatíveis.

### Migration 0007 — integridade de scope do NPS

Esta migration incremental ainda está **pendente de aplicação remota**. Antes da
janela, a pré-verificação deve confirmar que cada vínculo NPS **ativo** é um
override `selected_sectors` com fonte `specific`. Vínculos já encerrados são
preservados como histórico, inclusive quando foram criados antes dessa regra. A
migration aborta se encontrar combinação incompatível ativa; ela não apaga nem
converte o histórico encerrado.

Após instalada, inserções em `sector_nps_assignments` exigem NPS padrão de
escopo `selected_sectors` e fonte `specific`, mesmo quando já nascem
encerradas. Um vínculo histórico incompatível pode permanecer consultável, mas
não pode ser reativado nem ter pergunta ou fonte alteradas de forma incompatível.
Um NPS que já possui qualquer vínculo histórico não pode ter seu scope alterado.
Essas proteções são triggers PostgreSQL e também se aplicam a SQL direto. O NPS
global continua sendo resolvido dinamicamente, sem materializar vínculos para
setores.

## Fase 2 — backup e recuperação futura autorizada

Não crie nem restaure backup nesta preparação. Antes da migration, com aprovação
separada, o operador deve:

1. Criar um dump novo, cifrado e fora do repositório, por conexão administrativa
   aprovada, imediatamente antes da janela.
2. Registrar horário, operador, projeto confirmado, tamanho, checksum e local de
   armazenamento com acesso mínimo; não registrar a URL de conexão.
3. Validar a estrutura do archive (`pg_restore --list`) e, quando apropriado,
   restaurar uma cópia em instância isolada descartável para teste de recuperação.
4. Confirmar espaço, permissões, procedimento de restauração e decisão sobre
   escritas ocorridas após o ponto de recuperação.

Exemplo para a janela futura autorizada (substitua somente por variáveis
efêmeras fora do histórico de shell e fora do repositório):

```bash
pg_dump --format=custom --file "$BACKUP_FILE" "$DATABASE_URL_MIGRATIONS"
sha256sum "$BACKUP_FILE" > "$BACKUP_FILE.sha256"
pg_restore --list --file "$BACKUP_FILE" > /dev/null
```

O `pg_restore --list` valida que o archive pode ser lido; não substitui uma
restauração de teste em instância isolada. Essa restauração é uma operação
mutável futura, nunca uma ação no banco produtivo durante a pré-verificação.

Sucesso de `pg_dump` não prova restaurabilidade. Ausência de backup recente,
checksum, validação de archive ou plano para dados posteriores ao backup bloqueia
a aplicação. Nunca versione dumps hospitalares no Git.

## Fase 3 — sequência futura controlada

1. Autorizar leitura, confirmar projeto e executar a pré-verificação.
2. Resolver qualquer bloqueio com proposta aprovada; não corrigir ledger, RLS ou
   dados diretamente durante a pré-verificação.
3. Obter backup recente e verificável; aprovar janela, operador e suspensão de
   escritas.
4. Com conexão administrativa efêmera, executar somente `npm run migrate`.
5. Parar em qualquer falha. Não reaplicar bootstrap, não marcar ledger à mão e
   não prometer rollback automático.
6. Confirmar ledger final, RLS/policies/grants, schema/retropreenchimento e
   cenários Fase 3 antes do deploy separado.

| Backend | Schema até `0006` | Schema após `0007` |
| --- | --- | --- |
| Backend implantado | Confirmado no ambiente de desenvolvimento. | **PENDENTE**; o NPS global continua dinâmico e não pode ter vínculo setorial novo. |
| Backend Fase 3 | Compatível com o estado atual. | Requer aplicação controlada e verificação pós-migration antes do deploy separado. |

Não faça deploy que dependa da proteção de scope antes de confirmar a `0007`. A
compatibilidade do backend antigo não pode ser atribuída sem identificar a versão
realmente ativa.

## Retenção de auditoria: operação separada

A retenção não é migration Drizzle e não faz parte de `npm run migrate`. Depois
das migrations e somente mediante aprovação administrativa própria, os scripts
versionados de retenção podem provisionar `fhdod_audit_maintenance`, o owner sem
login, a função `SECURITY DEFINER` e policies RLS restritas a registros vencidos.
Não conceda `BYPASSRLS`, `DELETE` ao runtime ou policy ampla. Essa operação não
remove nenhum critério de prontidão da `0007`.

## Recuperação

Não existe rollback automático. Antes do commit de uma migration, confirme o
estado do ledger e pare. Depois de uma migration confirmada, a decisão entre
migration corretiva, suspensão do deploy ou restauração deve considerar os dados
criados depois do backup e ser tomada por responsável autorizado.
