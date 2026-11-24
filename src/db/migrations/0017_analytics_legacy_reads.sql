-- Analytics includes legacy sessions without changing historical rows.
GRANT SELECT ON submission_session_questions, submission_answers TO fhdod_api;--> statement-breakpoint
CREATE POLICY fhdod_api_legacy_questions_select ON submission_session_questions FOR SELECT TO fhdod_api USING (true);--> statement-breakpoint
CREATE POLICY fhdod_api_legacy_answers_select ON submission_answers FOR SELECT TO fhdod_api USING (true);
