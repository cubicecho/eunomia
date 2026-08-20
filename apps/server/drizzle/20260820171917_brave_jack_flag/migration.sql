CREATE TABLE "summaries" (
	"id" text PRIMARY KEY,
	"device_id" text NOT NULL,
	"day" text NOT NULL,
	"app" text NOT NULL,
	"context" text,
	"category_id" text,
	"seconds" real DEFAULT 0 NOT NULL,
	CONSTRAINT "summaries_key_idx" UNIQUE NULLS NOT DISTINCT("device_id","day","app","context","category_id")
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "rolled_up" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_device_id_devices_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "summaries" ADD CONSTRAINT "summaries_category_id_categories_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL;