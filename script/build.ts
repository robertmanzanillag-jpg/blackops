import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { mkdir, rm, readFile, copyFile, writeFile } from "fs/promises";
import { spawn } from "child_process";
import { createRequire } from "node:module";
import { createOfficeCloudSchemaSql } from "../server/office-cloud-store";

function pipInstallEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PIP_CONFIG_FILE: process.platform === "win32" ? "NUL" : "/dev/null",
    PIP_USER: "false",
    PYTHONNOUSERSITE: "1",
  };
}

function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
  env: NodeJS.ProcessEnv = process.env,
  stdio: "inherit" | "ignore" = "inherit",
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio,
      env,
    });
    let didTimeout = false;
    const timer = setTimeout(() => {
      didTimeout = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (didTimeout) {
        reject(new Error(`${command} timed out`));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with ${code}`));
    });
  });
}

async function canRunPythonPip(): Promise<boolean> {
  try {
    await runCommand("python3", [
      "-c",
      "import pip; import xml.parsers.expat",
    ], 30 * 1000, pipInstallEnv(), "ignore");
    return true;
  } catch (error) {
    console.log(
      "[build] optional yt-dlp bundle unavailable: python3 cannot import pip/xml.parsers.expat in this environment.",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

async function bundleFreshYtDlp() {
  const targetDir = "dist/yt-dlp-python";
  await mkdir(targetDir, { recursive: true });
  if (!(await canRunPythonPip())) return;
  try {
    console.log("installing fresh yt-dlp for production...");
    await runCommand("python3", [
      "-m",
      "pip",
      "install",
      "--upgrade",
      "--target",
      targetDir,
      "yt-dlp[default]",
      "curl-cffi>=0.11",
    ], 3 * 60 * 1000, pipInstallEnv());
  } catch (error) {
    console.log("[build] optional yt-dlp bundle unavailable:", error instanceof Error ? error.message : error);
  }
}

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  // connect-pg-simple resolves this resource relative to the bundled __dirname.
  // Copying the library schema does not execute SQL or touch the database.
  await copyFile(createRequire(import.meta.url).resolve("connect-pg-simple/table.sql"), "dist/table.sql");

  await bundleFreshYtDlp();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    // The server is deliberately bundled to reduce Replit openat(2) calls.
    // Errors remain visible; esbuild's generic output-size glyph is not a
    // release warning for this minified server artifact.
    logLevel: "error",
  });

  await esbuild({
    entryPoints: ["script/compact-local-news-state.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/compact-local-news-state.cjs",
    minify: true,
    logLevel: "error",
  });

  await esbuild({
    entryPoints: ["script/office-worker.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/office-worker.cjs",
    define: { "process.env.NODE_ENV": '"production"' },
    minify: true,
    external: externals,
    logLevel: "error",
  });
  await esbuild({
    entryPoints: ["script/software-factory-worker.ts"],
    platform: "node", bundle: true, format: "cjs",
    outfile: "dist/software-factory-worker.cjs",
    define: { "process.env.NODE_ENV": '"production"' },
    minify: true, external: externals, logLevel: "error",
  });
  // Prepared artifact only: building never applies this migration.
  await writeFile("dist/office-cloud-schema.sql", createOfficeCloudSchemaSql(), "utf8");
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
