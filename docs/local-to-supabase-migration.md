# Migração do FHDOD para o Supabase — fase 1, 26/11/2026

**Decisão operacional.** Preparar a atualização incremental do schema. Manter a importação de dados bloqueada até inventariar a origem confirmada pelo proprietário e aprovar as correspondências. O destino contém dados em uso. O levantamento fez consultas em transações `REPEATABLE READ READ ONLY`. Nenhum dump de dados pessoais foi produzido.

## A. Ambientes e inventário

| Item | Origem confirmada | Destino inspecionado |
|---|---|---|
| Endereço | PostgreSQL local, 127.0.0.1:5432, banco fhdod_dev | Projeto kzyfzqppblfzuxrfudbi, pooler de sessão us-east-2:5432, banco postgres |
| Conexão | Recusada. Serviço postgresql inativo | SELECT administrativo bem-sucedido |
| Versão, tabelas públicas, linhas | Indeterminadas | PostgreSQL 17.11, 37 tabelas, 597 linhas somadas no levantamento |
| Ledger | Indeterminado | 18 entradas de 0000 a 0017, timestamps e SHA-256 conferidos contra o journal |
| TV Wall | Indeterminada | Tabela e entrada 0018 ausentes |

A configuração antiga de desenvolvimento em `.env.local.backup` corresponde à origem informada. `.env` contém o destino administrativo e de runtime. Sua variável de testes aponta para outro endereço e não foi utilizada. `.env.development.local` e o comando `migrate:local` usam o banco descartável fhdod_test da porta 55440. Esse cluster PostgreSQL 18.6 só contém fhdod_test e o banco de manutenção postgres sem tabelas públicas. No contêiner fhdod-postgres, porta publicada 54332, fhdod_api e postgres também têm zero tabelas públicas. Os clusters de testes ou clones parados não são fontes de importação.

Contagens exatas de um snapshot remoto. “ND” significa que a origem não pôde ser consultada. Ausência de contagem local não representa zero.

| Tabela pública | fhdod_dev | Supabase |
|---|---:|---:|
| `audit_logs` | ND | 56 |
| `auth_refresh_tokens` | ND | 143 |
| `auth_sessions` | ND | 99 |
| `content_page_versions` | ND | 2 |
| `content_pages` | ND | 1 |
| `dashboard_dirty_groups` | ND | 16 |
| `dashboard_summary_state` | ND | 1 |
| `employee_shift_assignments` | ND | 0 |
| `employees` | ND | 0 |
| `hourly_answer_summaries` | ND | 0 |
| `hourly_ombudsman_summaries` | ND | 0 |
| `hourly_session_summaries` | ND | 0 |
| `ombudsman_notes` | ND | 0 |
| `ombudsman_tickets` | ND | 2 |
| `permissions` | ND | 11 |
| `question_sector_assignments` | ND | 10 |
| `question_versions` | ND | 17 |
| `questions` | ND | 14 |
| `role_permissions` | ND | 13 |
| `roles` | ND | 2 |
| `sector_current_forms` | ND | 2 |
| `sector_nps_assignments` | ND | 5 |
| `sector_shift_days` | ND | 28 |
| `sector_shift_ranges` | ND | 78 |
| `sectors` | ND | 4 |
| `shift_sheet_versions` | ND | 2 |
| `shift_upload_attempts` | ND | 3 |
| `submission_answers` | ND | 4 |
| `submission_form_answers` | ND | 27 |
| `submission_form_draft_questions` | ND | 0 |
| `submission_form_drafts` | ND | 0 |
| `submission_form_questions` | ND | 9 |
| `submission_form_versions` | ND | 3 |
| `submission_session_questions` | ND | 12 |
| `submission_sessions` | ND | 21 |
| `user_sector_assignments` | ND | 7 |
| `users` | ND | 5 |
| `tv_wall_configuration` | ND | Tabela ausente |

Não há tabela hospitals no catálogo público remoto. Os schemas de aplicação são public e drizzle (ledger). Auth, storage, extensions, graphql, graphql_public, realtime e vault são gerenciados pelo provedor e ficam fora da importação. Extensões instaladas no destino: plpgsql 1.0, pgcrypto 1.3, uuid-ossp 1.1, pg_stat_statements 1.11 e supabase_vault 0.3. A 0018 utiliza recursos nativos do PostgreSQL.

## B. Diferenças verificadas

Como referência de **estrutura**, o cluster descartável marcado `fhdod.disposable=true` possui os 19 hashes oficiais, incluindo 0018. As definições comuns de colunas (tipo, nulabilidade, default e identity), constraints e FKs, índices, dez enums, 25 sequences (configuração), sete triggers de tabela, funções, policies e flags RLS foram comparadas via catálogo. Essa comparação não estabelece o estado de fhdod_dev.

| Diferença entre referência e destino | Tratamento |
|---|---|
| Referência com 38 tabelas e 273 colunas. Destino com 37 e 271 | A 0018 cria tv_wall_configuration, id inteiro (PK limitada a 1) e settings JSONB com CHECK de objeto, insere configuração desabilitada, habilita RLS e concede SELECT e UPDATE(settings) ao runtime. Não usa nova sequence, FK ou índice adicional além da PK. |
| Referência com 125 índices e 81 policies. Destino com 124 e 77 | Um índice e duas policies correspondem à TV. Duas policies de retenção em audit_logs e a função purge_expired_audit_logs() são provisionamento independente no ambiente de referência. Não introduzir purga por consequência desta migração. |
| Catálogo PG18 expõe constraints NOT NULL como objetos | Das 225 entradas adicionais de constraint, 222 são NOT NULL do catálogo PG18 e três são PK/CHECK da TV. |
| Função pública rls_auto_enable() exclusiva do destino | Preservar o objeto e verificar seus vínculos com event triggers e papéis no ensaio de restauração. |

O Drizzle usa `drizzle.config.ts`, schema de catálogo `src/db/schema/baseline.ts`, SQL em `src/db/migrations` e ordem de `meta/_journal.json`. O script `npm run migrate` usa DATABASE_URL_MIGRATIONS e valida o ledger após executar. O SQL histórico `0001_shift_sheet_versions.sql` está fora do journal. Não executá-lo por ordem de nomes. O bootstrap em `src/db/bootstrap/FHDOD.sql` é exclusivo de banco vazio. A tabela JSONB do Drizzle e a 0018 concordam. O backend da branch fix/tv-wall-config-and-public-sector-name inclui a correção de escrita e o ETag com nome público do setor.

O driver Postgres.js aceita SSL pela URL. A sessão de diagnóstico exigiu TLS ao pooler. A visão pg_stat_ssl do backend reportou false na conexão do pooler ao PostgreSQL, que é outro trecho. Antes da execução, validar o certificado do endpoint com sslmode=verify-full e a CA apropriada para os clientes. Não incluir URLs, senhas, hashes de autenticação ou tokens em logs ou argumentos públicos.

## C. Riscos e limites

- **Crítico** — confundir a origem com fhdod_test. Na referência descartável foram encontrados dois setores do seed demo e 67 contas com sufixo de fixture. No destino esses dois marcadores tiveram contagem zero. Esses sinais não atestam a procedência dos demais registros. Não executar os seeds inicial ou demo.
- **Alto** — colisões de IDs e de chaves naturais. O destino tem cinco usuários, quatro setores, formulários publicados, sessões e duas manifestações. A exclusividade das linhas, duplicatas e divergências de conteúdo dependem de consultar fhdod_dev. Tratar todo o conteúdo remoto como protegido até a reconciliação.
- **Alto** — autenticação própria com roles, users, hashes Argon2, tokens e sessões do backend. Preservar contas, hashes e permissões existentes, validar domínio das identidades e aprovar individualmente contas adicionais. Não copiar cookies, refresh tokens ou sessões administrativas locais para o ambiente hospedado. Preservar a política de autenticação e os segredos do destino.
- **Médio** — tráfego simultâneo e avanço de sequences entre o diagnóstico e o corte. Usar janela de manutenção ou captura verificável do delta. Backup sem restauração validada é insuficiente.
- **Baixo** — 0018 isolada, com ledger íntegro e nome livre. Revalidar imediatamente antes da execução, inclusive ausência de objetos parciais e existência de fhdod_api.

## D. Estratégia

Combinar os cenários B e C. Na fase 2 pode-se autorizar **somente schema** independentemente da importação. Para os dados, quando a origem estiver disponível, repetir o inventário em snapshot de leitura nos dois bancos, conferir versões e migrations e calcular por tabela linhas exclusivas, iguais e conflitantes. Comparar chaves compostas e conteúdos após remapear FKs. Não concluir equivalência por contagens ou PK coincidentes. Submeter o manifesto agregado de reconciliação ao proprietário, com as categorias “preservar”, “inserir” e “revisar”.

Reconhecer setores por código estável, roles e permissões por código e usuários por identidade confirmada com e-mail normalizado. Resolver perguntas por identidade e linhagem, versões por pai e versão, formulários por setor e fingerprint, sessões por UUID e respostas por suas chaves de snapshot. Preservar histórico de publicação, vínculo NPS, escalas, autoria, política LGPD e estado de manifestações. Manter o ponteiro publicado remoto e a seleção da TV, conservando a ordem e remapeando IDs de setores no JSONB somente com decisão aprovada. Agregados derivados e filas exigem reconciliação própria para evitar dupla contagem.

## E. Comandos preparados para a fase autorizada

Executar no host administrativo protegido. Configurar serviços **libpq** em arquivo privado e senhas em arquivo de acesso 0600. Nos exemplos os nomes de serviço são apelidos a cadastrar para os destinos verificados, não configurações já existentes. O operador deve conferir host, porta, banco, TLS, papel e privilégios antes de cada comando. Manter os dumps em volume local criptografado fora do Git, com acesso e retenção restritos. pg_dump e pg_restore disponíveis são 18.6, capazes de ler PG17. Para restaurar em PG17, preferir ferramentas 17 compatíveis e ensaiar na mesma versão principal. Confirmar a versão da origem antes de escolher a ferramenta.

```sh
umask 077
backup_dir=$(mktemp -d "${HOME}/fhdod-backup.XXXXXXXX")
for service in fhdod_origem fhdod_destino; do
  PGSERVICE="$service" psql -X -v ON_ERROR_STOP=1 -c 'select current_database(),current_user,version()' || exit 1
  PGSERVICE="$service" pg_dump -Fc -n public -n drizzle -f "$backup_dir/$service.dump" || exit 1
  pg_restore -l "$backup_dir/$service.dump" > "$backup_dir/$service.toc" || exit 1
done
(cd "$backup_dir" && sha256sum *.dump > SHA256SUMS && sha256sum -c SHA256SUMS)
```

Inventariar também owners, grants, roles de aplicação sem segredos, default privileges, extensões, event triggers e dependências externas ao dump por schema. Replicar os pré-requisitos em ambiente de recuperação isolado com a mesma proteção de produção. Não levar PII a QA ou fhdod_test. Para ensaio funcional em testes usar dump apenas de schema e registros sintéticos. O ensaio completo exige ambiente de recuperação autorizado para os dados reais, roles compatíveis e banco vazio.

```sh
PGSERVICE=fhdod_recuperacao pg_restore --exit-on-error --single-transaction \
  -d 'service=fhdod_recuperacao' "$backup_dir/fhdod_destino.dump"
```

Validar checksum, contagens, hashes do ledger, ACLs, policies, FKs, conteúdo e leituras por papel nesse ambiente. Inspecionar o TOC e dependências do Supabase antes da restauração. Não executar restore integral no destino existente.

Com alteração de **schema** autorizada, conferir no ambiente do migrador que DATABASE_URL_MIGRATIONS resolve para o projeto confirmado e que o prefixo do ledger ainda coincide exatamente. Executar `npm run migrate` no checkout aprovado com 19 entradas. Confirmar a nova entrada, `jsonb_typeof(settings)='object'`, uma linha id=1, RLS e privilégios efetivos. A inicialização da configuração pertence à migration.

Para **dados**, o dump de origem permite extrair tabelas específicas no ambiente seguro, por exemplo:

```sh
pg_restore --data-only --table=sectors --file="$backup_dir/sectors.sql" "$backup_dir/fhdod_origem.dump"
```

Esse SQL referencia a tabela original. Carregá-lo somente numa cópia de trabalho protegida. Da cópia, exportar exclusivamente linhas e colunas aprovadas com COPY de uma seleção ordenada para staging restrito. Importar em transação por lote com mapas persistentes origem→destino e INSERT com colunas explícitas em ordem topológica de FKs. Capturar IDs gerados com RETURNING e usar os mapas nos filhos. Conflitos interrompem o lote para revisão. Um script de importação executável depende dos conflitos reais e do manifesto aprovado; não há importador genérico seguro para estes dados.

Preferir IDs gerados no destino. Para sequências ascendentes com IDs explícitos e escritores pausados, conferir o maior ID, last_value e is_called. Exemplo específico, a executar **somente se** a próxima emissão de sectors.id puder colidir e a sequence for ascendente convencional:

```sql
SELECT pg_get_serial_sequence('public.sectors','id'), max(id) FROM public.sectors;
SELECT last_value,is_called FROM public.sectors_id_seq;
SELECT setval(pg_get_serial_sequence('public.sectors','id'), max(id), true)
FROM public.sectors HAVING count(*) > 0;
```

Jamais recuar uma sequence existente. Registrar estado anterior e posterior, sem pressupor rollback transacional de setval.

## F. Aceite, rollback e autorização

Recalcular por tabela os totais esperados (destino anterior + inserções aprovadas + delta controlado), somas por setor, fingerprints normalizados das linhas preexistentes, mapeamentos, duplicatas de PK/unique, órfãos e constraints não validadas. Conferir sequences, apontadores vigentes, versões congeladas e capacidades das sessões. Cada linha exclusiva remota deve continuar presente e íntegra. Reexecutar o manifesto em simulação deve resultar em zero novas inserções.

Validar `/health/ready`, login existente, setores e `GET /api/public/sectors/:sectorId/current-form` com nome, perguntas e ETag/304. Validar `GET /api/analytics/dashboard` e contagens de NPS, conclusão, permissões e Ouvidoria. Na janela autorizada usar setor e tentativa sintéticos identificáveis para submissão/resposta e manifestação com aceite, registrando o impacto e a limpeza permitida por FKs e auditoria. Exercitar `GET /api/tv-wall/config`, `PUT /api/tv-wall/config` com superusuário e CSRF, e `GET /api/public/tv-wall`. Restaurar a configuração original e confirmar a resposta pública. Preferir o ambiente de recuperação para escritas de validação que criem histórico imutável.

Em falha, interromper lotes e tráfego de escrita, reverter a transação aberta e conservar manifesto, backup e logs agregados. Para lotes confirmados, identificar apenas IDs inseridos e seus dependentes antes de propor compensação aprovada. Se a falha for do aplicativo, retornar o binário anterior mantendo a tabela aditiva. Para recuperação integral, restaurar em banco separado e reconciliar as escritas posteriores antes de qualquer troca de conexão. Não substituir o banco vivo por um backup antigo nem editar o ledger para mascarar divergência.

A autorização futura deve identificar projeto, backup restaurado, janela, responsáveis, escopo (apenas 0018 ou dados também), manifesto e critério de interrupção. Enquanto fhdod_dev permanecer indisponível, a comparação origem–destino e a autorização de importação de dados ficam pendentes.
