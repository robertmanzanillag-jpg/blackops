// Which GitHub credential the web server can use, and an honest reason when it has none.
// Dependency-free so it can be unit tested without @octokit.
//
// Only GITHUB_TOKEN / GH_TOKEN or the Replit GitHub connector authenticate the shared GitHub
// client. SOFTWARE_FACTORY_GITHUB_TOKEN belongs to the software-factory operator launcher, which
// reads it from private files for one repository; it is deliberately NOT reused here (least
// privilege), so its presence alone never means "GitHub connected".
import { hasRealValue } from "./ceo-doctor-cli";

export const GITHUB_TOKEN_ENV_NAMES = ["GITHUB_TOKEN", "GH_TOKEN"] as const;
const GITHUB_TOKEN_FORMAT = /^(ghp|github_pat|gho|ghu|ghs|ghr)_[A-Za-z0-9_]+$/;

export type GitHubTokenEnvDiagnosis = {
  token: string | null;
  source: (typeof GITHUB_TOKEN_ENV_NAMES)[number] | null;
  // Names that hold a value in an unrecognized format (never the value itself).
  invalidFormat: string[];
  connectorIdentity: boolean;
  factoryTokenOnly: boolean;
};

export function diagnoseGitHubTokenEnv(env: NodeJS.ProcessEnv = process.env): GitHubTokenEnvDiagnosis {
  const invalidFormat: string[] = [];
  let token: string | null = null;
  let source: GitHubTokenEnvDiagnosis["source"] = null;
  for (const name of GITHUB_TOKEN_ENV_NAMES) {
    const value = env[name];
    if (!hasRealValue(value)) continue;
    const trimmed = value.trim();
    if (GITHUB_TOKEN_FORMAT.test(trimmed)) {
      if (!token) { token = trimmed; source = name; }
    } else {
      invalidFormat.push(name);
    }
  }
  const connectorIdentity = Boolean(env.REPL_IDENTITY?.trim() || env.WEB_REPL_RENEWAL?.trim()) && Boolean(env.REPLIT_CONNECTORS_HOSTNAME?.trim());
  return { token, source, invalidFormat, connectorIdentity, factoryTokenOnly: !token && hasRealValue(env.SOFTWARE_FACTORY_GITHUB_TOKEN) };
}

/** Spanish, credential-free reason shown in the office when GitHub is not usable. */
export function gitHubSetupReason(diagnosis: GitHubTokenEnvDiagnosis, failure?: { stage: "connector" | "api"; status?: number }): string {
  const parts: string[] = [];
  if (failure?.stage === "api") {
    parts.push(failure.status === 401 || failure.status === 403
      ? `GitHub rechazo la credencial (${failure.status}); renueva el token o reconecta el conector.`
      : `GitHub no respondio${failure.status ? ` (${failure.status})` : ""}; puede ser temporal.`);
  } else if (diagnosis.invalidFormat.length) {
    parts.push(`${diagnosis.invalidFormat.join(" y ")} tiene un formato no reconocido (se espera ghp_ o github_pat_).`);
  } else if (!diagnosis.connectorIdentity) {
    parts.push("Falta el Secret GITHUB_TOKEN (o GH_TOKEN) y no hay identidad de Replit para usar el conector GitHub.");
  } else {
    parts.push("Falta el Secret GITHUB_TOKEN (o GH_TOKEN) y el conector GitHub de Replit no esta autorizado.");
  }
  if (diagnosis.factoryTokenOnly) parts.push("SOFTWARE_FACTORY_GITHUB_TOKEN es exclusivo de la fabrica y no se reutiliza.");
  return parts.join(" ");
}
