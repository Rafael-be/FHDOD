# Inicialização segura do banco

1. Obtenha a versão aprovada do bootstrap SQL por meio do canal seguro do projeto. O arquivo `FHDOD.sql` não é versionado neste repositório; não o recrie nem aplique SQL de origem desconhecida.
2. Revise o bootstrap e aplique-o **uma única vez** em um banco PostgreSQL vazio, usando conexão administrativa. Nunca use `DATABASE_URL` para DDL.
3. Configure a senha da role `fhdod_api` interativamente e use essa role em `DATABASE_URL`; mantenha a conta administrativa somente em `DATABASE_URL_MIGRATIONS`.
4. Execute `npx drizzle-kit pull --init` apenas para inspecionar o banco recém-inicializado. Revise e versione o baseline gerado em uma alteração separada; não aplique migrations geradas sem revisão.
5. Forneça as três variáveis `INITIAL_SUPERUSER_*` apenas no ambiente seguro e rode `npm run seed`. O seed é idempotente: não troca a senha nem reativa a conta já existente. Uma conta criada pelo seed recebe senha temporária, com troca obrigatória e validade de 48 horas. Ele cria a página LGPD com conteúdo vazio, que não é publicação jurídica.

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
pelas operações administrativas offline; não a forneça ao processo da API em
produção.

## Limite de falhas de login

São contabilizadas somente falhas de credenciais válidas no formato esperado (`401 INVALID_CREDENTIALS`). A quinta falha efetiva de um mesmo IP em uma janela deslizante de 15 minutos ainda retorna `401`; a sexta requisição é bloqueada antes da verificação de credenciais com `429 LOGIN_FAILED_RATE_LIMITED`. A janela é renovada a cada nova falha e expira 15 minutos após a última delas. Um login bem-sucedido limpa apenas o atraso progressivo associado ao identificador, nunca a contagem por IP.

O contador atual usa memória do processo. Portanto, é reiniciado quando a API reinicia e não é compartilhado entre instâncias. Em produção com múltiplas réplicas, adote um armazenamento compartilhado para esse estado antes de tratar o bloqueio como proteção global.

As chaves expiradas também são removidas periodicamente durante requisições de
login, inclusive quando não voltam a ser consultadas. Isso limita o acúmulo no
modo local, mas não torna o contador compartilhado entre processos.
