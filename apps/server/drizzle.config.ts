import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    // Default matches the compose postgres published on host port 5433.
    url: process.env.DATABASE_URL ?? 'postgres://eunomia:eunomia@localhost:5433/eunomia',
  },
});
