import type { CouncilState } from "../shared/agent-council";
import { OFFICE_FEATURE_MAP, OFFICE_FEATURE_MAP_VERSION, type OfficeVerification } from "../shared/office-verification";
import { parseCapabilityTraining, capabilityTrainingSummary, gradeCapabilityTriage, CAPABILITY_PROMPT_VERSION } from "./office-capability-training";
import { parseRoleWork } from "./office-role-work";
import { parseSelfHealState, selfHealOfficeView } from "./office-self-heal";
import { selfHealTotals } from "../shared/office-self-heal-view";

const DAY = 86400_000;
const average = (values: number[]) => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;

/** Read-only projection of validated journals. No provider calls, admissions,
 * policy changes or retries can be triggered by opening this report. */
export function buildOfficeVerification(state: CouncilState, owner: string, now = Date.now(), env: NodeJS.ProcessEnv = process.env): OfficeVerification {
  const execution = state.officeExecution;
  const training = parseCapabilityTraining(execution?.capabilityTraining, owner);
  const work = parseRoleWork(execution?.roleWork, owner);
  if (execution?.selfHeal !== undefined) parseSelfHealState(execution.selfHeal, owner);
  const feedbackEnabled = env.OFFICE_SELF_HEAL_ENABLED === "true";
  const feedback = selfHealTotals(selfHealOfficeView(execution?.selfHeal, work, now, feedbackEnabled));
  const generations = Object.fromEntries(Object.entries(state.company.careers).map(([role, career]) => [role, career.generation]));
  const summaries = capabilityTrainingSummary(training, owner, generations);
  const completed = training.runs.filter(run => run.status === "completed" && run.trained && Date.parse(run.startedAt) <= now && Date.parse(run.trained.result.completedAt) <= now && (!run.baseline || Date.parse(run.baseline.result.completedAt) <= now));
  const confirmed = completed.filter(run => run.promptVersion === CAPABILITY_PROMPT_VERSION && generations[run.role] === run.generation);
  const unresolved = training.runs.filter(run => run.status === "unknown" || run.status === "running" && Date.parse(run.expiresAt) <= now).length;
  const qualifiedVersions = new Set<string>();
  const comparisons = summaries.filter(policy => policy.instructionCorrected && generations[policy.role] === policy.generation && policy.trainingRunId !== null).map(policy => {
    const parentVersion = training.policies.find(candidate => candidate.version === policy.policyVersion)!.parentVersion;
    const pairs = confirmed.filter(run => run.kind === "holdout" && run.policyVersion === policy.policyVersion && run.baselineVersion === parentVersion && run.promptVersion === CAPABILITY_PROMPT_VERSION && run.baseline);
    const visibleQualification = pairs.length === 3 && new Set(pairs.map(run => run.fixtureIndex)).size === 3 && pairs.every(run => gradeCapabilityTriage(run.task, run.trained!.result.text).passed);
    if (visibleQualification && policy.comparisonQualified) qualifiedVersions.add(policy.policyVersion);
    const lastExam = Math.max(...pairs.map(run => Date.parse(run.trained!.result.completedAt)), 0);
    const firstResult = confirmed.filter(run => run.kind === "production" && run.policyVersion === policy.policyVersion && Date.parse(run.startedAt) >= lastExam && gradeCapabilityTriage(run.task, run.trained!.result.text).passed)
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))[0];
    return { role: policy.role, policyVersion: policy.policyVersion, status: policy.lifecycle?.status || policy.status,
      passedPairs: pairs.filter(run => gradeCapabilityTriage(run.task, run.trained!.result.text).passed).length,
      baselineQuality: average(pairs.map(run => gradeCapabilityTriage(run.task, run.baseline!.result.text).quality)),
      candidateQuality: average(pairs.map(run => gradeCapabilityTriage(run.task, run.trained!.result.text).quality)),
      firstVerifiedRunId: visibleQualification && policy.comparisonQualified && !policy.lifecycle?.retiredAt && policy.status === "active" ? firstResult?.id || null : null };
  });
  // A future timestamp cannot manufacture recent execution evidence.
  const times = [...work.jobs.filter(job => job.artifactId).map(job => job.completedAt), ...confirmed.map(run => run.trained!.result.completedAt)]
    .map(value => Date.parse(value || "")).filter(value => Number.isFinite(value) && value <= now);
  const latest = times.length ? Math.max(...times) : null;
  return {
    generatedAt: new Date(now).toISOString(), featureMapVersion: OFFICE_FEATURE_MAP_VERSION,
    evidenceStatus: latest === null ? "missing" : now - latest <= DAY ? "recent" : "stale",
    latestEvidenceAt: latest === null ? null : new Date(latest).toISOString(),
    mechanisms: {
      feedback: { enabled: feedbackEnabled, detected: feedback.detected, repairing: feedback.repairing, verified: feedback.verified, needsOwner: feedback.needsOwner },
      evals: { enabled: env.OFFICE_CAPABILITY_TRAINING_ENABLED === "true", totalRuns: training.runs.length, completedRuns: completed.length,
        unknownRuns: unresolved,
        candidatePolicies: summaries.filter(policy => policy.instructionCorrected && generations[policy.role] === policy.generation && policy.status === "candidate").length,
        qualifiedPolicies: qualifiedVersions.size, verifiedImprovements: comparisons.filter(row => row.firstVerifiedRunId !== null).length, comparisons },
      guardrails: { status: "declared_in_code", rules: [
        "Sin evidencia independiente no se aprueba el cambio; la revisión queda ligada a la revisión exacta del PR.",
        "Una política candidata exige tres comparaciones separadas, calidad superior, costo y latencia sin regresión.",
        "Una mejora requiere además su primera ejecución real verificada; no equivale a reemplazar el rol completo.",
        "Una ejecución incierta bloquea nuevos intentos hasta reconciliarse; no se duplica automáticamente.",
        "Presupuestos, permisos y límites de reparación se controlan por código; las instrucciones no pueden ampliarlos.",
      ], references: [
        { rule: "Revisión ligada al PR", source: "server/office-runtime.ts#execute", test: "tests/office-runtime.test.ts" },
        { rule: "Comparación y primera ejecución", source: "server/office-capability-training.ts#eligible", test: "tests/office-capability-training.test.ts" },
        { rule: "Versiones, generaciones y ejecución incierta", source: "shared/office-role-lifecycle.ts#reserveRoleExecution", test: "tests/office-role-lifecycle.test.ts" },
        { rule: "Presupuesto y evidencia de publicación", source: "server/software-factory.ts#releaseGate", test: "tests/software-factory.test.ts" },
        { rule: "Reparaciones limitadas y reauditoría", source: "server/office-self-heal.ts#planSelfHeal", test: "tests/office-self-heal.test.ts" },
      ] },
    },
    featureMap: OFFICE_FEATURE_MAP.map(feature => ({ ...feature })),
    limitations: [
      ...(unresolved ? ["Hay evaluaciones inciertas, incluidas versiones o generaciones anteriores: el entrenador exige reconciliarlas antes de admitir más trabajo."] : []),
      "Las banderas describen este servidor web; no prueban la configuración ni el heartbeat del ejecutor dedicado.",
      "La evidencia reciente acredita trabajo registrado; no demuestra que un proceso siga ejecutándose ahora.",
      "Las comparaciones miden solo clasificación de auditorías guardadas, no la inteligencia general ni los resultados de todos los agentes.",
      "La academia sintética y las propuestas pendientes no cuentan como mejoras activadas. Publicar requiere el proceso de revisión existente.",
    ],
  };
}
