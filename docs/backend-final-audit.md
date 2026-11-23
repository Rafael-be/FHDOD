# Auditoria de conclusão do backend — execução local

Esta execução acrescentou analytics e preparou os artefatos de demonstração. Não declara conclusão integral de todos os requisitos históricos.

## Resultados medidos

- Typecheck, lint e build passaram sequencialmente; memória disponível durante as verificações ficou em aproximadamente 1,9 GB. Testes usaram `--runInBand`.
- Suíte integrada no fixture histórico descartável: 58 suítes, 224 testes aprovados, zero falhas; 1 suíte e 4 testes de retenção ignorados por configuração de role específica. Esses quatro não são considerados aprovados.
- Nova migration 0017 aplicada pelo migrador oficial tanto após 0016 no fixture histórico quanto desde bootstrap no banco novo. Ledger tem 18 entradas. Migrations anteriores não foram editadas.
- Login real de administrador e gestor, HTTP de analytics: 200, NPS 25 com 4 respondentes (2 promotores/1 neutro/1 detrator), 4 sessões completas e 2 manifestações. Gestor consultando outro setor: 403; Swagger: 200.
- Collection Postman: 72 requisições, todos os métodos/paths dos routers presentes; schema oficial v2.1 validado com AJV existente. Environment parseável e campos estruturais conferidos. A collection completa ainda não foi executada em Postman/Newman.
- Nenhum acesso ao Supabase nesta missão. `.env` e frontend não foram alterados. Senhas do seed entraram apenas por variáveis de processo.

## Defeitos e ajustes

- SELECT legado ausente impedia analytics histórico: corrigido por migration 0017 com duas policies SELECT e grants específicos, sem UPDATE/DELETE adicionais.
- Fixture histórico local restaurado tinha grants de Ouvidoria incompletos: restaurados apenas os grants previstos no bootstrap local. Não foi necessário alterar migrations antigas por esse problema do fixture.
- Seed de manifestações inicialmente omitia policy_accepted_at: corrigido; tentativa falha sofreu rollback integral. Seed agora cria somente dados fictícios e recusa sobrescrever e-mails fora da fixture.
- OpenAPI descrevia escritas legadas como sucesso, embora fossem bloqueadas por 409: respostas dessas operações foram alinhadas ao comportamento real.

## Limites e pendências reais

- A fonte antiga `Arquivos/modelagem_bd.md` prevê resumos horários e agendamento. Esta implementação agrega diretamente em SQL, conforme a missão atual, sem assumir que o job antigo existe. Decidir operação/performance de resumos com volume real continua pendente.
- Criação de perguntas globais/NPS por um fluxo administrativo de rascunho ainda precisa de desenho/implementação: o rascunho atual cria perguntas locais e permite editar conteúdo global/NPS existente com autorização; rotas antigas permanecem bloqueadas. O seed inicializa NPS e pergunta padrão, mas isso não substitui o editor administrativo.
- A auditoria dos documentos originais foi focal: foram localizados PDF acadêmico e documentos de regras/modelagem, mas não foi concluída uma rastreabilidade linha a linha de todos os documentos do workspace. A matriz essencial está em implementation-progress.md; não deve ser tratada como inventário exaustivo.
- Nenhuma atribuição individual de equipe ou taxa de atendimento foi inventada. Resposta explicita indisponibilidade desses indicadores. Política organizacional para supressão de amostras pequenas ainda não foi definida.
- Redis real e execução completa dos fluxos Postman permanecem sem validação nesta execução. O frontend exige adaptação para rascunho/publicação e novo dashboard.
- O backend antigo e o novo exigem corte coordenado com schema e frontend; merge não aplica migrations remotas. O checklist de implantação remota permanece vigente.

A entrega atual é uma unidade funcional de analytics, seed e coleção estruturada, com testes e pendências explícitas. Não usar este relatório para afirmar que todas as missões estão concluídas ou autorizar implantação remota.

Após ampliar a regressão de histórico, 7/7 testes direcionados passaram também no banco de instalação limpa. O seed e o migrador foram reexecutados sem duplicar dados. A validação sintática dos scripts Postman encontrou e corrigiu um escape inválido no guard de localhost; o guard foi executado com destinos local e externo.
