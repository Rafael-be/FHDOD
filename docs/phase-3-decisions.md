# Fase 3 — decisões de integração

## NPS efetivo por setor

Uma sessão pública só é criada quando o setor possui exatamente um NPS efetivo no instante da primeira interação. Zero NPS ou mais de um NPS resulta em `409 NPS_CONFIGURATION_CONFLICT`.

Essa política mantém o conflito global/específico explícito e impede que a API escolha silenciosamente qual pergunta usar. A correção deve ser feita na configuração administrativa antes de liberar novas sessões do setor.
