export function shouldStartResourceIntensiveSchedulers(env: NodeJS.ProcessEnv = process.env): boolean {
  const override = String(env.RESOURCE_INTENSIVE_SCHEDULERS_ENABLED || "").trim().toLowerCase();
  if (override === "true") return true;
  if (override === "false") return false;

  const isReplitDeployment = env.REPLIT_DEPLOYMENT === "1"
    || Boolean(String(env.REPLIT_DEPLOYMENT_ID || "").trim());
  return !(env.NODE_ENV === "production" && isReplitDeployment);
}
