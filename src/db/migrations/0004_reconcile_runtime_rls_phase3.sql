ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_refresh_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_page_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_pages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dashboard_dirty_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dashboard_summary_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "employee_shift_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hourly_answer_summaries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hourly_ombudsman_summaries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "hourly_session_summaries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ombudsman_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ombudsman_tickets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "question_sector_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "question_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "questions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sector_nps_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sector_shift_ranges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sectors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shift_sheet_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shift_upload_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "submission_answers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "submission_session_questions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "submission_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_sector_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "fhdod_api_dashboard_dirty_groups_insert" ON "dashboard_dirty_groups" AS PERMISSIVE FOR INSERT TO "fhdod_api" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "fhdod_api_employee_shift_assignments_insert" ON "employee_shift_assignments" AS PERMISSIVE FOR INSERT TO "fhdod_api" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "fhdod_api_employee_shift_assignments_select" ON "employee_shift_assignments" AS PERMISSIVE FOR SELECT TO "fhdod_api" USING (true);--> statement-breakpoint
CREATE POLICY "fhdod_api_employees_select" ON "employees" AS PERMISSIVE FOR SELECT TO "fhdod_api" USING (true);--> statement-breakpoint
CREATE POLICY "fhdod_api_sector_shift_ranges_insert" ON "sector_shift_ranges" AS PERMISSIVE FOR INSERT TO "fhdod_api" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "fhdod_api_shift_sheet_versions_update" ON "shift_sheet_versions" AS PERMISSIVE FOR UPDATE TO "fhdod_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "fhdod_api_shift_sheet_versions_insert" ON "shift_sheet_versions" AS PERMISSIVE FOR INSERT TO "fhdod_api" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "fhdod_api_shift_upload_attempts_insert" ON "shift_upload_attempts" AS PERMISSIVE FOR INSERT TO "fhdod_api" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "fhdod_api_submission_answers_update" ON "submission_answers" AS PERMISSIVE FOR UPDATE TO "fhdod_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "fhdod_api_submission_answers_insert" ON "submission_answers" AS PERMISSIVE FOR INSERT TO "fhdod_api" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "fhdod_api_submission_answers_select" ON "submission_answers" AS PERMISSIVE FOR SELECT TO "fhdod_api" USING (true);--> statement-breakpoint
CREATE POLICY "fhdod_api_submission_session_questions_insert" ON "submission_session_questions" AS PERMISSIVE FOR INSERT TO "fhdod_api" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "fhdod_api_submission_session_questions_select" ON "submission_session_questions" AS PERMISSIVE FOR SELECT TO "fhdod_api" USING (true);--> statement-breakpoint
CREATE POLICY "fhdod_api_submission_sessions_update" ON "submission_sessions" AS PERMISSIVE FOR UPDATE TO "fhdod_api" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "fhdod_api_submission_sessions_insert" ON "submission_sessions" AS PERMISSIVE FOR INSERT TO "fhdod_api" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "fhdod_api_submission_sessions_select" ON "submission_sessions" AS PERMISSIVE FOR SELECT TO "fhdod_api" USING (true);