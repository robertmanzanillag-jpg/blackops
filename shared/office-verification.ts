export type OfficeFeature = {
  id: string; title: string; route: string; api: string; expected: string; test: string;
};

export const OFFICE_FEATURE_MAP_VERSION = 1;
// Navigation and expected evidence are code-owned, never model-authored checks.
export const OFFICE_FEATURE_MAP: readonly OfficeFeature[] = Object.freeze([
  { id: "office", title: "Oficina y actividad", route: "/agents-office", api: "/api/agent-council/state", expected: "Cada estado distingue actividad observada, bloqueo y falta de evidencia.", test: "tests/kong-office-browser-qa.test.mjs" },
  { id: "runs", title: "Trabajo real y evaluaciones", route: "/agents-office?officePanel=history", api: "/api/agent-council/internal-work", expected: "Abrir Trabajo real; comparar resultados e instrucciones sin confundir una evaluación con trabajo de negocio.", test: "tests/office-capability-training.test.ts" },
  { id: "verification", title: "Verificación y mejora", route: "/agents-office?officePanel=verification", api: "/api/agents-office/verification", expected: "Abrir Verificación y mejora; una mejora exige tres comparaciones y una ejecución real posterior verificada.", test: "tests/office-verification-browser.test.mjs" },
  { id: "review", title: "Revisión independiente", route: "/agents-office?officePanel=history", api: "/api/agents-office/runs", expected: "La revisión identifica el PR y su revisión exacta; un cambio de código invalida el dictamen anterior.", test: "tests/office-runtime.test.ts" },
  { id: "qa", title: "Comprobación de aplicaciones", route: "/app-qa-agent", api: "/api/app-qa-agent/status", expected: "Consultar rutas, clics, API y errores antes de declarar listo un cambio.", test: "tests/app-qa-agent.test.ts" },
]);

export interface OfficeVerification {
  generatedAt: string;
  featureMapVersion: number;
  evidenceStatus: "recent" | "stale" | "missing";
  latestEvidenceAt: string | null;
  mechanisms: {
    feedback: { enabled: boolean; detected: number; repairing: number; verified: number; needsOwner: number };
    evals: {
      enabled: boolean; totalRuns: number; completedRuns: number; unknownRuns: number;
      candidatePolicies: number; qualifiedPolicies: number; verifiedImprovements: number;
      comparisons: Array<{ role: string; policyVersion: string; status: string; passedPairs: number;
        baselineQuality: number | null; candidateQuality: number | null; firstVerifiedRunId: string | null }>;
    };
    guardrails: { status: "declared_in_code"; rules: string[]; references: Array<{ rule: string; source: string; test: string }> };
  };
  featureMap: OfficeFeature[];
  limitations: string[];
}
