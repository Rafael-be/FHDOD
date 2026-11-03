import "dotenv/config";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { PostgresSubmissionRepository } from "../../src/modules/submissions/submission.repository.js";
import { SubmissionService } from "../../src/modules/submissions/submission.service.js";
import { testDatabaseUrl, usesIsolatedDatabase } from "../helpers/database.js";
import type { Clock } from "../../src/shared/core.js";

const testUrl = testDatabaseUrl();
const describeIntegration = usesIsolatedDatabase(testUrl, process.env.DATABASE_URL) ? describe : describe.skip;

describeIntegration("shift selection", () => {
  it("uses sector, local weekday and the prior weekday for overnight ranges", async () => {
    const sql = postgres(testUrl!, { max: 1 });
    const suffix = randomUUID().slice(0, 8);
    try {
      await sql.begin(async (tx) => {
        const user = await tx<{ id: number }[]>`insert into users (role_id, full_name, email, password_hash, created_at, updated_at) values (1, 'Turnos', ${`shift-${suffix}@test.invalid`}, 'hash', now(), now()) returning id`;
        const sectors = await tx<{ id: number; code: string }[]>`
          insert into sectors (code, name, created_at, updated_at)
          values (${`a-${suffix}`}, 'Setor A', now(), now()), (${`b-${suffix}`}, 'Setor B', now(), now())
          returning id, code
        `;
        await tx`update shift_sheet_versions set is_current = false where is_current = true`;
        const version = await tx<{ id: number }[]>`insert into shift_sheet_versions (version_number, uploaded_by_user_id, uploaded_at, valid_from, is_current) select coalesce(max(version_number), 0) + 1, ${user[0]!.id}, now(), now(), true from shift_sheet_versions returning id`;
        const a = sectors.find((sector) => sector.code === `a-${suffix}`)!;
        const b = sectors.find((sector) => sector.code === `b-${suffix}`)!;
        const ranges = await tx<{ id: number; shiftName: string }[]>`
          insert into sector_shift_ranges (shift_sheet_version_id, sector_id, shift_name, starts_at, ends_at)
          values
            (${version[0]!.id}, ${a.id}, 'Dia', '07:00', '19:00'),
            (${version[0]!.id}, ${a.id}, 'Noite', '19:00', '07:00'),
            (${version[0]!.id}, ${b.id}, 'Outro setor', '07:00', '19:00')
          returning id, shift_name as "shiftName"
        `;
        const day = ranges.find((range) => range.shiftName === 'Dia')!;
        const night = ranges.find((range) => range.shiftName === 'Noite')!;
        const other = ranges.find((range) => range.shiftName === 'Outro setor')!;
        for (const [range, sector, weekday, code] of [
          [day, a, 1, 'A-DIA'], [night, a, 1, 'A-NOITE-1'], [night, a, 1, 'A-NOITE-2'], [other, b, 1, 'B-DIA'], [night, a, 7, 'A-DOMINGO'],
        ] as const) {
          await tx`insert into employee_shift_assignments (shift_sheet_version_id, sector_id, shift_range_id, employee_code, employee_name, day_of_week) values (${version[0]!.id}, ${sector.id}, ${range.id}, ${`${code}-${suffix}`}, 'Profissional', ${weekday})`;
        }
        const question = await tx<{ id: number }[]>`insert into questions (question_kind, scope, sector_id, is_nps, display_order, created_by_user_id, created_at, updated_at) values ('standard', 'selected_sectors', null, true, 2147483647, ${user[0]!.id}, now(), now()) returning id`;
        await tx`insert into question_versions (question_id, version_number, text, is_current, created_by_user_id, created_at) values (${question[0]!.id}, 1, 'NPS', true, ${user[0]!.id}, now())`;
        await tx`insert into sector_nps_assignments (sector_id, question_id, assignment_source, assigned_at, assigned_by_user_id) values (${a.id}, ${question[0]!.id}, 'specific', now(), ${user[0]!.id}), (${b.id}, ${question[0]!.id}, 'specific', now(), ${user[0]!.id})`;
        const repository = new PostgresSubmissionRepository(tx as unknown as postgres.Sql);
        const snapshot = (sectorId: number, dayOfWeek: number, localTime: string) => repository.createSessionSnapshot({ sessionId: randomUUID(), sectorId, dayOfWeek, previousDayOfWeek: dayOfWeek === 1 ? 7 : dayOfWeek - 1, localTime, now: new Date('2026-01-05T12:00:00.000Z') });

        await expect(snapshot(a.id, 1, '06:59')).resolves.toMatchObject({ session: { shiftRangeId: night.id } });
        await expect(snapshot(a.id, 1, '07:00')).resolves.toMatchObject({ session: { shiftRangeId: day.id, shiftSheetVersionId: version[0]!.id } });
        await expect(snapshot(a.id, 1, '18:59')).resolves.toMatchObject({ session: { shiftRangeId: day.id } });
        await expect(snapshot(a.id, 1, '19:00')).resolves.toMatchObject({ session: { shiftRangeId: night.id } });
        await expect(snapshot(a.id, 2, '00:00')).resolves.toMatchObject({ session: { shiftRangeId: night.id } });
        await expect(snapshot(a.id, 2, '06:59')).resolves.toMatchObject({ session: { shiftRangeId: night.id } });
        await expect(snapshot(a.id, 2, '07:00')).rejects.toMatchObject({ code: 'SHIFT_NOT_FOUND' });
        await expect(snapshot(a.id, 1, '08:00')).resolves.toMatchObject({ session: { shiftRangeId: day.id } });
        await expect(snapshot(b.id, 1, '08:00')).resolves.toMatchObject({ session: { shiftRangeId: other.id } });
        await expect(snapshot(b.id, 2, '08:00')).rejects.toMatchObject({ code: 'SHIFT_NOT_FOUND' });
        await expect(snapshot(a.id, 1, '03:00')).resolves.toMatchObject({ session: { shiftRangeId: night.id } });
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("rejects distinct overlapping ranges instead of choosing the first row", async () => {
    const sql = postgres(testUrl!, { max: 1 });
    const suffix = randomUUID().slice(0, 8);
    try {
      await sql.begin(async (tx) => {
        const user = await tx<{ id: number }[]>`insert into users (role_id, full_name, email, password_hash, created_at, updated_at) values (1, 'Ambíguo', ${`ambiguous-${suffix}@test.invalid`}, 'hash', now(), now()) returning id`;
        const sector = await tx<{ id: number }[]>`insert into sectors (code, name, created_at, updated_at) values (${`ambiguous-${suffix}`}, 'Ambíguo', now(), now()) returning id`;
        await tx`update shift_sheet_versions set is_current = false where is_current = true`;
        const version = await tx<{ id: number }[]>`insert into shift_sheet_versions (version_number, uploaded_by_user_id, uploaded_at, valid_from, is_current) select coalesce(max(version_number), 0) + 1, ${user[0]!.id}, now(), now(), true from shift_sheet_versions returning id`;
        const ranges = await tx<{ id: number }[]>`insert into sector_shift_ranges (shift_sheet_version_id, sector_id, shift_name, starts_at, ends_at) values (${version[0]!.id}, ${sector[0]!.id}, 'A', '07:00', '13:00'), (${version[0]!.id}, ${sector[0]!.id}, 'B', '12:00', '19:00') returning id`;
        for (const [index, range] of ranges.entries()) await tx`insert into employee_shift_assignments (shift_sheet_version_id, sector_id, shift_range_id, employee_code, employee_name, day_of_week) values (${version[0]!.id}, ${sector[0]!.id}, ${range.id}, ${`AMB-${suffix}-${index}`}, 'Profissional', 1)`;
        await expect(new PostgresSubmissionRepository(tx as unknown as postgres.Sql).createSessionSnapshot({ sessionId: randomUUID(), sectorId: sector[0]!.id, dayOfWeek: 1, previousDayOfWeek: 7, localTime: '12:30', now: new Date('2026-01-05T12:30:00.000Z') })).rejects.toMatchObject({ code: 'SHIFT_AMBIGUOUS' });
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("does not select a Tuesday overnight shift before Tuesday night", async () => {
    const sql = postgres(testUrl!, { max: 1 });
    const suffix = randomUUID().slice(0, 8);
    try {
      await sql.begin(async (tx) => {
        const user = await tx<{ id: number }[]>`insert into users (role_id, full_name, email, password_hash, created_at, updated_at) values (1, 'Terça', ${`tuesday-${suffix}@test.invalid`}, 'hash', now(), now()) returning id`;
        const sector = await tx<{ id: number }[]>`insert into sectors (code, name, created_at, updated_at) values (${`tuesday-${suffix}`}, 'Setor terça', now(), now()) returning id`;
        await tx`update shift_sheet_versions set is_current = false where is_current = true`;
        const version = await tx<{ id: number }[]>`insert into shift_sheet_versions (version_number, uploaded_by_user_id, uploaded_at, valid_from, is_current) select coalesce(max(version_number), 0) + 1, ${user[0]!.id}, now(), now(), true from shift_sheet_versions returning id`;
        const range = await tx<{ id: number }[]>`insert into sector_shift_ranges (shift_sheet_version_id, sector_id, shift_name, starts_at, ends_at) values (${version[0]!.id}, ${sector[0]!.id}, 'Noite de terça', '19:00', '07:00') returning id`;
        await tx`insert into employee_shift_assignments (shift_sheet_version_id, sector_id, shift_range_id, employee_code, employee_name, day_of_week) values (${version[0]!.id}, ${sector[0]!.id}, ${range[0]!.id}, ${`TUE-${suffix}`}, 'Profissional', 2)`;
        const question = await tx<{ id: number }[]>`insert into questions (question_kind, scope, sector_id, is_nps, display_order, created_by_user_id, created_at, updated_at) values ('standard', 'selected_sectors', null, true, 2147483647, ${user[0]!.id}, now(), now()) returning id`;
        await tx`insert into question_versions (question_id, version_number, text, is_current, created_by_user_id, created_at) values (${question[0]!.id}, 1, 'NPS', true, ${user[0]!.id}, now())`;
        await tx`insert into sector_nps_assignments (sector_id, question_id, assignment_source, assigned_at, assigned_by_user_id) values (${sector[0]!.id}, ${question[0]!.id}, 'specific', now(), ${user[0]!.id})`;

        const startAt = (instant: string) => {
          const clock: Clock = { now: () => new Date(instant) };
          return new SubmissionService(new PostgresSubmissionRepository(tx as unknown as postgres.Sql), clock).startNow(sector[0]!.id);
        };

        await expect(startAt("2026-01-06T03:30:00.000Z")).rejects.toMatchObject({ code: "SHIFT_NOT_FOUND" });
        await expect(startAt("2026-01-06T06:00:00.000Z")).rejects.toMatchObject({ code: "SHIFT_NOT_FOUND" });
        await expect(startAt("2026-01-06T21:59:00.000Z")).rejects.toMatchObject({ code: "SHIFT_NOT_FOUND" });
        await expect(startAt("2026-01-06T22:00:00.000Z")).resolves.toMatchObject({ session: { shiftRangeId: range[0]!.id } });
        await expect(startAt("2026-01-07T02:59:00.000Z")).resolves.toMatchObject({ session: { shiftRangeId: range[0]!.id } });
        await expect(startAt("2026-01-07T03:00:00.000Z")).resolves.toMatchObject({ session: { shiftRangeId: range[0]!.id } });
        await expect(startAt("2026-01-07T09:59:00.000Z")).resolves.toMatchObject({ session: { shiftRangeId: range[0]!.id } });
        await expect(startAt("2026-01-07T10:00:00.000Z")).rejects.toMatchObject({ code: "SHIFT_NOT_FOUND" });
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
