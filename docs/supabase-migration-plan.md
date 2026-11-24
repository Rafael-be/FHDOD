# Plano de migração do Supabase (24/11/2026)

**Estado: auditoria concluída; produção bloqueada.** Não foi executada nenhuma escrita no Supabase. Não há backup restaurado nem staging isolado validado. Este documento não autoriza executar migrations.

## 1. Origem, destino e histórico

- O PR #8 foi integrado em `develop` pelo merge `ef96fcb6725a10e2459d406f08f84cf4e7fb671d`. A branch `chore/supabase-migration-integration` foi criada desse commit. O `git fetch origin --prune` não respondeu neste ambiente; o SHA, a árvore e os pais do merge foram verificados pela API do GitHub, e o objeto assinado foi importado localmente com SHA idêntico. Não houve reset ou alteração de `develop`/`main`.
- Local: PostgreSQL 18.6, banco descartável `fhdod_test`, 18 registros em `drizzle.__drizzle_migrations`. Supabase: PostgreSQL 17.11, banco `postgres`, projeto identificado pela referência `kzyfzqppblfzuxrfudbi` na configuração existente (`.env` e backup local apontam para a mesma referência), 14 registros. **O proprietário deve confirmar que esta referência é o projeto de produção pretendido antes de qualquer escrita.** Nenhuma senha ou URL de conexão é registrada aqui.
- Os 14 registros remotos correspondem, em ordem, aos 14 primeiros arquivos locais por `hash` e `created_at` (índices 0–13, até `0013_persist_submission_capabilities`). Isto foi confirmado por transação `READ ONLY` e pelo auditor [audit-migration-readiness.mjs](../scripts/db/audit-migration-readiness.mjs), com timeout de statement e lock.
- Identificadores remotos confirmados: `0000_enforce_runtime_rls_policies`, `0001_add_questions_runtime_rls`, `0002_add_question_versions_update_rls`, `0003_make_global_nps_dynamic`, `0004_reconcile_runtime_rls_phase3`, `0005_opposite_romulus`, `0006_enforce_question_link_integrity`, `0007_enforce_nps_scope_integrity`, `0008_shift_sheets_without_employees`, `0009_ombudsman_tickets`, `0010_published_submission_forms`, `0011_allow_form_republication`, `0012_restrict_form_mutation`, `0013_persist_submission_capabilities`. O ledger Drizzle armazena hash e timestamp; os nomes vêm do journal local, pareados por ordem e timestamp.
- Migrations pendentes, em ordem: `0014_submission_form_drafts`, `0015_sector_current_forms`, `0016_validate_current_form`, `0017_analytics_legacy_reads`. O migrador oficial é `npm run migrate`; ele verifica o ledger completo após aplicar. Não editar ledger nem migrations históricas.

## 2. Diferenças de schema e dados

| Objeto | Local 18 migrations | Supabase 14 migrations | Origem esperada |
| --- | ---: | ---: | --- |
| Tabelas públicas | 37 | 34 | 0014: 2; 0015: 1 |
| Colunas públicas | 271 | 254 | 17 colunas nas 3 tabelas novas |
| Tabelas com RLS | 37 | 34 | RLS das tabelas novas |
| Policies públicas | 79 | 65 | 10 novas em 0014/0015, 2 em 0017; 2 locais de retenção fora do Drizzle |
| Índices públicos | 124 | 117 | 7 das tabelas novas |
| Constraints de tabelas, excluindo `_not_null` do PG18 | 179 | 160 | 19 das tabelas novas |
| Triggers públicos de usuário | 7 | 6 | `sector_current_form_complete` (0016) |

Nas tabelas compartilhadas, não foram encontradas diferenças em nomes, tipos, nulabilidade ou defaults de colunas, definições de índices/constraints/triggers/funções, nem definições de policies. As contagens de constraints brutas diferem também porque PostgreSQL 18 expõe constraints `_not_null` que a versão 17 não expõe da mesma forma. O Supabase possui função `rls_auto_enable` e extensões gerenciadas que não existem no PostgreSQL local; não sobrescrever objetos gerenciados. O local possui `purge_expired_audit_logs` e duas policies de retenção instaladas por scripts separados, ausentes no remoto; essa operação é **fora** das quatro migrations e requer decisão própria. A role `fhdod_api` existe no remoto; os grants adicionais locais abrangem as novas tabelas. Não foi encontrada divergência de grant nas tabelas compartilhadas.

Contagens remotas observadas, sem ler conteúdo pessoal: 4 setores, 2 versões de formulário, 6 perguntas publicadas, 9 sessões e 4 respostas legadas. Os 2 formulários mais recentes de setores ativos possuem exatamente um NPS e ao menos uma pergunta padrão, logo são candidatos ao backfill da 0015. Os dados existentes devem permanecer intactos. A inspeção de catálogo e contagens não prova ausência absoluta de alterações manuais em objetos gerenciados ou fora de `public`; staging deve testar restauração e permissões da plataforma.

## 3. Análise das quatro migrations

| Migration | Operação e dependências | Risco e validação |
| --- | --- | --- |
| 0014 | Cria `submission_form_drafts` e `submission_form_draft_questions`, FKs para setores, usuários, formulários e versões de perguntas; índices/uniques/checks, RLS, 7 policies e grants para `fhdod_api`/sequences. | DDL toma locks curtos; nomes preexistentes ou grants/role ausentes abortam. As tabelas estão ausentes no remoto. Sem backfill e sem remoção de dados. |
| 0015 | Cria `sector_current_forms`, FK composta para versão do mesmo setor, RLS, 3 policies/grants; insere ponteiros para o formulário mais recente e completo de cada setor ativo. Depende das tabelas publicadas existentes. | O backfill deve produzir 2 linhas com os dados observados. Formulários incompletos ficariam sem ponteiro; contagem e fluxo público precisam ser checados após a execução. Sem `UPDATE` ou `DELETE` em tabelas existentes. |
| 0016 | Define `form_version_id NOT NULL`, função e trigger que exigem um NPS e uma pergunta padrão no formulário atual. Depende da 0015. | Pode falhar se houver ponteiro nulo criado manualmente entre etapas; executar sem concorrência de publicação e verificar ponteiros. A constraint será aplicada à tabela recém-criada. |
| 0017 | Adiciona grants `SELECT` e duas policies de leitura a tabelas legadas para analytics. Depende das tabelas existentes. | Policies duplicadas abortariam; estão ausentes no remoto. Validar acesso sob `fhdod_api` e isolamento dos demais endpoints. |

Não há `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `DELETE`, alteração de tipo nem renomeação nessas quatro migrations. A duração e os locks reais só podem ser medidos em staging equivalente; o volume atual é pequeno, mas não justifica uma estimativa de indisponibilidade sem ensaio.

## 4. Backup e recuperação: pendente obrigatório

1. Confirmar no painel do Supabase o plano contratado, mecanismos de backup, retenção e possibilidade de restauração pontual. A API de gerenciamento da conta não está disponível nesta sessão; **não foi confirmado backup automático**.
2. Antes de qualquer DDL, criar backup consistente, completo e protegido com `pg_dump` compatível (cliente local 18.6 contra servidor 17.11) ou mecanismo nativo validado. Incluir estrutura e dados de `public` e `drizzle`, além dos schemas/plataforma necessários à recuperação. Guardar fora do Git, com acesso restrito e checksum. Dump lógico não preserva necessariamente roles globais, configurações da plataforma, arquivos de Storage nem todos os recursos gerenciados do Supabase.
3. Restaurar em destino isolado com controles adequados aos dados, verificar ledger, tabelas, contagens, FKs, RLS, policies e fluxos essenciais. Dados reais em staging exigem autorização específica e proteção equivalente; preferir dados sintéticos/anonimizados.
4. Registrar local do backup, checksum, duração, versão de ferramentas, ensaio e responsável **fora do repositório**. Nenhum backup completo ou ensaio de restauração foi realizado nesta auditoria. Portanto, produção está bloqueada.

## 5. Staging e testes: pendentes obrigatórios

Criar projeto Supabase separado e isolado (somente após confirmar custo e autorização de criação), com PostgreSQL, extensões, roles, grants, RLS, policies e ledger equivalentes ao estado remoto de 14 migrations. Popular apenas dados sintéticos que cubram formulário completo/incompleto, sessões legadas, NPS, gestores de setores distintos e ouvidoria. Aplicar `0014`→`0017` via migrador oficial. Medir tempo, locks e warnings; comparar o schema antes/depois com este auditor. Repetir em ambiente limpo após qualquer correção.

Executar `npm run typecheck`, `npm run lint`, `npm run build`, `npm test` e testes PostgreSQL habilitados para banco descartável. Validar login/refresh, CSRF, permissões por setor, publicação, histórico/restauração, `POST /api/public/sectors/:sectorId/submissions`, respostas/NPS/conclusão, analytics/dashboard, ouvidoria, CSV, turnos, logs de auditoria e LGPD. Nunca apontar testes mutáveis para produção. **Nenhum staging separado foi provisionado ou migrado nesta sessão.**

## 6. Validação local e CI

Validação executada nesta branch: `node --check scripts/db/audit-migration-readiness.mjs`, `npm run typecheck`, `npm run lint` e `npm run build` passaram. `npm test` passou com 40 suítes/193 testes sem integração PostgreSQL. Com `POSTGRES_INTEGRATION_TESTS=true` e URLs explícitas para o banco local descartável, incluindo as roles de retenção, **63 suítes e 236 testes passaram, zero ignorados**. Os checks de push e PR no GitHub passaram para o commit de documentação/auditoria. Esses resultados não substituem os testes em staging equivalente ao Supabase remoto.

## 7. Procedimento de produção, somente após nova autorização

Pré-condições: referência do projeto confirmada pelo proprietário; staging limpo e aprovado; backup e restauração comprovados; versão implantada do backend compatível; janela e responsável definidos. Suspender novas publicações e controlar conexões de migração. Revalidar imediatamente antes da janela que o ledger ainda possui exatamente os mesmos 14 hashes/timestamps, que não há objetos concorrentes e que o backup está acessível. Definir `lock_timeout`/`statement_timeout` conforme ensaio e monitorar locks; não usar limites arbitrários sem medir staging.

Aplicar somente `0014`–`0017` pelo migrador oficial usando conexão administrativa, sem editar o ledger. Parar em qualquer erro ou mudança inesperada, inspecionar estado real antes de repetir. Depois, verificar 18 entradas e hashes, 3 tabelas novas, 2 ponteiros esperados (se os dados não mudarem), grants/RLS/policies, readiness do backend e testes funcionais **não destrutivos**. Confirmar contagens e integridade dos dados preexistentes. Se falhar após commit de DDL, manter o backend compatível anterior ou suspender tráfego e decidir entre migration corretiva e restauração do backup ensaiado; não improvisar rollback por `DROP`.

**Autorização:** não concedida. O próximo passo é confirmar o projeto, disponibilizar staging isolado, esclarecer o plano de backup e autorizar especificamente qualquer uso de dados reais no ensaio. A execução em produção requer nova autorização explícita depois que backup e staging forem validados.
