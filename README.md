# FHDOD API

API do sistema de avaliação hospitalar por setor. A aplicação fornece
autenticação por sessão, administração de gestores e setores, auditoria,
conteúdo público e verificações de saúde.

## Arquitetura

- Express 5 no limite HTTP.
- Serviços organizam regras de negócio; repositories executam consultas
  parametrizadas com `postgres.js`.
- Drizzle é usado para descrição de schema e fluxo de migrations. As consultas
  operacionais permanecem explícitas nos repositories.
- O servidor recebe dependências nomeadas e falha ao iniciar se algum módulo de
  runtime estiver ausente.

## Requisitos e execução local

São necessários Node.js 22 ou superior e PostgreSQL.

```bash
npm ci
cp .env.example .env
npm run dev
```

Consulte [a inicialização segura do banco](docs/bootstrap.md) antes de criar ou
configurar um banco. O servidor não executa bootstrap, migrations ou seed
automaticamente.

## Configuração

`DATABASE_URL` é a única conexão usada pelo servidor HTTP e deve utilizar a
role restrita `fhdod_api`. `DATABASE_URL_MIGRATIONS` é exclusiva para bootstrap,
migrations, seed e introspecção administrativos offline; ela não deve ser
fornecida ao processo da API em produção. O runtime não recebe DDL, `DELETE`,
ownership de tabelas nem `BYPASSRLS`.

As tabelas públicas do aplicativo usam RLS. As policies de `fhdod_api` limitam
as operações SQL permitidas; a autorização por superusuário, gestor e setor
continua sendo responsabilidade da API Express. O navegador não usa a Data API
para acessar essas tabelas. Consulte [a inicialização segura do banco](docs/bootstrap.md)
e [a reconciliação de migrations](docs/database-baseline.md) antes de alterar um
ambiente existente.

As demais variáveis obrigatórias são `ALLOWED_ORIGIN`, `JWT_SECRET`,
`JWT_ISSUER` e `JWT_AUDIENCE`. Veja os exemplos e comentários em
[.env.example](.env.example).

## Cache Redis

O cache é opcional e usa cache-aside somente para a lista efetiva de perguntas
ativas por setor, depois de a autorização normal ser concluída. Para uso local,
inicie um contêiner já criado com `docker start fhdod-redis` e verifique-o com
`redis-cli -u "$REDIS_URL" PING`. Configure
`CACHE_ENABLED=true`, `REDIS_URL` e `CACHE_QUESTIONS_TTL_SECONDS` (30–120;
padrão 60). Com `CACHE_ENABLED=false`, o cache é desabilitado; Redis ainda pode
ser conectado se `SECURITY_REDIS_ENABLED=true` para rate limiting.

As chaves seguem `fhdod:cache:v1:questions:effective:sector:<id>:v<versão>`.
Após qualquer alteração confirmada de pergunta, vínculo, NPS ou ordenação, a
versão global de perguntas é incrementada; entradas anteriores ficam obsoletas
sem `SCAN`, `FLUSHALL` ou `FLUSHDB`. Falha, timeout ou indisponibilidade do
Redis é fail-open: a API consulta PostgreSQL normalmente. O cache não contém
sessões, tokens, respostas de pacientes, cookies nem respostas HTTP completas.

## Limitação distribuída e proteção de login

Quando `SECURITY_REDIS_ENABLED=true`, os limites são compartilhados entre
réplicas por Redis. As chaves usam HMAC-SHA-256 derivado de `JWT_SECRET`; IPs e
e-mails não são gravados em texto puro. O incremento e a expiração são
atômicos. Redis indisponível ativa um fallback local por processo: ele mantém
uma proteção mínima, mas não coordena múltiplas instâncias.

- `POST /api/auth/login`: 30 requisições/IP a cada 15 minutos e, por padrão,
  cinco falhas por IP ou identificador na mesma janela. Falhas repetidas para o
  mesmo identificador recebem atraso progressivo curto; a tentativa seguinte
  ao limite recebe `429` com `Retry-After`. Login bem-sucedido limpa somente o
  contador do identificador.
- `GET /api/auth/csrf` e `POST /api/auth/refresh`: 60 requisições/IP a cada
  15 minutos.
- rotas administrativas autenticadas: 300 requisições/IP por minuto.
- rotas públicas de submissão: 180 requisições/IP por minuto, propositalmente
  mais permissivas para redes hospitalares compartilhadas.

Todos os valores podem ser ajustados pelas variáveis `RATE_LIMIT_*` e
`LOGIN_*` em [.env.example](.env.example). `TRUSTED_PROXY_CIDRS` é vazio por
padrão: o Express ignora cabeçalhos encaminhados. Informe somente os IPs/CIDRs
do proxy reverso controlado; nunca use uma confiança irrestrita. No Postman, repita uma rota até receber
`429` e confira `Retry-After`; para inspeção local, use somente chaves de teste
com o prefixo `fhdod:security:v1:` e nunca tente derivar ou registrar chaves
de usuários reais.

## Segurança de sessão

- Access token curto e refresh token opaco são enviados em cookies HTTP-only.
- Operações mutáveis autenticadas exigem o token CSRF da sessão no cabeçalho
  `x-csrf-token`.
- Senhas temporárias expiram em 48 horas e exigem troca após login.
- Logins substituem a sessão anterior do mesmo usuário dentro de transação.
- `POST /api/auth/login`, `POST /api/auth/refresh` e `GET /api/auth/me`
  retornam `{ user: { id, name, email, role, mustChangePassword } }`. Os dois
  primeiros atualizam os cookies; `/me` apenas valida a sessão atual e não a
  renova.
- O limite local de falhas protege cada processo, mas não substitui
  armazenamento compartilhado em implantação com múltiplas réplicas.

Defina `trust proxy` apenas após conhecer a cadeia de proxies confiáveis da
infraestrutura; não use `true` indiscriminadamente.

## Endpoints e observabilidade

- `GET /health`: liveness do processo.
- `GET /health/ready`: readiness do banco.
- `GET /api-docs/`: documentação OpenAPI das rotas disponíveis.

Logs são estruturados e evitam corpos, cookies, cabeçalhos e credenciais. Use
`PERFORMANCE_MEASUREMENTS=true` somente durante diagnósticos temporários.

## Validação

```bash
npm run typecheck
npm run lint
npm run build
npm test
```

Integrações PostgreSQL só executam com `POSTGRES_INTEGRATION_TESTS=true`.
O setup global então exige `LOCAL_DATABASE_URL` e `DATABASE_URL` no mesmo
endpoint loopback, banco descartável `fhdod_test`, runtime `fhdod_api` e o
marcador documentado em [docs/bootstrap.md](docs/bootstrap.md). Sem opt-in,
somente testes que não dependem de PostgreSQL são executados.

## Demonstração, indicadores e Postman

O comando separado `npm run seed:demo` exige conexão administrativa loopback explícita em `LOCAL_DEMO_DATABASE_URL`, banco `fhdod_test` com marcador descartável e senhas em `DEMO_ADMIN_PASSWORD`/`DEMO_MANAGER_PASSWORD`. Não utiliza o `.env` para escolher destino e não sobrescreve contas existentes fora da fixture. Veja [o manual local do Postman](postman/README.md).

O novo endpoint de agregados é `GET /api/analytics/dashboard`. Fórmulas, filtros, autorização e limites estão em [analytics](docs/analytics.md). A migration 0017 acrescenta somente leitura do histórico legado para a role runtime; deve seguir as migrations anteriores pelo comando oficial.

## Segurança das migrations

O mecanismo exige arquivos SQL em LF, valida o prefixo histórico antes de
qualquer DDL e coordena execuções com advisory lock. Use `npm run migrate:check`
para uma verificação somente leitura. O procedimento Windows/Supabase está em
[docs/migration-safety.md](docs/migration-safety.md).

## Desenvolvimento local seguro e prontidão do schema

`npm run dev` usa o arquivo ignorado `.env.development.local`, que precisa definir explicitamente DATABASE_URL (role fhdod_api) e DATABASE_URL_MIGRATIONS no mesmo PostgreSQL loopback, banco fhdod_test. As demais configurações locais podem sobrescrever os valores de `.env`; o arquivo original não é alterado. `npm run dev:configured` é a opção explícita para usar a configuração existente. Os comandos HTTP não executam migrations automaticamente.

Exemplo de conexões para a instância isolada desta auditoria (sem senha, exclusivamente no cluster de teste local):

```dotenv
DATABASE_URL=postgres://fhdod_api@127.0.0.1:55440/fhdod_test
DATABASE_URL_MIGRATIONS=postgres://rafael@127.0.0.1:55440/fhdod_test
PORT=3000
ALLOWED_ORIGIN=http://localhost:5173
CACHE_ENABLED=false
SECURITY_REDIS_ENABLED=false
```

Para iniciar o cluster já criado: `pg_ctl -D "$PWD/.local/postgres" -o "-h 127.0.0.1 -p 55440 -k $PWD/.local" -l "$PWD/.local/postgres.log" start`. Confirme o destino antes de `DATABASE_URL_MIGRATIONS=<conexão administrativa local> npm run migrate`. O runtime recusa schema incompleto com `DATABASE_SCHEMA_NOT_READY` antes do listen; não crie tabelas manualmente para contornar esse erro. A checagem verifica estruturas e permissões, não substitui a validação administrativa dos hashes no ledger.

`PERFORMANCE_MEASUREMENTS=true` acrescenta contagem SQL por requisição, tempos de autenticação e métricas do cache no encerramento, sem texto de SQL ou parâmetros. Desative após o diagnóstico. Consulte [a auditoria de performance](docs/backend-performance-audit.md) para medições e limites.

Para migrar com os mesmos guardas de destino, use `npm run migrate:local`: ele carrega `.env.development.local` e chama o migrador oficial. O comando original `npm run migrate` continua respeitando DATABASE_URL_MIGRATIONS do ambiente; não o execute sem conferir o destino.
