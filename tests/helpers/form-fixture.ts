import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { publishEffectiveForm } from "./publish-form.js";
import { assertDisposableTestDatabase } from "./database.js";

/** Self-contained identities and publications; no dependency on database sequence values. */
export async function createFormFixture(url: string, runtime: string) {
  await assertDisposableTestDatabase(url,runtime);
  const connection=postgres(url,{max:1});
  let ownSheetId: number | undefined;
  const questions: number[]=[]; const sectors: number[]=[]; const users: number[]=[]; const ranges: number[]=[];
  try { return await connection.begin(async transaction => {
    const sql=transaction as unknown as postgres.Sql;
    for (const role of ['superuser','sector_manager']) {
      const [u]=await sql<{id:number}[]>`insert into users(role_id,full_name,email,password_hash) select id,'Form fixture',${randomUUID()+'@test.invalid'},'not-a-login-hash' from roles where code=${role} returning id`;
      users.push(u!.id);
    }
    for (const name of ['Own','Other']) {
      const [s]=await sql<{id:number}[]>`insert into sectors(code,name) values (${randomUUID()},${name+' fixture'}) returning id`;sectors.push(s!.id);
    }
    const adminId=users[0]!,managerId=users[1]!,sectorId=sectors[0]!,otherSectorId=sectors[1]!;
    await sql`insert into user_sector_assignments(user_id,sector_id,assigned_by_user_id) values (${managerId},${sectorId},${adminId})`;
    async function question(kind:'sector'|'standard',sector:number|null,nps:boolean,scope:string,text:string,order:number){
      const [q]=await sql<{id:number}[]>`insert into questions(question_kind,scope,sector_id,is_nps,display_order,created_by_user_id)
        values (${kind},${scope},${sector},${nps},${order},${adminId}) returning id`;
      questions.push(q!.id);
      await sql`insert into question_versions(question_id,version_number,text,is_current,created_by_user_id) values (${q!.id},1,${text},true,${adminId})`;
      return q!.id;
    }
    const ownQuestionId=await question('sector',sectorId,false,'sector_only','Own fixture',1);
    const foreignQuestionId=await question('sector',otherSectorId,false,'sector_only','Other fixture',1);
    const globalQuestionId=await question('standard',null,false,'all_sectors','Global fixture',2);
    for(const s of sectors){
      await sql`insert into question_sector_assignments(question_id,sector_id,assignment_source,display_order,assigned_by_user_id) values (${globalQuestionId},${s},'global',2,${adminId})`;
      const nps=await question('standard',null,true,'selected_sectors','NPS fixture',2147483647);
      await sql`insert into sector_nps_assignments(question_id,sector_id,assignment_source,assigned_by_user_id) values (${nps},${s},'specific',${adminId})`;
    }
    let [sheet]=await sql<{id:number}[]>`select id from shift_sheet_versions where is_current`;
    if(!sheet) { [sheet]=await sql<{id:number}[]>`insert into shift_sheet_versions(version_number,uploaded_at,valid_from,is_current,csv_format)
      select coalesce(max(version_number),0)+1,now(),now(),true,1 from shift_sheet_versions returning id`; ownSheetId=sheet!.id; }
    for(const s of sectors){const [r]=await sql<{id:number}[]>`insert into sector_shift_ranges(shift_sheet_version_id,sector_id,shift_name,starts_at,ends_at,day_of_week)
      values (${sheet!.id},${s},'Fixture','08:00','17:00',1) returning id`;ranges.push(r!.id);}
    await publishEffectiveForm(sql,sectorId,adminId);
    await publishEffectiveForm(sql,otherSectorId,adminId);
    return {adminId,managerId,sectorId,otherSectorId,ownQuestionId,foreignQuestionId,globalQuestionId,
      async cleanup(){const db=postgres(url,{max:1});try{
        await db`delete from submission_form_answers where session_id in (select id from submission_sessions where sector_id=any(${sectors}::int[]))`;
        await db`delete from submission_sessions where sector_id=any(${sectors}::int[])`;
        await db`delete from submission_form_drafts where sector_id=any(${sectors}::int[])`;
        await db`delete from sector_current_forms where sector_id=any(${sectors}::int[])`;
        await db`delete from submission_form_questions where form_version_id in (select id from submission_form_versions where sector_id=any(${sectors}::int[]))`;
        await db`delete from submission_form_versions where sector_id=any(${sectors}::int[])`;
        await db`delete from sector_nps_assignments where sector_id=any(${sectors}::int[])`;
        await db`delete from question_sector_assignments where sector_id=any(${sectors}::int[])`;
        await db`delete from question_versions where question_id=any(${questions}::int[])`;
        await db`delete from questions where id=any(${questions}::int[])`;
        await db`delete from sector_shift_ranges where id=any(${ranges}::int[])`;
        if(ownSheetId !== undefined) await db`delete from shift_sheet_versions where id=${ownSheetId}`;
        await db`delete from user_sector_assignments where user_id=any(${users}::int[])`;
        await db`delete from sectors where id=any(${sectors}::int[])`;
        await db`delete from users where id=any(${users}::int[])`;
      }finally{await db.end({timeout:5});}}
    };
  }); } finally {await connection.end({timeout:5});}
}
