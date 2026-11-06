-- NPS global is resolved dynamically. Sector rows are valid only for
-- selected-sector overrides; legacy global rows closed by 0003 remain history.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.sector_nps_assignments a
    JOIN public.questions q ON q.id = a.question_id
    WHERE q.question_kind <> 'standard'
       OR q.is_nps = false
       OR (q.scope = 'selected_sectors' AND a.assignment_source <> 'specific')
       OR (q.scope <> 'selected_sectors' AND (a.ended_at IS NULL OR a.assignment_source <> 'global'))
  ) THEN
    RAISE EXCEPTION 'Existem vínculos NPS incompatíveis com o escopo; corrija os dados antes de aplicar a migration 0007.';
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

  IF TG_TABLE_NAME = 'sector_nps_assignments' THEN
    IF linked_question.question_kind <> 'standard' OR NOT linked_question.is_nps THEN
      RAISE EXCEPTION 'Vínculos NPS exigem pergunta NPS padrão.' USING ERRCODE = '23514';
    END IF;
    IF (TG_OP = 'INSERT' OR NEW.question_id IS DISTINCT FROM OLD.question_id OR NEW.assignment_source IS DISTINCT FROM OLD.assignment_source)
       AND (linked_question.scope <> 'selected_sectors' OR NEW.assignment_source <> 'specific') THEN
      RAISE EXCEPTION 'Vínculos NPS novos exigem override específico de pergunta com escopo setorial.' USING ERRCODE = '23514';
    END IF;
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

  IF NEW.scope IS DISTINCT FROM OLD.scope
     AND EXISTS (SELECT 1 FROM public.sector_nps_assignments WHERE question_id = NEW.id) THEN
    RAISE EXCEPTION 'Não é permitido alterar o escopo de um NPS com vínculos históricos.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS questions_validate_linked_question_classification ON public.questions;--> statement-breakpoint
CREATE TRIGGER questions_validate_linked_question_classification
BEFORE UPDATE OF question_kind, is_nps, scope ON public.questions
FOR EACH ROW EXECUTE FUNCTION public.validate_question_classification_integrity();
