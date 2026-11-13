import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { resolveDatabaseConnectionString } from "./database-url";

const pool = new Pool({
  connectionString: resolveDatabaseConnectionString(),
  allowExitOnIdle: true,
});

export const db = drizzle(pool);
