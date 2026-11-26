# Backend → develop: auditoria de integração (23/11/2026)

## Git e PRs

- Branch local inicial e final: `fix/backend-submission-performance`, HEAD `b1677ddab80c43ebf7abc60da40c9a91582574c5`, working tree inicialmente limpa. `origin/develop` = `6f21cc7`; `origin/main` = `6928a5f`. O GitHub confirma esses mesmos SHAs. `git fetch origin --prune` foi impedido porque `.git/FETCH_HEAD` é somente leitura neste ambiente; as referências remotas foram verificadas pela API do GitHub.
- A branch atual contém 26 commits exclusivos e `develop` não contém commits exclusivos. `develop` é o merge-base. Não há conflito esperado por divergência de histórico; o PR #8 informa `mergeable: true`, `mergeable_state: clean`.
- [PR #7](https://github.com/Rafael-be/FHDOD/pull/7): `feature/backend-manual-publish-audit` → `develop`, aberto, CI falhou. Seu HEAD `1e8b005` é ancestral da branch atual; nenhum commit exclusivo do #7 precisa ser preservado separadamente.
- [PR #8](https://github.com/Rafael-be/FHDOD/pull/8): `fix/backend-submission-performance` → `develop`, aberto, CI aprovado para `b1677dd`. Deve ser o PR de integração. O #7 pode ser fechado **após autorização**, com a justificativa de substituição integral pelo #8. Não mesclar ambos.
- Nenhum arquivo de ambiente ou segredo aparece no diff com `develop`. Não foi feito merge, push, fechamento de PR ou alteração em branches remotas nesta auditoria.

## Dois checks falhos do PR #7

Os dois checks são execuções do workflow **Continuous Integration**, job **Validate API**, etapa **Run tests**: [push 45099428926](https://github.com/Rafael-be/FHDOD/actions/runs/45099428926) e [pull request 45099434227](https://github.com/Rafael-be/FHDOD/actions/runs/45099434227). Ambos executam `npm test` para o mesmo SHA `1e8b005`. Type check, lint e build passaram. Não são duas causas independentes; são duas execuções do mesmo defeito de fixtures. No log do PR: 3 suítes e 6 testes falharam, 54 suítes e 218 testes passaram.

| Falha original | Arquivos | Causa e correção já presente no #8 | Regressão e prova |
| --- | --- | --- | --- |
| `Setor inexistente ou inativo.`; `sector_shift_ranges_sector_id_fkey` | `tests/submissions/form-draft.integration.test.ts`, `form-publication.integration.test.ts` | Testes presumiam setor de ID 2/3 em um banco novo, sem esses registros. Fixtures agora criam setores e referências válidas, isoladas por transação ou limpeza controlada. | Executar `POSTGRES_INTEGRATION_TESTS=true ... npm test` em banco descartável; ambos os arquivos passam. |
| `questions_created_by_user_id_fkey`; HTTP `expected 403, got 404` | `tests/submissions/form-draft.integration.test.ts`, `form-draft.http.integration.test.ts` | Testes presumiam usuário ID 1 e setor 3; a falha de autorização era mascarada pela ausência do setor. Fixtures agora criam usuário/atribuição/setores e verificam 403 em alvo existente. | Mesma suíte de integração, com role `fhdod_api` e RLS; 232 testes passaram. |

As correções de fixtures estão nos commits `699a8fb` e `a4ee378`, já contidos no PR #8. Não foi necessário alterar código de produção, migrations históricas ou critérios de CI nesta execução.

## Compatibilidade e verificação

- O diff parte diretamente de `develop` e acrescenta publicação manual, histórico/restauração, pesquisa pública, analytics, ouvidoria, cache, otimizações e seus testes; não remove endpoints de `develop`. `git diff --check origin/develop...HEAD` passou.
- O frontend de referência chama `POST /api/public/sectors/:sectorId/submissions` e os endpoints de resposta, reinício, renovação e conclusão. As rotas de backend continuam presentes. Também foram conferidas chamadas de login, refresh, setores, editor, dashboard, ouvidoria e planilhas. A inspeção foi estática; os testes HTTP e de integração cobrem os contratos principais.
- `npm run typecheck`, `npm run lint` e `npm run build`: aprovados. `npm test` sem integração: 40 suítes/193 testes aprovados, 23 suítes/43 testes ignorados. Com `POSTGRES_INTEGRATION_TESTS=true`, URLs explícitas de loopback para `fhdod_test` e execução serial: 62 suítes/232 testes aprovados, 1 suíte/4 testes ignorados. O CI do #8 passou no [run 45288254869](https://github.com/Rafael-be/FHDOD/actions/runs/45288254869).
- PostgreSQL local 18.6 na porta 55440, banco `fhdod_test`: 18 registros no ledger Drizzle; 37 tabelas públicas, 37 com RLS, 79 policies. Contagens de teste observadas: 21 versões de formulário e 14 respostas. O cluster foi iniciado pelo comando documentado no README. O sandbox padrão negava sockets; a validação local foi executada com permissão para sockets. Não se recriou o banco.

## Supabase: leitura remota e plano

- O destino configurado foi consultado somente em transações `READ ONLY` com timeout, sem exibir credenciais: banco `postgres`, role administrativa `postgres`, 14 entradas em `drizzle.__drizzle_migrations`; 34 tabelas públicas, 34 com RLS e 65 policies. `submission_form_versions` existe; `sector_current_forms` não existe. As diferenças de contagem de objetos não provam, por si, equivalência completa de definições ou de dados. Nenhuma migration ou alteração remota foi executada.
- Pendentes conforme journal local, nesta ordem: `0014_submission_form_drafts`, `0015_sector_current_forms`, `0016_validate_current_form`, `0017_analytics_legacy_reads`. A 0015 depende das estruturas da 0014; a 0016 valida o ponteiro atual; a 0017 ajusta leituras legadas de analytics. Verificar hashes do ledger e dependências SQL antes de aplicar.
- Antes de staging: provisionar Supabase de testes isolado, restaurar cópia sanitizada ou dados sintéticos, conferir o ledger e o schema, aplicar as quatro migrations em ordem pelo migrador oficial, validar grants, RLS, policies, publicação/restauração, pesquisa, analytics e rollback por restauração. Antes de produção: backup completo verificado e ensaio de restauração, janela de manutenção, aprovação explícita do plano e validação do staging. Depois: verificar ledger, objetos, grants, health/readiness, fluxos HTTP e métricas. Não editar migrations históricas nem o ledger manualmente.
- O backend hospedado deve receber URLs separadas para runtime (`fhdod_api`) e migração administrativa, TLS, pool limitado, secrets no provedor, CORS restrito ao frontend, HTTPS/cookies seguros, health checks, logs sem dados sensíveis, monitoramento e política de backup e retenção LGPD. O deploy deve ser progressivo: desenvolvimento local → staging isolado → produção, com migrations controladas antes da troca de tráfego. Redis permanece opcional.

## Próximas ações e riscos

1. Manter o PR #8 aberto e revisar. Fechar o #7 apenas com autorização explícita; seu trabalho já está no #8. Integrar somente o #8 em `develop` após aprovação, sem merge automático.
2. Confirmar o check do #8 novamente se novos commits forem adicionados. A suíte local ainda tem 1 suíte/4 testes ignorados; verificar se são condicionais de retenção antes do deploy.
3. Fazer auditoria estrutural remota detalhada e ensaio de staging antes de declarar o banco pronto. A diferença 18/14 exige quatro migrations pendentes e backup validado. Nenhuma migração remota está autorizada por esta auditoria.
