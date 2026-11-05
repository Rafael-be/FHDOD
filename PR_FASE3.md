# Fase 3 — planilhas, submissões e integridade de perguntas

## Escopo

- Importação e consulta de planilhas CSV versionadas, incluindo funcionários sem
  cadastro prévio, seleção de turnos e faixas que atravessam meia-noite no
  fuso `America/Sao_Paulo`.
- Sessões anônimas, snapshots imutáveis de perguntas, respostas, reinício e
  controles de concorrência/capability.
- Integração das regras de perguntas padrão, setoriais e NPS: herança global,
  vínculos independentes por setor, ordenação comum e NPS dinâmico por último.
- Proteção de integridade dos vínculos de perguntas pela migration `0006`.

## Migration pendente

`0006_enforce_question_link_integrity` valida os dados existentes e instala
triggers que impedem vínculos comuns para perguntas setoriais/NPS, vínculos NPS
para perguntas não-NPS e reclassificações incompatíveis com histórico. Ela não
remove nem reescreve dados históricos. A aplicação no Supabase requer a janela
e o procedimento descritos em `docs/supabase-phase3-migration-runbook.md`.

## Validação local

Em PostgreSQL 17 descartável (`fhdod_test`) foram aplicados bootstrap e journal
`0000`–`0006` pelo migrador oficial; o ledger foi confirmado com sete entradas.

- `npm run typecheck`
- `npm run build`
- `npm run lint`
- `npm test` com integrações locais habilitadas: 41 suítes e 182 testes
  aprovados; 1 suíte/4 testes de manutenção de retenção permaneceram ignorados
  por não terem as URLs locais específicas dessa rotina.

## Riscos e revisão

- Não houve aplicação de migration nem acesso de escrita ao Supabase.
- O PR deve ser revisado junto com o runbook antes da janela de migration.
- Não realizar merge automático: confirmar backup, ledger, RLS, grants e
  dados de pré-validação conforme o runbook.
