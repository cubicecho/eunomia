CREATE TABLE "instance_secrets" (
	"name" text PRIMARY KEY,
	"value" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
