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
