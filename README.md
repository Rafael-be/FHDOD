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
role restrita `fhdod_api`. `DATABASE_URL_MIGRATIONS` é exclusiva para operações
administrativas offline, como seed e introspecção; ela não deve ser fornecida ao
processo da API em produção.

As demais variáveis obrigatórias são `ALLOWED_ORIGIN`, `JWT_SECRET`,
`JWT_ISSUER` e `JWT_AUDIENCE`. Veja os exemplos e comentários em
[.env.example](.env.example).

## Segurança de sessão

- Access token curto e refresh token opaco são enviados em cookies HTTP-only.
- Operações mutáveis autenticadas exigem o token CSRF da sessão no cabeçalho
  `x-csrf-token`.
- Senhas temporárias expiram em 48 horas e exigem troca após login.
- Logins substituem a sessão anterior do mesmo usuário dentro de transação.
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

Testes de integração só executam quando `DATABASE_URL_TEST` aponta para um
banco físico isolado de `DATABASE_URL`. Use um banco descartável; detalhes em
[docs/bootstrap.md](docs/bootstrap.md).
