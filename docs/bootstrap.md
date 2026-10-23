# Inicialização segura do banco

## Sequência de inicialização

1. Obtenha a versão aprovada do bootstrap SQL por meio do canal seguro do projeto. O arquivo `FHDOD.sql` não é versionado neste repositório; não o recrie nem aplique SQL de origem desconhecida.
2. Revise o bootstrap e aplique-o **uma única vez** em um banco PostgreSQL vazio, usando conexão administrativa. Nunca use `DATABASE_URL` para DDL.
3. Execute as migrations Drizzle com `DATABASE_URL_MIGRATIONS`. O bootstrap deve sempre ocorrer antes das migrations; a migration atual pressupõe que suas tabelas já existam.
4. Forneça as três variáveis `INITIAL_SUPERUSER_*` apenas no ambiente seguro e rode `npm run seed`. O seed ocorre depois do bootstrap e das migrations. Ele é idempotente: não troca a senha nem reativa a conta já existente. Uma conta criada pelo seed recebe senha temporária, com troca obrigatória e validade de 48 horas. Ele cria a página LGPD com conteúdo vazio, que não é publicação jurídica.
5. Configure a senha da role `fhdod_api` interativamente e use essa role em `DATABASE_URL`.

Nunca reaplique o bootstrap em um banco existente. Ele não é uma migration, não deve ser usado para reconstruir estruturas já criadas e não substitui o histórico de migrations.

## Drizzle e baseline

O schema Drizzle e o snapshot atual ainda não representam o banco completo. Por isso,
**não execute `drizzle-kit generate`** até que o baseline seja reconciliado e revisado
em banco isolado. Uma migration gerada agora pode ser incompleta ou incompatível com
um banco inicializado pelo bootstrap aprovado.

A versão instalada de `drizzle-kit` não suporta `drizzle-kit pull --init`. Use a
introspecção somente para inspeção de um banco isolado, apontando a saída para um
diretório temporário fora do repositório. Nunca permita que a introspecção sobrescreva
o schema, migrations ou snapshots existentes sem revisão explícita.

Para testes de integração, `DATABASE_URL_TEST` deve apontar para um banco físico
isolado de `DATABASE_URL`: host, porta ou nome do banco devem ser diferentes.
Alterar somente credenciais, parâmetros ou aliases de URL não é suficiente. Os
testes de integração são ignorados quando essa proteção não é satisfeita.

Use um banco descartável e uma role restrita para testes. Alguns testes fazem
rollback explícito de uma transação; outros removem seus dados sintéticos em um
bloco `finally`. Portanto, não execute a suíte de integração contra banco de
produção ou um banco compartilhado com dados reais.

Nenhum comando deste repositório aplica o bootstrap ou migrations automaticamente.

## Credenciais por operação

O servidor HTTP valida e usa somente `DATABASE_URL`, que deve apontar para a role
restrita `fhdod_api`. `DATABASE_URL_MIGRATIONS` é validada somente pelo seed e
pelas operações administrativas offline. Não a forneça ao processo HTTP, à imagem de
runtime da API, ao frontend ou a logs de produção.

## Autorização e RLS na Fase 1

O RLS permanece desabilitado na Fase 1. A migration
`0000_enforce_runtime_rls_policies.sql` cria 26 policies permissivas (`USING (true)`
e `WITH CHECK (true)`) em 12 tabelas, mas não habilita RLS. Essas policies não
oferecem isolamento por linha e não devem ser consideradas uma barreira de segurança.

A autorização de usuários é responsabilidade dos middlewares e services da API: a
sessão atual define a identidade e o perfil, e os services limitam operações de
gestores aos vínculos ativos com seus setores. A role PostgreSQL `fhdod_api` continua
sendo a conexão restrita compartilhada pelo runtime, sem `DELETE`, DDL ou bypass de
RLS.

Antes do deploy, valide em ambiente autorizado e isolado os privilégios efetivos, o
owner das tabelas, os atributos da role `fhdod_api` e a exposição da Data API. Em
especial, confirme que roles expostas pela Data API não receberam grants inesperados
e que credenciais administrativas ou `service_role` nunca são distribuídas ao
frontend.

## Limite de falhas de login

São contabilizadas somente falhas de credenciais válidas no formato esperado (`401 INVALID_CREDENTIALS`). A quinta falha efetiva de um mesmo IP em uma janela deslizante de 15 minutos ainda retorna `401`; a sexta requisição é bloqueada antes da verificação de credenciais com `429 LOGIN_FAILED_RATE_LIMITED`. A janela é renovada a cada nova falha e expira 15 minutos após a última delas. Um login bem-sucedido limpa apenas o atraso progressivo associado ao identificador, nunca a contagem por IP.

O contador atual usa memória do processo. Portanto, é reiniciado quando a API reinicia e não é compartilhado entre instâncias. Em produção com múltiplas réplicas, adote um armazenamento compartilhado para esse estado antes de tratar o bloqueio como proteção global.

As chaves expiradas também são removidas periodicamente durante requisições de
login, inclusive quando não voltam a ser consultadas. Isso limita o acúmulo no
modo local, mas não torna o contador compartilhado entre processos.
