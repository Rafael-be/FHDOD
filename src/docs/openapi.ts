export const openapiDocument = {
  openapi: "3.0.3", info: { title: "FHDOD API", version: "0.1.0", description: "Endpoints implementados na Fase 1." },
  components: { schemas: { ErrorEnvelope: { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string", example: "VALIDATION_ERROR" }, message: { type: "string", example: "Dados de entrada inválidos." } } } } } } },
  paths: {
    "/health": { get: { summary: "Verifica disponibilidade do processo", responses: { "200": { description: "API disponível" } } } },
    "/health/ready": { get: { summary: "Verifica disponibilidade do banco", responses: { "200": { description: "API e banco disponíveis" }, "503": { description: "Banco indisponível" } } } },
    "/api/auth/login": { post: { summary: "Inicia uma sessão", requestBody: { required: true }, responses: { "200": { description: "Sessão iniciada" }, "401": { description: "Credenciais inválidas" } } } },
    "/api/auth/refresh": { post: { summary: "Rotaciona o refresh token", responses: { "200": { description: "Tokens renovados" }, "409": { description: "Conflito de renovação" } } } },
    "/api/auth/csrf": { get: { summary: "Recupera token CSRF da sessão", responses: { "200": { description: "Token CSRF" } } } },
    "/api/auth/change-temporary-password": { post: { summary: "Troca a senha temporária e revoga as sessões", responses: { "204": { description: "Senha trocada" }, "403": { description: "Senha temporária inválida ou CSRF inválido" } } } },
    "/api/managers": { get: { summary: "Lista gestores", responses: { "200": { description: "Lista de gestores" }, "403": { description: "Somente superusuário" } } }, post: { summary: "Cria gestor com senha temporária", responses: { "201": { description: "Gestor criado" }, "409": { description: "E-mail já reservado" } } } },
    "/api/managers/{id}": { get: { summary: "Consulta gestor e seus vínculos ativos", responses: { "200": { description: "Gestor e setores vinculados" }, "404": { description: "Gestor não encontrado" } } }, patch: { summary: "Edita gestor", responses: { "200": { description: "Gestor editado" }, "409": { description: "E-mail já reservado" } } } },
    "/api/sectors": { get: { summary: "Lista setores autorizados", responses: { "200": { description: "Lista de setores" } } }, post: { summary: "Cria setor", responses: { "201": { description: "Setor criado em preparação" } } } },
    "/api/sectors/{id}": { patch: { summary: "Renomeia setor (código imutável)", responses: { "200": { description: "Setor editado" } } } },
    "/api/audit-logs": { get: { summary: "Consulta auditoria com cursor", responses: { "200": { description: "Registros de auditoria" }, "403": { description: "Somente superusuário" } } } },
    "/api/pages/{slug}": { get: { summary: "Obtém a versão pública vigente de uma página", responses: { "200": { description: "Conteúdo publicado" }, "404": { description: "Conteúdo indisponível" } } }, put: { summary: "Publica nova versão imutável da página", responses: { "200": { description: "Versão publicada" }, "403": { description: "Somente superusuário; requer CSRF" } } } },
  },
};
