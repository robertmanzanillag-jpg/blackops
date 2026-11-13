import { readFile, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export interface NewsDeliveryAttempt {
  attemptId: string;
  articleIdentity: string;
  lane: string;
  platform: string;
  queueItemId: string;
  startedAt: string;
  state: "pending_reconciliation" | "rejected" | "scheduling_accepted";
  httpStatus?: number;
  metricoolPostId?: string;
}

/** Used under the delivery lock. Preserve every previous attempt verbatim.
 * An unreadable journal must block delivery, not silently discard history.
 */
export async function readNewsDeliveryAttempts(file: string): Promise<NewsDeliveryAttempt[]> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    if (!Array.isArray(parsed) || parsed.some(a => !a.articleIdentity || !a.state)) throw new Error("invalid_attempt_history");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
export async function saveNewsDeliveryAttempts(file: string, attempts: NewsDeliveryAttempt[]) {
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(attempts, null, 2) + "\n", { mode: 0o600 });
  await rename(temp, file);
}
