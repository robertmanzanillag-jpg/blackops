import { createHash } from 'node:crypto';
import { DESTINATIONS, DAILY_LIMIT, TIME_ZONE, destinationKey, findDestination, localDay, providerTimestamp } from './clippers-portfolio-metricool.mjs';

const HOUR = 3600000;
const SHA = /^[a-f0-9]{64}$/;
const isSha = value => typeof value === 'string' && SHA.test(value);
function iso(value) {
  const parsed = providerTimestamp(value);
  if (!parsed) return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!match || +match[2] > 23 || +match[3] > 59 || +match[4] > 59 || new Date(match[1] + 'T00:00:00Z').toISOString().slice(0, 10) !== match[1]) return null;
  return parsed;
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const parts = time => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).formatToParts(time).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('invalid_calendar_date');
  const d = new Date(value + 'T12:00:00Z');
  if (!Number.isFinite(+d) || d.toISOString().slice(0, 10) !== value) throw new Error('invalid_calendar_date');
  return d;
}
const nextDay = value => new Date(+date(value) + 24 * HOUR).toISOString().slice(0, 10);
/** Convert a NY wall time; ambiguous/repeated or missing DST wall times fail closed. */
export function newYorkSlot(day, hour) {
  date(day);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('invalid_hour');
  const candidates = [-4, -5].map(offset => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00${offset === -4 ? '-04:00' : '-05:00'}`))
    .filter(d => { const p = parts(d); return `${p.year}-${p.month}-${p.day}` === day && +p.hour === hour && p.minute === '00'; });
  return candidates.length === 1 ? candidates[0].toISOString() : null;
}
function normalizedSnapshot(snapshot, destination, day, now, maxAgeMs) {
  if (!snapshot) return { reason: 'provider_snapshot_missing' };
  if (snapshot.status !== 'verified' || snapshot.complete !== true || !isSha(snapshot.evidenceSha256) ||
      !iso(snapshot.observedAt) || +new Date(snapshot.observedAt) > now || now - +new Date(snapshot.observedAt) > maxAgeMs ||
      !Array.isArray(snapshot.posts) || snapshot.posts.length > 100) return { reason: 'provider_snapshot_unverified_or_stale' };
  const unique = new Map();
  for (const row of snapshot.posts) {
    if (!row || !findDestination(row.destination) || destinationKey(row.destination) !== destinationKey(destination) ||
        typeof row.providerPostId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(row.providerPostId) ||
        !iso(row.scheduledAt) || localDay(new Date(row.scheduledAt)) !== day ||
        !['scheduled', 'published'].includes(row.status) || !isSha(row.confirmationSha256)) return { reason: 'provider_snapshot_row_invalid' };
    if (row.status === 'scheduled' && +new Date(row.scheduledAt) <= now) return { reason: 'past_schedule_requires_publication_confirmation' };
    if (row.status === 'published' && +new Date(row.scheduledAt) > +new Date(snapshot.observedAt)) return { reason: 'provider_snapshot_row_invalid' };
    const normalized = { providerPostId: row.providerPostId, scheduledAt: iso(row.scheduledAt), status: row.status, confirmationSha256: row.confirmationSha256 };
    const prior = unique.get(row.providerPostId);
    if (prior && digest(prior) !== digest(normalized)) return { reason: 'provider_post_identity_conflict' };
    unique.set(row.providerPostId, normalized);
  }
  return { posts: [...unique.values()].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.providerPostId.localeCompare(b.providerPostId)), evidenceSha256: snapshot.evidenceSha256 };
}
/** Pure demand planning. Inputs are normalized by a trusted provider-read adapter, never model assertions.
 * Proposed slots do not authorize preparation, upload, spending or scheduling. No I/O or paid models.
 */
export function planClippersWeek({ now, startDate, endDate, snapshots = [], reservations = [], proposedHours = [12, 14, 16, 18, 20], maxSnapshotAgeMs = 15 * 60000 } = {}) {
  if (!iso(now)) throw new Error('invalid_now');
  const at = +new Date(now), today = localDay(new Date(now));
  const start = startDate ?? today;
  date(start);
  if (start < today) throw new Error('past_start_date');
  let end = endDate;
  if (!end) { const d = date(start); d.setUTCDate(d.getUTCDate() + ((7 - d.getUTCDay()) % 7)); end = d.toISOString().slice(0, 10); }
  date(end);
  if (end < start || +date(end) - +date(start) > 6 * 24 * HOUR) throw new Error('invalid_week_range');
  if (!Array.isArray(snapshots) || snapshots.length > 28 || !Array.isArray(reservations) || reservations.length > 140 ||
      !Array.isArray(proposedHours) || proposedHours.length !== DAILY_LIMIT || new Set(proposedHours).size !== DAILY_LIMIT ||
      proposedHours.some(h => !Number.isInteger(h) || h < 0 || h > 23) || !Number.isFinite(maxSnapshotAgeMs) || maxSnapshotAgeMs <= 0 || maxSnapshotAgeMs > 15 * 60000) throw new Error('invalid_plan_input');
  const days = []; for (let day = start; day <= end; day = nextDay(day)) days.push(day);
  const snapshotMap = new Map();
  for (const snapshot of snapshots) {
    if (!findDestination(snapshot?.destination) || !days.includes(snapshot.day)) throw new Error('snapshot_scope_rejected');
    const key = destinationKey(snapshot.destination) + ':' + snapshot.day;
    if (snapshotMap.has(key)) throw new Error('duplicate_snapshot');
    snapshotMap.set(key, snapshot);
  }
  const holds = new Map();
  for (const reservation of reservations) {
    if (!findDestination(reservation?.destination) || !days.includes(reservation.day) || !['in_flight', 'outcome_unknown'].includes(reservation.status)) throw new Error('reservation_scope_rejected');
    holds.set(destinationKey(reservation.destination) + ':' + reservation.day, 'schedule_outcome_unreconciled');
  }
  const cells = [];
  for (const destination of DESTINATIONS) for (const day of days) {
    const key = destinationKey(destination) + ':' + day;
    const checked = normalizedSnapshot(snapshotMap.get(key), destination, day, at, maxSnapshotAgeMs);
    const posts = checked.posts ?? [], existingHours = new Set(posts.map(p => +parts(new Date(p.scheduledAt)).hour));
    let reason = checked.reason ?? holds.get(key) ?? null;
    if (!reason && posts.length > DAILY_LIMIT) reason = 'existing_daily_cap_exceeded';
    if (!reason && existingHours.size < posts.length) reason = 'existing_posts_share_local_hour';
    const deficit = checked.posts ? Math.max(0, DAILY_LIMIT - posts.length) : null;
    const available = proposedHours.filter(h => !existingHours.has(h)).map(h => newYorkSlot(day, h)).filter(t => t && +new Date(t) >= at + 5 * 60000);
    const proposals = reason ? [] : available.slice(0, deficit);
    if (!reason && proposals.length < deficit) reason = 'insufficient_future_distinct_proposed_hours';
    cells.push({ destination: { ...destination }, day, target: DAILY_LIMIT, providerConfirmedCount: checked.posts ? posts.length : null,
      distinctLocalHours: checked.posts ? existingHours.size : null, deficit, status: reason ? 'held' : deficit ? 'needs_reviewed_assets' : 'covered', reason,
      providerPostIds: posts.map(p => p.providerPostId), providerEvidenceSha256: checked.evidenceSha256 ?? null,
      proposedSlots: proposals.map(scheduledAt => ({ scheduledAt, status: 'proposal_only', requires: ['exact_slot_owner_reviewed_asset', 'current_render_and_media_receipts', 'rights_valid_through_publication', 'source_fresh_at_publication', 'live_provider_preflight'] })),
      readyAssetsVerified: null, schedulingWritesPerformed: 0 });
  }
  // A stable provider ID cannot cover two calendar days in one exact destination.
  const identityCells = new Map();
  for (const cell of cells) for (const id of cell.providerPostIds) {
    const key = destinationKey(cell.destination) + ':' + id;
    const prior = identityCells.get(key);
    if (prior && prior !== cell) {
      for (const affected of [prior, cell]) Object.assign(affected, { status: 'held', reason: 'provider_post_cross_day_identity_conflict', providerConfirmedCount: null, distinctLocalHours: null, deficit: null, proposedSlots: [] });
    } else identityCells.set(key, cell);
  }
  const report = { schema: 1, generatedAt: iso(now), timeZone: TIME_ZONE, startDate: start, endDate: end, dailyLimitPerDestination: DAILY_LIMIT,
    targetPosts: cells.length * DAILY_LIMIT, coverageComplete: cells.every(c => c.deficit !== null), providerConfirmedCount: cells.reduce((n, c) => n + (c.providerConfirmedCount ?? 0), 0),
    knownDeficit: cells.reduce((n, c) => n + (c.deficit ?? 0), 0), unknownCells: cells.filter(c => c.deficit === null).length,
    proposedCount: cells.reduce((n, c) => n + c.proposedSlots.length, 0), disconnectedDestinations: [{ brandId: 6595747, reason: 'network_not_verified' }],
    modelCostUsd: 0, providerWrites: 0, mayPublish: false, cells };
  return { ...report, planSha256: digest(report) };
}
