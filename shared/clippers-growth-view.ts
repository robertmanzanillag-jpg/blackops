// Per-account Clippers growth view (office Clippers roles + Panel central). Pure shaping of the cloud
// streamer ledger's `growth` block (written by script/clippers-streamer-cloud-worker.mjs --growth-only);
// nothing here fetches or invents numbers.
export const GROWTH_LANES = Object.freeze([
  // One row per destination (Clipwave Miami TikTok and Facebook are separate accounts).
  { id: 'memes', brandId: '6431685', network: 'tiktok', label: 'memes · @streamersus' },
  { id: 'sports', brandId: '6431687', network: 'tiktok', label: 'SPORT · @streamersclipusa' },
  { id: 'miami', brandId: '6591612', network: 'tiktok', label: 'Clipwave Miami · TikTok' },
  { id: 'miamifb', brandId: '6591612', network: 'facebook', label: 'Clipwave Miami · Facebook' },
  { id: 'nyc', brandId: '6595747', network: 'facebook', label: 'Clipwave NYC · Facebook' },
] as const);
export type GrowthLaneId = typeof GROWTH_LANES[number]['id'];
export type GrowthRow = { lane: GrowthLaneId; label: string; weeklyViews: number | null; weeklyMedian: number | null; autoPublish: boolean | null; ownerOverride: boolean | null; decisions: number | null };

const OUTPUT = /^growth_(memes|sports|miami|miamifb|nyc)_(views|median|autopublish|decisions)$/;
/** "kind:brandId:network:account[:value]" -> parts. */
export function parseDecision(d: string) { const p = d.split(':'); return { kind: p[0], key: p.slice(1, 4).join(':'), value: p.slice(4).join(':') }; }
const count = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0 ? v as number : null;
export const laneOfDestinationKey = (key: string): GrowthLaneId | null => GROWTH_LANES.find(l => key.startsWith(`${l.brandId}:${l.network}:`))?.id ?? null;

/** Role outputs (numbers only, the orchestra wire contract) for the per-account growth view. */
export function growthOutputs(growth: any): Record<string, number> {
  const out: Record<string, number> = {};
  if (!growth || typeof growth !== 'object' || !growth.accounts || typeof growth.accounts !== 'object') return out;
  const decisions: string[] = Array.isArray(growth.decisions) ? growth.decisions.filter((d: unknown) => typeof d === 'string') : [];
  for (const lane of GROWTH_LANES) {
    // Exactly one destination per row: no max/sum across networks.
    const entry = Object.entries(growth.accounts as Record<string, any>).find(([k]) => laneOfDestinationKey(k) === lane.id);
    if (!entry) continue;
    const a = entry[1];
    out[`growth_${lane.id}_views`] = count(a?.weeklyViews) ?? 0;
    if (Number.isFinite(Number(a?.weeklyMedian)) && a?.weeklyMedian !== null) out[`growth_${lane.id}_median`] = Math.round(Number(a.weeklyMedian));
    // 0 drafts, 1 auto (median >= 1k), 2 auto (owner override).
    out[`growth_${lane.id}_autopublish`] = a?.autoPublish !== true ? 0 : a?.autoPublishMode === 'owner_override' ? 2 : 1;
    out[`growth_${lane.id}_decisions`] = decisions.filter(d => { const { kind, key } = parseDecision(d); return laneOfDestinationKey(key) === lane.id && kind !== 'autopublish_on'; }).length;
  }
  return out;
}

/** Rows for the UI from any role's outputs. */
export function growthRows(outputs: Record<string, number> | undefined | null): GrowthRow[] {
  const rows = new Map<GrowthLaneId, GrowthRow>();
  for (const [key, value] of Object.entries(outputs ?? {})) {
    const m = OUTPUT.exec(key);
    if (!m) continue;
    const lane = m[1] as GrowthLaneId;
    const row = rows.get(lane) ?? { lane, label: GROWTH_LANES.find(l => l.id === lane)!.label, weeklyViews: null, weeklyMedian: null, autoPublish: null, ownerOverride: null, decisions: null };
    if (m[2] === 'views') row.weeklyViews = count(value);
    if (m[2] === 'median') row.weeklyMedian = count(value);
    if (m[2] === 'autopublish') { row.autoPublish = value === 1 || value === 2; row.ownerOverride = value === 2; }
    if (m[2] === 'decisions') row.decisions = count(value);
    rows.set(lane, row);
  }
  return GROWTH_LANES.map(l => rows.get(l.id)).filter((r): r is GrowthRow => !!r);
}

/** Human decision lines (Spanish, owner-facing) from the ledger growth block. */
export function growthDecisionLines(growth: any, limit = 12): string[] {
  const label = (key: string) => GROWTH_LANES.find(l => l.id === laneOfDestinationKey(key))?.label ?? 'cuenta';
  const out: string[] = [];
  for (const d of (Array.isArray(growth?.decisions) ? growth.decisions : []).slice(0, 60)) {
    if (typeof d !== 'string') continue;
    const { kind, key, value } = parseDecision(d);
    const v = value.replace(/[^A-Za-z0-9_:.-]/g, '').slice(0, 60);
    if (kind === 'autopublish_on') out.push(`${label(key)}: auto-publicación activada (mediana semanal ≥ 1k)`);
    else if (kind === 'kill_creator') out.push(`${label(key)}: creador ${v} pausado (mediana < 300 tras 6 posts)`);
    else if (kind === 'kill_hook') out.push(`${label(key)}: gancho "${v}" pausado`);
    else if (kind === 'kill_slot') out.push(`${label(key)}: horario ${v}:00 pausado`);
    else if (kind === 'breakout') out.push(`${label(key)}: post > 10k en 24 h · 3 clips más de ${v}`);
    else if (kind === 'double_creator') out.push(`${label(key)}: post > 100k · doble cuota para ${v}`);
  }
  return out.slice(0, limit);
}
