-- better-auth 1.7 scopes account identity by issuer. Every row here was
-- written by this server's own credential provider, so the issuer it would
-- have stamped is 'local:<provider_id>' — backfill that before the column
-- goes NOT NULL, or the alter fails on any database with users in it.
ALTER TABLE "account" ADD COLUMN "issuer" text;--> statement-breakpoint
UPDATE "account" SET "issuer" = 'local:' || "provider_id" WHERE "issuer" IS NULL;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_account_id_idx" ON "account" ("issuer","account_id");
