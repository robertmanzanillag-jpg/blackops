import type { NextFunction, Request, Response } from "express";

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

export type RateLimitStore = Map<string, RateLimitBucket>;

export type PersistentRateLimitStore = {
  checkPersistentRateLimit(key: string, limit: number, windowMs: number, now?: number): Promise<RateLimitDecision>;
};

export function checkRateLimit(
  store: RateLimitStore,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitDecision {
  const existing = store.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: Math.max(0, limit - 1), resetAt };
  }

  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return { allowed: true, remaining: Math.max(0, limit - existing.count), resetAt: existing.resetAt };
}

export function getClientRateLimitAddress(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function getClientKey(req: Request, scope: string): string {
  return `${scope}:${getClientRateLimitAddress(req)}`;
}

export function createRateLimiter(options: {
  scope: string;
  limit: number;
  windowMs: number;
  persistentStore?: PersistentRateLimitStore;
  store?: RateLimitStore;
  onPersistentError?: (error: unknown) => void;
}) {
  const store = options.store || new Map<string, RateLimitBucket>();

  return async (req: Request, res: Response, next: NextFunction) => {
    const key = getClientKey(req, options.scope);
    let decision: RateLimitDecision;

    if (options.persistentStore) {
      try {
        decision = await options.persistentStore.checkPersistentRateLimit(key, options.limit, options.windowMs);
      } catch (error) {
        options.onPersistentError?.(error);
        decision = checkRateLimit(store, key, options.limit, options.windowMs);
      }
    } else {
      decision = checkRateLimit(store, key, options.limit, options.windowMs);
    }

    res.setHeader("X-RateLimit-Limit", String(options.limit));
    res.setHeader("X-RateLimit-Remaining", String(decision.remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(decision.resetAt / 1000)));

    if (!decision.allowed) {
      res.status(429).json({ error: "Too many requests", reason: "rate_limited" });
      return;
    }

    next();
  };
}

export const createInMemoryRateLimiter = createRateLimiter;
