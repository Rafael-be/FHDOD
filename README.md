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
padrão 60). Com `CACHE_ENABLED=false`, não há conexão Redis.

As chaves seguem `fhdod:cache:v1:questions:effective:sector:<id>:v<versão>`.
Após qualquer alteração confirmada de pergunta, vínculo, NPS ou ordenação, a
versão global de perguntas é incrementada; entradas anteriores ficam obsoletas
sem `SCAN`, `FLUSHALL` ou `FLUSHDB`. Falha, timeout ou indisponibilidade do
Redis é fail-open: a API consulta PostgreSQL normalmente. O cache não contém
sessões, tokens, respostas de pacientes, cookies nem respostas HTTP completas.

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
