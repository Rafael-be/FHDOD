# Resoluções da auditoria pré-merge

## Escopo

Esta rodada corrige os achados da auditoria da branch `fix/tv-wall-config-and-public-sector-name`, baseada em `develop`. Não houve push, merge, deploy, execução de migration ou alteração em banco remoto.

## Analytics

O CTE `candidates` é o conjunto de sessões elegíveis após os filtros de período, setor, turno e permissões. Ele agora é usado para participação, conclusão, abandono, séries diárias, setores e métricas do TV Wall.

O CTE `answers` continua restrito a respostas persistidas válidas. Assim, sessões somente com `skipped` participam das métricas de sessão, mas não entram em médias, distribuições ou NPS.

Foi adicionado um teste de regressão para uma sessão com resposta avaliada e outra contendo somente `skipped`.

## TV Wall

`GET /api/public/tv-wall` permanece público e recebe o rate limit `tv-wall-public`, por IP identificado por `request.ip`. O limite padrão é de 120 requisições por minuto, configurável por `RATE_LIMIT_TV_WALL_PER_IP` entre 30 e 2.000.

O limitador reutiliza Redis quando habilitado e disponível, com fallback local limitado já existente. O endpoint retorna `429 TV_WALL_RATE_LIMITED` quando excedido. O cache de indicadores continua com 30 segundos. Não foi adicionado cache local da configuração, pois isso poderia atrasar a propagação de alterações administrativas entre instâncias; a configuração permanece consistente com o banco.

## Ouvidoria e integridade referencial

Foi confirmado que o bootstrap SQL usa a ordem correta da chave composta:

```text
(shift_range_id, shift_sheet_version_id, sector_id)
```

O schema Drizzle estava divergente. O schema foi alinhado e a migration incremental `0019_fix_ombudsman_shift_reference.sql` recria as constraints de sessões e manifestações sem alterar migrations históricas.

Quando não existe uma faixa vigente aplicável ao setor, a Ouvidoria agora mantém os metadados de turno nulos. Nenhuma versão de outro setor é usada como fallback.

A migration não foi executada em Supabase ou qualquer banco remoto.

## Avaliações baixas

As regras documentadas permanecem:

- pergunta comum: notas 1 e 2;
- NPS: notas 0 a 5 para o gatilho de baixa avaliação;
- classificação estatística NPS: detratores 0–6, neutros 7–8 e promotores 9–10.

O gatilho da Ouvidoria não é confundido com a classificação estatística do NPS. O backend não cria manifestações automaticamente nem torna obrigatória a associação com uma sessão pública; manifestações voluntárias e anônimas continuam permitidas. A abertura automática do modal permanece responsabilidade do frontend e não foi alterada.

## Integridade de migrations

O hash esperado da migration `0000` corresponde ao conteúdo versionado em Git com LF. No Windows, `core.autocrlf=true` materializa o mesmo arquivo com CRLF, causando hash diferente embora o conteúdo SQL seja idêntico.

O teste agora normaliza somente `CRLF` para `LF` antes do hash. Não houve substituição arbitrária do hash, alteração da migration histórica ou enfraquecimento contra alterações reais de conteúdo.

## Contratos e limitações

Os contratos existentes de submissão, Ouvidoria, Analytics e TV Wall foram preservados. A única configuração nova é `RATE_LIMIT_TV_WALL_PER_IP`, com valor padrão seguro.

Testes PostgreSQL e Redis reais dependem de um ambiente descartável local explicitamente configurado. A ausência desses serviços não autoriza conexão com Supabase de produção.
