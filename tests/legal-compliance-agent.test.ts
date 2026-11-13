import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLegalComplianceReport,
  buildLegalComplianceRun,
  runLegalComplianceReportsWithSources,
  type LegalConnectedTarget,
} from "../server/legal-compliance-agent";

test("builds one legal report per connected app or repo", () => {
  const targets: LegalConnectedTarget[] = [
    {
      id: "app-1",
      source: "developer_health",
      appName: "Kong Nightlife",
      description: "Venues, promoters, tables and events",
      url: "https://kong.example",
      repo: "owner/kong",
      status: "healthy",
      priority: "critical",
      github: { open_prs: 2, open_issues: 3, private: true },
    },
    {
      id: "repo-1",
      source: "github",
      appName: "br-website",
      description: "Black Room event website",
      url: "https://blackroomus.com",
      repo: "owner/br-website",
      github: { open_issues_count: 1, private: false },
    },
  ];

  const run = buildLegalComplianceRun(targets, true);

  assert.equal(run.totalTargets, 2);
  assert.equal(run.githubConnected, true);
  assert.equal(run.reports.length, 2);
  assert.equal(run.summary.revisar, 2);
  const kongReport = run.reports.find((report) => report.appName === "Kong Nightlife");
  const blackRoomReport = run.reports.find((report) => report.appName === "br-website");
  assert.equal(kongReport?.checks.some((check) => check.includes("PRs abiertos")), true);
  assert.equal(kongReport?.scoutAgent, "Kong Legal Scout");
  assert.deepEqual(kongReport?.escalationPath, ["Kong Legal Scout", "Legal Main", "CEO"]);
  assert.equal(blackRoomReport?.riskAreas.includes("copyright"), true);
  assert.equal(blackRoomReport?.operatingModel, "app_scout_to_main");
});

test("marks unsafe public lead funnel without https as critical", () => {
  const report = buildLegalComplianceReport({
    id: "lead-app",
    source: "projects",
    appName: "Revenue Lead Funnel",
    description: "Landing page captures leads and sends follow-up",
    url: "http://leads.example",
    repo: null,
    status: "online",
  });

  assert.equal(report.severity, "critico");
  assert.equal(report.riskAreas.includes("data_security"), true);
  assert.equal(report.riskAreas.includes("missing_repo"), true);
  assert.equal(report.checks.some((check) => check.includes("HTTPS")), true);
});

test("classifies clip automation risk as critical", () => {
  const report = buildLegalComplianceReport({
    id: "clipper",
    source: "developer_health",
    appName: "Clippers Automation",
    description: "Auto posts short-form video clips",
    url: "https://clips.example",
    repo: "owner/clips",
    status: "healthy",
    github: { private: false },
  });

  assert.equal(report.severity, "critico");
  assert.equal(report.riskAreas.includes("platform_terms"), true);
  assert.equal(report.riskAreas.includes("public_repo_exposure"), true);
});

test("keeps generic apps under Legal Main central review", () => {
  const report = buildLegalComplianceReport({
    id: "generic",
    source: "github",
    appName: "internal-notes",
    description: "Internal helper",
    url: "https://notes.example",
    repo: "owner/internal-notes",
  });

  assert.equal(report.scoutAgent, "Legal Main");
  assert.equal(report.operatingModel, "central_review");
  assert.deepEqual(report.escalationPath, ["Legal Main"]);
});

test("degrades legal run when storage and GitHub sources are unavailable", async () => {
  const run = await runLegalComplianceReportsWithSources("user-1", {
    getAppProjects: async () => {
      throw new Error("db offline");
    },
    getMonitoredProjects: async () => {
      throw new Error("projects offline");
    },
    isGitHubConnected: async () => {
      throw new Error("github unavailable");
    },
    listRepositories: async () => {
      throw new Error("should not list repos");
    },
    getRepositoryOverview: async () => {
      throw new Error("should not load repo overview");
    },
  });

  assert.equal(run.totalTargets, 0);
  assert.equal(run.githubConnected, false);
  assert.equal(run.githubError, "github unavailable");
  assert.equal(run.reports.length, 0);
  assert.deepEqual(run.summary, { critico: 0, revisar: 0, info: 0 });
  assert.equal(run.sourceErrors.some((error) => error.includes("developer_health: db offline")), true);
  assert.equal(run.sourceErrors.some((error) => error.includes("projects: projects offline")), true);
  assert.equal(run.sourceErrors.some((error) => error.includes("github: github unavailable")), true);
});
