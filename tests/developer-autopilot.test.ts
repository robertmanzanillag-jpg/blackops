import assert from "node:assert/strict";
import test from "node:test";
import type { OfficeRun } from "../server/office-runtime";
import {
  DEVELOPER_AUTOPILOT_POLICY,
  buildCodexDispatchComment,
  buildCodexGitHubIssueTitle,
  buildCodexPrFirstBrief,
  buildCodexGitHubIssueBody,
  buildReadyForApprovalMessage,
  buildSubscriptionHandoffBrief,
  createDeveloperAutopilotHandoff,
  createDeveloperAutopilotHandoffFromRequest,
  evaluateDeveloperReleaseGate,
  parseDeveloperAutopilotRequest,
  parseSubscriptionHandoffRequest,
} from "../server/developer-autopilot";

function verifiedClaudeReview(prUrl: string, headSha = "a".repeat(40)): OfficeRun {
  return {
    id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", key: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
    kind: "claude_review", status: "completed", createdAt: new Date().toISOString(), completedAt: new Date().toISOString(),
    sessionId: "claude-session", review: { prUrl, headSha, diffSha256: "f".repeat(64), verdict: "pass", findings: [], summary: "No blockers" },
  };
}

test("developer autopilot policy is PR-first and subscription-based", () => {
  assert.equal(DEVELOPER_AUTOPILOT_POLICY.codexBillingMode, "chatgpt_subscription");
  assert.equal(DEVELOPER_AUTOPILOT_POLICY.claudeBillingMode, "signed_in_claude_subscription_or_claude_code");
  assert.equal(DEVELOPER_AUTOPILOT_POLICY.repoScope, "all_registered_github_projects");
  assert.equal(DEVELOPER_AUTOPILOT_POLICY.changeStrategy, "pull_request_first");
  assert.equal(DEVELOPER_AUTOPILOT_POLICY.secondReview, "claude_independent_review_before_app_qa");
  assert.equal(DEVELOPER_AUTOPILOT_POLICY.replitDeployment, "explicit_human_approval_required");
  assert.equal(DEVELOPER_AUTOPILOT_POLICY.subscriptionHandoff, "prefer_chatgpt_codex_pro_for_heavy_manual_work");
});

test("Codex brief blocks direct main commits, API spend, and Replit deploy while requiring Claude review", () => {
  const brief = buildCodexPrFirstBrief({
    source: "telegram",
    repoFullName: "robert/asistente",
    appName: "ASITENTE",
    kind: "security",
    severity: "critical",
    title: "Token leak report",
    description: "A user reported a possible token leak in logs.",
    evidence: ["screenshot provided privately"],
    productionUrl: "https://example.replit.app",
  });

  assert.match(brief, /ChatGPT\/Codex subscription/);
  assert.match(brief, /Claude as an independent signed-in reviewer/);
  assert.match(brief, /pull request first/);
  assert.match(brief, /do not commit directly to main/);
  assert.match(brief, /Codex PR -> Claude independent review -> App QA release gate/);
  assert.match(brief, /Do not deploy to Replit/);
  assert.match(brief, /Keep exploit details private or sanitized/);
  assert.match(brief, /Do not edit \.env, secrets, credentials/);
});

test("release gate requires all App QA subagents to pass and still blocks Replit deploy", () => {
  const gate = evaluateDeveloperReleaseGate(
    {
      failCount: 0,
      warnCount: 0,
      summary: "QA Agent no encontro bloqueos.",
      subAgents: [
        { id: "route-scout", name: "Route Scout", status: "pass", summary: "ok", checked: 1, findings: [] },
        { id: "api-scout", name: "API Scout", status: "pass", summary: "ok", checked: 1, findings: [] },
      ],
    },
    { prUrl: "https://github.com/robert/asistente/pull/12", prHeadSha: "a".repeat(40), prDiffSha256: "f".repeat(64), claudeReview: verifiedClaudeReview("https://github.com/robert/asistente/pull/12") },
  );

  assert.equal(gate.status, "pass");
  assert.equal(gate.canSendForApproval, true);
  assert.equal(gate.canDeployToReplit, false);
  assert.equal(gate.requiresHumanReplitApproval, true);
  assert.equal(gate.secondReviewRequired, true);
  assert.deepEqual(gate.requiredReviewers, ["codex", "claude", "app_qa"]);
  assert.equal(gate.prUrl, "https://github.com/robert/asistente/pull/12");
});

test("release gate blocks when a required App QA target context is missing", () => {
  const gate = evaluateDeveloperReleaseGate(
    {
      failCount: 0,
      warnCount: 0,
      summary: "QA Agent no encontro bloqueos.",
      subAgents: [
        { id: "route-scout", name: "Route Scout", status: "pass", summary: "ok", checked: 1, findings: [] },
      ],
    },
    {
      prUrl: "https://github.com/robert/client-site/pull/2",
      requiredTargetContext: {
        kind: "revenue_delivery_workspace",
        workspaceId: "workspace-123",
        clientName: "Client Site",
        repoFullName: "robert/client-site",
        prUrl: "https://github.com/robert/client-site/pull/2",
        prHeadSha: "abc123",
        branchName: "codex/client-site",
        routePath: "/revenue-engine",
      },
    },
  );

  assert.equal(gate.status, "blocked");
  assert.match(gate.reasons.join(" "), /missing targetContext/);
});

test("release gate blocks when App QA target context does not match the PR head", () => {
  const gate = evaluateDeveloperReleaseGate(
    {
      failCount: 0,
      warnCount: 0,
      summary: "QA Agent no encontro bloqueos.",
      targetContext: {
        kind: "revenue_delivery_workspace",
        workspaceId: "workspace-123",
        clientName: "Client Site",
        repoFullName: "robert/client-site",
        prUrl: "https://github.com/robert/client-site/pull/2",
        prHeadSha: "old-sha",
        branchName: "codex/client-site",
        routePath: "/revenue-engine",
        expectedControls: ["Run App QA", "Registrar release gate", "Entregar aprobado"],
      },
      subAgents: [
        { id: "route-scout", name: "Route Scout", status: "pass", summary: "ok", checked: 1, findings: [] },
      ],
    },
    {
      prUrl: "https://github.com/robert/client-site/pull/2",
      requiredTargetContext: {
        kind: "revenue_delivery_workspace",
        workspaceId: "workspace-123",
        clientName: "Client Site",
        repoFullName: "robert/client-site",
        prUrl: "https://github.com/robert/client-site/pull/2",
        prHeadSha: "new-sha",
        branchName: "codex/client-site",
        routePath: "/revenue-engine",
        expectedControls: ["Run App QA", "Registrar release gate", "Entregar aprobado"],
      },
    },
  );

  assert.equal(gate.status, "blocked");
  assert.match(gate.reasons.join(" "), /prHeadSha/);
});

test("release gate passes required App QA target only with matching visual scan", () => {
  const requiredTargetContext = {
    kind: "revenue_delivery_workspace" as const,
    workspaceId: "workspace-123",
    clientName: "Client Site",
    repoFullName: "robert/client-site",
    prUrl: "https://github.com/robert/client-site/pull/2",
    prHeadSha: "abc123",
    branchName: "codex/client-site",
    routePath: "/revenue-engine",
    expectedControls: ["Run App QA", "Registrar release gate", "Entregar aprobado"],
  };
  const gate = evaluateDeveloperReleaseGate(
    {
      failCount: 0,
      warnCount: 0,
      summary: "QA Agent no encontro bloqueos.",
      targetContext: requiredTargetContext,
      visualScans: [{
        path: "/revenue-engine",
        url: "http://127.0.0.1:5000/revenue-engine",
        status: "pass",
        title: "Revenue Engine",
        consoleErrors: [],
        clicked: ["Dashboard"],
        notes: ["Visual OK"],
      }],
      subAgents: [
        { id: "route-scout", name: "Route Scout", status: "pass", summary: "ok", checked: 1, findings: [] },
        { id: "visual-click-scout", name: "Visual Click Scout", status: "pass", summary: "ok", checked: 1, findings: [] },
      ],
    },
    {
      prUrl: "https://github.com/robert/client-site/pull/2",
      requiredTargetContext,
      prHeadSha: "a".repeat(40),
      prDiffSha256: "f".repeat(64),
      claudeReview: verifiedClaudeReview("https://github.com/robert/client-site/pull/2"),
    },
  );

  assert.equal(gate.status, "pass");
});

test("release gate rejects missing, stale and changed-head Claude evidence", () => {
  const prUrl = "https://github.com/robert/asistente/pull/12";
  const scan = { failCount: 0, warnCount: 0, summary: "QA passed", subAgents: [{ id: "route-scout", name: "Route Scout", status: "pass" as const, summary: "ok", checked: 1, findings: [] }] };
  const review = verifiedClaudeReview(prUrl);
  const cases = [
    undefined,
    { ...review, completedAt: new Date(Date.now() - 90_000_000).toISOString() },
    { ...review, review: { ...review.review!, headSha: "b".repeat(40) } },
    { ...review, review: { ...review.review!, findings: ["A blocker was found"] } },
  ];
  for (const claudeReview of cases) {
    const gate = evaluateDeveloperReleaseGate(scan, { prUrl, prHeadSha: "a".repeat(40), prDiffSha256: "f".repeat(64), claudeReview });
    assert.equal(gate.canSendForApproval, false);
    assert.match(gate.reasons.join(" "), /verified Claude review/);
  }
});

test("release gate blocks required App QA target when visual scan was skipped", () => {
  const requiredTargetContext = {
    kind: "revenue_delivery_workspace" as const,
    workspaceId: "workspace-123",
    clientName: "Client Site",
    repoFullName: "robert/client-site",
    prUrl: "https://github.com/robert/client-site/pull/2",
    prHeadSha: "abc123",
    branchName: "codex/client-site",
    routePath: "/revenue-engine",
    expectedControls: ["Run App QA", "Registrar release gate", "Entregar aprobado"],
  };
  const gate = evaluateDeveloperReleaseGate(
    {
      failCount: 0,
      warnCount: 0,
      summary: "QA Agent no encontro bloqueos.",
      targetContext: requiredTargetContext,
      visualScans: [],
      subAgents: [
        { id: "route-scout", name: "Route Scout", status: "pass", summary: "ok", checked: 1, findings: [] },
        { id: "visual-click-scout", name: "Visual Click Scout", status: "pass", summary: "skipped", checked: 0, findings: [] },
      ],
    },
    {
      prUrl: "https://github.com/robert/client-site/pull/2",
      requiredTargetContext,
    },
  );

  assert.equal(gate.status, "blocked");
  assert.match(gate.reasons.join(" "), /missing visualScans/);
});

test("release gate blocks send approval until a PR URL exists", () => {
  const gate = evaluateDeveloperReleaseGate({
    failCount: 0,
    warnCount: 0,
    summary: "QA Agent no encontro bloqueos.",
    subAgents: [
      { id: "route-scout", name: "Route Scout", status: "pass", summary: "ok", checked: 1, findings: [] },
    ],
  });

  assert.equal(gate.status, "blocked");
  assert.equal(gate.canSendForApproval, false);
  assert.match(gate.reasons.join(" "), /pull request URL is required/);
});

test("release gate blocks warnings before Replit deployment", () => {
  const gate = evaluateDeveloperReleaseGate({
    failCount: 0,
    warnCount: 1,
    summary: "QA Agent dejo 1 aviso.",
    subAgents: [
      { id: "improvement-scout", name: "Improvement Scout", status: "warn", summary: "warning", checked: 1, findings: [] },
    ],
  });

  assert.equal(gate.status, "blocked");
  assert.equal(gate.canSendForApproval, false);
  assert.match(gate.reasons.join(" "), /warning/);
  assert.match(gate.reasons.join(" "), /Improvement Scout=warn/);
});

test("ready message asks for explicit Replit approval", () => {
  const message = buildReadyForApprovalMessage({
    repoFullName: "robert/asistente",
    prUrl: "https://github.com/robert/asistente/pull/12",
    qaGate: {
      status: "pass",
      canSendForApproval: true,
      canDeployToReplit: false,
      requiresHumanReplitApproval: true,
      secondReviewRequired: true,
      requiredReviewers: ["codex", "claude", "app_qa"],
      reasons: ["ready"],
      qaSummary: "All App QA subagents passed.",
    },
    testsRun: ["npm run check", "npm run test:telegram"],
  });

  assert.match(message, /PR:/);
  assert.match(message, /No voy a montar en Replit/);
  assert.match(message, /apruebe explicitamente/);
});

test("developer autopilot detects developer bugs but ignores generic work requests", () => {
  assert.equal(parseDeveloperAutopilotRequest("revisa radio y dime slots vacios", "telegram"), null);
  const request = parseDeveloperAutopilotRequest("arregla este bug en robert/asistente y abre PR", "telegram");

  assert.equal(request?.kind, "bug");
  assert.equal(request?.repoFullName, "robert/asistente");
  assert.equal(request?.replitRequested, false);
});

test("developer autopilot accepts sold client website build handoffs", async () => {
  const request = parseDeveloperAutopilotRequest(
    "construye el website vendido para Handoff Cafe en robert/handoff-cafe con el mockup aprobado",
    "web_chat",
  );

  assert.equal(request?.kind, "client_build");
  assert.equal(request?.repoFullName, "robert/handoff-cafe");
  assert.match(request?.title || "", /website vendido/);

  const created = await createDeveloperAutopilotHandoff(
    "user-1",
    "construye el website vendido para Handoff Cafe en robert/handoff-cafe con el mockup aprobado",
    "web_chat",
    {
      getAppProjects: async () => [],
      listRepositories: async () => [{
        full_name: "robert/handoff-cafe",
        name: "handoff-cafe",
        private: true,
      }],
      createIssue: async (owner, repo, title, body) => {
        assert.equal(owner, "robert");
        assert.equal(repo, "handoff-cafe");
        assert.match(title, /\[Codex PR-first\]\[client-build\]/);
        assert.match(body, /Type: client_build/);
        assert.match(body, /approved scope, public business facts/);
        assert.match(body, /Do not deploy to Replit/);
        assert.match(body, /App QA/);
        return { number: 31, html_url: "https://github.com/robert/handoff-cafe/issues/31" };
      },
      createIssueComment: async () => {
        throw new Error("no PR was provided, so Codex should not be dispatched");
      },
    },
  );

  assert.equal(created.status, "created");
  assert.equal(created.handoffType, "developer_pr");
  assert.equal(created.repoFullName, "robert/handoff-cafe");
  assert.equal(created.issueNumber, 31);
  assert.match(created.codexBrief || "", /Type: client_build/);
});

test("developer autopilot creates client build handoff from structured Revenue Engine request", async () => {
  const safeTitle = buildCodexGitHubIssueTitle({
    source: "manual",
    repoFullName: "robert/handoff-cafe",
    appName: "Handoff Cafe",
    kind: "client_build",
    title: "Paid deposit payment client build",
    description: "Build the client website.",
  }, {
    full_name: "robert/handoff-cafe",
    name: "handoff-cafe",
    private: true,
  });

  assert.match(safeTitle, /\[Codex PR-first\]\[client-build\]/);
  assert.doesNotMatch(safeTitle, /\bpaid\b/i);
  assert.doesNotMatch(safeTitle, /\bdeposit\b/i);
  assert.doesNotMatch(safeTitle, /\bpayment\b/i);

  const created = await createDeveloperAutopilotHandoffFromRequest(
    "user-1",
    {
      source: "manual",
      repoFullName: "robert/handoff-cafe",
      appName: "Handoff Cafe",
      kind: "client_build",
      title: "[Revenue Website Build] Handoff Cafe - Website 3D Premium",
      description: [
        "PR-first client build handoff from Revenue Engine.",
        "",
        "Sanitized build context:",
        "- Client/workspace name: Handoff Cafe",
        "- Revenue workspace: delivery-workspace-1",
        "- Project type: website",
        "- Package: Website 3D Premium - $4,200 / Deposit $2,100",
        "- Target branch: codex/client-handoff-cafe-website",
        "- Public source: https://example.com/handoff-cafe",
        "- Mockup preview: /api/revenue-engine/mockup-previews/handoff-cafe",
        "",
        "Approved scope summary:",
        "Build a mobile menu, catering inquiry CTA and follow-up capture from public business facts. Payment ref ACH-123 should stay private.",
        "",
        "Cash collected for deposit: $2,100",
        "Setup: $3,500",
        "",
        "Public issue privacy rules:",
        "- Do not include sale amounts, collection status, transfer IDs, or proof-of-funds details.",
      ].join("\n"),
      severity: "medium",
      evidence: [
        "Revenue workspace: delivery-workspace-1",
        "Public source: https://example.com/handoff-cafe",
        "Mockup preview: /api/revenue-engine/mockup-previews/handoff-cafe",
        "Stripe pi_secret_12345",
        "deposit confirmation private",
        "package deposit tier",
        "Sensitive sale details and private client data intentionally withheld from GitHub issue.",
      ],
    },
    {
      getAppProjects: async () => [],
      listRepositories: async () => [{
        full_name: "robert/handoff-cafe",
        name: "handoff-cafe",
        private: true,
      }],
      createIssue: async (owner, repo, title, body) => {
        assert.equal(owner, "robert");
        assert.equal(repo, "handoff-cafe");
        assert.match(title, /\[Codex PR-first\]\[client-build\]/);
        assert.match(body, /Revenue workspace: delivery-workspace-1/);
        assert.match(body, /Target branch: codex\/client-handoff-cafe-website/);
        assert.match(body, /Public source: https:\/\/example\.com\/handoff-cafe/);
        assert.match(body, /Mockup preview: \/api\/revenue-engine\/mockup-previews\/handoff-cafe/);
        assert.match(body, /Build a mobile menu, catering inquiry CTA and follow-up capture/);
        assert.match(body, /amount-redacted/);
        assert.match(body, /transfer-ref-redacted/);
        assert.match(body, /Do not include sale amounts, collection status, transfer IDs, or proof-of-funds details/);
        assert.match(body, /Robert must approve Replit deployment explicitly/);
        assert.doesNotMatch(body, /Setup: \$/);
        assert.doesNotMatch(body, /Cash collected/);
        assert.doesNotMatch(body, /\$2,100/);
        assert.doesNotMatch(body, /\$4,200/);
        assert.doesNotMatch(body, /ACH-123/);
        assert.doesNotMatch(body, /\bdeposit\b/i);
        assert.doesNotMatch(body, /\bpayment\b/i);
        assert.doesNotMatch(body, /\bpaid\b/i);
        assert.doesNotMatch(body, /Stripe pi_/i);
        return { number: 41, html_url: "https://github.com/robert/handoff-cafe/issues/41" };
      },
      createIssueComment: async () => {
        throw new Error("no PR was provided, so Codex should not be dispatched");
      },
    },
  );

  assert.equal(created.status, "created");
  assert.equal(created.repoFullName, "robert/handoff-cafe");
  assert.equal(created.issueUrl, "https://github.com/robert/handoff-cafe/issues/41");
  assert.match(created.codexBrief || "", /Type: client_build/);
});

test("developer autopilot keeps security precedence over client website build wording", () => {
  const request = parseDeveloperAutopilotRequest(
    "implementa un fix de security para el website en robert/public-app: token=sk-secret1234567890",
    "web_chat",
  );

  assert.equal(request?.kind, "security");
  assert.equal(request?.severity, "high");

  const body = buildCodexGitHubIssueBody(request!, {
    full_name: "robert/public-app",
    name: "public-app",
    private: false,
  });

  assert.match(body, /Security details withheld/);
  assert.doesNotMatch(body, /sk-secret/);
});

test("subscription handoff routes heavy manual work to ChatGPT/Codex Pro instead of API spend", async () => {
  const request = parseSubscriptionHandoffRequest(
    "usa mi membresia Pro para una campana completa de marketing de clippers sin gastar API",
    "web_chat",
  );

  assert.equal(request?.kind, "marketing");
  const brief = buildSubscriptionHandoffBrief(request!);
  assert.match(brief, /signed-in ChatGPT\/Codex Pro membership/);
  assert.match(brief, /Do not spend OpenAI API tokens/);
  assert.match(brief, /Metricool schedule/);

  const handoff = await createDeveloperAutopilotHandoff(
    "user-1",
    "usa mi membresia Pro para una campana completa de marketing de clippers sin gastar API",
    "web_chat",
    {
      getAppProjects: async () => {
        throw new Error("subscription handoff should not need projects");
      },
      listRepositories: async () => {
        throw new Error("subscription handoff should not need GitHub");
      },
      createIssue: async () => {
        throw new Error("subscription handoff should not create issues");
      },
      createIssueComment: async () => {
        throw new Error("subscription handoff should not create comments");
      },
    },
  );

  assert.equal(handoff.status, "subscription_brief");
  assert.equal(handoff.handoffType, "subscription_work");
  assert.match(handoff.message, /membresia ChatGPT\/Codex Pro/);
  assert.match(handoff.subscriptionBrief || "", /BlackOps subscription handoff/);
});

test("strict cost mode routes heavy manual work to subscription handoff without magic words", async () => {
  const handoff = await createDeveloperAutopilotHandoff(
    "user-1",
    "prepara una campana completa para clippers con multiples cuentas y retorno de inversion",
    "web_chat",
    {
      getAppProjects: async () => {
        throw new Error("heavy manual handoff should not need projects");
      },
      listRepositories: async () => {
        throw new Error("heavy manual handoff should not need GitHub");
      },
      createIssue: async () => {
        throw new Error("heavy manual handoff should not create issues");
      },
      createIssueComment: async () => {
        throw new Error("heavy manual handoff should not create comments");
      },
    },
  );

  assert.equal(handoff.status, "subscription_brief");
  assert.equal(handoff.handoffType, "subscription_work");
  assert.match(handoff.message, /membresia ChatGPT\/Codex Pro/);
  assert.match(handoff.subscriptionBrief || "", /Do not spend OpenAI API tokens/);
});

test("subscription handoff ignores normal lightweight chat", () => {
  assert.equal(parseSubscriptionHandoffRequest("que tengo hoy en el calendario", "telegram"), null);
});

test("developer autopilot does not treat affected URLs as explicit GitHub repos", async () => {
  const request = parseDeveloperAutopilotRequest("arregla bug en https://kong.example.com/api/login para Kong app", "telegram");
  assert.equal(request?.repoFullName, null);

  const created = await createDeveloperAutopilotHandoff(
    "user-1",
    "arregla bug en https://kong.example.com/api/login para Kong app",
    "telegram",
    {
      getAppProjects: async () => [{
        name: "Kong App",
        description: "Nightlife production app",
        githubRepo: "robert/kong-app",
        publicUrl: "https://kong.example.com",
        healthUrl: "https://kong.example.com/health",
      }],
      listRepositories: async () => [{
        full_name: "robert/kong-app",
        name: "kong-app",
        private: true,
      }],
      createIssue: async (owner, repo) => {
        assert.equal(owner, "robert");
        assert.equal(repo, "kong-app");
        return { number: 8, html_url: "https://github.com/robert/kong-app/issues/8" };
      },
      createIssueComment: async () => {
        throw new Error("no PR was provided, so Codex should not be dispatched");
      },
    },
  );

  assert.equal(created.status, "created");
  assert.equal(created.repoFullName, "robert/kong-app");
});

test("developer autopilot creates a GitHub handoff issue for the selected repo", async () => {
  const created = await createDeveloperAutopilotHandoff(
    "user-1",
    "arregla este error en robert/asistente, el login falla",
    "web_chat",
    {
      getAppProjects: async () => [{
        name: "ASITENTE",
        description: "CEO assistant",
        githubRepo: "robert/asistente",
        publicUrl: "https://example.com",
        healthUrl: "https://example.com/health",
      }],
      listRepositories: async () => [{
        full_name: "robert/asistente",
        name: "asistente",
        private: true,
        html_url: "https://github.com/robert/asistente",
      }],
      createIssue: async (owner, repo, title, body) => {
        assert.equal(owner, "robert");
        assert.equal(repo, "asistente");
        assert.match(title, /\[Codex PR-first\]/);
        assert.match(body, /Do not deploy to Replit/);
        assert.match(body, /@codex review/);
        assert.match(body, /Claude independent review/);
        return { number: 7, html_url: "https://github.com/robert/asistente/issues/7" };
      },
      createIssueComment: async () => {
        throw new Error("no PR was provided, so Codex should not be dispatched");
      },
    },
  );

  assert.equal(created.status, "created");
  assert.equal(created.repoFullName, "robert/asistente");
  assert.equal(created.issueNumber, 7);
  assert.match(created.message, /PR-first/);
  assert.match(created.message, /No voy a montar en Replit/);
});

test("developer autopilot dispatches @codex fix when a PR is provided", async () => {
  const created = await createDeveloperAutopilotHandoff(
    "user-1",
    "arregla este error en robert/asistente PR #12, el login falla",
    "web_chat",
    {
      getAppProjects: async () => [{
        name: "ASITENTE",
        description: "CEO assistant",
        githubRepo: "robert/asistente",
        publicUrl: "https://example.com",
        healthUrl: "https://example.com/health",
      }],
      listRepositories: async () => [{
        full_name: "robert/asistente",
        name: "asistente",
        private: true,
        html_url: "https://github.com/robert/asistente",
      }],
      createIssue: async () => ({ number: 7, html_url: "https://github.com/robert/asistente/issues/7" }),
      createIssueComment: async (owner, repo, issueNumber, body) => {
        assert.equal(owner, "robert");
        assert.equal(repo, "asistente");
        assert.equal(issueNumber, 12);
        assert.match(body, /@codex fix this issue PR-first/);
        assert.match(body, /Do not use BlackOps OpenAI API spend/);
        assert.match(body, /Do not merge or deploy/);
        return { html_url: "https://github.com/robert/asistente/pull/12#issuecomment-1" };
      },
    },
  );

  assert.equal(created.status, "codex_dispatched");
  assert.equal(created.codexDispatchPrNumber, 12);
  assert.equal(created.codexDispatchCommentUrl, "https://github.com/robert/asistente/pull/12#issuecomment-1");
  assert.match(created.message, /mande el fix directo a Codex/);
});

test("Codex dispatch comment keeps approval and no-API rules", () => {
  const comment = buildCodexDispatchComment({
    source: "web_chat",
    repoFullName: "robert/asistente",
    pullRequestNumber: 12,
    kind: "bug",
    title: "Login bug",
    description: "Login fails after the latest deploy.",
    severity: "medium",
  });

  assert.match(comment, /@codex fix this issue PR-first/);
  assert.match(comment, /Do not use BlackOps OpenAI API spend/);
  assert.match(comment, /Work only on this PR branch/);
  assert.match(comment, /Robert must approve merge\/deploy after QA/);

  const clientBuildComment = buildCodexDispatchComment({
    source: "manual",
    repoFullName: "robert/handoff-cafe",
    pullRequestNumber: 41,
    kind: "client_build",
    title: "Client build",
    description: "Build package after deposit payment ref ACH-123 and $2,100 collection. Zelle ref scoped-deposit-123.",
    severity: "medium",
  });

  assert.match(clientBuildComment, /commercial-term-redacted/);
  assert.match(clientBuildComment, /transfer-ref-redacted/);
  assert.match(clientBuildComment, /amount-redacted/);
  assert.doesNotMatch(clientBuildComment, /\bdeposit\b/i);
  assert.doesNotMatch(clientBuildComment, /\bpayment\b/i);
  assert.doesNotMatch(clientBuildComment, /ACH-123/);
  assert.doesNotMatch(clientBuildComment, /scoped/i);
  assert.doesNotMatch(clientBuildComment, /Zelle/i);
  assert.doesNotMatch(clientBuildComment, /\$2,100/);
});

test("public security handoff redacts sensitive issue details", () => {
  const title = buildCodexGitHubIssueTitle({
    source: "telegram",
    repoFullName: "robert/public-app",
    kind: "security",
    title: "security bypass at /private-admin-reset",
    description: "private route",
    severity: "high",
  }, {
    full_name: "robert/public-app",
    name: "public-app",
    private: false,
  });
  assert.match(title, /Security-sensitive fix request/);
  assert.doesNotMatch(title, /private-admin-reset/);

  const body = buildCodexGitHubIssueBody({
    source: "telegram",
    repoFullName: "robert/public-app",
    kind: "security",
    title: "leaked token",
    description: "token=sk-secret1234567890 email admin@example.com",
    severity: "high",
    evidence: ["password=hunter2"],
  }, {
    full_name: "robert/public-app",
    name: "public-app",
    private: false,
  });

  assert.match(body, /Security details withheld/);
  assert.doesNotMatch(body, /sk-secret/);
  assert.doesNotMatch(body, /hunter2/);
  assert.doesNotMatch(body, /admin@example.com/);
});
