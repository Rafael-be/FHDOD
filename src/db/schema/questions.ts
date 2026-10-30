import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgEnum, pgTable, text, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { sectors, users } from "./core.js";

/** Phase 2 enums and tables, reconciled with src/db/bootstrap/FHDOD.sql. */
export const questionKind = pgEnum("question_kind", ["sector", "standard"]);
export const questionScope = pgEnum("question_scope", ["sector_only", "all_sectors", "selected_sectors"]);
export const questionAssignmentSource = pgEnum("question_assignment_source", ["global", "selected"]);
export const npsAssignmentSource = pgEnum("nps_assignment_source", ["global", "specific"]);

export const questions = pgTable("questions", {
  id: integer().primaryKey().generatedByDefaultAsIdentity(),
  questionKind: questionKind("question_kind").notNull(),
  scope: questionScope().notNull(),
  sectorId: integer("sector_id").references(() => sectors.id, { onDelete: "restrict" }),
  isNps: boolean("is_nps").notNull().default(false),
  displayOrder: integer("display_order").notNull().default(1),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  check("questions_kind_scope_check", sql`(
    (${table.questionKind} = 'sector' and ${table.sectorId} is not null and ${table.scope} = 'sector_only' and ${table.isNps} = false)
    or (${table.questionKind} = 'standard' and ${table.sectorId} is null and ${table.scope} in ('all_sectors', 'selected_sectors'))
  )`),
  check("questions_order_positive_check", sql`${table.displayOrder} >= 1`),
  index("questions_sector_order_idx").on(table.sectorId, table.displayOrder).where(sql`${table.questionKind} = 'sector' and ${table.deletedAt} is null`),
  index("questions_active_scope_idx").on(table.scope, table.isNps).where(sql`${table.deletedAt} is null`),
  uniqueIndex("questions_active_sector_order_uq").on(table.sectorId, table.displayOrder).where(sql`${table.questionKind} = 'sector' and ${table.deletedAt} is null`),
  uniqueIndex("questions_one_active_global_nps_uq").on(table.isNps).where(sql`${table.isNps} = true and ${table.scope} = 'all_sectors' and ${table.deletedAt} is null`),
]);

export const questionVersions = pgTable("question_versions", {
  id: integer().primaryKey().generatedByDefaultAsIdentity(),
  questionId: integer("question_id").notNull().references(() => questions.id, { onDelete: "restrict" }),
  versionNumber: integer("version_number").notNull(),
  text: text().notNull(),
  isCurrent: boolean("is_current").notNull().default(true),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("question_versions_number_positive_check", sql`${table.versionNumber} >= 1`),
  unique("question_versions_question_version_uq").on(table.questionId, table.versionNumber),
  unique("question_versions_id_question_uq").on(table.id, table.questionId),
  uniqueIndex("question_versions_one_current_uq").on(table.questionId).where(sql`${table.isCurrent} = true`),
  index("question_versions_question_idx").on(table.questionId, table.versionNumber.desc()),
]);

export const questionSectorAssignments = pgTable("question_sector_assignments", {
  id: integer().primaryKey().generatedByDefaultAsIdentity(),
  questionId: integer("question_id").notNull().references(() => questions.id, { onDelete: "restrict" }),
  sectorId: integer("sector_id").notNull().references(() => sectors.id, { onDelete: "restrict" }),
  assignmentSource: questionAssignmentSource("assignment_source").notNull(),
  displayOrder: integer("display_order").notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  assignedByUserId: integer("assigned_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
}, (table) => [
  check("question_sector_assignment_order_check", sql`${table.displayOrder} >= 1`),
  check("question_sector_assignment_dates_check", sql`${table.endedAt} is null or ${table.endedAt} >= ${table.assignedAt}`),
  uniqueIndex("question_sector_assignment_active_question_uq").on(table.questionId, table.sectorId).where(sql`${table.endedAt} is null`),
  uniqueIndex("question_sector_assignment_active_order_uq").on(table.sectorId, table.displayOrder).where(sql`${table.endedAt} is null`),
  index("question_sector_assignments_sector_idx").on(table.sectorId, table.endedAt, table.displayOrder),
]);

export const sectorNpsAssignments = pgTable("sector_nps_assignments", {
  id: integer().primaryKey().generatedByDefaultAsIdentity(),
  sectorId: integer("sector_id").notNull().references(() => sectors.id, { onDelete: "restrict" }),
  questionId: integer("question_id").notNull().references(() => questions.id, { onDelete: "restrict" }),
  assignmentSource: npsAssignmentSource("assignment_source").notNull(),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  assignedByUserId: integer("assigned_by_user_id").references(() => users.id, { onDelete: "restrict" }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
}, (table) => [
  check("sector_nps_assignment_dates_check", sql`${table.endedAt} is null or ${table.endedAt} >= ${table.assignedAt}`),
  uniqueIndex("sector_nps_one_current_per_sector_uq").on(table.sectorId).where(sql`${table.endedAt} is null`),
  index("sector_nps_question_idx").on(table.questionId, table.endedAt),
]);
