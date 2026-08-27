CREATE TABLE "merge_rules" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"from_app" text NOT NULL,
	"from_context" text,
	"to_app" text NOT NULL,
	"to_context" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "merge_rules_source_idx" UNIQUE NULLS NOT DISTINCT("user_id","from_app","from_context")
);
--> statement-breakpoint
CREATE INDEX "merge_rules_user_idx" ON "merge_rules" ("user_id");--> statement-breakpoint
ALTER TABLE "merge_rules" ADD CONSTRAINT "merge_rules_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;