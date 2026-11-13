import assert from "node:assert/strict";
import test from "node:test";
import type { AppProject } from "@shared/schema";
import {
  __cybersecurityAgentInternals,
  analyzeAppProject,
  type CybersecurityScanResult,
  type CyberThreat,
} from "../server/cybersecurity-agent";

function appProject(overrides: Partial<AppProject> = {}): AppProject {
  return {
    id: "app-1",
    userId: "user-1",
    name: "Kong Nightlife",
    slug: "kong-nightlife",
    description: "Nightlife production app",
    environment: "production",
    publicUrl: "https://kong.example",
    healthUrl: "https://kong.example/health",
    repoOwner: "robertmanzanillag-jpg",
    repoName: "kong-nightlife",
    githubRepo: "robertmanzanillag-jpg/kong-nightlife",
    deploymentProvider: "replit",
    deploymentId: null,
    testCommand: "npm run check",
    buildCommand: "npm run build",
    sentryProjectId: null,
    stripeAccountId: null,
    stripeWebhookEndpointId: null,
    logSource: null,
    status: "healthy",
    priority: "high",
    ownerLabel: "Robert",
    tags: null,
    lastSeenAt: null,
    createdAt: new Date("2026-06-18T12:00:00.000Z"),
    updatedAt: new Date("2026-06-18T12:00:00.000Z"),
    ...overrides,
  };
}

function threat(overrides: Partial<CyberThreat>): CyberThreat {
  return {
    id: "threat-1",
    appName: "Kong Nightlife",
    appUrl: "https://kong.example",
    severity: "high",
    title: "App importante sin health URL",
    detail: "Inventario incompleto.",
    recommendation: "Agregar health URL.",
    signal: "coverage",
    ...overrides,
  };
}

function scanResult(threats: CyberThreat[]): CybersecurityScanResult {
  return {
    scannedAt: "2026-06-18T12:00:00.000Z",
    totalApps: 1,
    totalLegacyProjects: 0,
    totalGithubRepos: 0,
    githubConnected: false,
    githubError: null,
    threatCount: threats.length,
    criticalCount: threats.filter((item) => item.severity === "critical").length,
    highCount: threats.filter((item) => item.severity === "high").length,
    telegramSent: false,
    summary: "Test scan",
    threats,
    githubRepos: [],
    skills: [],
  };
}

test("flags high-priority production apps missing public and health URLs", () => {
  const threats = analyzeAppProject(appProject({ publicUrl: null, healthUrl: null }), []);

  assert.equal(threats.some((threat) => threat.title === "App importante sin URL pública"), true);
  assert.equal(threats.some((threat) => threat.title === "App importante sin health URL"), true);
  assert.equal(threats.filter((threat) => threat.signal === "coverage").length, 2);
});

test("does not flag complete high-priority production apps for coverage", () => {
  const threats = analyzeAppProject(appProject(), []);

  assert.equal(threats.some((threat) => threat.signal === "coverage"), false);
});

test("keeps down critical apps at critical severity", () => {
  const threats = analyzeAppProject(appProject({ status: "down", priority: "critical" }), []);
  const uptimeThreat = threats.find((threat) => threat.signal === "uptime");

  assert.equal(uptimeThreat?.severity, "critical");
});

test("treats DROPKIT as an important app repo for inventory import", () => {
  const repo = {
    id: 42,
    name: "DROPKIT",
    full_name: "robertmanzanillag-jpg/DROPKIT",
    private: false,
    archived: false,
    disabled: false,
    fork: false,
    language: "TypeScript",
    description: "Dropshipping app kit",
    homepage: "https://dropkit.example",
    html_url: "https://github.com/robertmanzanillag-jpg/DROPKIT",
    updated_at: "2026-06-18T12:00:00.000Z",
    pushed_at: "2026-06-18T12:00:00.000Z",
    open_issues_count: 0,
  } as any;

  assert.equal(__cybersecurityAgentInternals.isLikelyAppRepo(repo), true);
  assert.equal(__cybersecurityAgentInternals.inferPriorityFromRepo(repo), "high");

  const input = __cybersecurityAgentInternals.githubRepoToAppProjectInput(repo);
  assert.equal(input.githubRepo, "robertmanzanillag-jpg/DROPKIT");
  assert.equal(input.priority, "high");
  assert.equal(input.testCommand, null);
  assert.equal(input.buildCommand, null);
  assert.deepEqual(input.tags, ["github-import", "needs-health-url", "needs-test-command", "needs-build-command"]);
});

test("automatic Telegram alerts ignore inventory-only cybersecurity gaps", () => {
  const result = scanResult([
    threat({ signal: "coverage", title: "App importante sin health URL" }),
    threat({ signal: "repo", title: "Repo no conectado" }),
  ]);

  assert.match(__cybersecurityAgentInternals.alertSignature(result), /App importante sin health URL/);
  assert.equal(__cybersecurityAgentInternals.automaticAlertSignature(result), "");
});

test("automatic Telegram alerts still include urgent runtime security issues", () => {
  const result = scanResult([
    threat({ signal: "uptime", title: "App caída", severity: "critical" }),
    threat({ signal: "https", title: "URL sin HTTPS" }),
  ]);

  assert.match(__cybersecurityAgentInternals.automaticAlertSignature(result), /App caída/);
  assert.match(__cybersecurityAgentInternals.automaticAlertSignature(result), /URL sin HTTPS/);
});
