# FHDOD no Postman

Importe `FHDOD.postman_collection.json` (v2.1) e `FHDOD.local.postman_environment.json`. Preencha as senhas **somente nos valores locais** do ambiente; os arquivos exportados não contêm senhas. A coleção bloqueia baseUrl fora de `http://localhost[:porta]` ou `http://127.0.0.1[:porta]`.

## Preparação local

1. Inicie PostgreSQL descartável segundo `docs/bootstrap.md`. Confirme explicitamente host loopback e banco `fhdod_test`; configure o marcador `fhdod.disposable=true`.
2. Instalação vazia exige bootstrap uma vez; depois execute `DATABASE_URL_MIGRATIONS=<conexão administrativa local> npm run migrate`. O ledger atual tem 18 migrations, até 0017.
3. Defina `LOCAL_DEMO_DATABASE_URL` para o mesmo banco local e `DEMO_ADMIN_PASSWORD`/`DEMO_MANAGER_PASSWORD` com os valores de desenvolvimento fornecidos pelo responsável. Execute `npm run seed:demo`. As contas são `ouvidoria@gmail.com` e `gestor@gmail.com`. O seed não lê `.env`, não aceita remoto e recusa sobrescrever contas preexistentes fora da fixture.
4. Inicie `npm run dev` com `DATABASE_URL` local usando `fhdod_api`, `PORT=3000`, `SECURITY_REDIS_ENABLED=false` e as demais configurações existentes. Passe as variáveis no processo; confira que o `.env` do Supabase não substitui a conexão local.
5. Configure `baseUrl`, `sectorId` e `otherSectorId` com os IDs impressos pelo seed. IDs podem avançar após rollback e não devem ser presumidos. `from`/`to` devem incluir a data atual.

## Sequência de teste

- Execute health/readiness e login de administrador. O cookie jar do Postman recebe os cookies HTTP-only; o script guarda `csrfToken`. `/refresh` usa cookie, não Bearer; token consumido, ausente ou expirado pode retornar 401.
- Leia setores e o rascunho. O GET guarda revisão e `draftPayload`; o pre-request do PUT acrescenta uma pergunta local fictícia antes do NPS, criando uma alteração real. NPS/global requer administrador. Readiness deve estar satisfeita antes de publicar. Guarde `formVersionId` pelo retorno ou histórico e use restauração para criar rascunho; publicar é operação separada.
- Login de gestor substitui os cookies do administrador. Leia o setor vinculado; outro setor deve retornar 403. Volte ao login administrativo para gerir Ouvidoria e horários. Evite executar toda a collection em ordem sem preparar esses estados.
- Crie sessão pública sem body; o script guarda `sessionId`, `sessionCapability`, `questionId` e `questionVersionId`. Responder usa `x-session-capability`. Para NPS selecione os IDs NPS recebidos e envie score 0–10; as demais notas são 1–5. Responder NPS após as demais perguntas conclui a pesquisa. Refresh, restart e close seguem contratos próprios; restart troca a sessão.
- Publique LGPD pelo PUT de conteúdo antes da manifestação pública se necessário. Configure ticketId com o ID retornado; a consulta/status exige administrador. Não preencha telefone real.
- CSV: baixe modelo, preencha os sete dias de todos os setores ativos, escolha o arquivo no body **binary** do POST. O arquivo não acompanha a coleção; não use multipart. Download da vigente deve devolver CSV com BOM.
- Analytics: `GET /api/analytics/dashboard?from=...&to=...&sectorId=...`. Para o setor do seed, antes de adicionar outras respostas, espere 4 sessões completas, 8 respostas e NPS **25** (2 promotores, 1 neutro, 1 detrator). Gestor só recebe seus setores. Taxa de atendimento é null porque não existe denominador.
- Execute negativos com o perfil indicado no nome: CSRF ausente, capability incorreta, gestor fora do escopo. Limpe cookies antes de testar refresh inválido. Rotas antigas de escrita retornam 409 por contrato.

A coleção foi validada contra o schema oficial v2.1 com AJV existente; environment foi validado estruturalmente. Essa validação não comprova execução de todos os fluxos no Postman. Algumas requisições administrativas usam exemplos OpenAPI: substitua placeholders e preencha payloads com os dados fictícios locais. Veja `docs/form-publication.md` para a composição completa do PUT.

As duas requisições de criação em `/api/catalog/*` usam superusuário e CSRF e não publicam automaticamente. Crie a identidade, leia o catálogo e inclua a pergunta no rascunho antes de publicar. Criar NPS específico onde já existe override retorna conflito; não trate isso como substituição automática.

## Retomar a instância demonstrativa desta sessão

Os processos temporários foram encerrados para liberar memória. Enquanto os arquivos de `/tmp` existirem, o cluster já preparado pode ser retomado a partir da raiz do backend:

```bash
demo_dir=$(cat /tmp/fhdod-demo-dir)
pg_ctl -D "$demo_dir/pg" -o "-h 127.0.0.1 -p 55440 -k $demo_dir" -l "$demo_dir/server.log" start
DATABASE_URL=postgres://fhdod_api@127.0.0.1:55440/fhdod_test \
DATABASE_URL_MIGRATIONS=postgres://rafael@127.0.0.1:55440/fhdod_test \
PORT=3000 CACHE_ENABLED=false SECURITY_REDIS_ENABLED=false npm run dev
```

A conexão sem senha acima é exclusiva do cluster descartável com autenticação local criado nesta sessão; não é uma configuração para serviços compartilhados. `/tmp` pode ser limpo pelo sistema. Se isso ocorrer, recrie o banco conforme o bootstrap documentado e execute migrations e seed novamente. Os IDs da demonstração desta execução são setor 3 e outro setor 4; confirme-os antes de testar se recriar a fixture.
