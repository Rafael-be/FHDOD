import { pgTable, unique, pgPolicy, integer, text, timestamp, index, uniqueIndex, foreignKey, check, boolean, uuid, varchar, time, date, smallint, jsonb, primaryKey, bigint, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const answerStatus = pgEnum("answer_status", ['answered', 'skipped'])
export const dashboardSummaryType = pgEnum("dashboard_summary_type", ['answers', 'sessions', 'ombudsman'])
export const npsAssignmentSource = pgEnum("nps_assignment_source", ['global', 'specific'])
export const ombudsmanTicketStatus = pgEnum("ombudsman_ticket_status", ['open', 'in_contact_attempt', 'resolved', 'unresolved', 'read'])
export const ombudsmanTicketType = pgEnum("ombudsman_ticket_type", ['complaint', 'compliment', 'suggestion_other'])
export const questionAssignmentSource = pgEnum("question_assignment_source", ['global', 'selected'])
export const questionKind = pgEnum("question_kind", ['sector', 'standard'])
export const questionScope = pgEnum("question_scope", ['sector_only', 'all_sectors', 'selected_sectors'])
export const shiftUploadResult = pgEnum("shift_upload_result", ['accepted', 'rejected'])
export const submissionStatus = pgEnum("submission_status", ['incomplete', 'complete'])


export const roles = pgTable("roles", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "roles_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	code: text().notNull(),
	name: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("roles_code_key").on(table.code),
	pgPolicy("fhdod_api_roles_select", { as: "permissive", for: "select", to: ["fhdod_api"], using: sql`true` }),
]);

export const permissions = pgTable("permissions", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "permissions_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	code: text().notNull(),
	description: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("permissions_code_key").on(table.code),
]);

export const users = pgTable("users", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "users_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	roleId: integer("role_id").notNull(),
	fullName: text("full_name").notNull(),
	email: text().notNull(),
	passwordHash: text("password_hash").notNull(),
	mustChangePassword: boolean("must_change_password").default(false).notNull(),
	temporaryPasswordExpiresAt: timestamp("temporary_password_expires_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("users_deleted_at_idx").using("btree", table.deletedAt.asc().nullsLast().op("timestamptz_ops")),
	uniqueIndex("users_email_case_insensitive_uq").using("btree", sql`lower(btrim(email))`),
	index("users_role_id_idx").using("btree", table.roleId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.roleId],
			foreignColumns: [roles.id],
			name: "users_role_id_fkey"
		}).onDelete("restrict"),
	pgPolicy("fhdod_api_users_update", { as: "permissive", for: "update", to: ["fhdod_api"], using: sql`true`, withCheck: sql`true`  }),
	pgPolicy("fhdod_api_users_insert", { as: "permissive", for: "insert", to: ["fhdod_api"] }),
	pgPolicy("fhdod_api_users_select", { as: "permissive", for: "select", to: ["fhdod_api"] }),
	check("users_temporary_password_expiry_check", sql`must_change_password OR (temporary_password_expires_at IS NULL)`),
]);

export const authSessions = pgTable("auth_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	csrfToken: text("csrf_token").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: 'string' }),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("auth_sessions_active_expiry_idx").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(revoked_at IS NULL)`),
	uniqueIndex("auth_sessions_one_unrevoked_per_user_uq").using("btree", table.userId.asc().nullsLast().op("int4_ops")).where(sql`(revoked_at IS NULL)`),
	index("auth_sessions_user_id_idx").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "auth_sessions_user_id_fkey"
		}).onDelete("restrict"),
	pgPolicy("fhdod_api_auth_sessions_update", { as: "permissive", for: "update", to: ["fhdod_api"], using: sql`true`, withCheck: sql`true`  }),
	pgPolicy("fhdod_api_auth_sessions_insert", { as: "permissive", for: "insert", to: ["fhdod_api"] }),
	pgPolicy("fhdod_api_auth_sessions_select", { as: "permissive", for: "select", to: ["fhdod_api"] }),
	check("auth_sessions_expiry_check", sql`expires_at > created_at`),
	check("auth_sessions_csrf_token_length_check", sql`length(csrf_token) >= 32`),
]);

export const authRefreshTokens = pgTable("auth_refresh_tokens", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sessionId: uuid("session_id").notNull(),
	tokenHash: text("token_hash").notNull(),
	issuedAt: timestamp("issued_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	consumedAt: timestamp("consumed_at", { withTimezone: true, mode: 'string' }),
	replacedByTokenId: uuid("replaced_by_token_id"),
}, (table) => [
	uniqueIndex("auth_refresh_tokens_one_unconsumed_per_session_uq").using("btree", table.sessionId.asc().nullsLast().op("uuid_ops")).where(sql`(consumed_at IS NULL)`),
	index("auth_refresh_tokens_session_issued_idx").using("btree", table.sessionId.asc().nullsLast().op("uuid_ops"), table.issuedAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [authSessions.id],
			name: "auth_refresh_tokens_session_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.sessionId, table.replacedByTokenId],
			foreignColumns: [table.id, table.sessionId],
			name: "auth_refresh_tokens_replacement_same_session_fk"
		}).onDelete("restrict"),
	unique("auth_refresh_tokens_id_session_uq").on(table.id, table.sessionId),
	unique("auth_refresh_tokens_hash_uq").on(table.tokenHash),
	pgPolicy("fhdod_api_auth_refresh_tokens_update", { as: "permissive", for: "update", to: ["fhdod_api"], using: sql`true`, withCheck: sql`true`  }),
	pgPolicy("fhdod_api_auth_refresh_tokens_insert", { as: "permissive", for: "insert", to: ["fhdod_api"] }),
	pgPolicy("fhdod_api_auth_refresh_tokens_select", { as: "permissive", for: "select", to: ["fhdod_api"] }),
	check("auth_refresh_tokens_expiry_check", sql`expires_at > issued_at`),
	check("auth_refresh_tokens_consumed_check", sql`(consumed_at IS NULL) OR (consumed_at >= issued_at)`),
	check("auth_refresh_tokens_not_self_replaced_check", sql`(replaced_by_token_id IS NULL) OR (replaced_by_token_id <> id)`),
]);

export const sectors = pgTable("sectors", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "sectors_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	code: text().notNull(),
	name: text().notNull(),
	createdByUserId: integer("created_by_user_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	uniqueIndex("sectors_code_normalized_uq").using("btree", sql`lower(btrim(code))`),
	index("sectors_deleted_at_idx").using("btree", table.deletedAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.createdByUserId],
			foreignColumns: [users.id],
			name: "sectors_created_by_user_id_fkey"
		}).onDelete("restrict"),
	pgPolicy("fhdod_api_sectors_update", { as: "permissive", for: "update", to: ["fhdod_api"], using: sql`true`, withCheck: sql`true`  }),
	pgPolicy("fhdod_api_sectors_insert", { as: "permissive", for: "insert", to: ["fhdod_api"] }),
	pgPolicy("fhdod_api_sectors_select", { as: "permissive", for: "select", to: ["fhdod_api"] }),
]);

export const userSectorAssignments = pgTable("user_sector_assignments", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "user_sector_assignments_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	userId: integer("user_id").notNull(),
	sectorId: integer("sector_id").notNull(),
	assignedAt: timestamp("assigned_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	assignedByUserId: integer("assigned_by_user_id"),
	unassignedAt: timestamp("unassigned_at", { withTimezone: true, mode: 'string' }),
	unassignedByUserId: integer("unassigned_by_user_id"),
}, (table) => [
	index("user_sector_assignments_sector_idx").using("btree", table.sectorId.asc().nullsLast().op("timestamptz_ops"), table.unassignedAt.asc().nullsLast().op("int4_ops")),
	index("user_sector_assignments_user_idx").using("btree", table.userId.asc().nullsLast().op("int4_ops"), table.unassignedAt.asc().nullsLast().op("timestamptz_ops")),
	uniqueIndex("user_sector_one_active_assignment_uq").using("btree", table.userId.asc().nullsLast().op("int4_ops"), table.sectorId.asc().nullsLast().op("int4_ops")).where(sql`(unassigned_at IS NULL)`),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "user_sector_assignments_user_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.sectorId],
			foreignColumns: [sectors.id],
			name: "user_sector_assignments_sector_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.assignedByUserId],
			foreignColumns: [users.id],
			name: "user_sector_assignments_assigned_by_user_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.unassignedByUserId],
			foreignColumns: [users.id],
			name: "user_sector_assignments_unassigned_by_user_id_fkey"
		}).onDelete("restrict"),
	pgPolicy("fhdod_api_user_sector_assignments_update", { as: "permissive", for: "update", to: ["fhdod_api"], using: sql`true`, withCheck: sql`true`  }),
	pgPolicy("fhdod_api_user_sector_assignments_insert", { as: "permissive", for: "insert", to: ["fhdod_api"] }),
	pgPolicy("fhdod_api_user_sector_assignments_select", { as: "permissive", for: "select", to: ["fhdod_api"] }),
	check("user_sector_assignment_dates_check", sql`(unassigned_at IS NULL) OR (unassigned_at >= assigned_at)`),
]);

export const questions = pgTable("questions", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "questions_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	questionKind: questionKind("question_kind").notNull(),
	scope: questionScope().notNull(),
	sectorId: integer("sector_id"),
	isNps: boolean("is_nps").default(false).notNull(),
	displayOrder: integer("display_order").default(1).notNull(),
	createdByUserId: integer("created_by_user_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("questions_active_scope_idx").using("btree", table.scope.asc().nullsLast().op("bool_ops"), table.isNps.asc().nullsLast().op("enum_ops")).where(sql`(deleted_at IS NULL)`),
	uniqueIndex("questions_active_sector_order_uq").using("btree", table.sectorId.asc().nullsLast().op("int4_ops"), table.displayOrder.asc().nullsLast().op("int4_ops")).where(sql`((question_kind = 'sector'::question_kind) AND (deleted_at IS NULL))`),
	uniqueIndex("questions_one_active_global_nps_uq").using("btree", table.isNps.asc().nullsLast().op("bool_ops")).where(sql`((is_nps = true) AND (scope = 'all_sectors'::question_scope) AND (deleted_at IS NULL))`),
	index("questions_sector_order_idx").using("btree", table.sectorId.asc().nullsLast().op("int4_ops"), table.displayOrder.asc().nullsLast().op("int4_ops")).where(sql`((question_kind = 'sector'::question_kind) AND (deleted_at IS NULL))`),
	foreignKey({
			columns: [table.sectorId],
			foreignColumns: [sectors.id],
			name: "questions_sector_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.createdByUserId],
			foreignColumns: [users.id],
			name: "questions_created_by_user_id_fkey"
		}).onDelete("restrict"),
	pgPolicy("fhdod_api_questions_update", { as: "permissive", for: "update", to: ["fhdod_api"], using: sql`true`, withCheck: sql`true`  }),
	pgPolicy("fhdod_api_questions_insert", { as: "permissive", for: "insert", to: ["fhdod_api"] }),
	pgPolicy("fhdod_api_questions_select", { as: "permissive", for: "select", to: ["fhdod_api"] }),
	check("questions_kind_scope_check", sql`((question_kind = 'sector'::question_kind) AND (sector_id IS NOT NULL) AND (scope = 'sector_only'::question_scope) AND (is_nps = false)) OR ((question_kind = 'standard'::question_kind) AND (sector_id IS NULL) AND (scope = ANY (ARRAY['all_sectors'::question_scope, 'selected_sectors'::question_scope])))`),
	check("questions_order_positive_check", sql`display_order >= 1`),
]);

export const questionVersions = pgTable("question_versions", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "question_versions_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	questionId: integer("question_id").notNull(),
	versionNumber: integer("version_number").notNull(),
	text: text().notNull(),
	isCurrent: boolean("is_current").default(true).notNull(),
	createdByUserId: integer("created_by_user_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("question_versions_one_current_uq").using("btree", table.questionId.asc().nullsLast().op("int4_ops")).where(sql`(is_current = true)`),
	index("question_versions_question_idx").using("btree", table.questionId.asc().nullsLast().op("int4_ops"), table.versionNumber.desc().nullsFirst().op("int4_ops")),
	foreignKey({
			columns: [table.questionId],
			foreignColumns: [questions.id],
			name: "question_versions_question_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.createdByUserId],
			foreignColumns: [users.id],
			name: "question_versions_created_by_user_id_fkey"
		}).onDelete("restrict"),
	unique("question_versions_id_question_uq").on(table.id, table.questionId),
	unique("question_versions_question_version_uq").on(table.questionId, table.versionNumber),
	pgPolicy("fhdod_api_question_versions_update", { as: "permissive", for: "update", to: ["fhdod_api"], using: sql`true`, withCheck: sql`true`  }),
	pgPolicy("fhdod_api_question_versions_insert", { as: "permissive", for: "insert", to: ["fhdod_api"] }),
	pgPolicy("fhdod_api_question_versions_select", { as: "permissive", for: "select", to: ["fhdod_api"] }),
	check("question_versions_number_positive_check", sql`version_number >= 1`),
]);

export const questionSectorAssignments = pgTable("question_sector_assignments", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "question_sector_assignments_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	questionId: integer("question_id").notNull(),
	sectorId: integer("sector_id").notNull(),
	assignmentSource: questionAssignmentSource("assignment_source").notNull(),
	displayOrder: integer("display_order").notNull(),
	assignedAt: timestamp("assigned_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	assignedByUserId: integer("assigned_by_user_id"),
	endedAt: timestamp("ended_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	uniqueIndex("question_sector_assignment_active_order_uq").using("btree", table.sectorId.asc().nullsLast().op("int4_ops"), table.displayOrder.asc().nullsLast().op("int4_ops")).where(sql`(ended_at IS NULL)`),
	uniqueIndex("question_sector_assignment_active_question_uq").using("btree", table.questionId.asc().nullsLast().op("int4_ops"), table.sectorId.asc().nullsLast().op("int4_ops")).where(sql`(ended_at IS NULL)`),
	index("question_sector_assignments_sector_idx").using("btree", table.sectorId.asc().nullsLast().op("int4_ops"), table.endedAt.asc().nullsLast().op("timestamptz_ops"), table.displayOrder.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.questionId],
			foreignColumns: [questions.id],
			name: "question_sector_assignments_question_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.sectorId],
			foreignColumns: [sectors.id],
			name: "question_sector_assignments_sector_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.assignedByUserId],
			foreignColumns: [users.id],
			name: "question_sector_assignments_assigned_by_user_id_fkey"
		}).onDelete("restrict"),
	pgPolicy("fhdod_api_question_sector_assignments_update", { as: "permissive", for: "update", to: ["fhdod_api"], using: sql`true`, withCheck: sql`true`  }),
	pgPolicy("fhdod_api_question_sector_assignments_insert", { as: "permissive", for: "insert", to: ["fhdod_api"] }),
	pgPolicy("fhdod_api_question_sector_assignments_select", { as: "permissive", for: "select", to: ["fhdod_api"] }),
	check("question_sector_assignment_order_check", sql`display_order >= 1`),
	check("question_sector_assignment_dates_check", sql`(ended_at IS NULL) OR (ended_at >= assigned_at)`),
]);

export const sectorNpsAssignments = pgTable("sector_nps_assignments", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "sector_nps_assignments_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	sectorId: integer("sector_id").notNull(),
	questionId: integer("question_id").notNull(),
	assignmentSource: npsAssignmentSource("assignment_source").notNull(),
	assignedAt: timestamp("assigned_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	assignedByUserId: integer("assigned_by_user_id"),
	endedAt: timestamp("ended_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	uniqueIndex("sector_nps_one_current_per_sector_uq").using("btree", table.sectorId.asc().nullsLast().op("int4_ops")).where(sql`(ended_at IS NULL)`),
	index("sector_nps_question_idx").using("btree", table.questionId.asc().nullsLast().op("int4_ops"), table.endedAt.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.sectorId],
			foreignColumns: [sectors.id],
			name: "sector_nps_assignments_sector_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.questionId],
			foreignColumns: [questions.id],
			name: "sector_nps_assignments_question_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.assignedByUserId],
			foreignColumns: [users.id],
			name: "sector_nps_assignments_assigned_by_user_id_fkey"
		}).onDelete("restrict"),
	pgPolicy("fhdod_api_sector_nps_assignments_update", { as: "permissive", for: "update", to: ["fhdod_api"], using: sql`true`, withCheck: sql`true`  }),
	pgPolicy("fhdod_api_sector_nps_assignments_insert", { as: "permissive", for: "insert", to: ["fhdod_api"] }),
	pgPolicy("fhdod_api_sector_nps_assignments_select", { as: "permissive", for: "select", to: ["fhdod_api"] }),
	check("sector_nps_assignment_dates_check", sql`(ended_at IS NULL) OR (ended_at >= assigned_at)`),
]);

export const shiftSheetVersions = pgTable("shift_sheet_versions", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "shift_sheet_versions_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	versionNumber: integer("version_number").notNull(),
	uploadedByUserId: integer("uploaded_by_user_id"),
	uploadedAt: timestamp("uploaded_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	validFrom: timestamp("valid_from", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	isCurrent: boolean("is_current").default(false).notNull(),
}, (table) => [
	uniqueIndex("shift_sheet_one_current_version_uq").using("btree", table.isCurrent.asc().nullsLast().op("bool_ops")).where(sql`(is_current = true)`),
	index("shift_sheet_versions_valid_from_idx").using("btree", table.validFrom.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.uploadedByUserId],
			foreignColumns: [users.id],
			name: "shift_sheet_versions_uploaded_by_user_id_fkey"
		}).onDelete("restrict"),
	unique("shift_sheet_versions_version_number_key").on(table.versionNumber),
	pgPolicy("fhdod_api_shift_sheet_versions_select", { as: "permissive", for: "select", to: ["fhdod_api"], using: sql`true` }),
	check("shift_sheet_version_number_check", sql`version_number >= 1`),
]);

export const employees = pgTable("employees", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "employees_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	employeeCode: text("employee_code").notNull(),
	fullName: text("full_name").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	uniqueIndex("employees_code_normalized_uq").using("btree", sql`lower(btrim(employee_code))`),
	index("employees_deleted_at_idx").using("btree", table.deletedAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const submissionSessions = pgTable("submission_sessions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	sectorId: integer("sector_id").notNull(),
	shiftSheetVersionId: integer("shift_sheet_version_id").notNull(),
	shiftRangeId: integer("shift_range_id").notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastActivityAt: timestamp("last_activity_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	endedAt: timestamp("ended_at", { withTimezone: true, mode: 'string' }),
	status: submissionStatus().default('incomplete').notNull(),
}, (table) => [
	index("submission_sessions_incomplete_activity_idx").using("btree", table.lastActivityAt.asc().nullsLast().op("timestamptz_ops")).where(sql`((status = 'incomplete'::submission_status) AND (ended_at IS NULL))`),
	index("submission_sessions_sector_time_idx").using("btree", table.sectorId.asc().nullsLast().op("timestamptz_ops"), table.startedAt.desc().nullsFirst().op("int4_ops")),
	index("submission_sessions_shift_time_idx").using("btree", table.shiftRangeId.asc().nullsLast().op("timestamptz_ops"), table.startedAt.desc().nullsFirst().op("int4_ops")),
	foreignKey({
			columns: [table.sectorId],
			foreignColumns: [sectors.id],
			name: "submission_sessions_sector_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.sectorId, table.shiftSheetVersionId, table.shiftRangeId],
			foreignColumns: [sectorShiftRanges.id, sectorShiftRanges.shiftSheetVersionId, sectorShiftRanges.sectorId],
			name: "submission_session_shift_fk"
		}).onDelete("restrict"),
	check("submission_session_activity_check", sql`last_activity_at >= started_at`),
	check("submission_session_end_check", sql`(ended_at IS NULL) OR (ended_at >= started_at)`),
	check("submission_session_complete_end_check", sql`(status <> 'complete'::submission_status) OR (ended_at IS NOT NULL)`),
]);

export const submissionAnswers = pgTable("submission_answers", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "submission_answers_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	sessionQuestionId: integer("session_question_id").notNull(),
	status: answerStatus().notNull(),
	score: integer(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("submission_answers_status_idx").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.sessionQuestionId],
			foreignColumns: [submissionSessionQuestions.id],
			name: "submission_answers_session_question_id_fkey"
		}).onDelete("restrict"),
	unique("submission_answers_session_question_id_key").on(table.sessionQuestionId),
	check("submission_answer_status_score_check", sql`((status = 'answered'::answer_status) AND (score IS NOT NULL)) OR ((status = 'skipped'::answer_status) AND (score IS NULL))`),
]);

export const contentPages = pgTable("content_pages", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "content_pages_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	slug: text().notNull(),
	title: text().notNull(),
	createdByUserId: integer("created_by_user_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.createdByUserId],
			foreignColumns: [users.id],
			name: "content_pages_created_by_user_id_fkey"
		}).onDelete("restrict"),
	unique("content_pages_slug_key").on(table.slug),
	pgPolicy("fhdod_api_content_pages_update", { as: "permissive", for: "update", to: ["fhdod_api"], using: sql`true`, withCheck: sql`true`  }),
	pgPolicy("fhdod_api_content_pages_select", { as: "permissive", for: "select", to: ["fhdod_api"] }),
]);

export const contentPageVersions = pgTable("content_page_versions", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "content_page_versions_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	pageId: integer("page_id").notNull(),
	versionNumber: integer("version_number").notNull(),
	content: text().notNull(),
	isCurrent: boolean("is_current").default(true).notNull(),
	createdByUserId: integer("created_by_user_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	publishedAt: timestamp("published_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("content_page_versions_history_idx").using("btree", table.pageId.asc().nullsLast().op("int4_ops"), table.versionNumber.desc().nullsFirst().op("int4_ops")),
	uniqueIndex("content_page_versions_one_current_uq").using("btree", table.pageId.asc().nullsLast().op("int4_ops")).where(sql`(is_current = true)`),
	foreignKey({
			columns: [table.pageId],
			foreignColumns: [contentPages.id],
			name: "content_page_versions_page_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.createdByUserId],
			foreignColumns: [users.id],
			name: "content_page_versions_created_by_user_id_fkey"
		}).onDelete("restrict"),
	unique("content_page_versions_id_page_uq").on(table.id, table.pageId),
	unique("content_page_versions_page_version_uq").on(table.pageId, table.versionNumber),
	pgPolicy("fhdod_api_content_page_versions_update", { as: "permissive", for: "update", to: ["fhdod_api"], using: sql`true`, withCheck: sql`true`  }),
	pgPolicy("fhdod_api_content_page_versions_insert", { as: "permissive", for: "insert", to: ["fhdod_api"] }),
	pgPolicy("fhdod_api_content_page_versions_select", { as: "permissive", for: "select", to: ["fhdod_api"] }),
	check("content_page_version_number_check", sql`version_number >= 1`),
]);

export const ombudsmanTickets = pgTable("ombudsman_tickets", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "ombudsman_tickets_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	sectorId: integer("sector_id").notNull(),
	shiftSheetVersionId: integer("shift_sheet_version_id").notNull(),
	shiftRangeId: integer("shift_range_id").notNull(),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	ticketType: ombudsmanTicketType("ticket_type").notNull(),
	status: ombudsmanTicketStatus().default('open').notNull(),
	body: varchar({ length: 300 }).notNull(),
	phoneNormalized: varchar("phone_normalized", { length: 20 }),
	acceptedPolicyVersionId: integer("accepted_policy_version_id").notNull(),
	policyAcceptedAt: timestamp("policy_accepted_at", { withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ombudsman_tickets_created_idx").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("ombudsman_tickets_sector_created_idx").using("btree", table.sectorId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("ombudsman_tickets_status_created_idx").using("btree", table.status.asc().nullsLast().op("enum_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("ombudsman_tickets_type_created_idx").using("btree", table.ticketType.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.sectorId],
			foreignColumns: [sectors.id],
			name: "ombudsman_tickets_sector_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.acceptedPolicyVersionId],
			foreignColumns: [contentPageVersions.id],
			name: "ombudsman_tickets_accepted_policy_version_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.sectorId, table.shiftSheetVersionId, table.shiftRangeId],
			foreignColumns: [sectorShiftRanges.id, sectorShiftRanges.shiftSheetVersionId, sectorShiftRanges.sectorId],
			name: "ombudsman_ticket_shift_fk"
		}).onDelete("restrict"),
]);

export const sectorShiftRanges = pgTable("sector_shift_ranges", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "sector_shift_ranges_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	shiftSheetVersionId: integer("shift_sheet_version_id").notNull(),
	sectorId: integer("sector_id").notNull(),
	shiftName: text("shift_name").notNull(),
	startsAt: time("starts_at").notNull(),
	endsAt: time("ends_at").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("sector_shift_ranges_lookup_idx").using("btree", table.shiftSheetVersionId.asc().nullsLast().op("int4_ops"), table.sectorId.asc().nullsLast().op("int4_ops"), table.startsAt.asc().nullsLast().op("time_ops"), table.endsAt.asc().nullsLast().op("time_ops")),
	index("sector_shift_ranges_sector_version_idx").using("btree", table.sectorId.asc().nullsLast().op("int4_ops"), table.shiftSheetVersionId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.sectorId],
			foreignColumns: [sectors.id],
			name: "sector_shift_ranges_sector_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.shiftSheetVersionId],
			foreignColumns: [shiftSheetVersions.id],
			name: "sector_shift_ranges_shift_sheet_version_id_fkey"
		}).onDelete("restrict"),
	unique("sector_shift_range_composite_uq").on(table.id, table.shiftSheetVersionId, table.sectorId),
	unique("sector_shift_range_duplicate_uq").on(table.shiftSheetVersionId, table.sectorId, table.shiftName, table.startsAt, table.endsAt),
	pgPolicy("fhdod_api_sector_shift_ranges_select", { as: "permissive", for: "select", to: ["fhdod_api"], using: sql`true` }),
	check("sector_shift_range_nonzero_check", sql`starts_at <> ends_at`),
]);

export const employeeShiftAssignments = pgTable("employee_shift_assignments", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "employee_shift_assignments_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	shiftSheetVersionId: integer("shift_sheet_version_id").notNull(),
	sectorId: integer("sector_id").notNull(),
	shiftRangeId: integer("shift_range_id").notNull(),
	employeeId: integer("employee_id").notNull(),
	workDate: date("work_date"),
	dayOfWeek: smallint("day_of_week"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("employee_shift_date_assignment_uq").using("btree", table.shiftRangeId.asc().nullsLast().op("int4_ops"), table.employeeId.asc().nullsLast().op("date_ops"), table.workDate.asc().nullsLast().op("int4_ops")).where(sql`(work_date IS NOT NULL)`),
	index("employee_shift_employee_idx").using("btree", table.employeeId.asc().nullsLast().op("int4_ops")),
	index("employee_shift_team_lookup_idx").using("btree", table.shiftSheetVersionId.asc().nullsLast().op("int4_ops"), table.sectorId.asc().nullsLast().op("int4_ops"), table.shiftRangeId.asc().nullsLast().op("int4_ops")),
	uniqueIndex("employee_shift_weekday_assignment_uq").using("btree", table.shiftRangeId.asc().nullsLast().op("int2_ops"), table.employeeId.asc().nullsLast().op("int4_ops"), table.dayOfWeek.asc().nullsLast().op("int2_ops")).where(sql`(day_of_week IS NOT NULL)`),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [employees.id],
			name: "employee_shift_assignments_employee_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.shiftSheetVersionId, table.sectorId, table.shiftRangeId],
			foreignColumns: [sectorShiftRanges.id, sectorShiftRanges.shiftSheetVersionId, sectorShiftRanges.sectorId],
			name: "employee_shift_range_fk"
		}).onDelete("restrict"),
	check("employee_shift_date_or_weekday_check", sql`((work_date IS NOT NULL) AND (day_of_week IS NULL)) OR ((work_date IS NULL) AND (day_of_week IS NOT NULL))`),
	check("employee_shift_weekday_check", sql`(day_of_week IS NULL) OR ((day_of_week >= 1) AND (day_of_week <= 7))`),
]);

export const shiftUploadAttempts = pgTable("shift_upload_attempts", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "shift_upload_attempts_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	uploadedByUserId: integer("uploaded_by_user_id").notNull(),
	attemptedAt: timestamp("attempted_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	result: shiftUploadResult().notNull(),
	resultingVersionId: integer("resulting_version_id"),
	validationErrors: jsonb("validation_errors").default([]).notNull(),
}, (table) => [
	index("shift_upload_attempts_created_idx").using("btree", table.attemptedAt.desc().nullsFirst().op("timestamptz_ops")),
	index("shift_upload_attempts_user_idx").using("btree", table.uploadedByUserId.asc().nullsLast().op("int4_ops"), table.attemptedAt.desc().nullsFirst().op("int4_ops")),
	foreignKey({
			columns: [table.uploadedByUserId],
			foreignColumns: [users.id],
			name: "shift_upload_attempts_uploaded_by_user_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.resultingVersionId],
			foreignColumns: [shiftSheetVersions.id],
			name: "shift_upload_attempts_resulting_version_id_fkey"
		}).onDelete("restrict"),
	check("shift_upload_result_version_check", sql`((result = 'accepted'::shift_upload_result) AND (resulting_version_id IS NOT NULL)) OR ((result = 'rejected'::shift_upload_result) AND (resulting_version_id IS NULL))`),
]);

export const submissionSessionQuestions = pgTable("submission_session_questions", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "submission_session_questions_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	sessionId: uuid("session_id").notNull(),
	questionId: integer("question_id").notNull(),
	questionVersionId: integer("question_version_id").notNull(),
	position: integer().notNull(),
	questionKind: questionKind("question_kind").notNull(),
	isNps: boolean("is_nps").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("submission_session_questions_question_version_idx").using("btree", table.questionId.asc().nullsLast().op("int4_ops"), table.questionVersionId.asc().nullsLast().op("int4_ops")),
	index("submission_session_questions_session_idx").using("btree", table.sessionId.asc().nullsLast().op("int4_ops"), table.position.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [submissionSessions.id],
			name: "submission_session_questions_session_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.questionId],
			foreignColumns: [questions.id],
			name: "submission_session_questions_question_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.questionId, table.questionVersionId],
			foreignColumns: [questionVersions.id, questionVersions.questionId],
			name: "submission_session_question_version_fk"
		}).onDelete("restrict"),
	unique("submission_session_question_position_uq").on(table.sessionId, table.position),
	unique("submission_session_question_once_uq").on(table.sessionId, table.questionId),
	check("submission_session_question_position_check", sql`"position" >= 1`),
]);

export const ombudsmanNotes = pgTable("ombudsman_notes", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "ombudsman_notes_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	ticketId: integer("ticket_id").notNull(),
	authorUserId: integer("author_user_id").notNull(),
	note: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ombudsman_notes_ticket_idx").using("btree", table.ticketId.asc().nullsLast().op("int4_ops"), table.createdAt.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.ticketId],
			foreignColumns: [ombudsmanTickets.id],
			name: "ombudsman_notes_ticket_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.authorUserId],
			foreignColumns: [users.id],
			name: "ombudsman_notes_author_user_id_fkey"
		}).onDelete("restrict"),
]);

export const auditLogs = pgTable("audit_logs", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "audit_logs_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	actorUserId: integer("actor_user_id"),
	action: text().notNull(),
	entityType: text("entity_type").notNull(),
	entityId: integer("entity_id"),
	oldValues: jsonb("old_values"),
	newValues: jsonb("new_values"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("audit_logs_actor_idx").using("btree", table.actorUserId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("audit_logs_created_idx").using("btree", table.createdAt.desc().nullsFirst().op("int4_ops"), table.id.desc().nullsFirst().op("timestamptz_ops")),
	index("audit_logs_entity_idx").using("btree", table.entityType.asc().nullsLast().op("int4_ops"), table.entityId.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.actorUserId],
			foreignColumns: [users.id],
			name: "audit_logs_actor_user_id_fkey"
		}).onDelete("restrict"),
	pgPolicy("fhdod_api_audit_logs_insert", { as: "permissive", for: "insert", to: ["fhdod_api"], withCheck: sql`true`  }),
	pgPolicy("fhdod_api_audit_logs_select", { as: "permissive", for: "select", to: ["fhdod_api"] }),
]);

export const dashboardSummaryState = pgTable("dashboard_summary_state", {
	singletonId: smallint("singleton_id").default(1).primaryKey().notNull(),
	lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true, mode: 'string' }),
	lastClosedHour: timestamp("last_closed_hour", { withTimezone: true, mode: 'string' }),
}, (_table) => [
	check("dashboard_summary_state_singleton_check", sql`singleton_id = 1`),
]);

export const dashboardDirtyGroups = pgTable("dashboard_dirty_groups", {
	id: integer().primaryKey().generatedByDefaultAsIdentity({ name: "dashboard_dirty_groups_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 2147483647, cache: 1 }),
	summaryType: dashboardSummaryType("summary_type").notNull(),
	hourBucket: timestamp("hour_bucket", { withTimezone: true, mode: 'string' }).notNull(),
	sectorId: integer("sector_id").notNull(),
	shiftRangeId: integer("shift_range_id").notNull(),
	questionId: integer("question_id"),
	questionVersionId: integer("question_version_id"),
	ticketType: ombudsmanTicketType("ticket_type"),
	ticketStatus: ombudsmanTicketStatus("ticket_status"),
	queuedAt: timestamp("queued_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("dashboard_dirty_groups_answers_uq").using("btree", table.hourBucket.asc().nullsLast().op("int4_ops"), table.sectorId.asc().nullsLast().op("int4_ops"), table.shiftRangeId.asc().nullsLast().op("int4_ops"), table.questionId.asc().nullsLast().op("timestamptz_ops"), table.questionVersionId.asc().nullsLast().op("int4_ops")).where(sql`(summary_type = 'answers'::dashboard_summary_type)`),
	uniqueIndex("dashboard_dirty_groups_ombudsman_uq").using("btree", table.hourBucket.asc().nullsLast().op("enum_ops"), table.sectorId.asc().nullsLast().op("int4_ops"), table.shiftRangeId.asc().nullsLast().op("int4_ops"), table.ticketType.asc().nullsLast().op("enum_ops"), table.ticketStatus.asc().nullsLast().op("int4_ops")).where(sql`(summary_type = 'ombudsman'::dashboard_summary_type)`),
	index("dashboard_dirty_groups_queue_idx").using("btree", table.queuedAt.asc().nullsLast().op("int4_ops"), table.id.asc().nullsLast().op("int4_ops")),
	uniqueIndex("dashboard_dirty_groups_sessions_uq").using("btree", table.hourBucket.asc().nullsLast().op("int4_ops"), table.sectorId.asc().nullsLast().op("int4_ops"), table.shiftRangeId.asc().nullsLast().op("timestamptz_ops")).where(sql`(summary_type = 'sessions'::dashboard_summary_type)`),
	foreignKey({
			columns: [table.sectorId],
			foreignColumns: [sectors.id],
			name: "dashboard_dirty_groups_sector_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.shiftRangeId],
			foreignColumns: [sectorShiftRanges.id],
			name: "dashboard_dirty_groups_shift_range_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.questionId, table.questionVersionId],
			foreignColumns: [questionVersions.id, questionVersions.questionId],
			name: "dashboard_dirty_group_question_version_fk"
		}).onDelete("restrict"),
	check("dashboard_dirty_group_shape_check", sql`((summary_type = 'answers'::dashboard_summary_type) AND (question_id IS NOT NULL) AND (question_version_id IS NOT NULL) AND (ticket_type IS NULL) AND (ticket_status IS NULL)) OR ((summary_type = 'sessions'::dashboard_summary_type) AND (question_id IS NULL) AND (question_version_id IS NULL) AND (ticket_type IS NULL) AND (ticket_status IS NULL)) OR ((summary_type = 'ombudsman'::dashboard_summary_type) AND (question_id IS NULL) AND (question_version_id IS NULL) AND (ticket_type IS NOT NULL) AND (ticket_status IS NOT NULL))`),
]);

export const rolePermissions = pgTable("role_permissions", {
	roleId: integer("role_id").notNull(),
	permissionId: integer("permission_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.roleId],
			foreignColumns: [roles.id],
			name: "role_permissions_role_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.permissionId],
			foreignColumns: [permissions.id],
			name: "role_permissions_permission_id_fkey"
		}).onDelete("restrict"),
	primaryKey({ columns: [table.roleId, table.permissionId], name: "role_permissions_pkey"}),
]);

export const hourlySessionSummaries = pgTable("hourly_session_summaries", {
	hourBucket: timestamp("hour_bucket", { withTimezone: true, mode: 'string' }).notNull(),
	sectorId: integer("sector_id").notNull(),
	shiftRangeId: integer("shift_range_id").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	completeCount: bigint("complete_count", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	incompleteCount: bigint("incomplete_count", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	abandonedCount: bigint("abandoned_count", { mode: "number" }).default(0).notNull(),
	recalculatedAt: timestamp("recalculated_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("hourly_session_summaries_sector_hour_idx").using("btree", table.sectorId.asc().nullsLast().op("int4_ops"), table.hourBucket.desc().nullsFirst().op("int4_ops")),
	foreignKey({
			columns: [table.sectorId],
			foreignColumns: [sectors.id],
			name: "hourly_session_summaries_sector_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.shiftRangeId],
			foreignColumns: [sectorShiftRanges.id],
			name: "hourly_session_summaries_shift_range_id_fkey"
		}).onDelete("restrict"),
	primaryKey({ columns: [table.hourBucket, table.sectorId, table.shiftRangeId], name: "hourly_session_summaries_pkey"}),
	check("hourly_session_summary_counts_check", sql`(complete_count >= 0) AND (incomplete_count >= 0) AND (abandoned_count >= 0)`),
]);

export const hourlyOmbudsmanSummaries = pgTable("hourly_ombudsman_summaries", {
	hourBucket: timestamp("hour_bucket", { withTimezone: true, mode: 'string' }).notNull(),
	sectorId: integer("sector_id").notNull(),
	shiftRangeId: integer("shift_range_id").notNull(),
	ticketType: ombudsmanTicketType("ticket_type").notNull(),
	ticketStatus: ombudsmanTicketStatus("ticket_status").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	ticketCount: bigint("ticket_count", { mode: "number" }).default(0).notNull(),
	recalculatedAt: timestamp("recalculated_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("hourly_ombudsman_summaries_sector_hour_idx").using("btree", table.sectorId.asc().nullsLast().op("int4_ops"), table.hourBucket.desc().nullsFirst().op("int4_ops")),
	foreignKey({
			columns: [table.sectorId],
			foreignColumns: [sectors.id],
			name: "hourly_ombudsman_summaries_sector_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.shiftRangeId],
			foreignColumns: [sectorShiftRanges.id],
			name: "hourly_ombudsman_summaries_shift_range_id_fkey"
		}).onDelete("restrict"),
	primaryKey({ columns: [table.hourBucket, table.sectorId, table.shiftRangeId, table.ticketType, table.ticketStatus], name: "hourly_ombudsman_summaries_pkey"}),
	check("hourly_ombudsman_summary_count_check", sql`ticket_count >= 0`),
]);

export const hourlyAnswerSummaries = pgTable("hourly_answer_summaries", {
	hourBucket: timestamp("hour_bucket", { withTimezone: true, mode: 'string' }).notNull(),
	sectorId: integer("sector_id").notNull(),
	shiftRangeId: integer("shift_range_id").notNull(),
	questionId: integer("question_id").notNull(),
	questionVersionId: integer("question_version_id").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	score0Count: bigint("score_0_count", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	score1Count: bigint("score_1_count", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	score2Count: bigint("score_2_count", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	score3Count: bigint("score_3_count", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	score4Count: bigint("score_4_count", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	score5Count: bigint("score_5_count", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	score6Count: bigint("score_6_count", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	score7Count: bigint("score_7_count", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	score8Count: bigint("score_8_count", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	score9Count: bigint("score_9_count", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	score10Count: bigint("score_10_count", { mode: "number" }).default(0).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	skippedCount: bigint("skipped_count", { mode: "number" }).default(0).notNull(),
	recalculatedAt: timestamp("recalculated_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("hourly_answer_summaries_question_hour_idx").using("btree", table.questionId.asc().nullsLast().op("int4_ops"), table.questionVersionId.asc().nullsLast().op("int4_ops"), table.hourBucket.desc().nullsFirst().op("timestamptz_ops")),
	index("hourly_answer_summaries_sector_hour_idx").using("btree", table.sectorId.asc().nullsLast().op("int4_ops"), table.hourBucket.desc().nullsFirst().op("int4_ops")),
	foreignKey({
			columns: [table.sectorId],
			foreignColumns: [sectors.id],
			name: "hourly_answer_summaries_sector_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.shiftRangeId],
			foreignColumns: [sectorShiftRanges.id],
			name: "hourly_answer_summaries_shift_range_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.questionId],
			foreignColumns: [questions.id],
			name: "hourly_answer_summaries_question_id_fkey"
		}).onDelete("restrict"),
	foreignKey({
			columns: [table.questionId, table.questionVersionId],
			foreignColumns: [questionVersions.id, questionVersions.questionId],
			name: "hourly_answer_summary_version_fk"
		}).onDelete("restrict"),
	primaryKey({ columns: [table.hourBucket, table.sectorId, table.shiftRangeId, table.questionId, table.questionVersionId], name: "hourly_answer_summaries_pkey"}),
]);
