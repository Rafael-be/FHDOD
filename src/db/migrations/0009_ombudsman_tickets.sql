-- A ticket may be filed outside working hours or before any sheet exists.
-- Keep legacy enum values for historical rows; the API accepts only the new workflow.
ALTER TYPE ombudsman_ticket_status ADD VALUE 'contact_attempt';--> statement-breakpoint
ALTER TYPE ombudsman_ticket_status ADD VALUE 'contact_failed';--> statement-breakpoint
ALTER TABLE ombudsman_tickets ALTER COLUMN shift_sheet_version_id DROP NOT NULL;--> statement-breakpoint
ALTER TABLE ombudsman_tickets ALTER COLUMN shift_range_id DROP NOT NULL;--> statement-breakpoint
ALTER TABLE ombudsman_tickets ADD CONSTRAINT ombudsman_ticket_version_fk FOREIGN KEY (shift_sheet_version_id) REFERENCES shift_sheet_versions(id) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE ombudsman_tickets ADD CONSTRAINT ombudsman_ticket_range_requires_version CHECK (shift_range_id IS NULL OR shift_sheet_version_id IS NOT NULL);--> statement-breakpoint
ALTER TABLE ombudsman_tickets ADD CONSTRAINT ombudsman_ticket_contact_requires_phone CHECK (status::text NOT IN ('contact_attempt', 'contact_failed') OR phone_normalized IS NOT NULL);--> statement-breakpoint
CREATE POLICY fhdod_api_ombudsman_tickets_select ON ombudsman_tickets FOR SELECT TO fhdod_api USING (true);--> statement-breakpoint
CREATE POLICY fhdod_api_ombudsman_tickets_insert ON ombudsman_tickets FOR INSERT TO fhdod_api WITH CHECK (true);--> statement-breakpoint
CREATE POLICY fhdod_api_ombudsman_tickets_update ON ombudsman_tickets FOR UPDATE TO fhdod_api USING (true) WITH CHECK (true);
