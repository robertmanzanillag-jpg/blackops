/** Code-owned write scope for the Asistente factory. Operator configuration can
 * only narrow these roots; it can never re-enable a denied path. The same checks
 * run at configuration, per-order selection, export, review and the GitHub write
 * boundary so a single bypass cannot publish a protected file. */
export const FACTORY_DEFAULT_WRITE_ROOTS = Object.freeze(["server/", "client/", "shared/", "tests/"] as const);
/** Any path segment with one of these names is denied (root or nested). */
export const FACTORY_DENIED_DIRECTORIES = Object.freeze([".github", ".claude", ".agents", "credentials", "secrets", "migrations", "drizzle", "node_modules", "dist", ".git"] as const);
/** Exact file names denied at any depth (case-insensitive). */
export const FACTORY_DENIED_FILE_NAMES = Object.freeze(["package.json", "package-lock.json", "pnpm-lock.yaml", ".replit", "replit.nix", "drizzle.config.ts", "AGENTS.md", "CLAUDE.md"] as const);
export const FACTORY_MAX_FILES_PER_ORDER = 8;
export const FACTORY_MAX_DRAFT_PULL_REQUESTS_PER_DAY = 10;
const deniedDirectories = new Set(FACTORY_DENIED_DIRECTORIES.map(name => name.toLowerCase()));
const deniedFiles = new Set(FACTORY_DENIED_FILE_NAMES.map(name => name.toLowerCase()));
// Pre-existing sensitive-name guard retained from the two-file scope.
const sensitive = /kong|software-factory|office-token-budget|credit|auth|permission|payment|migration/i;

/** True when the path is malformed or protected regardless of configured roots. */
export function isFactoryWritePathDenied(path: unknown): boolean {
  if (typeof path !== "string" || !path || path.length > 1000 || path.startsWith("/") || /^[a-z]:/i.test(path) || /[\\:\x00-\x20\x7f]/.test(path) || path.includes("..")) return true;
  if (path !== path.normalize("NFC")) return true;
  const parts = path.split("/");
  if (parts.some(part => !part || part === "." || /[. ]$/.test(part))) return true;
  const lower = parts.map(part => part.toLowerCase()), name = lower[lower.length - 1];
  if (lower.slice(0, -1).some(part => deniedDirectories.has(part)) || deniedDirectories.has(name)) return true;
  if (lower.some(part => /^\.env(?:\.|$)/.test(part) || /^(?:\.ssh|\.aws|id_rsa|id_ed25519)$/.test(part))) return true;
  if (deniedFiles.has(name) || /\.(?:pem|key|p12|pfx)$/.test(name)) return true;
  if (lower[0] === "script" && lower.length > 1 && lower[1].startsWith("replit-")) return true;
  return sensitive.test(path);
}

/** Roots are directory prefixes ending in "/", each a default root or a subfolder. */
export function validateFactoryWriteRoots(roots: unknown): string[] {
  if (!Array.isArray(roots) || !roots.length || roots.length > 16) throw Error("FACTORY_WRITE_ROOTS_INVALID");
  const result: string[] = [];
  for (const root of roots) {
    if (typeof root !== "string" || !root.endsWith("/") || !FACTORY_DEFAULT_WRITE_ROOTS.some(base => root.startsWith(base)) || isFactoryWritePathDenied(root.slice(0, -1)) || result.includes(root)) throw Error("FACTORY_WRITE_ROOTS_INVALID");
    result.push(root);
  }
  return result;
}

export function isFactoryWritePathAllowed(path: unknown, roots: readonly string[] = FACTORY_DEFAULT_WRITE_ROOTS): path is string {
  return typeof path === "string" && !isFactoryWritePathDenied(path) && roots.some(root => path.startsWith(root) && path.length > root.length);
}

/** Validates one order's explicit, persisted file list. Fails closed. */
export function validateFactoryOrderPaths(paths: unknown, options: { roots: readonly string[]; maxFiles: number }): string[] {
  const roots = validateFactoryWriteRoots(options.roots);
  if (!Number.isSafeInteger(options.maxFiles) || options.maxFiles < 1 || options.maxFiles > FACTORY_MAX_FILES_PER_ORDER) throw Error("FACTORY_ORDER_PATHS_INVALID");
  if (!Array.isArray(paths) || !paths.length || paths.length > options.maxFiles) throw Error("FACTORY_ORDER_PATHS_INVALID");
  const seen = new Set<string>();
  for (const path of paths) {
    if (!isFactoryWritePathAllowed(path, roots)) throw Error("FACTORY_ORDER_PATH_DENIED");
    const folded = path.toLowerCase();
    if (seen.has(folded)) throw Error("FACTORY_ORDER_PATHS_INVALID");
    seen.add(folded);
  }
  return [...paths];
}

/** Start of the UTC day containing now, as an ISO timestamp. */
export const utcDayStart = (now: Date) => `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
