# Regras de negócio das perguntas

## Tipos

- Perguntas padrão têm uma única identidade em `questions` e podem possuir um vínculo independente em cada setor.
- Perguntas setoriais pertencem exclusivamente ao setor de origem e nunca são herdadas por outros setores.
- NPS mantém sua regra própria: é resolvido separadamente, não participa do `display_order` comum e aparece por último.

## Vínculos e ordenação

`question_sector_assignments` guarda o setor, a posição e o estado do vínculo de uma pergunta padrão. A posição é independente por setor, mas a sequência comum combina perguntas padrão e setoriais. Inclusões calculam `MAX(display_order) + 1` nessa sequência e usam inserção em lote; NPS não participa.

Ao criar um setor, perguntas padrão globais ativas são herdadas em ordem determinística, com posições iniciando em 1. O NPS global continua dinâmico e não recebe vínculo comum. A tabela `sector_nps_assignments` é reservada a overrides ativos `selected_sectors` com fonte `specific`; linhas encerradas anteriores a essa regra permanecem somente como histórico.

Reordenar um setor recebe a sequência completa de perguntas comuns ativas elegíveis desse setor e altera somente esse setor. O NPS é excluído da reordenação comum. Criação, reativação de vínculo e reordenação usam o mesmo lock transacional por setor.

## Ativação e histórico

Desativar uma pergunta inteira altera apenas seu estado global e preserva seus vínculos. Desativar um vínculo padrão afeta somente o setor indicado. Reativar um vínculo recupera a posição anterior quando ela estiver livre; em caso de conflito com qualquer pergunta comum ativa, a pergunta é anexada ao final. O banco valida que vínculos comuns apontam apenas para perguntas padrão não-NPS e que vínculos NPS apontam apenas para perguntas NPS.

As operações preservam versões, respostas, sessões e snapshots históricos. Não há exclusão física de registros necessários à auditoria ou ao histórico.
