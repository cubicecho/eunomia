CREATE TABLE "pings" (
	"device_id" text,
	"captured_at" timestamp with time zone,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "pings_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"app" text,
	"title" text,
	"context" text,
	"idle_seconds" integer NOT NULL,
	CONSTRAINT "pings_pkey" PRIMARY KEY("device_id","captured_at","seq")
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "ping_log_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "replay_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activities" ALTER COLUMN "active_seconds" SET DATA TYPE double precision USING "active_seconds"::double precision;--> statement-breakpoint
ALTER TABLE "summaries" ALTER COLUMN "seconds" SET DATA TYPE double precision USING "seconds"::double precision;--> statement-breakpoint
ALTER TABLE "pings" ADD CONSTRAINT "pings_device_id_devices_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE;--> statement-breakpoint
-- Every device that already has history has it from pings no log ever held.
-- Mark its log complete only from the end of that history, so replay never
-- rebuilds over activities it has no pings for: the latest lastActiveAt, or —
-- when retention pruned every activity and only summaries remain — now.
-- Devices with no history at all keep NULL: their log is complete from the
-- first ping.
UPDATE "devices" d SET "ping_log_from" = COALESCE(
	(SELECT max(a."last_active_at") FROM "activities" a WHERE a."device_id" = d."id"),
	CASE WHEN EXISTS (SELECT 1 FROM "summaries" s WHERE s."device_id" = d."id") THEN now() END
);
