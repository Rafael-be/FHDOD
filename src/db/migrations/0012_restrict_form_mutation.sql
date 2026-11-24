-- Runtime cannot delete published forms: no DELETE grants or RLS policies.
-- The database owner retains the ability to clean synthetic fixtures after
-- removing referencing sessions and answers; UPDATE remains forbidden.
DROP TRIGGER submission_form_versions_immutable ON submission_form_versions;--> statement-breakpoint
CREATE TRIGGER submission_form_versions_immutable BEFORE UPDATE ON submission_form_versions FOR EACH ROW EXECUTE FUNCTION reject_published_form_changes();--> statement-breakpoint
DROP TRIGGER submission_form_questions_immutable ON submission_form_questions;--> statement-breakpoint
CREATE TRIGGER submission_form_questions_immutable BEFORE UPDATE ON submission_form_questions FOR EACH ROW EXECUTE FUNCTION reject_published_form_changes();
