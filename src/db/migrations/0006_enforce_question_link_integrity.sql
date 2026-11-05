-- Questions are polymorphic. Foreign keys alone cannot ensure that each
-- assignment table references a compatible question kind, so validate both
-- new links and later classification changes without deleting history.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM question_sector_assignments a
    JOIN questions q ON q.id = a.question_id
    WHERE q.question_kind <> 'standard' OR q.is_nps = true
  ) OR EXISTS (
    SELECT 1
    FROM sector_nps_assignments a
    JOIN questions q ON q.id = a.question_id
    WHERE q.question_kind <> 'standard' OR q.is_nps = false
  ) THEN
    RAISE EXCEPTION 'Existem vínculos de perguntas incompatíveis; corrija os dados antes de aplicar a migration 0006.';
  END IF;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.validate_question_link_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  linked_question public.questions%ROWTYPE;
BEGIN
  SELECT * INTO linked_question FROM public.questions WHERE id = NEW.question_id;

  IF TG_TABLE_NAME = 'question_sector_assignments'
     AND (linked_question.question_kind <> 'standard' OR linked_question.is_nps) THEN
    RAISE EXCEPTION 'Vínculos comuns exigem pergunta padrão não-NPS.' USING ERRCODE = '23514';
  END IF;

  IF TG_TABLE_NAME = 'sector_nps_assignments'
     AND (linked_question.question_kind <> 'standard' OR NOT linked_question.is_nps) THEN
    RAISE EXCEPTION 'Vínculos NPS exigem pergunta NPS padrão.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.validate_question_classification_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.question_kind <> 'standard' OR NEW.is_nps)
     AND EXISTS (SELECT 1 FROM public.question_sector_assignments WHERE question_id = NEW.id) THEN
    RAISE EXCEPTION 'Não é permitido tornar incompatível uma pergunta com vínculos comuns históricos.' USING ERRCODE = '23514';
  END IF;

  IF (NEW.question_kind <> 'standard' OR NOT NEW.is_nps)
     AND EXISTS (SELECT 1 FROM public.sector_nps_assignments WHERE question_id = NEW.id) THEN
    RAISE EXCEPTION 'Não é permitido tornar incompatível uma pergunta com vínculos NPS históricos.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;--> statement-breakpoint

CREATE TRIGGER question_sector_assignments_validate_question_kind
BEFORE INSERT OR UPDATE OF question_id ON public.question_sector_assignments
FOR EACH ROW EXECUTE FUNCTION public.validate_question_link_integrity();--> statement-breakpoint

CREATE TRIGGER sector_nps_assignments_validate_question_kind
BEFORE INSERT OR UPDATE OF question_id ON public.sector_nps_assignments
FOR EACH ROW EXECUTE FUNCTION public.validate_question_link_integrity();--> statement-breakpoint

CREATE TRIGGER questions_validate_linked_question_classification
BEFORE UPDATE OF question_kind, is_nps ON public.questions
FOR EACH ROW EXECUTE FUNCTION public.validate_question_classification_integrity();
