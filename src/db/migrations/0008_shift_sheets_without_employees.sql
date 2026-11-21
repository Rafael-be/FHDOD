-- New sheets store the weekday on each range. NULL keeps legacy range semantics,
-- where weekdays live in employee_shift_assignments. Historical rows stay intact.
ALTER TABLE sector_shift_ranges ADD COLUMN day_of_week smallint;--> statement-breakpoint
ALTER TABLE sector_shift_ranges ADD CONSTRAINT sector_shift_range_weekday_check CHECK (day_of_week BETWEEN 1 AND 7 OR day_of_week IS NULL);--> statement-breakpoint
ALTER TABLE sector_shift_ranges DROP CONSTRAINT sector_shift_range_duplicate_uq;--> statement-breakpoint
CREATE UNIQUE INDEX sector_shift_range_legacy_duplicate_uq ON sector_shift_ranges (shift_sheet_version_id, sector_id, shift_name, starts_at, ends_at) WHERE day_of_week IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX sector_shift_range_weekday_duplicate_uq ON sector_shift_ranges (shift_sheet_version_id, sector_id, day_of_week, shift_name, starts_at, ends_at) WHERE day_of_week IS NOT NULL;--> statement-breakpoint
ALTER TABLE shift_sheet_versions ADD COLUMN csv_format smallint NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE shift_sheet_versions ADD CONSTRAINT shift_sheet_csv_format_check CHECK (csv_format IN (1, 2));--> statement-breakpoint
ALTER TABLE submission_sessions ALTER COLUMN shift_range_id DROP NOT NULL;--> statement-breakpoint
ALTER TABLE submission_sessions ALTER COLUMN shift_sheet_version_id DROP NOT NULL;--> statement-breakpoint
ALTER TABLE submission_sessions ADD CONSTRAINT submission_session_version_fk FOREIGN KEY (shift_sheet_version_id) REFERENCES shift_sheet_versions(id) ON DELETE RESTRICT;--> statement-breakpoint

CREATE TABLE sector_shift_days (
  shift_sheet_version_id integer NOT NULL REFERENCES shift_sheet_versions(id) ON DELETE RESTRICT,
  sector_id integer NOT NULL REFERENCES sectors(id) ON DELETE RESTRICT,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  is_closed boolean NOT NULL,
  PRIMARY KEY (shift_sheet_version_id, sector_id, day_of_week)
);--> statement-breakpoint
ALTER TABLE sector_shift_days ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY fhdod_api_sector_shift_days_select ON sector_shift_days FOR SELECT TO fhdod_api USING (true);--> statement-breakpoint
CREATE POLICY fhdod_api_sector_shift_days_insert ON sector_shift_days FOR INSERT TO fhdod_api WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT ON sector_shift_days TO fhdod_api;--> statement-breakpoint

-- Historical employee snapshots remain untouched and readable. New imports never
-- insert into that table; no employee placeholder is created.
CREATE OR REPLACE FUNCTION validate_current_shift_sheet() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_current AND NEW.csv_format = 2 THEN
    IF EXISTS (
      SELECT 1 FROM sectors s CROSS JOIN generate_series(1, 7) d(day)
      LEFT JOIN sector_shift_days sd ON sd.shift_sheet_version_id = NEW.id AND sd.sector_id = s.id AND sd.day_of_week = d.day
      WHERE s.deleted_at IS NULL AND sd.sector_id IS NULL
    ) OR EXISTS (
      SELECT 1 FROM sector_shift_days sd
      WHERE sd.shift_sheet_version_id = NEW.id AND sd.is_closed = false
        AND NOT EXISTS (SELECT 1 FROM sector_shift_ranges r WHERE r.shift_sheet_version_id = sd.shift_sheet_version_id AND r.sector_id = sd.sector_id AND r.day_of_week = sd.day_of_week)
    ) THEN
      RAISE EXCEPTION 'A versão de horários está incompleta.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER validate_current_shift_sheet_before_write BEFORE INSERT OR UPDATE OF is_current ON shift_sheet_versions FOR EACH ROW EXECUTE FUNCTION validate_current_shift_sheet();
