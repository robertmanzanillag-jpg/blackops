import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { resolveDatabaseConnectionString } from "./database-url";
import { blackopsApplicationName } from "./agent-council-store";

const pool = new Pool({
  connectionString: resolveDatabaseConnectionString(),
  allowExitOnIdle: true,
  application_name: blackopsApplicationName("web-db"),
});

export const db = drizzle(pool);
