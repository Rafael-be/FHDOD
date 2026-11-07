# Inicialização segura do banco

## Sequência de inicialização

1. Revise o bootstrap SQL aprovado em `src/db/bootstrap/FHDOD.sql`. Não o recrie nem aplique SQL de outra origem.
2. Revise o bootstrap e aplique-o **uma única vez** em um banco PostgreSQL vazio, usando conexão administrativa. Nunca use `DATABASE_URL` para DDL.
3. Execute `npm run migrate` com `DATABASE_URL_MIGRATIONS`. O comando usa o migrador do Drizzle e só termina com sucesso após conferir os hashes e timestamps do ledger `drizzle.__drizzle_migrations`. O bootstrap deve sempre ocorrer antes das migrations.
4. Forneça as três variáveis `INITIAL_SUPERUSER_*` apenas no ambiente seguro e rode `npm run seed`. O seed ocorre depois do bootstrap e das migrations. Ele é idempotente: não troca a senha nem reativa a conta já existente. Uma conta criada pelo seed recebe senha temporária, com troca obrigatória e validade de 48 horas. Ele cria a página LGPD com conteúdo vazio, que não é publicação jurídica.
5. Configure a senha da role `fhdod_api` interativamente e use essa role em `DATABASE_URL`.

Nunca reaplique o bootstrap em um banco existente. Ele não é uma migration, não deve ser usado para reconstruir estruturas já criadas e não substitui o histórico de migrations.

## Drizzle e baseline

O baseline completo está em `src/db/schema/baseline.ts`; o journal e os snapshots
correspondentes ficam em `src/db/migrations/meta/`. Gere migrations somente a
partir desse schema completo, revise o SQL produzido e nunca use
`drizzle-kit push`. Os schemas `core.ts` e `questions.ts` continuam focados na
aplicação e não participam da geração para evitar definições duplicadas.

A versão instalada de `drizzle-kit` não suporta `drizzle-kit pull --init`. Use a
introspecção somente para inspeção de um banco isolado, apontando a saída para um
diretório temporário fora do repositório. Nunca permita que a introspecção sobrescreva
o schema, migrations ou snapshots existentes sem revisão explícita.

Para testes de integração, defina explicitamente `POSTGRES_INTEGRATION_TESTS=true`.
`LOCAL_DATABASE_URL` e `DATABASE_URL` devem apontar
para o mesmo endpoint loopback e para o banco exatamente chamado `fhdod_test`.
A URL runtime deve usar a role `fhdod_api`; aliases como `localhost` e
`127.0.0.1`, portas divergentes e qualquer outro nome de banco são rejeitados.
O provisionamento do banco descartável deve instalar previamente o marcador
`ALTER DATABASE fhdod_test SET fhdod.disposable = 'true'`. O teste RLS confere
esse marcador em leitura antes de qualquer suíte de integração iniciar e nunca o cria.

Use um banco descartável e uma role restrita para testes. Alguns testes fazem
rollback explícito de uma transação; outros removem seus dados sintéticos em um
bloco `finally`. Portanto, não execute a suíte de integração contra banco de
produção ou um banco compartilhado com dados reais.

Nenhum comando deste repositório aplica o bootstrap ou migrations automaticamente.

## Verificação de migrations

`npm run migrate` é o procedimento administrativo oficial. Ele requer somente
`DATABASE_URL_MIGRATIONS`, não usa `DATABASE_URL`, e valida ao final que o ledger
tem exatamente uma entrada, com hash e timestamp esperados, para cada item do
journal. `npm run migrate:drizzle` existe apenas para diagnóstico do CLI bruto.

Depois de uma atualização autorizada, confirme em uma conexão administrativa:

```sql
select id, hash, created_at
from drizzle.__drizzle_migrations
order by created_at;
```

Em novembro de 2026, o Supabase principal está confirmado até
`0006_enforce_question_link_integrity`; a `0007_enforce_nps_scope_integrity`
permanece pendente de aplicação remota. Não execute bootstrap, seed ou migrations
futuras nele sem procedimento operacional aprovado.

## Credenciais por operação

O servidor HTTP valida e usa somente `DATABASE_URL`, que deve apontar para a role
restrita `fhdod_api`. `DATABASE_URL_MIGRATIONS` é validada somente pelo seed e
pelas operações administrativas offline. Não a forneça ao processo HTTP, à imagem de
runtime da API, ao frontend ou a logs de produção.

## Autorização na API e RLS

RLS é habilitado nas 30 tabelas `public` do aplicativo desde o bootstrap e é
reafirmado pela migration `0004_reconcile_runtime_rls_phase3.sql`. As migrations
`0000`–`0002` cobrem os fluxos de Fase 1 e 2; `0004` completa as policies
necessárias para upload de planilhas e submissões da Fase 3. As policies da role
compartilhada `fhdod_api` são permissivas (`USING (true)` e `WITH CHECK (true)`) por
operação: elas não oferecem isolamento por linha e não substituem a autorização da API.

A autorização por usuário e setor é responsabilidade dos middlewares e services da API: a
sessão atual define a identidade e o perfil, e os services limitam operações de
gestores aos vínculos ativos com seus setores. A role PostgreSQL `fhdod_api` continua
sendo a conexão restrita compartilhada pelo runtime, sem `DELETE`, DDL ou bypass de
RLS. Isso só é seguro enquanto o banco não for exposto diretamente: a Data API
deve permanecer desabilitada, o frontend não pode receber URLs/credenciais do
banco e as credenciais administrativas/service_role devem ficar fora do runtime.

Antes do deploy, valide em ambiente autorizado e isolado os privilégios efetivos, o
owner das tabelas, os atributos da role `fhdod_api` e a exposição da Data API. Em
especial, confirme que roles expostas pela Data API não receberam grants inesperados
e que credenciais administrativas ou `service_role` nunca são distribuídas ao
frontend. RLS é uma camada de operações/tabelas; isolamento por usuário só existe
onde a API ou uma policy restritiva o implementarem explicitamente.

## Limite de falhas de login

São contabilizadas somente falhas de credenciais válidas no formato esperado (`401 INVALID_CREDENTIALS`). A quinta falha efetiva de um mesmo IP em uma janela deslizante de 15 minutos ainda retorna `401`; a sexta requisição é bloqueada antes da verificação de credenciais com `429 LOGIN_FAILED_RATE_LIMITED`. A janela é renovada a cada nova falha e expira 15 minutos após a última delas. Um login bem-sucedido limpa apenas o atraso progressivo associado ao identificador, nunca a contagem por IP.

O contador atual usa memória do processo. Portanto, é reiniciado quando a API reinicia e não é compartilhado entre instâncias. Em produção com múltiplas réplicas, adote um armazenamento compartilhado para esse estado antes de tratar o bloqueio como proteção global.

As chaves expiradas também são removidas periodicamente durante requisições de
login, inclusive quando não voltam a ser consultadas. Isso limita o acúmulo no
modo local, mas não torna o contador compartilhado entre processos.
