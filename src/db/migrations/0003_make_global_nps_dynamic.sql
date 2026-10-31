-- Fase 2: global NPS is inherited dynamically, never materialized per sector.
-- Existing global rows are retained as history and closed at migration time.
-- Specific rows remain active overrides and therefore continue to win per sector.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.sector_nps_assignments a
    JOIN public.questions q ON q.id = a.question_id
    WHERE a.ended_at IS NULL
      AND a.assignment_source = 'global'
      AND q.is_nps = true
      AND q.scope = 'all_sectors'
  ) THEN
    UPDATE public.sector_nps_assignments a
    SET ended_at = now()
    FROM public.questions q
    WHERE q.id = a.question_id
      AND a.ended_at IS NULL
      AND a.assignment_source = 'global'
      AND q.is_nps = true
      AND q.scope = 'all_sectors';
  END IF;
END
$$;

-- The existing partial unique index remains the concurrency guard for active
-- specific overrides. Global uniqueness is enforced by
-- questions_one_active_global_nps_uq.
