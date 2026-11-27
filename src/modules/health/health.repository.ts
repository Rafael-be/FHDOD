import type postgres from "postgres";
import { DomainError } from "../../shared/core.js";

/** Checks capabilities required by runtime without administrative ledger access or DDL. */
export class HealthRepository {
  constructor(private readonly sql: postgres.Sql) {}
  async isAvailable(): Promise<boolean> {
    const rows = await this.sql<{ object: string }[]>`
      select required.object from unnest(array[
        'public.submission_form_versions','public.submission_form_questions','public.submission_form_answers',
        'public.submission_form_drafts','public.submission_form_draft_questions','public.sector_current_forms',
        'public.sector_shift_days','public.tv_wall_configuration'
      ]) as required(object) where to_regclass(required.object) is null
      union all
      select 'public.submission_sessions.capability_hash' where not exists (
        select 1 from information_schema.columns where table_schema='public' and table_name='submission_sessions' and column_name='capability_hash'
      )
      union all
      select required.name from unnest(array['fhdod_api_legacy_questions_select','fhdod_api_legacy_answers_select']) as required(name)
      where not exists(select 1 from pg_policies where schemaname='public' and policyname=required.name)`;
    if (rows.length) throw new DomainError('DATABASE_SCHEMA_NOT_READY',
      'Schema PostgreSQL incompleto. Confira o banco configurado e aplique as migrations pelo comando oficial antes de iniciar a API.',503,
      { missingObjects: rows.map(row=>row.object) });
    const [access] = await this.sql<{ allowed: boolean }[]>`select has_table_privilege(current_user,'public.sector_current_forms','SELECT')
      and has_table_privilege(current_user,'public.submission_form_drafts','SELECT')
      and has_table_privilege(current_user,'public.submission_form_drafts','INSERT')
      and has_table_privilege(current_user,'public.submission_form_drafts','UPDATE')
      and has_table_privilege(current_user,'public.submission_form_drafts','DELETE')
      and has_table_privilege(current_user,'public.submission_session_questions','SELECT')
      and has_column_privilege(current_user,'public.tv_wall_configuration','settings','UPDATE')
      and has_table_privilege(current_user,'public.tv_wall_configuration','SELECT')
      and has_table_privilege(current_user,'public.submission_answers','SELECT') as allowed`;
    if (!access?.allowed) throw new DomainError('DATABASE_SCHEMA_NOT_READY','Permissões de runtime incompletas. Confira bootstrap e migrations do banco configurado.',503);
    return true;
  }
}
