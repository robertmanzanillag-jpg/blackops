import { hasRealValue } from "./ceo-doctor-cli";

export function resolveDatabaseConnectionString(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): string | undefined {
  if (!env.DATABASE_URL) {
    if (env.NODE_ENV === "production") {
      throw new Error("DATABASE_URL is required in production before starting the server.");
    }
    return undefined;
  }
  if (!hasRealValue(env.DATABASE_URL)) {
    throw new Error("DATABASE_URL is configured with a placeholder value. Set a real Postgres URL before starting the server.");
  }
  return env.DATABASE_URL;
}
