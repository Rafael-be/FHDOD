import type postgres from "postgres";
import { logPerformanceMeasurement } from "../../shared/logger.js";
import { measurePerformance } from "../../shared/performance.js";

export interface PublishedQuestion {
  questionId: number;
  questionVersionId: number;
  text: string;
  questionKind: "sector" | "standard";
  isNps: boolean;
  position: number;
}

export class PublishedFormCache {
  private readonly forms = new Map<number, Promise<PublishedQuestion[]>>();
  private trace = false;

  setTracing(enabled: boolean): void { this.trace = enabled; }

  async get(sql: postgres.Sql, versionId: number): Promise<PublishedQuestion[]> {
    let pending = this.forms.get(versionId);
    if (this.trace) logPerformanceMeasurement("submission.form_cache", pending ? "hit" : "miss", 0);
    if (!pending) {
      pending = measurePerformance(this.trace, "submission.form_cache", "load", () => sql<PublishedQuestion[]>`
        select question_id as "questionId", question_version_id as "questionVersionId",
          text, question_kind as "questionKind", is_nps as "isNps", position
        from submission_form_questions where form_version_id = ${versionId} order by position`);
      this.forms.set(versionId, pending);
      // Bound memory without invalidating an active version's persisted source of truth.
      if (this.forms.size > 128) this.forms.delete(this.forms.keys().next().value!);
      void pending.catch(() => { if (this.forms.get(versionId) === pending) this.forms.delete(versionId); });
    }
    return pending;
  }

  put(versionId: number, questions: PublishedQuestion[]): void {
    this.forms.set(versionId, Promise.resolve(questions));
    if (this.forms.size > 128) this.forms.delete(this.forms.keys().next().value!);
  }
}

export const publishedFormCache = new PublishedFormCache();
