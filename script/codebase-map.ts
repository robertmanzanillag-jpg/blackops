import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

type FileNode = {
  path: string;
  kind: string;
  imports: string[];
  exports: string[];
  symbols: string[];
  routes: string[];
};

type CodebaseMap = {
  generatedAt: string;
  repoRoot: string;
  packageName: string | null;
  scripts: Record<string, string>;
  totals: {
    filesVisible: number;
    filesIndexed: number;
    imports: number;
    routes: number;
    symbols: number;
  };
  directories: Record<string, { files: number; indexed: number; kinds: Record<string, number> }>;
  files: FileNode[];
  entrypoints: string[];
  tests: string[];
  guardrails: string[];
};

const REPO_ROOT = process.cwd();
const OUTPUT_DIR = path.join(REPO_ROOT, "docs");
const JSON_OUT = path.join(OUTPUT_DIR, "codebase-map.json");
const MD_OUT = path.join(OUTPUT_DIR, "codebase-map.md");

const SKIP_PREFIXES = [
  ".git/",
  "node_modules/",
  "dist/",
  "build/",
  "coverage/",
  ".cache/",
  ".codex/",
  ".claude/",
  "credentials/",
  "secrets/",
  "radio_video_edits/",
  "promo_video_edits/",
];

const SKIP_FILES = [
  ".env",
  ".env.local",
  "data_export.sql",
  "data_export_clean.sql",
  "data_export_weekly.csv",
  "data_export_monthly.csv",
  "data_export_yearly.csv",
];

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".css",
  ".html",
]);

function gitVisibleFiles(): string[] {
  const output = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: REPO_ROOT });
  return output
    .toString("utf8")
    .split("\0")
    .map((file) => file.trim())
    .filter(Boolean);
}

function shouldIndex(file: string): boolean {
  if (SKIP_FILES.includes(file)) return false;
  if (SKIP_PREFIXES.some((prefix) => file.startsWith(prefix))) return false;
  if (/(^|[/_-])(dump|export|backup|credentials?|secrets?|tokens?)([/_.-]|$)/i.test(file)) return false;
  const extension = path.extname(file);
  if (!TEXT_EXTENSIONS.has(extension)) return false;

  const absolute = path.join(REPO_ROOT, file);
  if (!existsSync(absolute)) return false;
  return statSync(absolute).size <= 350_000;
}

function kindFor(file: string): string {
  if (file.startsWith("client/src/pages/")) return "client-page";
  if (file.startsWith("client/src/components/ui/")) return "ui-component";
  if (file.startsWith("client/src/components/")) return "client-component";
  if (file.startsWith("client/src/hooks/")) return "client-hook";
  if (file.startsWith("client/src/lib/")) return "client-lib";
  if (file.startsWith("server/")) return "server";
  if (file.startsWith("shared/")) return "shared";
  if (file.startsWith("tests/")) return "test";
  if (file.startsWith("script/") || file.startsWith("scripts/")) return "script";
  if (file.startsWith("docs/")) return "docs";
  if (file === "package.json") return "package";
  if (file.endsWith(".md")) return "docs";
  return "other";
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function captureAll(content: string, pattern: RegExp, group = 1): string[] {
  return unique([...content.matchAll(pattern)].map((match) => match[group]).filter(Boolean));
}

function analyze(file: string): FileNode {
  const content = readFileSync(path.join(REPO_ROOT, file), "utf8");
  const imports = unique([
    ...captureAll(content, /^\s*import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/gm),
    ...captureAll(content, /^\s*export\s+[\s\S]*?\s+from\s+["']([^"']+)["']/gm),
    ...captureAll(content, /\brequire\(["']([^"']+)["']\)/g),
  ]);
  const exports = unique([
    ...captureAll(content, /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class|type|interface|enum)\s+([A-Za-z0-9_]+)/gm),
    ...captureAll(content, /^\s*export\s+\{\s*([^}]+)\s*\}/gm),
  ]);
  const symbols = unique([
    ...captureAll(content, /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm),
    ...captureAll(content, /^\s*(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=/gm),
    ...captureAll(content, /^\s*(?:export\s+)?class\s+([A-Za-z0-9_]+)/gm),
    ...captureAll(content, /^\s*type\s+([A-Za-z0-9_]+)\s*=/gm),
    ...captureAll(content, /^\s*interface\s+([A-Za-z0-9_]+)/gm),
  ]);
  const routes = unique([
    ...captureAll(content, /\b(?:app|router)\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g, 2),
    ...captureAll(content, /<Route\b[^>]*\bpath=["']([^"']+)["']/g),
  ]);

  return {
    path: file,
    kind: kindFor(file),
    imports,
    exports,
    symbols,
    routes,
  };
}

function addDirectory(directories: CodebaseMap["directories"], file: string, indexed: boolean, kind: string) {
  if (SKIP_PREFIXES.some((prefix) => file.startsWith(prefix))) return;
  if (SKIP_FILES.includes(file)) return;
  const dir = path.dirname(file) === "." ? "." : path.dirname(file).split(path.sep).slice(0, 2).join("/");
  directories[dir] ??= { files: 0, indexed: 0, kinds: {} };
  directories[dir].files += 1;
  if (indexed) directories[dir].indexed += 1;
  directories[dir].kinds[kind] = (directories[dir].kinds[kind] ?? 0) + 1;
}

function readPackage() {
  const packagePath = path.join(REPO_ROOT, "package.json");
  if (!existsSync(packagePath)) return { packageName: null, scripts: {} };
  const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: string; scripts?: Record<string, string> };
  return { packageName: parsed.name ?? null, scripts: parsed.scripts ?? {} };
}

function buildMap(): CodebaseMap {
  const visibleFiles = gitVisibleFiles();
  const { packageName, scripts } = readPackage();
  const directories: CodebaseMap["directories"] = {};
  const files: FileNode[] = [];

  for (const file of visibleFiles) {
    const indexed = shouldIndex(file);
    const kind = kindFor(file);
    addDirectory(directories, file, indexed, kind);
    if (indexed) files.push(analyze(file));
  }

  const entrypoints = visibleFiles.filter((file) =>
    [
      "client/src/main.tsx",
      "client/src/App.tsx",
      "server/index.ts",
      "server/routes.ts",
      "shared/schema.ts",
      "vite.config.ts",
      "drizzle.config.ts",
      "package.json",
    ].includes(file),
  );

  const tests = visibleFiles.filter((file) => file.startsWith("tests/") && file.endsWith(".test.ts")).sort();

  return {
    generatedAt: new Date().toISOString(),
    repoRoot: REPO_ROOT,
    packageName,
    scripts,
    totals: {
      filesVisible: visibleFiles.length,
      filesIndexed: files.length,
      imports: files.reduce((total, file) => total + file.imports.length, 0),
      routes: files.reduce((total, file) => total + file.routes.length, 0),
      symbols: files.reduce((total, file) => total + file.symbols.length, 0),
    },
    directories,
    files: files.sort((left, right) => left.path.localeCompare(right.path)),
    entrypoints,
    tests,
    guardrails: [
      "Generated locally from Git-visible files only: tracked files plus untracked files that are not ignored.",
      "Skips credentials/, secrets/, .env files, node_modules/, build outputs, media folders, and large data exports.",
      "Does not index SQL files or filenames that look like dumps, backups, credentials, secrets, or tokens.",
      "Use this map to narrow exploration; verify behavior in source files before editing.",
    ],
  };
}

function tableRow(values: string[]): string {
  return `| ${values.join(" | ")} |`;
}

function renderMarkdown(map: CodebaseMap): string {
  const topDirs = Object.entries(map.directories)
    .sort((left, right) => right[1].indexed - left[1].indexed || left[0].localeCompare(right[0]))
    .slice(0, 24);
  const routeFiles = map.files.filter((file) => file.routes.length > 0);
  const keyFiles = map.files
    .filter((file) => ["client-page", "server", "shared", "script", "package"].includes(file.kind))
    .slice(0, 80);

  const lines: string[] = [];
  lines.push("# Codebase Map");
  lines.push("");
  lines.push(`Generated: ${map.generatedAt}`);
  lines.push(`Repo: \`${map.repoRoot}\``);
  lines.push(`Package: \`${map.packageName ?? "unknown"}\``);
  lines.push("");
  lines.push("## Guardrails");
  for (const guardrail of map.guardrails) lines.push(`- ${guardrail}`);
  lines.push("");
  lines.push("## Totals");
  lines.push(tableRow(["Git-visible files", "Indexed files", "Imports", "Routes", "Symbols"]));
  lines.push(tableRow(["---:", "---:", "---:", "---:", "---:"]));
  lines.push(tableRow([
    String(map.totals.filesVisible),
    String(map.totals.filesIndexed),
    String(map.totals.imports),
    String(map.totals.routes),
    String(map.totals.symbols),
  ]));
  lines.push("");
  lines.push("## Entrypoints");
  for (const file of map.entrypoints) lines.push(`- \`${file}\``);
  lines.push("");
  lines.push("## Main Directories");
  lines.push(tableRow(["Directory", "Visible", "Indexed", "Main kinds"]));
  lines.push(tableRow(["---", "---:", "---:", "---"]));
  for (const [dir, info] of topDirs) {
    const kinds = Object.entries(info.kinds)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 4)
      .map(([kind, count]) => `${kind}:${count}`)
      .join(", ");
    lines.push(tableRow([`\`${dir}\``, String(info.files), String(info.indexed), kinds]));
  }
  lines.push("");
  lines.push("## Routes Detected");
  if (routeFiles.length === 0) {
    lines.push("- No static route literals detected.");
  } else {
    for (const file of routeFiles) {
      lines.push(`- \`${file.path}\`: ${file.routes.map((route) => `\`${route}\``).join(", ")}`);
    }
  }
  lines.push("");
  lines.push("## Test Inventory");
  for (const file of map.tests) lines.push(`- \`${file}\``);
  lines.push("");
  lines.push("## Key Files");
  for (const file of keyFiles) {
    const details = [
      file.symbols.length ? `${file.symbols.length} symbols` : null,
      file.imports.length ? `${file.imports.length} imports` : null,
      file.routes.length ? `${file.routes.length} routes` : null,
    ].filter(Boolean).join(", ");
    lines.push(`- \`${file.path}\` (${file.kind}${details ? `; ${details}` : ""})`);
  }
  lines.push("");
  lines.push("## How Agents Should Use This");
  lines.push("1. Read this map before broad repo exploration.");
  lines.push("2. Pick the smallest set of files likely to answer the task.");
  lines.push("3. Read source files directly before editing or making strong claims.");
  lines.push("4. Regenerate with `npm run codebase:map` after major file moves, new pages, routes, tests, or server modules.");
  lines.push("5. Do not paste `docs/codebase-map.json` into prompts; use it for local scripts or targeted lookups only.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function main() {
  const map = buildMap();
  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(JSON_OUT, `${JSON.stringify(map, null, 2)}\n`);
  writeFileSync(MD_OUT, renderMarkdown(map));
  console.log(`Wrote ${path.relative(REPO_ROOT, MD_OUT)}`);
  console.log(`Wrote ${path.relative(REPO_ROOT, JSON_OUT)}`);
}

main();
