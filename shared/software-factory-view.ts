export interface FactoryOrderProposal { orderId:string;orderRevision:string;reviewJobId:string;projectId:string;prUrl:string;baseSha:string;headSha:string;completedAt:string;evidenceCount:number;scope:"reviewed_proposal";orderLink:"historical_unverified";published:false;careerCredit:false;
  /** Read-only link to the office reviewer's verdict for this exact PR head. Never merges or closes the order. */
  officeReview?: FactoryOfficeReviewLink }
export interface FactoryOfficeReviewLink { status:"not_requested"|"pending"|"running"|"pass"|"block"|"failed"|"head_mismatch"|"unavailable"; findingsCount?:number; runId?:string; completedAt?:string }
/** Public owner dashboard. Never includes job payloads, credentials or provider output. */
export interface SoftwareFactoryView {
  proposalEvidenceStatus?: "complete"|"partial"|"unavailable";
  reviewedProposals?: FactoryOrderProposal[];
  checkedAt: string;
  paused: boolean;
  readiness: "blocked" | "paused" | "available";
  blockers: string[];
  /** Review-only PR proposal mode (discover/build/simulate/review). Never implies publication. */
  proposal?: { mode: "review-only"; readiness: "blocked" | "paused" | "available"; blockers: string[] };
  budget: { month: string; limitCents: number; fixedCents: number; spentCents: number; reservedCents: number; remainingCents: number; configured: boolean };
  metrics: { verifiedDeliveries: number; stagingVerifications: number; regressions: number; humanInterventions: number | null; rollbacks: number; blockedJobs: number; completedJobs: number; averageCompletedCostCents: number | null };
  projects: { id: string; repo: string; readiness: string[]; proposalReadiness?: string[]; automaticRelease: boolean }[];
  jobs: { id: string; projectId: string; kind: string; status: string; createdAt: string; costCents: number | null; evidenceCount: number; blocker?: string; reasonCode?: string; headSha?: string }[];
}
