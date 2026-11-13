import { spawn } from "node:child_process";
import path from "node:path";

const OUTPUT_LIMIT = 1024 * 1024;
const PROMPT_LIMIT = 64 * 1024;
const SAFE_SETTINGS = JSON.stringify({ disableAllHooks: true });

export type OfficeClaudeProbe = { status: "ready" | "blocked"; reason: string; checkedAt: string };
export type OfficeClaudeResult = { text: string; sessionId: string; completedAt: string };
export type OfficeClaudeProcessRequest = {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  input: string;
  timeoutMs: number;
  maxOutputBytes: number;
  shell: false;
};
export type OfficeClaudeProcessResult = {
  code: number | null;
  stdout: string;
  stderr?: string;
  timedOut?: boolean;
  outputLimitExceeded?: boolean;
};
export type OfficeClaudeRunner = (request: OfficeClaudeProcessRequest) => Promise<OfficeClaudeProcessResult>;

export class OfficeClaudeError extends Error {
  constructor(public readonly code: string, reason: string) {
    super(reason);
    this.name = "OfficeClaudeError";
  }
}

// Deliberate allowlist: no API keys, API helpers, cloud routing, NODE_OPTIONS,
// or shell startup settings are inherited by the subscription-only subprocess.
function subscriptionEnvironment(source: NodeJS.ProcessEnv, subscriptionToken?: string): NodeJS.ProcessEnv {
  const allowed = new Set([
    "path", "pathext", "systemroot", "windir", "home", "userprofile", "appdata",
    "localappdata", "temp", "tmp", "lang", "lc_all", "claude_config_dir",
  ]);
  const result: NodeJS.ProcessEnv = {};
  for (const key of Object.keys(source)) {
    if (!allowed.has(key.toLowerCase())) continue;
    const value = source[key];
    if (value !== undefined) result[key] = value;
  }
  // Official claude setup-token output is an explicit subscription-only mode.
  // Do not even read this credential from the environment in stored-login mode.
  if (subscriptionToken !== undefined) result.CLAUDE_CODE_OAUTH_TOKEN = subscriptionToken;
  return result;
}

export const officeClaudeProcessRunner: OfficeClaudeRunner = (request) => new Promise((resolve, reject) => {
  const child = spawn(request.executable, request.args, {
    cwd: request.cwd, env: request.env, shell: false, windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let outputBytes = 0;
  let timedOut = false;
  let outputLimitExceeded = false;
  const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, request.timeoutMs);
  const collect = (chunk: Buffer, target: "stdout" | "stderr") => {
    outputBytes += chunk.length;
    if (outputBytes > request.maxOutputBytes) {
      outputLimitExceeded = true;
      child.kill("SIGKILL");
      return;
    }
    if (target === "stdout") stdout.push(chunk);
    else stderr.push(chunk);
  };
  child.stdout.on("data", (chunk: Buffer) => collect(chunk, "stdout"));
  child.stderr.on("data", (chunk: Buffer) => collect(chunk, "stderr"));
  child.once("error", (error) => { clearTimeout(timer); reject(error); });
  child.once("close", (code) => {
    clearTimeout(timer);
    resolve({ code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), timedOut, outputLimitExceeded });
  });
  // A CLI that exits early may close stdin before its output is delivered.
  child.stdin.on("error", () => {});
  child.stdin.end(request.input);
});

export function createOfficeClaude(options: {
  runner?: OfficeClaudeRunner;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  now?: () => Date;
} = {}) {
  const runner = options.runner || officeClaudeProcessRunner;
  const now = options.now || (() => new Date());
  // Configuration is server-owned, never sourced from a chat/API request.
  const cwd = options.cwd || process.cwd();
  const getConfig = () => {
    try {
      const source = options.env || process.env;
      const executable = source.OFFICE_CLAUDE_EXECUTABLE?.trim() || "claude";
      if (executable !== "claude" && !(
        (path.isAbsolute(executable) || path.win32.isAbsolute(executable)) &&
        (process.platform !== "win32" || /\.exe$/i.test(executable))
      )) throw new OfficeClaudeError("invalid_executable", "La ruta configurada de Claude no es un ejecutable absoluto valido.");
      const authMode = source.OFFICE_CLAUDE_AUTH_MODE?.trim() || "stored-session";
      if (authMode !== "stored-session" && authMode !== "subscription-token") {
        throw new OfficeClaudeError("invalid_auth_mode", "El modo de autenticacion de Claude no es valido.");
      }
      let subscriptionToken: string | undefined;
      if (authMode === "subscription-token") {
        subscriptionToken = source.CLAUDE_CODE_OAUTH_TOKEN?.trim();
        if (!subscriptionToken || /[\s\x00-\x1f\x7f]/.test(subscriptionToken)) {
          throw new OfficeClaudeError("subscription_token_required", "Configura un token oficial de suscripcion para el ejecutor de Claude.");
        }
      }
      return { executable, authMode, env: subscriptionEnvironment(source, subscriptionToken) };
    } catch (error) {
      if (error instanceof OfficeClaudeError) throw error;
      throw new OfficeClaudeError("invalid_configuration", "No se pudo leer la configuracion autorizada de Claude.");
    }
  };
  const execute = async (args: string[], input: string, timeoutMs: number, config: ReturnType<typeof getConfig>) => {
    let result: OfficeClaudeProcessResult;
    try {
      result = await runner({ executable: config.executable, env: config.env, args, cwd, input, timeoutMs, maxOutputBytes: OUTPUT_LIMIT, shell: false });
    } catch (error) {
      if (error instanceof OfficeClaudeError) throw error;
      throw new OfficeClaudeError("cli_unavailable", "Claude CLI no esta disponible en este servidor.");
    }
    if (result.timedOut) throw new OfficeClaudeError("timeout", "Claude excedio el tiempo de espera.");
    if (result.outputLimitExceeded || Buffer.byteLength(result.stdout, "utf8") + Buffer.byteLength(result.stderr || "", "utf8") > OUTPUT_LIMIT) {
      throw new OfficeClaudeError("output_limit", "La respuesta de Claude excedio el limite permitido.");
    }
    if (result.code !== 0) throw new OfficeClaudeError("cli_failed", "Claude no pudo completar la operacion.");
    try {
      const parsed: unknown = JSON.parse(result.stdout);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      return parsed as Record<string, unknown>;
    } catch {
      throw new OfficeClaudeError("invalid_output", "Claude devolvio una respuesta no verificable.");
    }
  };
  const probeConfiguredClaude = async (config: ReturnType<typeof getConfig>): Promise<OfficeClaudeProbe> => {
    try {
      const auth = await execute(["--safe-mode", "--settings", SAFE_SETTINGS, "auth", "status"], "", 15_000, config);
      const correctMethod = config.authMode === "subscription-token"
        ? auth.authMethod === "oauth_token" && auth.apiProvider === "firstParty"
        : auth.authMethod === "claude.ai" && (auth.apiProvider === undefined || auth.apiProvider === "firstParty");
      if (auth.loggedIn !== true || !correctMethod) {
        throw new OfficeClaudeError("subscription_auth_required", "Inicia sesion en Claude CLI con tu suscripcion de Claude; no se permite autenticacion API.");
      }
      // auth status can report a configured OAuth token without checking it on
      // the network. Only a completed real session below proves execution.
      return { status: "ready", reason: "Claude CLI tiene autenticacion de suscripcion configurada. El acceso se confirma al completar una ejecucion real.", checkedAt: now().toISOString() };
    } catch (error) {
      return { status: "blocked", reason: error instanceof OfficeClaudeError ? error.message : "No se pudo verificar Claude CLI.", checkedAt: now().toISOString() };
    }
  };
  const probeOfficeClaude = async (): Promise<OfficeClaudeProbe> => {
    try { return await probeConfiguredClaude(getConfig()); }
    catch (error) {
      return { status: "blocked", reason: error instanceof OfficeClaudeError ? error.message : "No se pudo comprobar la configuracion de Claude.", checkedAt: now().toISOString() };
    }
  };
  const runOfficeClaude = async (prompt: string): Promise<OfficeClaudeResult> => {
    if (typeof prompt !== "string" || !prompt.trim() || Buffer.byteLength(prompt, "utf8") > PROMPT_LIMIT) {
      throw new OfficeClaudeError("invalid_prompt", "El mensaje debe contener texto y no superar 64 KiB.");
    }
    // Pin the configured authentication environment across probe and execution.
    const config = getConfig();
    const probe = await probeConfiguredClaude(config);
    if (probe.status !== "ready") throw new OfficeClaudeError("blocked", probe.reason);
    const result = await execute([
      "-p", "--safe-mode", "--tools", "", "--disallowedTools", "mcp__*",
      "--strict-mcp-config", "--mcp-config", JSON.stringify({ mcpServers: {} }),
      "--settings", SAFE_SETTINGS, "--no-session-persistence", "--output-format", "json", "--max-turns", "2",
    ], prompt, 120_000, config);
    if (result.type !== "result" || result.subtype !== "success" || result.is_error !== false ||
      typeof result.result !== "string" || !result.result.trim() ||
      typeof result.session_id !== "string" || !result.session_id.trim()) {
      throw new OfficeClaudeError("invalid_result", "Claude no entrego un resultado exitoso con sesion verificable.");
    }
    return { text: result.result.trim(), sessionId: result.session_id.trim(), completedAt: now().toISOString() };
  };
  return { probeOfficeClaude, runOfficeClaude };
}

const officeClaude = createOfficeClaude();
export const probeOfficeClaude = officeClaude.probeOfficeClaude;
export const runOfficeClaude = officeClaude.runOfficeClaude;
