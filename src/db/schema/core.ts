import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const roles = pgTable("roles", { id: integer().primaryKey().generatedByDefaultAsIdentity(), code: text().notNull(), name: text().notNull() });
export const users = pgTable("users", {
  id: integer().primaryKey().generatedByDefaultAsIdentity(), roleId: integer("role_id").notNull(), fullName: text("full_name").notNull(), email: text().notNull(), passwordHash: text("password_hash").notNull(),
  mustChangePassword: boolean("must_change_password").notNull().default(false), temporaryPasswordExpiresAt: timestamp("temporary_password_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(), deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [uniqueIndex("users_email_case_insensitive_uq").on(table.email), index("users_role_id_idx").on(table.roleId)]);
export const authSessions = pgTable("auth_sessions", {
  id: uuid().primaryKey(), userId: integer("user_id").notNull(), csrfToken: text("csrf_token").notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull(), lastUsedAt: timestamp("last_used_at", { withTimezone: true }), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
export const authRefreshTokens = pgTable("auth_refresh_tokens", {
  id: uuid().primaryKey(), sessionId: uuid("session_id").notNull(), tokenHash: text("token_hash").notNull(), issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), consumedAt: timestamp("consumed_at", { withTimezone: true }), replacedByTokenId: uuid("replaced_by_token_id"),
});
export const sectors = pgTable("sectors", { id: integer().primaryKey().generatedByDefaultAsIdentity(), code: text().notNull(), name: text().notNull(), createdByUserId: integer("created_by_user_id"), createdAt: timestamp("created_at", { withTimezone: true }).notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(), deletedAt: timestamp("deleted_at", { withTimezone: true }) });
export const userSectorAssignments = pgTable("user_sector_assignments", { id: integer().primaryKey().generatedByDefaultAsIdentity(), userId: integer("user_id").notNull(), sectorId: integer("sector_id").notNull(), assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull(), assignedByUserId: integer("assigned_by_user_id"), unassignedAt: timestamp("unassigned_at", { withTimezone: true }), unassignedByUserId: integer("unassigned_by_user_id") });
export const auditLogs = pgTable("audit_logs", { id: integer().primaryKey().generatedByDefaultAsIdentity(), actorUserId: integer("actor_user_id"), action: text().notNull(), entityType: text("entity_type").notNull(), entityId: integer("entity_id"), oldValues: jsonb("old_values"), newValues: jsonb("new_values"), createdAt: timestamp("created_at", { withTimezone: true }).notNull() });
