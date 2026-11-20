# Owner focus pause

`CEO_PAUSED_DOMAINS=websites,dropshipping` pauses commercial Revenue Engine work and Dropshipping CEO work. The reviewed `.replit` environment persists this nonsecret setting. A hosting environment override must contain the same value; do not assume a source change has propagated until the deployed snapshots report `operatingPause.paused=true` for both domains.

The pause blocks commercial planning, scouting, drafts, approvals, outreach, delivery and direct business functions. POST/PUT/PATCH/DELETE requests under `/api/revenue-engine` and `/api/dropshipping-ceo` return HTTP 423 with `CEO_DOMAIN_PAUSED`. Scheduler calls stop before reading recipients or dispatching work. Existing pending approvals are checked before their status changes; manual automation triggers use their stored agent/key. Factory company-order admission and discovery recheck structured commercial assignees before model or GitHub work. Engineering words such as “new page” do not classify an existing-app repair as commercial website creation. Old approvals and task text cannot lift the pause.

New role-academy and capability-training assignments for Revenue/Dropshipping and the Black Room website cohort are held before provider admission; completed, partial and uncertain history is preserved. Factory/Clippers and other authorized training continues.

Read/status APIs remain accessible. Existing business queues and approval records are held by the persisted domain policy, not deleted, completed, charged, or automatically retried. Their historical statuses remain intact; `operatingPause` reports the effective hold. This does not stop or undo an external action already in flight before activation.

Software maintenance, KONG, the academy, Clippers, and read-only health checks of existing websites remain available. The CEO context prioritizes factory, academy and the Clippers orchestra and assigns former News destinations to clips. This focus does not grant publishing permission, additional spending, or retries for unknown paid News executions.

Deployment verification: read both deployed snapshots, confirm their pause flags, attempt an otherwise valid commercial command and verify HTTP 423 without queue changes, and check factory/academy/Clippers status routes remain readable. The local HTTP fixture covers the policy boundary and direct-call bypasses without external providers or credentials. Actual production readback belongs to the deployment operator.

To resume later, the owner must explicitly authorize changing `CEO_PAUSED_DOMAINS`. Clearing a domain only removes this hold; all existing approvals, budget controls, QA, uncertain-result fences and deployment gates still apply. Rollback: revert the PR and coordinate the environment setting; do not delete queues or replay unknown work.
