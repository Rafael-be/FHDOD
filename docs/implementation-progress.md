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
- Documentos `docs/backend-final-audit.md` e `postman/README.md` registram fórmulas, início local e limites. Permanecem por concluir a evolução administrativa de perguntas globais/NPS e execução integral da collection com preparação de estados. Não declarar a missão integral concluída.
