// Social Hub scheduler: queue, approval gate, publishing with retries, best-time picker.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  engagementOf,
  validateSocialPost,
  type SocialMetricSnapshot,
  type SocialNetwork,
  type SocialPost,
  type SocialPostInput,
  type SocialPostStatus,
} from "@shared/social-hub";
import { collectPostMetrics, summarizeMetrics } from "./analytics";
import { kvGet, kvSet } from "./persist";
import { SOCIAL_PROVIDERS, SocialPublishError, type FetchLike, type SocialCredentialStore, type SocialProvider } from "./providers";

export interface SocialHubStore {
  load(): SocialHubState;
  save(state: SocialHubState): void;
}

export interface SocialHubState {
  posts: SocialPost[];
  metrics: SocialMetricSnapshot[];
}

/** Durable store (Postgres on Replit, file locally) via ./persist. Requires hydrateSocialHub() at startup. */
export function persistentSocialHubStore(key = "state"): SocialHubStore {
  return {
    load() {
      const raw = kvGet(key);
      if (!raw) return { posts: [], metrics: [] };
      try { return JSON.parse(raw); } catch { return { posts: [], metrics: [] }; }
    },
    save(state) { kvSet(key, JSON.stringify(state)); },
  };
}

/** Plain file store (local scripts only — Replit wipes files on redeploy). */
export function fileSocialHubStore(path = process.env.SOCIAL_HUB_STATE_PATH ?? "data/social-hub/state.json"): SocialHubStore {
  return {
    load() {
      if (!existsSync(path)) return { posts: [], metrics: [] };
      try { return JSON.parse(readFileSync(path, "utf8")); } catch { return { posts: [], metrics: [] }; }
    },
    save(state) {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify(state, null, 2));
      renameSync(tmp, path);
    },
  };
}

export function memorySocialHubStore(initial: SocialHubState = { posts: [], metrics: [] }): SocialHubStore {
  let state = structuredClone(initial);
  return { load: () => structuredClone(state), save: (s) => { state = structuredClone(s); } };
}

export interface SocialHubOptions {
  store: SocialHubStore;
  credentials: SocialCredentialStore;
  fetchImpl?: FetchLike;
  providers?: Partial<Record<SocialNetwork, SocialProvider>>;
  now?: () => Date;
  /** Brands Robert pre-approved for agent auto-posting (SOCIAL_HUB_AUTO_APPROVE_BRANDS). Default: none. */
  autoApproveBrands?: string[];
  /** Global kill switch: SOCIAL_HUB_PUBLISHING_ENABLED must be "true" to post externally. */
  publishingEnabled?: boolean;
  maxAttempts?: number;
}

// Sensible defaults (local time hours) when there is no history yet.
const DEFAULT_BEST_HOURS: Record<SocialNetwork, number[]> = {
  facebook: [13, 19], instagram: [12, 19, 21], threads: [9, 20], tiktok: [19, 21, 22],
  youtube: [15, 18], x: [9, 12, 17], linkedin: [8, 12], reddit: [8, 20],
};

export class SocialHub {
  private providers: Record<SocialNetwork, SocialProvider>;
  private fetchImpl: FetchLike;
  private now: () => Date;
  private running = false;

  private opts: SocialHubOptions;

  constructor(opts: SocialHubOptions) {
    this.opts = opts;
    this.providers = { ...SOCIAL_PROVIDERS, ...(opts.providers ?? {}) } as Record<SocialNetwork, SocialProvider>;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? (() => new Date());
  }

  list(filter?: { status?: SocialPostStatus; brand?: string }): SocialPost[] {
    return this.opts.store.load().posts
      .filter((p) => (!filter?.status || p.status === filter.status) && (!filter?.brand || p.brand === filter.brand))
      .sort((a, b) => a.publishAt.localeCompare(b.publishAt));
  }

  get(id: string): SocialPost | undefined {
    return this.opts.store.load().posts.find((p) => p.id === id);
  }

  /** Entry point for Robert, la fábrica and la oficina. */
  create(input: SocialPostInput): SocialPost {
    const problems = validateSocialPost(input);
    if (problems.length) throw new SocialHubValidationError(problems);
    const state = this.opts.store.load();
    const publishAt = !input.publishAt || input.publishAt === "best"
      ? this.bestTime(input.targets.map((t) => t.network), state.metrics).toISOString()
      : new Date(input.publishAt).toISOString();
    const byRobert = input.createdBy === "robert";
    const preApproved = (this.opts.autoApproveBrands ?? []).includes(input.brand);
    const post: SocialPost = {
      ...input,
      id: randomUUID(),
      publishAt,
      createdAt: this.now().toISOString(),
      status: byRobert || preApproved ? "scheduled" : "pending_approval",
      approvedBy: byRobert ? "robert" : preApproved ? "auto:brand-allowlist" : undefined,
      results: input.targets.map((t) => ({ network: t.network, accountId: t.accountId, status: "pending", attempts: 0 })),
    };
    state.posts.push(post);
    this.opts.store.save(state);
    return post;
  }

  approve(id: string, by = "robert"): SocialPost {
    return this.mutate(id, (p) => {
      if (p.status !== "pending_approval") throw new Error(`No se puede aprobar un post en estado ${p.status}`);
      p.status = "scheduled";
      p.approvedBy = by;
    });
  }

  cancel(id: string): SocialPost {
    return this.mutate(id, (p) => {
      if (p.status === "published" || p.status === "publishing") throw new Error("Ya se publicó o se está publicando.");
      p.status = "cancelled";
    });
  }

  reschedule(id: string, publishAt: string): SocialPost {
    return this.mutate(id, (p) => {
      if (!["scheduled", "pending_approval", "failed", "draft"].includes(p.status)) throw new Error(`No se puede mover un post en estado ${p.status}`);
      p.publishAt = new Date(publishAt).toISOString();
      if (p.status === "failed") p.status = "scheduled";
    });
  }

  recordMetrics(snapshots: SocialMetricSnapshot[]) {
    const state = this.opts.store.load();
    state.metrics.push(...snapshots);
    // Keep the last 20k snapshots.
    if (state.metrics.length > 20000) state.metrics = state.metrics.slice(-20000);
    this.opts.store.save(state);
  }

  /** Pulls fresh metrics for posts published in the last `days` days and stores them. */
  async collectMetrics(days = 30): Promise<{ collected: number; errors: string[] }> {
    const since = new Date(this.now().getTime() - days * 86_400_000).toISOString();
    const posts = this.opts.store.load().posts.filter((p) => (p.status === "published" || p.status === "partially_published") && p.publishAt >= since);
    const { snapshots, errors } = await collectPostMetrics(posts, (n, a) => this.opts.credentials.get(n, a), this.fetchImpl, this.now());
    if (snapshots.length) this.recordMetrics(snapshots);
    return { collected: snapshots.length, errors };
  }

  analytics(days = 30) {
    const since = new Date(this.now().getTime() - days * 86_400_000).toISOString();
    return summarizeMetrics(this.opts.store.load().metrics, since);
  }

  /** Picks the next slot (>= 15 min from now) at the historically best weekday/hour for these networks. */
  bestTime(networks: SocialNetwork[], metrics: SocialMetricSnapshot[] = this.opts.store.load().metrics): Date {
    const now = this.now();
    const score = new Map<number, number>(); // key = weekday*24 + hour
    const relevant = metrics.filter((m) => networks.includes(m.network) && m.externalId);
    for (const m of relevant) {
      const d = new Date(m.capturedAt);
      const key = d.getDay() * 24 + d.getHours();
      score.set(key, (score.get(key) ?? 0) + engagementOf(m));
    }
    if (relevant.length < 10) {
      for (const n of networks) for (const h of DEFAULT_BEST_HOURS[n]) for (let wd = 0; wd < 7; wd++) {
        const key = wd * 24 + h;
        score.set(key, (score.get(key) ?? 0) + 1);
      }
    }
    let best: Date | null = null;
    let bestScore = -1;
    const start = new Date(now.getTime() + 15 * 60_000);
    for (let i = 0; i < 7 * 24; i++) {
      const slot = new Date(start);
      slot.setMinutes(0, 0, 0);
      slot.setHours(slot.getHours() + i + 1);
      const s = score.get(slot.getDay() * 24 + slot.getHours()) ?? 0;
      if (s > bestScore) { bestScore = s; best = slot; }
    }
    return best ?? start;
  }

  /** Publishes everything that is due. Safe to call from a cron every minute. */
  async runDue(): Promise<SocialPost[]> {
    if (this.running) return [];
    this.running = true;
    try {
      const nowIso = this.now().toISOString();
      const due = this.list({ status: "scheduled" }).filter((p) => p.publishAt <= nowIso);
      const done: SocialPost[] = [];
      for (const p of due) done.push(await this.publishNow(p.id));
      return done;
    } finally {
      this.running = false;
    }
  }

  async publishNow(id: string): Promise<SocialPost> {
    if (!this.opts.publishingEnabled) throw new Error("Publicación externa apagada (SOCIAL_HUB_PUBLISHING_ENABLED≠true).");
    const post = this.mutate(id, (p) => {
      if (p.status !== "scheduled" && p.status !== "partially_published") throw new Error(`Post en estado ${p.status}`);
      p.status = "publishing";
    });
    const maxAttempts = this.opts.maxAttempts ?? 3;
    for (const target of post.targets) {
      const result = post.results.find((r) => r.network === target.network && r.accountId === target.accountId)!;
      if (result.status === "published") continue;
      const cred = await this.opts.credentials.get(target.network, target.accountId);
      if (!cred) { result.status = "failed"; result.error = "cuenta no conectada"; continue; }
      while (result.attempts < maxAttempts) {
        result.attempts++;
        try {
          const out = await this.providers[target.network].publish(post, target, cred, this.fetchImpl);
          Object.assign(result, { status: "published", externalId: out.externalId, url: out.url, error: undefined });
          break;
        } catch (err) {
          result.status = "failed";
          result.error = err instanceof Error ? err.message : String(err);
          if (err instanceof SocialPublishError && !err.retryable) break;
        }
      }
    }
    const ok = post.results.filter((r) => r.status === "published").length;
    post.status = ok === post.results.length ? "published" : ok > 0 ? "partially_published" : "failed";
    return this.mutate(id, (p) => { p.status = post.status; p.results = post.results; });
  }

  private mutate(id: string, fn: (p: SocialPost) => void): SocialPost {
    const state = this.opts.store.load();
    const p = state.posts.find((x) => x.id === id);
    if (!p) throw new Error("Post no encontrado");
    fn(p);
    this.opts.store.save(state);
    return structuredClone(p);
  }
}

export class SocialHubValidationError extends Error {
  problems: string[];
  constructor(problems: string[]) {
    super(problems.join(" "));
    this.problems = problems;
  }
}
