# Migration safety

Os arquivos SQL em `src/db/migrations/` são versionados e executados em LF.
Essa regra está em `.gitattributes` e prevalece mesmo quando `core.autocrlf=true`.
O journal e os snapshots JSON também usam LF.

## Checkout Windows existente

Confira os finais de linha:

```bash
git ls-files --eol src/db/migrations
```

As migrations SQL devem aparecer como `i/lf w/lf`. Se aparecerem como `w/crlf`,
atualize somente esses arquivos:

```bash
git ls-files 'src/db/migrations/*.sql' | while IFS= read -r file; do
  git -c core.autocrlf=false -c core.eol=lf checkout-index --force -- "$file"
done
```

O migrador prepara uma cópia temporária LF e usa essa mesma cópia para o
preflight e para o Drizzle. Assim, CRLF residual em um checkout antigo não muda
o hash nem a representação executada. Não altere `core.autocrlf` globalmente
nem normalize o repositório inteiro.

## Preflight e concorrência

`npm run migrate:check` valida o journal, os hashes LF, o prefixo do ledger e as
migrations pendentes sem criar tabelas nem executar DDL. `npm run migrate` faz a
mesma validação antes do Drizzle e valida o ledger completo depois.

Ambos usam um advisory lock estável em uma conexão PostgreSQL reservada. O lock
coordena executores que usam este protocolo; não impede DDL externo.

Um ledger inexistente não é tratado automaticamente como banco novo. Para um
banco vazio que recebeu o bootstrap aprovado, habilite explicitamente
`MIGRATIONS_ALLOW_EMPTY_LEDGER=true` nessa execução. Um banco existente sem ledger
permanece bloqueado para investigação.

## Supabase

Use somente `DATABASE_URL_MIGRATIONS`, normalmente com a role PostgreSQL
`postgres` e o banco `postgres`. `DATABASE_URL` continua reservada ao runtime
com `fhdod_api`.

Após backup, diagnóstico e autorização independente:

```bash
export DATABASE_URL_MIGRATIONS='postgres://postgres:<SENHA>@<HOST_SUPABASE>:5432/postgres?sslmode=require'
npm run migrate:check
npm run migrate
```

Não execute bootstrap novamente, não edite o ledger e não registre migrations
manualmente. Em caso de falha, preserve o estado, consulte o ledger e siga o
plano de recuperação aprovado.
