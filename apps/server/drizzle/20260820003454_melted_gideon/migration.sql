CREATE TABLE "context_rules" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"app_pattern" text,
	"title_pattern" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "context" text;--> statement-breakpoint
ALTER TABLE "category_rules" ADD COLUMN "context_pattern" text;--> statement-breakpoint
CREATE INDEX "context_rules_user_idx" ON "context_rules" ("user_id","priority");--> statement-breakpoint
ALTER TABLE "context_rules" ADD CONSTRAINT "context_rules_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;