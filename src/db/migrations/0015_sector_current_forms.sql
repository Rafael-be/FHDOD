-- The previous runtime selected the highest version_number for each sector.
-- Preserve that choice only when the published snapshot is complete.
CREATE TABLE sector_current_forms (
  sector_id integer PRIMARY KEY REFERENCES sectors(id) ON DELETE RESTRICT,
  form_version_id integer,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  FOREIGN KEY (form_version_id, sector_id) REFERENCES submission_form_versions(id, sector_id) ON DELETE RESTRICT
);--> statement-breakpoint
INSERT INTO sector_current_forms(sector_id,form_version_id)
SELECT s.id,v.id FROM sectors s
JOIN LATERAL (
  SELECT id FROM submission_form_versions WHERE sector_id=s.id ORDER BY version_number DESC LIMIT 1
) v ON true
WHERE s.deleted_at IS NULL
  AND (SELECT count(*) FROM submission_form_questions q WHERE q.form_version_id=v.id AND q.is_nps)=1
  AND EXISTS (SELECT 1 FROM submission_form_questions q WHERE q.form_version_id=v.id AND q.question_kind='standard' AND NOT q.is_nps);--> statement-breakpoint
ALTER TABLE sector_current_forms ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY fhdod_api_current_forms_select ON sector_current_forms FOR SELECT TO fhdod_api USING (true);--> statement-breakpoint
CREATE POLICY fhdod_api_current_forms_insert ON sector_current_forms FOR INSERT TO fhdod_api WITH CHECK (true);--> statement-breakpoint
CREATE POLICY fhdod_api_current_forms_update ON sector_current_forms FOR UPDATE TO fhdod_api USING (true) WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON sector_current_forms TO fhdod_api;
