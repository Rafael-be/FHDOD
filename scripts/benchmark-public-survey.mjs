import { config } from "dotenv";
import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import postgres from "postgres";
import { SubmissionService } from "../dist/modules/submissions/submission.service.js";
import { PostgresSubmissionRepository } from "../dist/modules/submissions/submission.repository.js";

config({ path: ".env.development.local", override: true, quiet: true });
const adminUrl = new URL(process.env.LOCAL_DATABASE_URL ?? "");
const runtimeUrl = new URL(process.env.DATABASE_URL ?? "");
if (adminUrl.hostname !== "127.0.0.1" || runtimeUrl.hostname !== "127.0.0.1" ||
    adminUrl.port !== runtimeUrl.port || adminUrl.pathname !== "/fhdod_test" ||
    runtimeUrl.pathname !== "/fhdod_test" || runtimeUrl.username !== "fhdod_api")
  throw new Error("Benchmark permitido apenas no banco descartável local fhdod_test.");

const sql = postgres(adminUrl.toString(), { max: 1 });
const rollback = Symbol("rollback");
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (percentile) => Number(sorted[Math.ceil(sorted.length * percentile) - 1].toFixed(2));
  return { samples: values.length, meanMs: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)), p50Ms: pick(0.5), p95Ms: pick(0.95) };
}

try {
  const [marker] = await sql`select current_setting('fhdod.disposable', true) as value`;
  if (marker?.value !== "true") throw new Error("Banco sem marcador descartável.");
  try {
    await sql.begin(async (tx) => {
      const [sector] = await tx`select s.id from sectors s join sector_current_forms c on c.sector_id=s.id
        where s.deleted_at is null and c.form_version_id is not null order by s.id limit 1`;
      if (!sector) throw new Error("Nenhum setor publicado disponível para benchmark.");
      const service = new SubmissionService(new PostgresSubmissionRepository(tx), { now: () => new Date() });
      const measurements = { currentForm: [], legacyStart: [], firstAnswer: [], nextAnswer: [] };
      for (let iteration = 0; iteration < 21; iteration++) {
        let start = performance.now();
        const form = await service.currentForm(sector.id);
        if (iteration) measurements.currentForm.push(performance.now() - start);
        start = performance.now();
        await service.startNow(sector.id);
        if (iteration) measurements.legacyStart.push(performance.now() - start);
        const question = form.questions[0];
        const answer = { questionId: question.questionId, questionVersionId: question.questionVersionId,
          status: question.questionKind === "sector" ? "skipped" : "answered", score: question.questionKind === "sector" ? null : 5 };
        start = performance.now();
        const attemptId = randomUUID();
        const capability = randomBytes(32).toString("base64url");
        await service.startWithFirstAnswer(sector.id, form.formVersionId, attemptId, capability, answer);
        if (iteration) measurements.firstAnswer.push(performance.now() - start);
        const next = form.questions[1];
        if (next) {
          start = performance.now();
          await service.answer(attemptId, capability, { questionId: next.questionId, questionVersionId: next.questionVersionId,
            status: next.questionKind === "sector" ? "skipped" : "answered", score: next.questionKind === "sector" ? null : 5 });
          if (iteration) measurements.nextAnswer.push(performance.now() - start);
        }
      }
      process.stdout.write(JSON.stringify({ operation: "local_public_survey_service_benchmark", source: "disposable_postgres", warmup: 1,
        currentForm: summary(measurements.currentForm), legacyStart: summary(measurements.legacyStart), firstAnswer: summary(measurements.firstAnswer), nextAnswer: summary(measurements.nextAnswer) }) + "\n");
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
} finally { await sql.end({ timeout: 5 }); }
