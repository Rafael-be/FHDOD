# Retenção de logs de auditoria

O processo de retenção é externo ao servidor HTTP. Ele remove, em lotes de até
1.000 linhas, somente registros cujo `created_at` seja estritamente anterior a
`now() - interval '48 hours'`. Registros exatamente no limite permanecem.

O runtime da API continua usando `fhdod_api` e não recebe `DELETE` em
`audit_logs`. O job exige exclusivamente a role `fhdod_audit_maintenance`, que
recebe somente `USAGE` no schema e `EXECUTE` na função fixa de limpeza.

A função é `SECURITY DEFINER`, mas seu owner é a role sem login
`fhdod_audit_retention_owner`, que recebe somente `USAGE` no schema, `DELETE` e
`SELECT` das colunas `id` e `created_at` em `audit_logs`. Essas duas colunas são
necessárias para avaliar o predicado temporal e a ordenação; a role não tem login
nem acesso ao conteúdo dos registros. O `search_path` é fixado em `pg_catalog`, a
tabela é referenciada com schema explícito e a rotina não usa SQL dinâmico.

## Provisionamento aprovado pelo administrador

O administrador deve executar, uma única vez e fora do processo HTTP:

1. `scripts/audit-retention/provision-role.sql` com `psql` administrativo. Ele
   cria a role de execução e a role sem login proprietária da função.
2. Definir a senha de `fhdod_audit_maintenance` interativamente, sem registrá-la
   no repositório.
3. `scripts/audit-retention/install-purge-function.sql` com credencial capaz de
   criar a função e transferir seu owner para `fhdod_audit_retention_owner`.
4. Armazenar a URL da role dedicada apenas no segredo do agendador, como
   `AUDIT_RETENTION_DATABASE_URL`.

Os scripts não são executados automaticamente e não devem ser aplicados em
bancos de produção sem aprovação operacional. Enquanto o baseline Drizzle não
for reconciliado, a função é um script operacional versionado, não uma migration
Drizzle registrada.

## Execução e monitoramento

Configure um agendador externo (CronJob, systemd timer ou equivalente) para
executar, por exemplo, a cada 15 minutos:

```bash
npm run audit:purge
```

A função usa `pg_try_advisory_xact_lock`, portanto uma execução simultânea é
registrada como `audit_retention.skipped`, com `lockAcquired: false`, e não disputa
nem remove linhas. Um alerta deve ser aberto se houver duas ou mais execuções
ignoradas consecutivas. Cada execução processa no máximo um lote; o agendador
repetirá o processo no próximo ciclo caso existam mais linhas expiradas.

Com execução a cada 15 minutos, a capacidade teórica máxima é de 4.000 registros
por hora. Monitore, com uma credencial administrativa de observabilidade, a
quantidade e a idade do backlog expirado:

```sql
select
  count(*) as expired_count,
  min(created_at) as oldest_expired_at
from public.audit_logs
where created_at < now() - interval '48 hours';
```

Abra alerta se o backlog crescer por dois ciclos consecutivos, se
`oldest_expired_at` permanecer além do limite após um ciclo completo, ou se a taxa
de inserção exceder sustentadamente 4.000 registros por hora.

O comando emite somente JSON agregado: evento, lock obtido, quantidade removida
e duração. Uma falha de conexão, permissão ou execução produz evento de falha e
termina com código diferente de zero, devendo acionar o monitoramento do
agendador.

O índice existente `audit_logs_created_idx` atende ao filtro temporal. Nenhum
índice adicional é necessário sem evidência de `EXPLAIN (ANALYZE, BUFFERS)` em
ambiente isolado.
