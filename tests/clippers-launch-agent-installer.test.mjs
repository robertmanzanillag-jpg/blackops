import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = process.cwd();
const installerPath = path.join(repoRoot, "script", "install-clippers-free-local-worker-launch-agent.sh");
const localtimeTarget = spawnSync("readlink", ["/etc/localtime"], { encoding: "utf8" }).stdout.trim();
const systemTimeZone = localtimeTarget.includes("/zoneinfo/") ? localtimeTarget.split("/zoneinfo/")[1] : "unknown";

async function writeContentConfig(root, mode = 0o600) {
  const configDirectory = path.join(root, "config");
  const configPath = path.join(configDirectory, "clippers-content-worker.json");
  await mkdir(configDirectory, { recursive: true });
  await writeFile(configPath, "{}\n", { mode });
  await chmod(configPath, mode);
  return configPath;
}

async function writeYoutubeConfigs(root, mode = 0o600) {
  const configDirectory = path.join(root, "config");
  await mkdir(configDirectory, { recursive: true });
  const deliveryConfig = path.join(configDirectory, "clippers-youtube-upload-packager.json");
  const selectedEnv = path.join(configDirectory, "clippers-youtube-delivery.env");
  await writeFile(deliveryConfig, "{}\n", { mode });
  await writeFile(selectedEnv, "CLIPPERS_YOUTUBE_PUBLISH_AUTHORIZED=false\n", { mode });
  await chmod(deliveryConfig, mode);
  await chmod(selectedEnv, mode);
  return { deliveryConfig, selectedEnv };
}

test("production runtime guard rejects untracked entrypoints and files", async () => {
  const installer = await readFile(installerPath, "utf8");
  assert.match(installer, /status --porcelain --untracked-files=all/);
  assert.match(installer, /ls-files --error-unmatch/);
  assert.match(installer, /installed and verified without kickstart/);
  assert.match(installer, /script\/clippers-content-local-worker\.mjs/);
  assert.match(installer, /script\/clippers-content-learning-ceo\.mjs/);
  assert.match(installer, /script\/clippers-motivation-shorts\.mjs/);
  assert.match(installer, /script\/clippers-sleep-video-generator\.mjs/);
  assert.match(installer, /script\/clippers-youtube-delivery-worker\.mjs/);
  assert.match(installer, /script\/run-clippers-youtube-delivery-worker\.sh/);
});

test("LaunchAgents bind configurable runtime/config roots and persist only explicit non-secret controls", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "clippers-launch-agent-home-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-launch-agent-workspace-"));
  try {
    const contentConfig = await writeContentConfig(workspaceRoot);
    const { deliveryConfig, selectedEnv } = await writeYoutubeConfigs(workspaceRoot);
    const result = spawnSync("zsh", [installerPath], {
      cwd: workspaceRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        CLIPPERS_LAUNCH_AGENT_DRY_RUN: "true",
        CLIPPERS_LAUNCH_AGENT_ALLOW_DEVELOPMENT_RUNTIME: "true",
        CLIPPERS_RUNTIME_ROOT: repoRoot,
        CLIPPERS_WORKSPACE_ROOT: workspaceRoot,
        CLIPPERS_CONFIG_ROOT: repoRoot,
        CLIPPERS_CONTENT_WORKER_CONFIG: contentConfig,
        CLIPPERS_YOUTUBE_DELIVERY_CONFIG: deliveryConfig,
        CLIPPERS_YOUTUBE_SELECTED_ENV: selectedEnv,
        CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED: "true",
        CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED: "true",
        CLIPPERS_METRICOOL_BLOG_ID: "6431687",
        CLIPPERS_TIKTOK_ACCOUNT: "streamersclipusa",
        CLIPPERS_TARGET_DAILY_CLIPS: "5",
        CLIPPERS_PUBLIC_MEDIA_PROVIDER: "google_drive",
        CLIPPERS_FREE_WORKER_CLEANUP_EXECUTE: "false",
        METRICOOL_USER_TOKEN: "must-not-persist",
        GOOGLE_DRIVE_REFRESH_TOKEN: "must-not-persist",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const plist = await readFile(
      path.join(home, "Library", "LaunchAgents", "com.blackops.clippers-free-worker.plist"),
      "utf8",
    );
    assert.match(plist, new RegExp(`<key>WorkingDirectory</key><string>${repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(plist, new RegExp(`<string>${repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/script/clippers-free-local-worker\\.mjs</string>`));
    assert.match(plist, new RegExp(`CLIPPERS_WORKSPACE_ROOT</key><string>${workspaceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(plist, new RegExp(`CLIPPERS_CONFIG_ROOT</key><string>${repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(plist, /CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED<\/key><string>true<\/string>/);
    assert.match(plist, /CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED<\/key><string>true<\/string>/);
    assert.match(plist, /CLIPPERS_METRICOOL_BLOG_ID<\/key><string>6431687<\/string>/);
    assert.match(plist, /<key>TZ<\/key><string>America\/New_York<\/string>/);
    assert.match(plist, /<key>StartCalendarInterval<\/key><dict><key>Hour<\/key><integer>7<\/integer><key>Minute<\/key><integer>0<\/integer>/);
    assert.doesNotMatch(plist, /StartInterval/);
    assert.doesNotMatch(
      plist,
      /must-not-persist|METRICOOL_USER_TOKEN|GOOGLE_DRIVE_REFRESH_TOKEN/,
    );
    const watchdogPlist = await readFile(
      path.join(home, "Library", "LaunchAgents", "com.blackops.clippers-daily-watchdog.plist"),
      "utf8",
    );
    assert.match(watchdogPlist, new RegExp(`${repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/script/clippers-daily-watchdog\\.mjs`));
    assert.match(watchdogPlist, /<key>StartCalendarInterval<\/key><dict><key>Hour<\/key><integer>10<\/integer><key>Minute<\/key><integer>0<\/integer>/);
    assert.match(watchdogPlist, /watchdog\.error\.log/);
    assert.match(watchdogPlist, /Library\/Logs\/BlackOps\/Clippers\/daily-watchdog\/watchdog\.error\.log/);
    assert.doesNotMatch(watchdogPlist, /reports\/clippers-daily-watchdog\/watchdog\.error\.log/);
    assert.doesNotMatch(watchdogPlist, /must-not-persist|METRICOOL_USER_TOKEN|GOOGLE_DRIVE_REFRESH_TOKEN/);
    const contentPlist = await readFile(
      path.join(home, "Library", "LaunchAgents", "com.blackops.clippers-content-worker.plist"),
      "utf8",
    );
    assert.match(contentPlist, new RegExp(`${repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/script/clippers-content-local-worker\\.mjs`));
    assert.match(contentPlist, /<string>--config<\/string>/);
    assert.match(contentPlist, new RegExp(`<string>${contentConfig.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</string>`));
    assert.match(contentPlist, /<key>StartCalendarInterval<\/key><dict><key>Hour<\/key><integer>4<\/integer><key>Minute<\/key><integer>0<\/integer>/);
    assert.match(contentPlist, /Library\/Logs\/BlackOps\/Clippers\/content-worker\/worker\.error\.log/);
    assert.match(contentPlist, /CLIPPERS_CONTENT_WORKER_CONFIG<\/key>/);
    assert.doesNotMatch(contentPlist, /CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED|CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED/);
    assert.doesNotMatch(contentPlist, /must-not-persist|METRICOOL_USER_TOKEN|GOOGLE_DRIVE_REFRESH_TOKEN/);
    const deliveryPlist = await readFile(
      path.join(home, "Library", "LaunchAgents", "com.blackops.clippers-youtube-delivery-worker.plist"),
      "utf8",
    );
    assert.match(deliveryPlist, /<string>\/bin\/zsh<\/string>/);
    assert.match(deliveryPlist, /run-clippers-youtube-delivery-worker\.sh/);
    assert.match(deliveryPlist, /<key>StartCalendarInterval<\/key><dict><key>Hour<\/key><integer>6<\/integer><key>Minute<\/key><integer>30<\/integer>/);
    assert.match(deliveryPlist, new RegExp(deliveryConfig.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(deliveryPlist, new RegExp(selectedEnv.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(deliveryPlist, /must-not-persist|CLIENT_SECRET|REFRESH_TOKEN|CLIPPERS_YOUTUBE_PUBLISH_AUTHORIZED<\/key>/);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("LaunchAgent does not install or start by default", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "clippers-launch-agent-default-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-launch-agent-default-workspace-"));
  try {
    const contentConfig = await writeContentConfig(workspaceRoot);
    const { deliveryConfig, selectedEnv } = await writeYoutubeConfigs(workspaceRoot);
    const env = { ...process.env, HOME: home };
    env.CLIPPERS_LAUNCH_AGENT_ALLOW_DEVELOPMENT_RUNTIME = "true";
    env.CLIPPERS_CONTENT_WORKER_CONFIG = contentConfig;
    env.CLIPPERS_YOUTUBE_DELIVERY_CONFIG = deliveryConfig;
    env.CLIPPERS_YOUTUBE_SELECTED_ENV = selectedEnv;
    delete env.CLIPPERS_LAUNCH_AGENT_DRY_RUN;
    const result = spawnSync("zsh", [installerPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /validated without installation/);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("LaunchAgent refuses a dirty development runtime unless the test-only override is explicit", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "clippers-launch-agent-dirty-runtime-"));
  const runtimeParent = await mkdtemp(path.join(os.tmpdir(), "clippers-launch-agent-dirty-checkout-"));
  const runtimeRoot = path.join(runtimeParent, "runtime");
  try {
    const sourceRefs = spawnSync("git", ["-C", repoRoot, "rev-parse", "HEAD", "refs/remotes/origin/main"], {
      encoding: "utf8",
    });
    assert.equal(sourceRefs.status, 0, sourceRefs.stderr);
    const [sourceHead, sourceOriginMain] = sourceRefs.stdout.trim().split(/\r?\n/);
    assert.match(sourceHead, /^[a-f0-9]{40}$/);
    assert.match(sourceOriginMain, /^[a-f0-9]{40}$/);
    const sourceBasedOnMain = spawnSync("git", ["-C", repoRoot, "merge-base", "--is-ancestor", sourceOriginMain, sourceHead], {
      encoding: "utf8",
    });
    assert.equal(sourceBasedOnMain.status, 0, sourceBasedOnMain.stderr);
    const clone = spawnSync("git", ["clone", "--quiet", "--no-hardlinks", repoRoot, runtimeRoot], {
      encoding: "utf8",
    });
    assert.equal(clone.status, 0, clone.stderr);
    const pinOriginMain = spawnSync("git", ["-C", runtimeRoot, "update-ref", "refs/remotes/origin/main", sourceHead], {
      encoding: "utf8",
    });
    assert.equal(pinOriginMain.status, 0, pinOriginMain.stderr);
    const detachMain = spawnSync("git", ["-C", runtimeRoot, "switch", "--detach", sourceHead], {
      encoding: "utf8",
    });
    assert.equal(detachMain.status, 0, detachMain.stderr);
    const headAtMain = spawnSync("git", ["-C", runtimeRoot, "rev-parse", "HEAD", "refs/remotes/origin/main"], {
      encoding: "utf8",
    });
    assert.equal(headAtMain.status, 0, headAtMain.stderr);
    const [runtimeHead, runtimeOriginMain] = headAtMain.stdout.trim().split(/\r?\n/);
    assert.equal(runtimeHead, sourceHead);
    assert.equal(runtimeOriginMain, sourceHead);
    const dirtyMarker = path.join(runtimeRoot, ".clippers-runtime-dirty-test");
    await writeFile(dirtyMarker, "intentional untracked fixture\n");
    const runtimeStatus = spawnSync("git", ["-C", runtimeRoot, "status", "--porcelain", "--untracked-files=all"], {
      encoding: "utf8",
    });
    assert.equal(runtimeStatus.status, 0, runtimeStatus.stderr);
    assert.match(runtimeStatus.stdout, /\.clippers-runtime-dirty-test/);
    const result = spawnSync("zsh", [installerPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        CLIPPERS_RUNTIME_ROOT: runtimeRoot,
        CLIPPERS_CONFIG_ROOT: repoRoot,
        CLIPPERS_LAUNCH_AGENT_DRY_RUN: "true",
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /runtime has untracked or modified files/);
    assert.doesNotMatch(result.stderr, /CLIPPERS_CONTENT_WORKER_CONFIG/);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(runtimeParent, { recursive: true, force: true });
  }
});

test("LaunchAgent refuses an invalid project root without replacing the existing plist", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "clippers-launch-agent-invalid-"));
  try {
    const invalidRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-invalid-project-"));
    const result = spawnSync("zsh", [installerPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        CLIPPERS_PROJECT_DIR: invalidRoot,
        CLIPPERS_LAUNCH_AGENT_DRY_RUN: "true",
        CLIPPERS_LAUNCH_AGENT_ALLOW_DEVELOPMENT_RUNTIME: "true",
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not a valid Clippers runtime checkout/);
    await assert.rejects(readFile(path.join(home, "Library", "LaunchAgents", "com.blackops.clippers-free-worker.plist")));
    await rm(invalidRoot, { recursive: true, force: true });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("LaunchAgent refuses a schedule time zone different from the macOS system time zone", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "clippers-launch-agent-timezone-"));
  try {
    const result = spawnSync("zsh", [installerPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        CLIPPERS_RUNTIME_ROOT: repoRoot,
        CLIPPERS_CONFIG_ROOT: repoRoot,
        CLIPPERS_WATCHDOG_TIME_ZONE: systemTimeZone === "UTC" ? "America/New_York" : "UTC",
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /StartCalendarInterval uses the macOS system time zone/);
    await assert.rejects(readFile(path.join(home, "Library", "LaunchAgents", "com.blackops.clippers-free-worker.plist")));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("installation verifies all launchd jobs without kickstarting them", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "clippers-launch-agent-install-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-launch-agent-install-workspace-"));
  const fakeBin = path.join(home, "bin");
  const launchctlLog = path.join(home, "launchctl.log");
  try {
    const contentConfig = await writeContentConfig(workspaceRoot);
    const { deliveryConfig, selectedEnv } = await writeYoutubeConfigs(workspaceRoot);
    await mkdir(fakeBin, { recursive: true });
    const fakeLaunchctl = path.join(fakeBin, "launchctl");
    await writeFile(fakeLaunchctl, `#!/bin/zsh\nprint -r -- "$*" >> "${launchctlLog}"\nexit 0\n`);
    await chmod(fakeLaunchctl, 0o700);
    const result = spawnSync("zsh", [installerPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        PATH: `${fakeBin}:${process.env.PATH}`,
        CLIPPERS_LAUNCH_AGENT_DRY_RUN: "false",
        CLIPPERS_LAUNCH_AGENT_ALLOW_DEVELOPMENT_RUNTIME: "true",
        CLIPPERS_RUNTIME_ROOT: repoRoot,
        CLIPPERS_CONFIG_ROOT: repoRoot,
        CLIPPERS_CONTENT_WORKER_CONFIG: contentConfig,
        CLIPPERS_YOUTUBE_DELIVERY_CONFIG: deliveryConfig,
        CLIPPERS_YOUTUBE_SELECTED_ENV: selectedEnv,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /installed and verified/);
    const calls = await readFile(launchctlLog, "utf8");
    assert.match(calls, /bootstrap .*com\.blackops\.clippers-free-worker\.plist/);
    assert.match(calls, /bootstrap .*com\.blackops\.clippers-daily-watchdog\.plist/);
    assert.match(calls, /bootstrap .*com\.blackops\.clippers-content-worker\.plist/);
    assert.match(calls, /bootstrap .*com\.blackops\.clippers-youtube-delivery-worker\.plist/);
    assert.match(calls, /print .*com\.blackops\.clippers-free-worker/);
    assert.match(calls, /print .*com\.blackops\.clippers-daily-watchdog/);
    assert.match(calls, /print .*com\.blackops\.clippers-content-worker/);
    assert.match(calls, /print .*com\.blackops\.clippers-youtube-delivery-worker/);
    assert.doesNotMatch(calls, /kickstart/);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("LaunchAgent fails closed when the content worker config is not owner-only", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "clippers-launch-agent-content-config-home-"));
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "clippers-launch-agent-content-config-workspace-"));
  try {
    const contentConfig = await writeContentConfig(workspaceRoot, 0o644);
    const result = spawnSync("zsh", [installerPath], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        CLIPPERS_LAUNCH_AGENT_DRY_RUN: "true",
        CLIPPERS_LAUNCH_AGENT_ALLOW_DEVELOPMENT_RUNTIME: "true",
        CLIPPERS_RUNTIME_ROOT: repoRoot,
        CLIPPERS_CONFIG_ROOT: repoRoot,
        CLIPPERS_CONTENT_WORKER_CONFIG: contentConfig,
      },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /must be owner-only/);
    await assert.rejects(readFile(path.join(home, "Library", "LaunchAgents", "com.blackops.clippers-content-worker.plist")));
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
