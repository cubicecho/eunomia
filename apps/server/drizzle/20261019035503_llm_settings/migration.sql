CREATE TABLE "llm_settings" (
	"id" text PRIMARY KEY DEFAULT 'llm',
	"base_url" text NOT NULL,
	"model" text NOT NULL,
	"api_key" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "llm_settings_singleton" CHECK ("id" = 'llm')
);
