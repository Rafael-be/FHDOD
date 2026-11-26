CREATE TABLE tv_wall_configuration (
  id integer PRIMARY KEY CHECK (id = 1),
  settings jsonb NOT NULL CHECK (jsonb_typeof(settings) = 'object')
);--> statement-breakpoint
INSERT INTO tv_wall_configuration (id, settings)
VALUES (1, '{"indicators":[],"sectorIds":[],"periodDays":7,"refreshSeconds":60}');--> statement-breakpoint
ALTER TABLE tv_wall_configuration ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY fhdod_api_tv_wall_select ON tv_wall_configuration FOR SELECT TO fhdod_api USING (id = 1);--> statement-breakpoint
CREATE POLICY fhdod_api_tv_wall_update ON tv_wall_configuration FOR UPDATE TO fhdod_api USING (id = 1) WITH CHECK (id = 1);--> statement-breakpoint
GRANT SELECT, UPDATE (settings) ON tv_wall_configuration TO fhdod_api;
