import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { DirectRadioYoutubeCommand } from "./radio-youtube-command";

export type LocalYoutubeQueueStatus = "pending" | "processing" | "done" | "failed";

export type LocalYoutubeQueueEntry = {
  id: string;
  userId: string;
  command: DirectRadioYoutubeCommand;
  status: LocalYoutubeQueueStatus;
  createdAt: string;
  processedAt?: string;
  error?: string;
  result?: unknown;
};

function resolveQueuePath(): string {
  const configured = process.env.LOCAL_YOUTUBE_QUEUE_PATH?.trim();
  if (configured) return configured;
  const dataDir = path.resolve(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return path.join(dataDir, "local-youtube-queue.json");
}

function readQueue(queuePath: string): LocalYoutubeQueueEntry[] {
  try {
    if (!fs.existsSync(queuePath)) return [];
    const raw = fs.readFileSync(queuePath, "utf-8").trim();
    if (!raw) return [];
    return JSON.parse(raw) as LocalYoutubeQueueEntry[];
  } catch {
    return [];
  }
}

function writeQueue(queuePath: string, entries: LocalYoutubeQueueEntry[]): void {
  fs.writeFileSync(queuePath, JSON.stringify(entries, null, 2), "utf-8");
}

export function enqueueLocalYoutubeAction(
  command: DirectRadioYoutubeCommand,
  userId: string,
  queuePathOverride?: string,
): LocalYoutubeQueueEntry {
  const queuePath = queuePathOverride ?? resolveQueuePath();
  const entries = readQueue(queuePath);
  const entry: LocalYoutubeQueueEntry = {
    id: crypto.randomUUID(),
    userId,
    command,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  entries.push(entry);
  writeQueue(queuePath, entries);
  return entry;
}

export function getLocalYoutubeQueue(queuePathOverride?: string): LocalYoutubeQueueEntry[] {
  return readQueue(queuePathOverride ?? resolveQueuePath());
}

export function getLocalYoutubeQueueEntry(
  id: string,
  queuePathOverride?: string,
): LocalYoutubeQueueEntry | undefined {
  return readQueue(queuePathOverride ?? resolveQueuePath()).find((e) => e.id === id);
}

export function updateLocalYoutubeQueueEntry(
  id: string,
  updates: Partial<Pick<LocalYoutubeQueueEntry, "status" | "processedAt" | "error" | "result">>,
  queuePathOverride?: string,
): LocalYoutubeQueueEntry | undefined {
  const queuePath = queuePathOverride ?? resolveQueuePath();
  const entries = readQueue(queuePath);
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return undefined;
  entries[idx] = { ...entries[idx], ...updates };
  writeQueue(queuePath, entries);
  return entries[idx];
}

export function getPendingLocalYoutubeQueue(queuePathOverride?: string): LocalYoutubeQueueEntry[] {
  return getLocalYoutubeQueue(queuePathOverride).filter((e) => e.status === "pending");
}

export function formatQueuedMessage(entry: LocalYoutubeQueueEntry): string {
  return [
    `📥 YouTube queued para tu Mac local`,
    `ID: ${entry.id}`,
    `URL: ${entry.command.youtubeUrl}`,
    entry.command.djName ? `DJ: ${entry.command.djName}` : null,
    `Carpeta Drive: ${entry.command.driveFolderPath.join("/") || "(desde título)"}`,
    ``,
    `Corre en la Mac: npm run radio:local-worker`,
    `Esto descarga con yt-dlp local, genera clips, sube a Drive y borra el MP4 largo.`,
    `Costo estimado: $0.00 USD (herramientas locales gratuitas).`,
  ].filter(Boolean).join("\n");
}
