const id = { type: "integer", minimum: 1, maximum: 2147483647 };
const filters = [
  ...["from", "to"].map(name => ({ in: "query", name, required: true, schema: { type: "string", format: "date-time" } })),
  { in: "query", name: "sectorId", schema: id },
  { in: "query", name: "sectorIds", description: "Até 200 IDs separados por vírgula. Exclusivo com sectorId.", schema: { type: "string", example: "1,2" } },
  { in: "query", name: "shiftRangeId", schema: id },
];
const cookie = [{ cookieAuth: [] }];
const authErrors = { "401": { description: "UNAUTHENTICATED" }, "403": { description: "FORBIDDEN ou PASSWORD_CHANGE_REQUIRED" } };
const invalid = { description: "VALIDATION_ERROR" };
const indicators = { type: "string", enum: ["completionRate", "nps", "npsGroups"] };
const settings = {
  type: "object", additionalProperties: false, required: ["indicators", "sectorIds", "periodDays", "refreshSeconds"],
  properties: {
    indicators: { type: "array", items: indicators, uniqueItems: true, maxItems: 3 },
    sectorIds: { type: "array", items: id, uniqueItems: true, maxItems: 200 },
    periodDays: { type: "integer", minimum: 1, maximum: 90 },
    refreshSeconds: { type: "integer", minimum: 30, maximum: 3600 },
  },
};
const configResponse = {
  description: "Configuração efetiva", content: { "application/json": { schema: { type:"object",properties:{data:settings} } } },
};
export const analyticsPaths = {
  "/api/analytics/dashboard": { get: {
    summary: "Indicadores agregados por início da sessão no intervalo [from,to), até 366 dias",
    security: cookie, parameters: filters, responses: {
      "200": { description: "data contém sessions, nps, questions, distribution, shifts, unclassifiedCompleted, daily, dailyAnswers, sectors, ombudsman e metadados. Ouvidoria é visível somente ao superusuário." },
      "400": invalid, ...authErrors,
    },
  } },
  "/api/analytics/global-questions": { get: {
    summary: "Satisfação por identidade e versão de pergunta global",
    security: cookie, parameters: [...filters, { in:"query", name:"questionId", schema:id }],
    responses: { "200": { description: "data é uma lista com questionId, questionVersionId, isNps, text, publishedSectorIds, responses, mean, distribution e sectors." }, "400": invalid, ...authErrors },
  } },
  "/api/tv-wall/config": {
    get: { summary:"Configuração do TV Wall para superusuários", security:cookie, responses:{"200":configResponse,...authErrors} },
    put: { summary:"Substitui a seleção e a ordem do TV Wall", security:cookie,
      parameters:[{in:"header",name:"x-csrf-token",required:true,schema:{type:"string"}}],
      requestBody:{required:true,content:{"application/json":{schema:settings}}},
      responses:{"200":configResponse,"400":{description:"VALIDATION_ERROR ou TV_WALL_SECTOR_INVALID"},...authErrors,"403":{description:"FORBIDDEN, PASSWORD_CHANGE_REQUIRED ou CSRF_INVALID"}},
    },
  },
  "/api/public/tv-wall": { get: {
    summary:"Exibe somente indicadores públicos habilitados e protegidos por limiar amostral",
    responses:{"200":{description:"data contém periodDays, refreshSeconds e indicators (id, value). Valores suprimidos são null. Sem parâmetros ou credenciais."},"400":invalid},
  } },
};
