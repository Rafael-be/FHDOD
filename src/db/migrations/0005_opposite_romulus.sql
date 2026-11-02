DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "employee_shift_assignments" AS assignment
    LEFT JOIN "employees" AS employee ON employee.id = assignment.employee_id
    WHERE employee.id IS NULL
       OR btrim(employee.employee_code) = ''
       OR btrim(employee.full_name) = ''
  ) THEN
    RAISE EXCEPTION
      'Não é possível preservar atribuições históricas: employee_id sem código ou nome de funcionário válido.';
  END IF;
END
$$;--> statement-breakpoint
DROP INDEX "employee_shift_date_assignment_uq";--> statement-breakpoint
DROP INDEX "employee_shift_weekday_assignment_uq";--> statement-breakpoint
ALTER TABLE "employee_shift_assignments" ALTER COLUMN "employee_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_shift_assignments" ADD COLUMN "employee_code" text;--> statement-breakpoint
ALTER TABLE "employee_shift_assignments" ADD COLUMN "employee_name" text;--> statement-breakpoint
UPDATE "employee_shift_assignments" AS assignment
SET employee_code = employee.employee_code,
    employee_name = employee.full_name
FROM "employees" AS employee
WHERE employee.id = assignment.employee_id;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "employee_shift_assignments"
    WHERE employee_code IS NULL
       OR employee_name IS NULL
       OR btrim(employee_code) = ''
       OR btrim(employee_name) = ''
  ) THEN
    RAISE EXCEPTION
      'Não é possível preservar atribuições históricas: o retropreenchimento de código ou nome falhou.';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "employee_shift_assignments" ALTER COLUMN "employee_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_shift_assignments" ALTER COLUMN "employee_name" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_shift_date_assignment_uq" ON "employee_shift_assignments" USING btree ("shift_range_id" int4_ops,lower(btrim("employee_code")),lower(btrim("employee_name")),"work_date" date_ops) WHERE (work_date IS NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX "employee_shift_weekday_assignment_uq" ON "employee_shift_assignments" USING btree ("shift_range_id" int4_ops,lower(btrim("employee_code")),lower(btrim("employee_name")),"day_of_week" int2_ops) WHERE (day_of_week IS NOT NULL);--> statement-breakpoint
ALTER TABLE "employee_shift_assignments" ADD CONSTRAINT "employee_shift_code_nonempty_check" CHECK (btrim(employee_code) <> '');--> statement-breakpoint
ALTER TABLE "employee_shift_assignments" ADD CONSTRAINT "employee_shift_name_nonempty_check" CHECK (btrim(employee_name) <> '');
