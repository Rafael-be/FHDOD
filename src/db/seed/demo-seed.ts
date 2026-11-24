import postgres from "postgres";
import { PostgresShiftSheetRepository } from "../../modules/shifts/shift-sheet.repository.js";
import { parseShiftSheet } from "../../modules/shifts/shift-sheet.parser.js";
import argon2 from "argon2";
import { createHash } from "node:crypto";
import { SubmissionService } from "../../modules/submissions/submission.service.js";
import { PostgresSubmissionRepository } from "../../modules/submissions/submission.repository.js";

// This entrypoint never loads .env or falls back to a remote connection.
const target = process.env.LOCAL_DEMO_DATABASE_URL;
if (!target) throw new Error("Informe LOCAL_DEMO_DATABASE_URL explicitamente.");
const destination = new URL(target);
if (!["localhost", "127.0.0.1", "[::1]"].includes(destination.hostname) || destination.pathname !== "/fhdod_test")
  throw new Error("O seed exige fhdod_test em loopback.");
const adminPassword = process.env.DEMO_ADMIN_PASSWORD, managerPassword = process.env.DEMO_MANAGER_PASSWORD;
if (!adminPassword || !managerPassword || adminPassword.length < 12 || managerPassword.length < 12)
  throw new Error("Informe DEMO_ADMIN_PASSWORD e DEMO_MANAGER_PASSWORD com pelo menos 12 caracteres.");
const sql = postgres(target, { max: 1 });
try {
  const [state] = await sql<{ marker: string; migrations: number }[]>`select current_setting('fhdod.disposable',true) marker,(select count(*)::int from drizzle.__drizzle_migrations) migrations`;
  if (state?.marker !== 'true' || state.migrations !== 18) throw new Error("Banco sem marcador descartável ou migrations incompletas.");
  await sql.begin(async tx => {
    const db = tx as unknown as postgres.Sql;
    await db`select pg_advisory_xact_lock(912099,1)`;
    const existing = await db`select id from sectors where code='demo-fhdod'`;
    if (existing.length) { console.log('Fixture demo já existe; nenhum dado foi alterado.'); return; }
    if ((await db`select id from users where email in ('ouvidoria@gmail.com','gestor@gmail.com')`).length)
      throw new Error('E-mails já existem sem fixture demo; não serão sobrescritos.');
    const [admin] = await db<{ id: number }[]>`insert into users(role_id,full_name,email,password_hash,must_change_password)
      select id,'Administrador fictício','ouvidoria@gmail.com',${await argon2.hash(adminPassword)},false from roles where code='superuser' returning id`;
    const [manager] = await db<{ id: number }[]>`insert into users(role_id,full_name,email,password_hash,must_change_password)
      select id,'Gestor fictício','gestor@gmail.com',${await argon2.hash(managerPassword)},false from roles where code='sector_manager' returning id`;
    const [sector] = await db<{ id: number }[]>`insert into sectors(code,name) values ('demo-fhdod','Setor fictício de demonstração') returning id`;
    const [other] = await db<{ id: number }[]>`insert into sectors(code,name) values ('demo-fhdod-other','Outro setor fictício') returning id`;
    await db`insert into user_sector_assignments(user_id,sector_id,assigned_by_user_id) values (${manager!.id},${sector!.id},${admin!.id})`;
    const items = [];
    for (const nps of [false, true]) {
      const [q] = await db<{ id: number }[]>`insert into questions(question_kind,scope,is_nps,display_order,created_by_user_id)
        values ('standard','selected_sectors',${nps},${nps ? 2 : 1},${admin!.id}) returning id`;
      const text = nps ? 'Qual a chance de recomendar este setor fictício?' : 'Como avalia o atendimento fictício?';
      const [v] = await db<{ id: number }[]>`insert into question_versions(question_id,version_number,text,is_current,created_by_user_id)
        values (${q!.id},1,${text},true,${admin!.id}) returning id`;
      if (nps) await db`insert into sector_nps_assignments(sector_id,question_id,assignment_source,assigned_by_user_id) values (${sector!.id},${q!.id},'specific',${admin!.id})`;
      else await db`insert into question_sector_assignments(question_id,sector_id,assignment_source,display_order,assigned_by_user_id) values (${q!.id},${sector!.id},'selected',1,${admin!.id})`;
      items.push({ questionId:q!.id,questionVersionId:v!.id,text,questionKind:'standard',isNps:nps,position:items.length+1 });
    }
    const [form] = await db<{ id: number }[]>`insert into submission_form_versions(sector_id,version_number,fingerprint)
      values (${sector!.id},1,${createHash('sha256').update(JSON.stringify(items)).digest('hex')}) returning id`;
    for (const q of items) await db`insert into submission_form_questions(form_version_id,question_id,question_version_id,text,question_kind,is_nps,position)
      values (${form!.id},${q.questionId},${q.questionVersionId},${q.text},'standard',${q.isNps},${q.position})`;
    await db`insert into sector_current_forms(sector_id,form_version_id) values (${sector!.id},${form!.id})`;
    const csv = ['\ufeffcodigo_setor;nome_setor;nome_turno;hora_inicio;hora_fim;dia_semana_iso'];
    for (let day=1;day<=7;day++) {
      csv.push(`demo-fhdod;Setor fictício de demonstração;SEM_TURNO;08:00;17:00;${day}`);
      csv.push(`demo-fhdod-other;Outro setor fictício;FECHADO;00:00;00:00;${day}`);
    }
    const parsed = parseShiftSheet(new TextEncoder().encode(csv.join('\r\n')+'\r\n'));
    if (parsed.issues.length) throw new Error('CSV demo inválido.');
    await new PostgresShiftSheetRepository(db).replaceCurrentSheet(parsed.rows,new Date());
    const [page] = await db<{id:number}[]>`insert into content_pages(slug,title) values ('lgpd','Política fictícia local') returning id`;
    const [policy] = await db<{id:number}[]>`insert into content_page_versions(page_id,version_number,content,is_current,created_by_user_id)
      values (${page!.id},1,'Conteúdo exclusivamente fictício para demonstração local.',true,${admin!.id}) returning id`;
    for (const type of ['complaint','compliment']) await db`insert into ombudsman_tickets(sector_id,ticket_type,body,accepted_policy_version_id,policy_accepted_at)
      values (${sector!.id},${type},'Manifestação fictícia local.',${policy!.id},now())`;
    const service = new SubmissionService(new PostgresSubmissionRepository(db), { now: () => new Date() });
    for (const score of [10, 9, 8, 5]) {
      const started = await service.startNow(sector!.id);
      for (const q of started.questions) await service.answer(started.capability.sessionId,started.capability.token,
        { questionId:q.questionId,questionVersionId:q.questionVersionId,status:'answered',score:q.isNps ? score : 4 });
    }
    console.log(JSON.stringify({ sectorId:sector!.id,otherSectorId:other!.id,formVersionId:form!.id,expectedDemoNps:25,sessions:4,answers:8 }));
  });
} finally { await sql.end({ timeout: 5 }); }
