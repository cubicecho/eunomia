CREATE TABLE "erasures" (
	"id" text PRIMARY KEY,
	"device_id" text NOT NULL,
	"from" timestamp with time zone,
	"to" timestamp with time zone NOT NULL,
	"app" text,
	"context" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "retention_days" integer;--> statement-breakpoint
CREATE INDEX "erasures_device_to_idx" ON "erasures" ("device_id","to");--> statement-breakpoint
ALTER TABLE "erasures" ADD CONSTRAINT "erasures_device_id_devices_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE;