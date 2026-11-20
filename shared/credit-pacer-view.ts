// Office world header line for the daily credit pacer (pure; client and tests).
// Input is the public view from server/credit-pacer.ts creditPacerView: numbers and a mode enum only.
const MODE_LABEL = { normal: "modo normal", soft: "modo suave", hard: "crédito agotado" } as const;

export function creditPacerLine(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (v.present !== true || v.current !== true) return null;
  const allowance = Number(v.allowanceUsd), spent = Number(v.spentTodayUsd), streak = Number(v.streak);
  const mode = MODE_LABEL[v.mode as keyof typeof MODE_LABEL];
  if (!Number.isFinite(allowance) || !Number.isFinite(spent) || !mode) return null;
  const parts = [`Presupuesto hoy: $${spent.toFixed(2)} de $${allowance.toFixed(2)}`, mode];
  if (Number.isSafeInteger(streak) && streak >= 2) parts.push(`${streak} días seguidos por encima`);
  return parts.join(" · ");
}
