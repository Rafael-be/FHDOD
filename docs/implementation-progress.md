# Conclusão do backend — progresso

Branch `feature/backend-completion-analytics` parte de `1e8b005`, com dependência do PR #7 de publicação manual. A base não foi mesclada automaticamente.

## Matriz essencial

| Requisito | Fonte | Estado / aceitação | Verificação |
|---|---|---|---|
| Autenticação, CSRF, escopo administrativo | README; docs/bootstrap.md | Implementado anteriormente; preservar guards | Suíte auth/admin |
| Rascunhos, revisão, prontidão, publicação, restauração | docs/form-publication.md; missão atual | Implementado; versão vigente imutável | form-draft/form-publication |
| CSV sem funcionários, semana explícita e fora do horário permitido | docs/shift-sheets.md; instruções atuais | Prevalece sobre documentos antigos que exigiam 24h | tests/shifts e submissões |
| NPS, contagens, médias, distribuição, tempo e setores | missão atual §6; Arquivos/regras_de_negocio.md | Novo endpoint agregado, NPS matemático, escopo por setor | tests/analytics |
| Respostas antigas preservadas | missão atual §6/8 | UNION somente para sessões sem form_version_id; SELECT por 0017 | teste RLS e SQL |
| Dados demonstrativos locais | missão atual §8 | Novo seed transacional, idempotente; recusa colisão e destino remoto | seed executado em banco novo |
| Collection e environment Postman | missão atual §9 | JSON v2.1 validado; placeholders; fluxo de cookies | AJV com schema oficial |
| Equipe/profissional e taxa de atendimento | missão atual §6 | Indisponíveis sem associação/denominador confiável | flags/null explícitos |
| Resumos horários/pg_cron dos planos antigos | Arquivos/modelagem_bd.md §3.5 | Divergência documentada: consulta direta agregada nesta entrega, sem job | Pendência de definição operacional |

## Unidade atual

- Analytics separado em routes/service/repository; parâmetros Zod e janela máxima de 366 dias; agregação SQL com respostas antigas e atuais. Nova migration 0017 permite apenas SELECT nas duas tabelas legadas.
- Testes direcionados: NPS +100/-100/0, vazio, timezone, escopo, leitura com role runtime; HTTP 401/400/200.
- Seed gera contas solicitadas via Argon2 usando senhas apenas de ambiente, setores, formulário, planilha e manifestações fictícias; quatro NPS 10/9/8/5 => 25. Primeiro teste detectou consentimento sem timestamp, corrigido; rollback preservou atomicidade.
- Postman cobre todos os métodos e paths dos routers e acrescenta login de gestor e cenários negativos. Execução da collection inteira no Postman ainda não realizada; validação estrutural não equivale a E2E.
- Próximo marco: suíte integrada final, HTTP real de analytics, commits e publicação se autenticação disponível. Nenhum acesso ao Supabase nesta missão.

## Marco validado e commitado

- `c7d2a6a`: analytics, SELECT histórico, autorização e testes.
- Suíte geral integrada desta missão: 58 suítes/224 testes aprovados, zero falhas, quatro testes de retenção ignorados. Regressão adicional de histórico e instalação limpa: 7/7 aprovados.
- Seed e migrador idempotentes: 2 usuários, 2 setores, 4 sessões, 8 respostas, 14 dias e 2 manifestações no demo, sem duplicação ao reexecutar.
- HTTP real confirmou NPS 25, gestor com acesso filtrado e 403 fora do escopo; `/api-docs/` retornou 200.
- Documentos `docs/backend-final-audit.md` e `postman/README.md` registram fórmulas, início local e limites. Cadastro administrativo padrão/NPS acrescentado em rotas de catálogo sem publicar snapshots. Permanece por concluir a execução integral da collection com preparação de estados. Não declarar a missão integral concluída.

## Última continuação

- Rotas `POST /api/catalog/standard-questions` e `POST /api/catalog/nps-questions`: reutilizam serviços transacionais existentes, exigem superusuário e CSRF; publicação continua explícita.
- Teste HTTP compara argumentos de scope/texto/setores e testa negação sem CSRF e para gestor. Teste PostgreSQL real compara todos os ponteiros e snapshots antes/depois do cadastro.
- Suíte ampliada com retenção habilitada: 228 aprovados, 2 falhas, nenhum ignorado. As duas falhas foram resolvidas (OpenAPI legado e grants incompletos do fixture histórico); os dois arquivos afetados passaram 11/11 na reexecução. Os quatro testes de retenção executaram sem falhas. Não foi repetida a suíte completa após essa correção direcionada.
- Collection final tem 74 requisições; inclui cadastro padrão/NPS e resposta NPS separada. Scripts e schema foram validados; execução integral interativa continua pendente.

## Git e encerramento dos processos

Commits: `c7d2a6a` (analytics), `1d60b85` (seed/Postman) e `0db229a` (catálogo e regressões). Push da branch `feature/backend-completion-analytics` recusado por falta de autenticação HTTPS (`could not read Username`). Nenhum merge executado. Servidor de demonstração e clusters 55437/55440 foram encerrados; o manual Postman contém os comandos para retomar o cluster demonstrativo. Não foi alterado `.env` nem frontend, nem acessado Supabase nesta missão.

## Correção crítica e performance — 23/11/2026

Branch `fix/backend-submission-performance`, base `8904e76`. Banco novo local em `.local/postgres`, porta 55440, `fhdod_test`, ledger 18. `.env` remoto preservado; `.env.development.local` ignorado aponta ambos os comandos ao banco local. `npm run dev` exige esse arquivo. Readiness detecta estruturas/policies/grants ausentes antes de ouvir HTTP, sem migrar automaticamente.

- `bbf9ec7`: configuração local e prontidão de schema, incluindo testes de destino remoto/malformado e ausência da tabela 0015.
- `189a1a5`: autenticação única administrativa, contadores SQL por request e métricas seguras de cache.
- `699a8fb`: fixtures de rascunhos/publicação com IDs dinâmicos, montagem transacional e limpeza própria.
- Teste inicial em banco novo: 225 aprovados, 6 falhas em três suítes com IDs fixos. Final: 63 suítes/236 testes aprovados, zero falhas ou ignorados. Typecheck, lint, build e diff-check aprovados.
- Medianas locais com 15 amostras: dashboard 27,02→11,36ms (13→3 consultas); auditoria 15,02→7,75ms (7→3); catálogo 18,88→9,27ms (9→3). Sem extrapolar para Supabase. EXPLAIN de analytics: execução 1,53ms no dataset pequeno.
- HTTP real: pesquisa completa [5,10], NPS agregado correto, capability inválida 403, expirada 410, sem publicação 409, restart/CSV válidos. Login de gestor, CSRF, conflito de revisão, publicação e restauração aprovados, mantendo snapshots históricos.
- Supabase original apenas consultado por SELECTs com read-only: runtime fhdod_api/public, tabela ausente, ledger 14. Sem nenhuma escrita remota.
- Relatório consolidado em `docs/backend-performance-audit.md`; limitações: Redis real indisponível, separação exata de espera de pool/serialização não medida, tempos remotos de segundos não reproduzidos.

Últimas regressões desta rodada: `1a628c2` conecta publicação à invalidação versionada após commit (observador PostgreSQL independente confirmou o ponteiro novo; erro Redis não desfaz publicação); `4377881` acrescenta `migrate:local` com guardas de destino; `a4ee378` corrige a restauração da planilha após remover setor temporário no teste RLS, fechando conexões mesmo em falha. A última suíte completa, após todas essas correções, passou 63 suítes e 236 testes, sem falhas/ignorados. `npm run dev` e `npm run migrate:local` são os comandos locais seguros; o migrador original continua exigindo conferência explícita de destino.
