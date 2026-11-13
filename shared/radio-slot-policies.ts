import { parseRadioDescription } from "./radio-slots";

export const RADIO_SLOT_BASELINE_POLICY = "radio-slots-baseline-v1";
export const RADIO_SLOT_CANDIDATE_POLICY = "radio-slots-range-v1";
export const RADIO_SLOT_PROFILE_ID = "radio-slots-heldout";
export const RADIO_SLOT_PROFILE_VERSION = "1";
export type RadioSlotAssignment = ReturnType<typeof parseRadioDescription>;
export type RadioSlotPolicyVersion = typeof RADIO_SLOT_BASELINE_POLICY | typeof RADIO_SLOT_CANDIDATE_POLICY;
export const RADIO_SLOT_POLICIES = Object.freeze({
  [RADIO_SLOT_BASELINE_POLICY]: Object.freeze({ version: RADIO_SLOT_BASELINE_POLICY, description: "Existing radio description parser, unchanged" }),
  [RADIO_SLOT_CANDIDATE_POLICY]: Object.freeze({ version: RADIO_SLOT_CANDIDATE_POLICY, description: "Whole-line one-hour PM ranges; existing parser for other formats" }),
});
const MAX_DESCRIPTION_LENGTH = 20000;

function checkedInput(description: string | null): string | null {
  if (description !== null && (typeof description !== "string" || description.length > MAX_DESCRIPTION_LENGTH)) throw new Error("Radio description exceeds supported input contract");
  return description;
}

// Versioned adapter only: no mutation of the existing parser or calendar data.
// PM must be explicit on the range end. Unsupported/multi-hour ranges retain
// baseline behavior; the qualification is restricted to this documented format.
function rangeInput(description: string | null): { text: string | null; lines: number; rewrites: number } {
  if (!description) return { text: description, lines: 0, rewrites: 0 };
  const lines = description.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").split(/\r?\n/);
  let rewrites = 0;
  const rewritten = lines.map(line => {
    const match = /^\s*([789])(?::00)?\s*(?:p\.?m\.?)?\s*[-–—]\s*(8|9|10)(?::00)?\s*p\.?m\.?\s*(?:[:–—-]\s*)?(.*?)\s*$/i.exec(line);
    if (!match || Number(match[2]) !== Number(match[1]) + 1) return line;
    rewrites++;
    return `${match[1]}: ${match[3]}`;
  });
  // Preserve baseline normalization exactly when nothing matched.
  return { text: rewrites ? rewritten.join("\n") : description, lines: lines.length, rewrites };
}

export function executeRadioSlotPolicy(version: string, description: string | null) {
  if (!Object.hasOwn(RADIO_SLOT_POLICIES, version)) throw new Error("Unknown radio slot policy version");
  checkedInput(description);
  const input = version === RADIO_SLOT_CANDIDATE_POLICY ? rangeInput(description) : { text: description, lines: 0, rewrites: 0 };
  return {
    policyVersion: version as RadioSlotPolicyVersion,
    assignment: parseRadioDescription(input.text),
    work: { inputCharacters: description?.length || 0, rangeLinesInspected: input.lines, rangeRewrites: input.rewrites,
      baselineParserCalls: 1 as const, measurement: "structural-counters-not-latency-or-total-operations" as const },
  };
}
export function parseRadioSlotsWithPolicy(version: string, description: string | null): RadioSlotAssignment {
  return executeRadioSlotPolicy(version, description).assignment;
}

type OracleCase = { id: string; description: string | null; expected: RadioSlotAssignment };
const slots = (slot7: string | null, slot8: string | null, slot9: string | null): RadioSlotAssignment => ({ slot7, slot8, slot9 });
// Fixed independent oracle: expectations never derive from either policy output.
// These cases are not production execution evidence and do not authorize promotion.
const families: readonly { id: string; cases: readonly OracleCase[] }[] = [
  { id: "compact-ranges", cases: [
    { id: "compact-three", description: "7-8PM DJ Alpha\n8-9PM DJ Beta\n9-10PM DJ Gamma", expected: slots("DJ Alpha", "DJ Beta", "DJ Gamma") },
    { id: "compact-open", description: "7-8PM TBA\n8-9PM Open\n9-10PM N1T0", expected: slots(null, null, "N1T0") },
    { id: "legacy-numeric", description: "7: DJ 808\n8: 808State\n9: N1T0", expected: slots("DJ 808", "808State", "N1T0") },
    { id: "no-schedule", description: "Doors open soon. Contact the producer.", expected: slots(null, null, null) },
  ] },
  { id: "explicit-time-ranges", cases: [
    { id: "minutes-three", description: "7:00 PM - 8:00 PM: Lucia Reina\n8:00 PM - 9:00 PM: DJ Delta\n9:00 PM - 10:00 PM: Dani", expected: slots("Lucia Reina", "DJ Delta", "Dani") },
    { id: "punctuated-empty", description: "7 p.m. – 8 p.m.: Pendiente\n8 p.m. – 9 p.m.: Sol\n9 p.m. – 10 p.m.:", expected: slots(null, "Sol", null) },
    { id: "legacy-compact", description: "7pm: Lucia 8p.m.: TBA 9pm: Dani", expected: slots("Lucia", null, "Dani") },
    { id: "null-description", description: null, expected: slots(null, null, null) },
  ] },
  { id: "html-ranges", cases: [
    { id: "html-breaks", description: "<p>7–8PM: Ana &amp; Sol</p><p>8–9PM: DJ Luna</p><p>9–10PM: DJ Estrella</p>", expected: slots("Ana & Sol", "DJ Luna", "DJ Estrella") },
    { id: "html-empty", description: "7&nbsp;-&nbsp;8PM:<br>8-9PM: Vacío<br/>9-10PM: A&#39;B", expected: slots(null, null, "A'B") },
    { id: "legacy-html", description: "7:&nbsp;<br>8: Luz<br>9:", expected: slots(null, "Luz", null) },
    { id: "empty-description", description: "", expected: slots(null, null, null) },
  ] },
];
const equal = (left: RadioSlotAssignment, right: RadioSlotAssignment) => left.slot7 === right.slot7 && left.slot8 === right.slot8 && left.slot9 === right.slot9;

export function evaluateRadioSlotPolicies() {
  const artifacts = families.map(family => {
    const cases = family.cases.map(item => {
      const baseline = executeRadioSlotPolicy(RADIO_SLOT_BASELINE_POLICY, item.description);
      const candidate = executeRadioSlotPolicy(RADIO_SLOT_CANDIDATE_POLICY, item.description);
      return { caseId: item.id, description: item.description, expected: { ...item.expected }, baseline, candidate,
        baselineCorrect: equal(baseline.assignment, item.expected), candidateCorrect: equal(candidate.assignment, item.expected) };
    });
    const baselineCorrect = cases.filter(c => c.baselineCorrect).length;
    const candidateCorrect = cases.filter(c => c.candidateCorrect).length;
    return { benchmarkId: `${RADIO_SLOT_PROFILE_ID}-v${RADIO_SLOT_PROFILE_VERSION}:${family.id}`, cases,
      baselineQuality: baselineCorrect / cases.length * 100, candidateQuality: candidateCorrect / cases.length * 100,
      noRegression: cases.every(c => !c.baselineCorrect || c.candidateCorrect), strictImprovement: candidateCorrect > baselineCorrect };
  });
  return { profileId: RADIO_SLOT_PROFILE_ID, profileVersion: RADIO_SLOT_PROFILE_VERSION,
    baselinePolicyVersion: RADIO_SLOT_BASELINE_POLICY, candidatePolicyVersion: RADIO_SLOT_CANDIDATE_POLICY,
    scope: "deterministic-heldout-contract" as const, metric: "exact-complete-case-assignment" as const,
    qualified: artifacts.every(a => a.noRegression && a.strictImprovement), artifacts };
}
export type RadioSlotPolicyEvaluation = ReturnType<typeof evaluateRadioSlotPolicies>;
