ALTER TABLE "category_rules" ADD COLUMN "pack" text;--> statement-breakpoint
ALTER TABLE "category_rules" ADD COLUMN "pack_version" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "category_rules_user_pack_idx" ON "category_rules" ("user_id","pack");