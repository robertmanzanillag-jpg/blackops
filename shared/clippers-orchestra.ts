import { ALL_DISCOVERY_CREATORS, LEGACY_DISCOVERY_CREATORS, KNOWN_CREATOR_GROUPS } from './clippers-priority-creators.mjs';
import { parseViralScout, type ViralScoutView } from './clippers-viral-scout.mjs';
/** Sanitized wire contract for the owner-only Clippers orchestra. No rights grants or credentials. */
export type ClippersRoleStage = 'supervisor' | 'analytics' | 'trends' | 'streamers' | 'editor' | 'checker' | 'publisher' | 'learning' | 'health';
export type ClippersRoleState = 'working' | 'completed' | 'held' | 'idle' | 'stale' | 'disconnected';
export type ClippersCareerView = { registered: boolean; generation: number | null; points: number | null; battery: number | null; inTraining: boolean; hiredAt: string | null; skillIds: string[]; lastEvidenceId: string | null };
export type ClippersVerifiedOutcome = { evidenceId: string; completedAt: string; outcome: 'verified_deliverable' | 'attributable_failure'; reason: string; artifactSha256: string };
export type ClippersRoleEvidence = {
  id: `clippers-${ClippersRoleStage}`; stage: ClippersRoleStage; state: ClippersRoleState;
  evidenceAt: string | null; activeUntil: string | null; lastRunAt: string | null; heartbeatAt: string | null; nextDueAt: string | null;
  runId: string | null; evidenceIds: string[]; outputs: Record<string, number>;
  heldReasons: string[]; lifePenaltyExempt: boolean; career: ClippersCareerView; outcomes?: ClippersVerifiedOutcome[];
  /** Owner notes (an action only the owner can take, e.g. a Facebook identity check). Not a failure. */
  ownerNotes?: string[];
};
export type ClippersMetricAgeBucket = { windowHours: 24 | 72 | 168; samples: number; actualAgeHoursMin: number | null; actualAgeHoursMax: number | null; latestObservedAt: string | null; views: number; likes: number | null; comments: number | null; shares: number | null };
export type ClippersAccountView = {
  key: string; brandId: string; network: 'tiktok' | 'facebook'; account: string; label: string;
  connection: 'observed' | 'unverified' | 'disconnected'; observedAt: string | null;
  dailyTarget: number; eligibleAssets: number | null; confirmedScheduledOrPublished: number | null;
  shortfall: number | null; heldReasons: string[]; activeVersion: string | null;
  policyStatus: string; metricAgeBuckets: ClippersMetricAgeBucket[];
  analytics?: { status: 'observed' | 'held' | 'unavailable'; observedAt: string | null; posts: number | null; totalViews: number | null; actualAgeHoursMin: number | null; actualAgeHoursMax: number | null; heldReasons: string[] };
};
export type ClippersTrendSignal = {
  creatorId: string; videoId: string; publishedAt: string; observedAt: string;
  views: number | null; previousObservedAt: string | null; previousViews: number | null;
  growthViews: number | null; growthPerHour: number | null;
  label: 'initial_baseline' | 'paired_growth_observed' | 'insufficient_metrics' | 'stale_reference';
  rights: 'unknown';
};
export type ClippersSourceView = { creatorId: string; channelId: string; observedAt: string | null; status: 'observed' | 'unavailable' | 'not_observed'; heldReasons: string[]; observations: number };
export type ClippersComparisonView = {
  id: string; destination: string; variable: string; baselineVersion: string; candidateVersion: string;
  controlSamples: number; candidateSamples: number; improvementRatio: number | null;
  current: boolean; renderReceiptVerified: boolean; eligible: boolean; heldReasons: string[];
};
export type ClippersCreatorPreferenceView = { scopeKey: string; destination: {brandId:number;network:'tiktok'|'facebook';account:string}; language:string;format:string;context:string;postingBand:string;timezone:'America/New_York';windowHours:24|72|168;baselineCreatorGroupId:string;preferredCreatorGroupId:string;status:'preferred'|'baseline'|'unmeasured';reason:string;eligibleSamples:number;expiresAt:string|null;evidenceSha256:string };
export type ClippersCreatorSelectionView = { evaluatedAt:string|null; contexts:number;assigned:number|null;heldReasons:string[];preferences:ClippersCreatorPreferenceView[] };
export type ClippersOrchestraStatus = {
  creatorSelection?: ClippersCreatorSelectionView;
  version: 1; generatedAt: string; evidenceAt: string | null;
  sourceFreshness: { state: 'connected' | 'stale' | 'disconnected' | 'invalid'; transport: 'local_reports' | 'authenticated_ingest' | 'unavailable'; receivedAt: string | null; reportedAt: string | null; ageMinutes: number | null; staleAfterMinutes: number; heldReasons: string[] };
  transport: { state: 'connected' | 'stale' | 'disconnected' | 'invalid'; lastIngestAt: string | null; maxAgeMs: number };
  disconnectedDestinations: { brandId: string; label: string; reason: string }[];
  accounts: ClippersAccountView[]; roles: ClippersRoleEvidence[];
  discovery: { sources: ClippersSourceView[]; observations: number | null; eligibleAssets: number | null; rotationSize: number; rotationDays: number; catalogVersion?:2; signals: ClippersTrendSignal[]; scout?: ViralScoutView; rightsPolicy: 'owner_review_required' };
  learning: { comparisons: ClippersComparisonView[]; eligibleComparisons: number | null; promotions: number | null; requiredComparisons: 3; minimumPerArm: 5; improvementThreshold: 0.2; automaticPromotion: false; heldReasons: string[] };
  safety: { paidSpendUsd: 0; deniedBrandIds: string[]; metadataDoesNotGrantRights: true; publicUploadRequiresReviewedPacket: true; publicationClaimsRequireProviderReceipt: true };
};

const roleStages = ['supervisor','analytics','trends','streamers','editor','checker','publisher','learning','health'] as const;
const targetKeys = ['6431685:tiktok:streamersus','6431687:tiktok:streamersclipusa','6591612:tiktok:news305miami','6591612:facebook:1193011863901514'];
// Earlier account names of the same brand+network (script/clippers-portfolio-metricool.mjs LEGACY_ACCOUNT_ALIASES).
// Persisted learning/creator-selection evidence written before the rename still names the same destination.
const legacyTargetKeys: Record<string,string> = { '6431685:tiktok:streamersclips': '6431685:tiktok:streamersus', '6591612:tiktok:ynb4b6r6': '6591612:tiktok:news305miami' };
const isTargetKey = (k: unknown) => typeof k === 'string' && targetKeys.includes(legacyTargetKeys[k] ?? k);
const denied = ['6431692','6475033','6585226'];
const sourceChannels:Record<string,string>=Object.fromEntries(ALL_DISCOVERY_CREATORS.map(c=>[c.id,c.channelId]));
const knownGroups=new Set(KNOWN_CREATOR_GROUPS.map(g=>g.id));
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: unknown, names: string[]) => record(v) && Object.keys(v).length === names.length && Object.keys(v).every(k=>names.includes(k));
const count = (v: unknown) => Number.isSafeInteger(v) && Number(v)>=0 && Number(v)<=Number.MAX_SAFE_INTEGER;
const nullableCount = (v: unknown) => v===null || count(v);
const text = (v: unknown, max=200) => typeof v==='string' && v.length>0 && v.length<=max && !/[\r\n\x00-\x1f]/.test(v);
const code = (v: unknown) => typeof v==='string' && /^[a-zA-Z0-9_.:-]{1,200}$/.test(v);
const codes = (v: unknown, max=100) => Array.isArray(v) && v.length<=max && v.every(code) && new Set(v).size===v.length;
const time = (v: unknown, until: number) => typeof v==='string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v && Date.parse(v)<=until;
const nullableTime = (v: unknown, until: number) => v===null || time(v,until);
const finite = (v: unknown) => typeof v==='number' && Number.isFinite(v);
const nullableFinite = (v: unknown) => v===null || finite(v);

/** Reject malformed payloads instead of turning unavailable evidence into zero activity. */
export function parseClippersOrchestraStatus(value: unknown, now=Date.now()): ClippersOrchestraStatus | null {
  if(!record(value)||!keys(value,['version','generatedAt','evidenceAt','sourceFreshness','transport','disconnectedDestinations','accounts','roles','discovery','learning','safety',...(value.creatorSelection===undefined?[]:['creatorSelection'])]))return null;
  const v=value as Record<string,any>;
  if(v.version!==1 || !time(v.generatedAt,now) || !nullableTime(v.evidenceAt,now))return null;
  const sf=v.sourceFreshness, tr=v.transport;
  const states=['connected','stale','disconnected','invalid'];
  if(!keys(sf,['state','transport','receivedAt','reportedAt','ageMinutes','staleAfterMinutes','heldReasons']) || !states.includes(sf.state) ||
    !['local_reports','authenticated_ingest','unavailable'].includes(sf.transport) || !nullableTime(sf.receivedAt,now) || !nullableTime(sf.reportedAt,now) ||
    !nullableFinite(sf.ageMinutes) || (sf.ageMinutes!==null&&sf.ageMinutes<0) || !count(sf.staleAfterMinutes) || sf.staleAfterMinutes<1 || !codes(sf.heldReasons))return null;
  if(!keys(tr,['state','lastIngestAt','maxAgeMs']) || !states.includes(tr.state) || !nullableTime(tr.lastIngestAt,now) || tr.maxAgeMs!==90_000)return null;
  if(!Array.isArray(v.disconnectedDestinations) || v.disconnectedDestinations.length!==1 || !keys(v.disconnectedDestinations[0],['brandId','label','reason']) ||
    v.disconnectedDestinations[0].brandId!=='6595747' || !text(v.disconnectedDestinations[0].label) || v.disconnectedDestinations[0].reason!=='destination_not_connected')return null;
  if(!Array.isArray(v.accounts) || v.accounts.length!==4 || new Set(v.accounts.map((a:any)=>a?.key)).size!==4)return null;
  for(const a of v.accounts){
    if(!keys(a,['key','brandId','network','account','label','connection','observedAt','dailyTarget','eligibleAssets','confirmedScheduledOrPublished','shortfall','heldReasons','activeVersion','policyStatus','metricAgeBuckets',...(a.analytics===undefined?[]:['analytics'])]) ||
      !targetKeys.includes(a.key) || a.key!==[a.brandId,a.network,a.account].join(':') || !text(a.label) ||
      !['observed','unverified','disconnected'].includes(a.connection) || !nullableTime(a.observedAt,now) || a.dailyTarget!==5 ||
      ![a.eligibleAssets,a.confirmedScheduledOrPublished,a.shortfall].every(nullableCount) || !codes(a.heldReasons) ||
      !(a.activeVersion===null||code(a.activeVersion)) || !code(a.policyStatus) || !Array.isArray(a.metricAgeBuckets) || a.metricAgeBuckets.length>3)return null;
    if(a.analytics!==undefined){const x=a.analytics;if(!keys(x,['status','observedAt','posts','totalViews','actualAgeHoursMin','actualAgeHoursMax','heldReasons'])||!['observed','held','unavailable'].includes(x.status)||!nullableTime(x.observedAt,now)||![x.posts,x.totalViews].every(nullableCount)||![x.actualAgeHoursMin,x.actualAgeHoursMax].every(nullableFinite)||!codes(x.heldReasons)||(x.actualAgeHoursMin!==null&&(x.actualAgeHoursMin<0||x.actualAgeHoursMax<x.actualAgeHoursMin)))return null;}
    const seen=new Set();
    for(const b of a.metricAgeBuckets){
      if(!keys(b,['windowHours','samples','actualAgeHoursMin','actualAgeHoursMax','latestObservedAt','views','likes','comments','shares']) ||
        ![24,72,168].includes(b.windowHours) || seen.has(b.windowHours) || ![b.samples,b.views].every(count) || ![b.likes,b.comments,b.shares].every(nullableCount) ||
        ![b.actualAgeHoursMin,b.actualAgeHoursMax].every(nullableFinite) || !nullableTime(b.latestObservedAt,now) ||
        (b.actualAgeHoursMin!==null&&(b.actualAgeHoursMin<b.windowHours||b.actualAgeHoursMax<b.actualAgeHoursMin||b.actualAgeHoursMax>=b.windowHours+24)))return null;
      seen.add(b.windowHours);
    }
  }
  if(!Array.isArray(v.roles)||v.roles.length!==9||new Set(v.roles.map((r:any)=>r?.id)).size!==9)return null;
  for(const r of v.roles){
    if(!keys(r,['id','stage','state','evidenceAt','activeUntil','lastRunAt','heartbeatAt','nextDueAt','runId','evidenceIds','outputs','heldReasons','lifePenaltyExempt','career',...(r.outcomes===undefined?[]:['outcomes']),...(r.ownerNotes===undefined?[]:['ownerNotes'])]) ||
      !roleStages.includes(r.stage)||r.id!==`clippers-${r.stage}`||!['working','completed','held','idle','stale','disconnected'].includes(r.state)||
      ![r.evidenceAt,r.lastRunAt,r.heartbeatAt].every(at=>nullableTime(at,now)) || !nullableTime(r.activeUntil,now+2*3600000) ||
      !nullableTime(r.nextDueAt,now+3*86400000) || !(r.runId===null||code(r.runId)) || !codes(r.evidenceIds) || !codes(r.heldReasons) ||
      typeof r.lifePenaltyExempt!=='boolean' || !record(r.outputs)||Object.keys(r.outputs).length>20 || !Object.entries(r.outputs).every(([k,n])=>code(k)&&count(n)))return null;
    if(r.ownerNotes!==undefined&&(!Array.isArray(r.ownerNotes)||r.ownerNotes.length>5||r.ownerNotes.some((n:any)=>typeof n!=='string'||!n.length||n.length>160)))return null;
    if(r.outcomes!==undefined&&(!Array.isArray(r.outcomes)||r.outcomes.length>100||r.outcomes.some((o:any)=>!keys(o,['evidenceId','completedAt','outcome','reason','artifactSha256'])||!code(o.evidenceId)||!time(o.completedAt,now)||!['verified_deliverable','attributable_failure'].includes(o.outcome)||!code(o.reason)||!(/^[a-f0-9]{64}$/).test(o.artifactSha256))))return null;
    const c=r.career;
    if(!keys(c,['registered','generation','points','battery','inTraining','hiredAt','skillIds','lastEvidenceId']) || typeof c.registered!=='boolean'||typeof c.inTraining!=='boolean'||
      ![c.generation,c.points,c.battery].every(nullableCount)||!nullableTime(c.hiredAt,now)||!codes(c.skillIds,12)||!(c.lastEvidenceId===null||code(c.lastEvidenceId)) ||
      (c.registered?(c.generation<1||c.points===null||c.battery===null||c.battery>100||!c.hiredAt):[c.generation,c.points,c.battery,c.hiredAt,c.lastEvidenceId].some(x=>x!==null)))return null;
  }
  const d=v.discovery;
  const sourceCatalog=d?.catalogVersion===2?ALL_DISCOVERY_CREATORS:LEGACY_DISCOVERY_CREATORS;
  if(!keys(d,['sources','observations','eligibleAssets','rotationSize','rotationDays','signals','rightsPolicy',...(d.catalogVersion===undefined?[]:['catalogVersion']),...(d.scout===undefined?[]:['scout'])]) || !nullableCount(d.observations)||!nullableCount(d.eligibleAssets)||
    (d.catalogVersion===2?(d.rotationSize!==14||d.rotationDays!==1):(d.catalogVersion!==undefined||d.rotationSize!==4||d.rotationDays!==2))||d.rightsPolicy!=='owner_review_required'||
    !Array.isArray(d.sources)||d.sources.length!==sourceCatalog.length||new Set(d.sources.map((s:any)=>s?.creatorId)).size!==sourceCatalog.length||!sourceCatalog.every(c=>d.sources.some((s:any)=>s.creatorId===c.id&&s.channelId===c.channelId))||!Array.isArray(d.signals)||d.signals.length>200)return null;
  for(const s of d.sources)if(!keys(s,['creatorId','channelId','observedAt','status','heldReasons','observations'])||!sourceCatalog.some(c=>c.id===s.creatorId)||sourceChannels[s.creatorId]!==s.channelId||!nullableTime(s.observedAt,now)||!['observed','unavailable','not_observed'].includes(s.status)||!codes(s.heldReasons)||!count(s.observations))return null;
  for(const s of d.signals){
    if(!keys(s,['creatorId','videoId','publishedAt','observedAt','views','previousObservedAt','previousViews','growthViews','growthPerHour','label','rights'])||!sourceCatalog.some(c=>c.id===s.creatorId)||!(/^[A-Za-z0-9_-]{11}$/).test(s.videoId)||!time(s.publishedAt,now)||!time(s.observedAt,now)||Date.parse(s.publishedAt)>Date.parse(s.observedAt)||
      !nullableCount(s.views)||!nullableTime(s.previousObservedAt,now)||!nullableCount(s.previousViews)||!nullableFinite(s.growthViews)||!nullableFinite(s.growthPerHour)||!['initial_baseline','paired_growth_observed','insufficient_metrics','stale_reference'].includes(s.label)||s.rights!=='unknown')return null;
    if(s.label==='paired_growth_observed'&&(!s.previousObservedAt||Date.parse(s.previousObservedAt)>=Date.parse(s.observedAt)||s.growthViews<=0||s.growthPerHour<=0||now-Date.parse(s.observedAt)>72*3600000||now-Date.parse(s.previousObservedAt)>72*3600000))return null;
  }
  if(d.scout!==undefined&&!parseViralScout(d.scout,now))return null;
  const l=v.learning;
  if(!keys(l,['comparisons','eligibleComparisons','promotions','requiredComparisons','minimumPerArm','improvementThreshold','automaticPromotion','heldReasons']) || !Array.isArray(l.comparisons)||l.comparisons.length>100||!nullableCount(l.eligibleComparisons)||!nullableCount(l.promotions)||l.requiredComparisons!==3||l.minimumPerArm!==5||l.improvementThreshold!==0.2||l.automaticPromotion!==false||!codes(l.heldReasons))return null;
  for(const c of l.comparisons)if(!keys(c,['id','destination','variable','baselineVersion','candidateVersion','controlSamples','candidateSamples','improvementRatio','current','renderReceiptVerified','eligible','heldReasons'])||!code(c.id)||!isTargetKey(c.destination)||!['hook','duration','caption_layout','crop','posting_slot'].includes(c.variable)||!code(c.baselineVersion)||!code(c.candidateVersion)||![c.controlSamples,c.candidateSamples].every(count)||!nullableFinite(c.improvementRatio)||![c.current,c.renderReceiptVerified,c.eligible].every(x=>typeof x==='boolean')||!codes(c.heldReasons)||(c.eligible&&(!c.current||!c.renderReceiptVerified||c.controlSamples<5||c.candidateSamples<5||c.improvementRatio===null||c.improvementRatio+Number.EPSILON<0.2)))return null;
  if(v.creatorSelection!==undefined){
    const c=v.creatorSelection;
    if(!keys(c,['evaluatedAt','contexts','assigned','heldReasons','preferences'])||!nullableTime(c.evaluatedAt,now)||!count(c.contexts)||c.contexts>32||!nullableCount(c.assigned)||!codes(c.heldReasons)||!Array.isArray(c.preferences)||c.preferences.length!==c.contexts||new Set(c.preferences.map((p:any)=>p.scopeKey)).size!==c.preferences.length)return null;
    for(const p of c.preferences){
      if(!keys(p,['scopeKey','destination','language','format','context','postingBand','timezone','windowHours','baselineCreatorGroupId','preferredCreatorGroupId','status','reason','eligibleSamples','expiresAt','evidenceSha256'])||!(/^[a-f0-9]{64}$/).test(p.scopeKey)||!(/^[a-f0-9]{64}$/).test(p.evidenceSha256)||!keys(p.destination,['brandId','network','account'])||(!Number.isSafeInteger(p.destination.brandId)||!isTargetKey([p.destination.brandId,p.destination.network,p.destination.account].join(':')))||!/^([01]\d|2[0-3]):00$/.test(p.postingBand)||p.timezone!=='America/New_York'||![24,72,168].includes(p.windowHours)||!code(p.language)||!code(p.format)||!code(p.context)||!knownGroups.has(p.baselineCreatorGroupId)||!knownGroups.has(p.preferredCreatorGroupId)||!['preferred','baseline','unmeasured'].includes(p.status)||!code(p.reason)||!count(p.eligibleSamples)||!nullableTime(p.expiresAt,now+24*3600000)||
        (p.status==='preferred'&&(!p.expiresAt||Date.parse(p.expiresAt)<=now||p.eligibleSamples<30)))return null;
    }
  }
  const s=v.safety;
  if(!keys(s,['paidSpendUsd','deniedBrandIds','metadataDoesNotGrantRights','publicUploadRequiresReviewedPacket','publicationClaimsRequireProviderReceipt'])||s.paidSpendUsd!==0||!Array.isArray(s.deniedBrandIds)||s.deniedBrandIds.length!==3||new Set(s.deniedBrandIds).size!==3||!s.deniedBrandIds.every((x:unknown)=>typeof x==='string'&&denied.includes(x))||s.metadataDoesNotGrantRights!==true||s.publicUploadRequiresReviewedPacket!==true||s.publicationClaimsRequireProviderReceipt!==true)return null;
  return structuredClone(v) as ClippersOrchestraStatus;
}
