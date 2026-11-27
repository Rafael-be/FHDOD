ALTER TABLE submission_sessions DROP CONSTRAINT IF EXISTS submission_session_shift_fk;--> statement-breakpoint
ALTER TABLE ombudsman_tickets DROP CONSTRAINT IF EXISTS ombudsman_ticket_shift_fk;--> statement-breakpoint
ALTER TABLE submission_sessions
  ADD CONSTRAINT submission_session_shift_fk
  FOREIGN KEY (shift_range_id, shift_sheet_version_id, sector_id)
  REFERENCES sector_shift_ranges (id, shift_sheet_version_id, sector_id)
  ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE ombudsman_tickets
  ADD CONSTRAINT ombudsman_ticket_shift_fk
  FOREIGN KEY (shift_range_id, shift_sheet_version_id, sector_id)
  REFERENCES sector_shift_ranges (id, shift_sheet_version_id, sector_id)
  ON DELETE RESTRICT;
