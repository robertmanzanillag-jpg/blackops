# Revenue internal HTML deliverable

The optional worker adapter reads the existing `revenue_engine_state` collection `publicLeadCandidates` under the canonical `rev_SHA256(trimmedOwner)` namespace. It never imports candidates, changes a lead, contacts a business, fetches source URLs, calls a model or publishes a site.

Only candidates with retained `verified_public` and `publicEvidenceVerified=true`, a safe HTTPS source URL and non-placeholder evidence qualify. Identity is the candidate's exact stored ID and collection revision/digest. No name-based join to leads or opportunities is inferred. Historical verification is explicitly labelled as saved evidence, not a fresh website check.

The adapter uses its own `office_revenue_preview_v1` journal, retaining fenced generations, one assignment per UTC day/generation, 60-second leases, 200-job/4MB caps, no deletion, no automatic uncertain retry, and deterministic source/artifact revalidation. The caller must use `eligibleBusinessGeneration` under the existing council owner lock. Missing candidates produce an explicit blocked record. Completed candidate versions are excluded before the20-record source selection limit, allowing subsequent candidates to receive work.

`buildRevenueMockupPreview` gains an opt-in standalone renderer. Existing calls are unchanged. Standalone results are static, script-free HTML, with no form or external resource. The office artifact removes template QA/price assertions, adds retained provenance and clear internal-concept labels, and disables navigation controls. HTML SHA256 covers actual UTF-8 bytes.

The parent integration must expose only sanitized history to the authenticated canonical owner. Render HTML using an iframe with empty `sandbox`, `referrerPolicy="no-referrer"`, and no script/same-origin permissions. If serving HTML directly, use `REVENUE_PREVIEW_CSP` and no-store headers; the meta policy alone does not enforce sandbox or frame ancestors. Do not return retained raw source collections.

Validation: deterministic tests cover owner source isolation, malformed/future/unverified records, malicious text escaping, tampered readback, concurrent claims, generation loss, expiry, restart and selection beyond20 candidates. The existing-Chrome fixture checks desktop/mobile layout, inert controls, no scripts/forms and zero network requests. PostgreSQL concurrency remains inspection/mock-tested until parent-controlled live verification.

This is a local concept artifact, not a customer-approved website, sale, imported lead, full-role qualification or automatic replacement. Rollback removes the worker hook and owner preview route while retaining the journal.
