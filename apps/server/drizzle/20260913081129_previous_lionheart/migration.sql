CREATE TABLE "focus_segments" (
	"id" text PRIMARY KEY,
	"device_id" text NOT NULL,
	"activity_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "focus_segments_device_started_idx" ON "focus_segments" ("device_id","started_at");--> statement-breakpoint
CREATE INDEX "focus_segments_activity_started_idx" ON "focus_segments" ("activity_id","started_at");--> statement-breakpoint
ALTER TABLE "focus_segments" ADD CONSTRAINT "focus_segments_device_id_devices_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "focus_segments" ADD CONSTRAINT "focus_segments_activity_id_activities_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE;