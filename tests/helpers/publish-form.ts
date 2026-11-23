import { createHash } from "node:crypto";
import type postgres from "postgres";
import { listEffectiveQuestions } from "../../src/modules/questions/effective-question-resolver.js";

/** Test fixture: performs the explicit publication that session creation no longer performs. */
export async function publishEffectiveForm(sql: postgres.Sql, sectorId: number, actorId: number, addRequiredStandard = false): Promise<number> {
  let effective = await listEffectiveQuestions(sql, sectorId, false);
  if (addRequiredStandard && !effective.some((q) => q.questionKind === "standard" && !q.isNps)) {
    const [q] = await sql<{ id: number }[]>`insert into questions(question_kind,scope,sector_id,is_nps,display_order,created_by_user_id)
      values ('standard','selected_sectors',null,false,99999,${actorId}) returning id`;
    await sql`insert into question_versions(question_id,version_number,text,is_current,created_by_user_id)
      values (${q!.id},1,'Pergunta padrão',true,${actorId})`;
    await sql`insert into question_sector_assignments(question_id,sector_id,assignment_source,display_order,assigned_by_user_id)
      values (${q!.id},${sectorId},'selected',99999,${actorId})`;
    effective = await listEffectiveQuestions(sql, sectorId, false);
  }
  if (effective.filter((q) => q.isNps).length !== 1 || !effective.some((q) => q.questionKind === "standard" && !q.isNps))
    throw new Error("Fixture requires one NPS and one standard question");
  const items = effective.map((q, index) => ({ questionId: q.id, questionVersionId: q.versionId, text: q.text,
    questionKind: q.questionKind, isNps: q.isNps, position: index + 1 }));
  const fingerprint = createHash("sha256").update(JSON.stringify(items)).digest("hex");
  const [latest] = await sql<{ number: number }[]>`select coalesce(max(version_number),0)+1 as number from submission_form_versions where sector_id=${sectorId}`;
  const [version] = await sql<{ id: number }[]>`insert into submission_form_versions(sector_id,version_number,fingerprint,published_at)
    values (${sectorId},${latest!.number},${fingerprint},now()) returning id`;
  for (const item of items) await sql`insert into submission_form_questions(form_version_id,question_id,question_version_id,position,question_kind,is_nps,text)
    values (${version!.id},${item.questionId},${item.questionVersionId},${item.position},${item.questionKind},${item.isNps},${item.text})`;
  await sql`insert into sector_current_forms(sector_id,form_version_id,revision) values (${sectorId},${version!.id},1)
    on conflict (sector_id) do update set form_version_id=excluded.form_version_id,revision=sector_current_forms.revision+1`;
  return version!.id;
}
