import { isLearningObservation, type LearningNetwork } from "./blackroom-learning-observations";
import type { reconcileManualObservations } from "./blackroom-manual-observations";

type ManualReport = ReturnType<typeof reconcileManualObservations>;
export interface ManualExploration {
  mode: "observational-hypothesis";
  evaluatedAt: string;
  durationSeconds: 15 | 30 | 60;
  evidencePostIds: string[];
}
export type ManualExplorations = Partial<Record<LearningNetwork, ManualExploration>>;

/** Descriptive signal chooses a follow-up question, never a causal winner.
 * Only actual 24-hour acquisitions are comparable; later totals cannot fill gaps. */
export function proposeManualExploration(report: ManualReport | undefined, now: Date): ManualExplorations {
  const result: ManualExplorations = {};
  const age = now.getTime() - Date.parse(report?.evaluatedAt || "");
  if (report?.mode !== "observational-only" || !Array.isArray(report.deliveries) || !Number.isFinite(age) || age < 0 || age > 36 * 3600000) return result;
  for (const network of ["tiktok", "facebook", "youtube"] as const) {
    const groups = new Map<number, Map<string, { views: number; dj: string }>>();
    for (const delivery of report.deliveries) {
      if (delivery?.status !== "observed" || delivery.network !== network || ![15,30,60].includes(delivery.durationSeconds)
        || !isLearningObservation(delivery.observation) || delivery.observation.network !== network
        || delivery.observation.postId !== delivery.platformPostId || !Array.isArray(delivery.snapshots)) continue;
      const latestAge = now.getTime() - Date.parse(delivery.observation.observedAt);
      if (latestAge < 0 || latestAge > 36 * 3600000) continue;
      const snapshot = delivery.snapshots.find(s => {
        const hours = (Date.parse(s.observedAt)-Date.parse(s.publishedAt))/3600000;
        return isLearningObservation(s) && s.network === network && s.postId === delivery.platformPostId
          && s.windowHours === 24 && hours >=24 && hours <30 && s.ageHours === hours
          && Date.parse(s.observedAt) <= now.getTime() && now.getTime()-Date.parse(s.publishedAt) <=14*86400000;
      });
      if (!snapshot) continue;
      const group = groups.get(delivery.durationSeconds) || new Map();
      group.set(delivery.platformPostId, {views:snapshot.views,dj:delivery.dj});
      groups.set(delivery.durationSeconds, group);
    }
    const eligible = [...groups].filter(([,posts])=>posts.size>=5 && new Set([...posts.values()].map(p=>p.dj)).size>=2)
      .map(([seconds,posts])=>{const views=[...posts.values()].map(p=>p.views).sort((a,b)=>a-b);const middle=Math.floor(views.length/2);
        return {seconds,posts,median:views.length%2?views[middle]:(views[middle-1]+views[middle])/2};})
      .sort((a,b)=>b.median-a.median || a.seconds-b.seconds);
    if (eligible.length<2 || eligible[0].median <=0 || eligible[0].median < eligible[1].median*1.2 || eligible[0].median===eligible[1].median) continue;
    result[network]={mode:"observational-hypothesis",evaluatedAt:now.toISOString(),durationSeconds:eligible[0].seconds as 15|30|60,
      evidencePostIds:eligible.flatMap(g=>[...g.posts.keys()]).sort()};
  }
  return result;
}

export function sharedManualExploration(hypotheses: ManualExplorations | undefined, networks: LearningNetwork[], now: Date): number | null {
  const values=networks.map(n=>hypotheses?.[n]);
  const seconds=values[0]?.durationSeconds;
  return networks.length && seconds && values.every(v=>v?.mode==="observational-hypothesis" && v.durationSeconds===seconds
    && [15,30,60].includes(seconds) && Array.isArray(v.evidencePostIds) && new Set(v.evidencePostIds).size>=10
    && now.getTime()-Date.parse(v.evaluatedAt)>=0 && now.getTime()-Date.parse(v.evaluatedAt)<=36*3600000) ? seconds : null;
}
