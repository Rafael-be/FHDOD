# Fase 3 — status de implementação

## Validado

- Parser CSV UTF-8 com BOM e separador `;`.
- Horários que atravessam meia-noite, buracos, sobreposições e horários iguais rejeitados.
- Upload versionado, rollback e download da versão vigente.
- Registro de tentativas de upload sem persistir o CSV original.
- Sessões anônimas com snapshot de perguntas e versões históricas.
- Respostas, pulos, sobrescrita, conclusão e grupos dirty.
- Timeout, reinício, reconciliação de sessões e capability efêmera.
- Rate limiting das rotas públicas.
- Testes unitários, HTTP e PostgreSQL local.

## Limitações conhecidas

- O rate limiting é local ao processo; múltiplas réplicas exigem armazenamento compartilhado.
- A suíte de integração depende de `DATABASE_URL_TEST` isolada.
- O layout de atribuições de funcionários continua provisório conforme a especificação.
- Dashboards não são calculados nesta fase.
- O frontend do totem não faz parte deste backend.

## Regra de NPS

Sessões públicas exigem exatamente um NPS efetivo por setor. Configuração ausente ou ambígua retorna `409 NPS_CONFIGURATION_CONFLICT`.
