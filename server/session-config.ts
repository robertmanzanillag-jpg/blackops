import session, { type SessionOptions } from "express-session";
import connectPgSimple from "connect-pg-simple";
import { resolveDatabaseConnectionString } from "./database-url";
import { resolveSessionRuntimeSettings, type SessionRuntimeSettings } from "./session-config-core";

export { resolveSessionRuntimeSettings };
export type { SessionRuntimeSettings, SessionStoreKind } from "./session-config-core";

export function createSessionMiddleware(settings = resolveSessionRuntimeSettings()) {
  if (!settings.enabled || !settings.secret) return null;

  const options: SessionOptions = {
    name: "blackops.sid",
    secret: settings.secret,
    proxy: settings.secureCookie,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: settings.secureCookie ? "auto" : false,
      maxAge: 1000 * 60 * 60 * 24 * 30,
    },
  };

  if (settings.storeKind === "postgres") {
    const PgSession = connectPgSimple(session);
    options.store = new PgSession({
      conString: resolveDatabaseConnectionString(),
      createTableIfMissing: true,
      tableName: "user_sessions",
    });
  }

  return session(options);
}
