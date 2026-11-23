# Implantação futura da publicação manual

Este checklist é preparatório. Nenhuma migration foi aplicada ao Supabase nesta rodada.

1. Confirmar branch, diff, migrations `0014`–`0016` e hashes históricos `0000`–`0013` com `migration-integrity.test.ts`.
2. Obter backup restaurável e registrar contagens de setores, perguntas, versões, sessões e respostas antes de alterar o banco.
3. Revisar no destino o ledger Drizzle e quaisquer versões publicadas incompletas ou ambíguas; não escolher ponteiro manualmente sem análise.
4. Aplicar `0014`, `0015`, `0016` em ordem pelo migrador oficial, durante janela controlada. Confirmar ledger com 17 entradas e reexecutar o migrador para verificar idempotência.
5. Conferir `sector_current_forms`: uma versão vigente por setor publicado, sempre do próprio setor, com exatamente um NPS e ao menos uma pergunta padrão. Setores sem versão válida devem ficar sem ponteiro.
6. Comparar contagens e vínculos históricos de sessões e respostas antes/depois; não reescrever `form_version_id` histórico.
7. Conferir RLS e grants de `fhdod_api` para rascunhos e ponteiros, incluindo exclusão física somente dos rascunhos. Validar que snapshots publicados não recebem DELETE da role runtime.
8. Implantar o backend coordenadamente com o schema: o backend novo exige `sector_current_forms`; executá-lo antes das migrations causa erro. O backend antigo pode publicar automaticamente e não deve permanecer ativo depois da transição.
9. Planejar a integração do frontend: as rotas antigas de escrita de perguntas retornam `409 FORM_DRAFT_REQUIRED`; o editor precisa usar rascunho, prontidão, publicação, histórico e restauração com `expectedRevision` e CSRF.
10. Fazer smoke tests com superusuário e gestor vinculado: login, leitura própria, negação de outro setor, salvamento, publicação, criação de sessão pública, resposta e consulta de histórico. Conferir versão vigente de uma sessão nova e preservação de uma antiga.
11. Em falha antes do COMMIT, corrigir a causa e reexecutar o migrador; cada migration usa transação. Para recuperação após publicação em produção, restaurar backup ou implantar correção coordenada. Não excluir tabelas nem editar versões históricas como rollback.

## Verificação de 22/11/2026 — implantação remota pendente

- PR #7 aberto para `develop`, HEAD `ab1c8dd`, sem conflito informado pelo GitHub. O único workflow em `.github/workflows` é de CI; não foi identificado deploy automático das migrations pelo merge.
- Conexões do `.env` apontam para o projeto Supabase `kzyfzqppblfzuxrfudbi`. Consultas somente de leitura confirmaram ledger remoto com 14 entradas (`0000`–`0013`), hashes iguais aos 14 primeiros do banco local, e ausência de `public.sector_current_forms`. Nenhuma migration remota foi executada.
- O archive integral anterior (`/tmp/fhdod-supabase-kzyfzqppblfzuxrfudbi-full-20261122.dump`, criado às 12:55) é legível, mas contém apenas 9 migrations e está desatualizado. A restauração integral em PostgreSQL local parou pela extensão ausente `supabase_vault`; isso **não** comprova recuperação integral do Supabase.
- Um dump novo **somente dos schemas `public` e `drizzle`** foi feito por conexão de leitura às 23:12 (`/tmp/fhdod-public-drizzle-current-20261122.dump`, formato customizado, 201.685 bytes, SHA-256 `545f608b7cd8c305cdf63308f91ad55231a4b6cb9b6c301bc8ecc7bc6b37137c`). Foi restaurado sem erros em PostgreSQL isolado após preparar a role local `fhdod_api` e remover o schema `public` padrão vazio.
- Na cópia atual, o migrador oficial aplicou `0014`–`0016`: ledger 14→17, 2 ponteiros vigentes criados. Contagens de setores/usuários/perguntas/versões/sessões/respostas antes e depois: `4/5/13/2/9/2+4` em ambos os estados. Nenhum ponteiro de outro setor, sessão sem versão ou resposta sem sessão foi encontrado. RLS habilitado nas três tabelas novas, com 4/3/3 políticas; reexecutar o migrador manteve 17 entradas. Como o dump usou `--no-acl`, esta restauração não valida integralmente os grants históricos de runtime.
- Dois setores ativos têm versão completa e recebem ponteiro; outros dois não têm formulário publicado e continuarão sem ponteiro, retornando `409 FORM_NOT_PUBLISHED` até publicação manual. As rotas antigas de escrita do frontend passam a retornar 409 com o backend novo.

**Bloqueio atual:** finalidade do projeto remoto e autorização específica para alterá-lo não foram comprovadas; tampouco foi validada restauração integral recente de todos os schemas Supabase. Não executar migrations remotas nem fazer merge como substituto dessa autorização.

**Ordem proposta após resolver o bloqueio:** obter backup completo recente e testar sua recuperação em ambiente com as extensões Supabase necessárias; registrar contagens e ledger; combinar janela de manutenção para impedir escrita durante o corte; aplicar `0014`–`0016` com `DATABASE_URL_MIGRATIONS` pelo `npm run migrate`; conferir ledger, ponteiros, vínculos, RLS e grants; então ativar o backend compatível e fazer leituras de autenticação, setores, formulários e histórico. Escritas remotas exigem setor de teste autorizado. Em falha após o corte, restaurar o backup segundo um plano operacional aprovado, considerando dados gravados depois dele; não executar SQL inverso genérico.
