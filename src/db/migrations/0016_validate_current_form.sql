-- A sector without a publication has no row. A current pointer must target a complete snapshot.
ALTER TABLE sector_current_forms ALTER COLUMN form_version_id SET NOT NULL;--> statement-breakpoint
CREATE FUNCTION validate_current_form() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM submission_form_questions WHERE form_version_id=NEW.form_version_id AND is_nps) <> 1
     OR NOT EXISTS (SELECT 1 FROM submission_form_questions
                    WHERE form_version_id=NEW.form_version_id AND question_kind='standard' AND NOT is_nps) THEN
    RAISE EXCEPTION 'Current form must contain one NPS and a standard question' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER sector_current_form_complete BEFORE INSERT OR UPDATE OF form_version_id ON sector_current_forms
  FOR EACH ROW EXECUTE FUNCTION validate_current_form();
