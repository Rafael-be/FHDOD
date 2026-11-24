# Auditoria local parcial — publicação, CSV, permissões e Redis

## Rotas e permissões

Inventário obtido de `src/modules/**/**.routes.ts`. Rotas públicas: início, resposta, reinício, refresh e close de submissões; criação de ticket da Ouvidoria; leitura de página publicada; health. Rotas autenticadas: autenticação, setores, perguntas, rascunhos, versões, planilhas, auditoria e gestão da Ouvidoria. Escritas administrativas exigem sessão e CSRF. Publicação, restauração e edição de rascunho exigem superusuário ou gestor vinculado ao setor; importação de horários exige superusuário.

| Método | Endpoint | Perfil | Esperado | Observado em teste HTTP local | Latência |
|---|---|---|---:|---:|---|
| GET | `/api/questions?sectorId=2` | Gestor vinculado | 200 | 200 | 20 amostras: mediana 4,14 ms; p95 6,39 ms; 3 queries |
| GET | `/api/questions?sectorId=3` | Gestor sem vínculo | 403 | 403 | 20 amostras: mediana 2,85 ms; p95 4,62 ms; 1 query |
| GET | `/api/sectors/2/questions` | Gestor vinculado | 200 | 200 | 20 amostras: mediana 3,33 ms; p95 8,38 ms; 2 queries |
| GET | `/api/sectors/2/form-draft` | Gestor vinculado | 200 | 200 | 20 amostras: mediana 6,13 ms; p95 8,61 ms; 12 queries |
| GET | `/api/sectors/2/form-versions` | Gestor vinculado | 200 | 200 | 20 amostras: mediana 3,57 ms; p95 4,62 ms; 4 queries |
| PUT | `/api/sectors/2/form-draft` sem CSRF | Gestor vinculado | 403 | 403 | Não medida |
| POST | `/api/sectors/2/form-draft/publish` sem rascunho | Gestor vinculado | 409 | 409 | Não medida |
| POST | `/api/sectors/2/questions` | Gestor vinculado | 409 | 409 | Não medida |
| POST | `/api/shift-sheets` com CSV inválido | Superusuário simulado | 400 | 400 | Não medida |

As cinco rotas de leitura foram medidas por HTTP local com `supertest`, identidade de gestor simulada e PostgreSQL temporário. A autenticação real por cookie e sua latência não fazem parte dessas medidas. Os demais status são de testes automatizados, sem amostras de latência. Não havia credenciais de teste seguras disponíveis para percorrer todas as rotas com perfis reais. O rascunho executa 12 queries por leitura; é um candidato a otimização somente se a latência do editor for demonstrada como problema no ambiente alvo.

## CSV de horários

Arquivo de teste: 80 linhas de dados, 4 setores, 3.865 bytes. Em `fhdod_test`, os setores extras foram desativados dentro de transação revertida. O fluxo persistiu temporariamente 28 registros de dias e 78 faixas, também revertidos. Antes do lote SQL: 114 queries, parser 1,29 ms, validação 6,71 ms, importação 42,60 ms. Depois: 10 queries, parser 2,29 ms, validação 6,65 ms, importação 15,45 ms. Ganho local medido da importação: 63,7%. Os 40 segundos observados no ambiente externo não foram reproduzidos. A redução de round trips provavelmente terá impacto maior quando a latência de rede for alta, mas isso ainda não foi medido remotamente.

## Redis

O código usa `fhdod:cache:v1:questions:effective:sector:{id}:v{versão}` com TTL padrão de 60 s e versão global para invalidar. O cache de formulários publicados permanece em memória, indexado por versão imutável. A segurança usa chaves HMAC `fhdod:security:v1:{escopo}:{digest}`, TTL por janela e fallback local limitado a 10.000 contadores. O cliente Redis usa timeout de conexão de 1 s, até três tentativas de reconexão e fila offline desabilitada.

Neste ambiente, `REDIS_URL` aponta para `127.0.0.1:6379`, sem autenticação na URL; `CACHE_ENABLED` não estava definido (padrão desabilitado) e `SECURITY_REDIS_ENABLED` não estava definido (padrão habilitado). Não havia `redis-server` ativo nem `redis-cli`; memória utilizada, `maxmemory`, política de eviction e persistência não puderam ser medidas. O código não define um limite de memória do Redis. Para o cache de formulários, manter o cache local por versão é suficiente enquanto a referência vigente é lida no PostgreSQL a cada sessão; migrá-lo para Redis adicionaria uma dependência sem ganho medido. Uma futura avaliação de metadados de setores exigiria medição de consultas e estratégia de invalidação por alteração administrativa antes da implementação.
