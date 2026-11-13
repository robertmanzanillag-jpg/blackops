import { defineConfig } from "drizzle-kit";
import "./server/env-loader";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Tables owned by explicit migration scripts or created at runtime are NOT in shared/schema.ts.
  // Without this filter `npm run db:push` proposes DROP TABLE for all of them (office council
  // state, office queue, factory, source documents, login sessions). Found by the release gate.
  // The office_* and software_factory_* name prefixes are RESERVED for tables created by the
  // migration scripts (script/office-*-migrate.ts, script/software-factory-migrate.ts): never name a
  // shared/schema.ts table with those prefixes, db:push would silently ignore it.
  tablesFilter: [
    "!agent_council_state",
    "!agent_office_cloud_jobs",
    "!office_*",
    "!software_factory_*",
    "!user_sessions",
  ],
});
