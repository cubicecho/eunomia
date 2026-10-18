CREATE TABLE "oidc_settings" (
	"id" text PRIMARY KEY DEFAULT 'oidc',
	"issuer" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text,
	"client_auth" text DEFAULT 'client_secret_basic' NOT NULL,
	"name" text NOT NULL,
	"registration_access_token" text,
	"registration_client_uri" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oidc_settings_singleton" CHECK ("id" = 'oidc')
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- An instance that already has accounts gets its oldest one as the admin, the
-- account whoever set it up made first. A fresh one gets its first account.
UPDATE "user" SET "is_admin" = true WHERE "id" = (SELECT "id" FROM "user" ORDER BY "created_at", "id" LIMIT 1);
