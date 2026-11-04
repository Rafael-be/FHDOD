# Regras de negócio das perguntas

## Tipos

- Perguntas padrão têm uma única identidade em `questions` e podem possuir um vínculo independente em cada setor.
- Perguntas setoriais pertencem exclusivamente ao setor de origem e nunca são herdadas por outros setores.
- NPS mantém sua regra própria: é resolvido separadamente, não participa do `display_order` comum e aparece por último.

## Vínculos e ordenação

`question_sector_assignments` guarda o setor, a posição e o estado do vínculo de uma pergunta padrão. A posição é independente por setor. Inclusões calculam `MAX(display_order) + 1` por setor e usam inserção em lote; perguntas setoriais seguem a mesma regra no próprio setor.

Ao criar um setor, perguntas padrão globais ativas são herdadas em ordem determinística, com posições iniciando em 1. O NPS global continua dinâmico e não recebe vínculo comum.

Reordenar um setor altera somente os vínculos daquele setor. O NPS é excluído da reordenação comum.

## Ativação e histórico

Desativar uma pergunta inteira altera apenas seu estado global e preserva seus vínculos. Desativar um vínculo padrão afeta somente o setor indicado. Reativar um vínculo recupera a posição anterior quando ela estiver livre; em caso de conflito, a pergunta é anexada ao final.

As operações preservam versões, respostas, sessões e snapshots históricos. Não há exclusão física de registros necessários à auditoria ou ao histórico.
