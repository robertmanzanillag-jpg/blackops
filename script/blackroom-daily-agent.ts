import {
  BLACKROOM_QUEUE_PATH,
  claimNextBlackRoomJob,
  completeBlackRoomJob,
  ensureBlackRoomScheduleBuffer,
  readBlackRoomQueue,
  reconcileBlackRoomSchedule,
  recoverInterruptedBlackRoomJobs,
  recordBlackRoomSourceUsage,
  retryBlackRoomJob,
  pauseBlackRoomAgent,
  startBlackRoomAgent,
  summarizeBlackRoomQueue,
  writeBlackRoomQueue,
  withBlackRoomQueueLock,
  BLACKROOM_DURATION_VARIANTS,
  type BlackRoomExperimentDuration,
  applyBlackRoomRemoteCommands,
} from "../server/blackroom-daily-queue";
import type { BlackRoomRemoteCommand } from "../server/blackroom-chat";

type Command = "sync" | "start" | "pause" | "claim" | "complete" | "retry" | "record-source" | "remote-config" | "status";

function argument(name: string): string | undefined {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function command(): Command {
  if (process.argv.includes("--start")) return "start";
  if (process.argv.includes("--pause")) return "pause";
  if (process.argv.includes("--claim")) return "claim";
  if (process.argv.includes("--complete")) return "complete";
  if (process.argv.includes("--retry")) return "retry";
  if (process.argv.includes("--record-source")) return "record-source";
  if (process.argv.includes("--remote-config")) return "remote-config";
  if (process.argv.includes("--status")) return "status";
  return "sync";
}

async function main(): Promise<void> {
  const queuePath = argument("--queue") || process.env.BLACKROOM_QUEUE_PATH || BLACKROOM_QUEUE_PATH;
  const selectedCommand = command();
  if (selectedCommand === "status") {
    const result = await withBlackRoomQueueLock(queuePath, async () => {
      const state = await readBlackRoomQueue(queuePath);
      const { recovered, created } = reconcileBlackRoomSchedule(state);
      if (recovered || created) await writeBlackRoomQueue(state, queuePath);
      return { recovered, created, summary: summarizeBlackRoomQueue(state) };
    });
    console.log(JSON.stringify({ mode: "blackroom_daily_agent", command: selectedCommand, queuePath, ...result, job: null }, null, 2));
    return;
  }

  const result = await withBlackRoomQueueLock(queuePath, async () => {
    const state = await readBlackRoomQueue(queuePath);
    const recovered = recoverInterruptedBlackRoomJobs(state);
    const created = selectedCommand === "start"
      ? startBlackRoomAgent(state, Number(argument("--weeks") || 2))
      : ensureBlackRoomScheduleBuffer(state);
    let job = null;

    if (selectedCommand === "pause") {
      pauseBlackRoomAgent(state);
    } else if (selectedCommand === "remote-config") {
      const encoded = argument("--commands");
      if (!encoded) throw new Error("--commands is required with --remote-config");
      const commands = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as BlackRoomRemoteCommand[];
      if (!Array.isArray(commands)) throw new Error("--commands must encode an array");
      applyBlackRoomRemoteCommands(state, commands);
    } else if (selectedCommand === "claim") {
      job = claimNextBlackRoomJob(state);
    } else if (selectedCommand === "complete") {
      const jobId = argument("--job");
      if (!jobId) throw new Error("--job is required with --complete");
      job = completeBlackRoomJob(state, jobId);
    } else if (selectedCommand === "retry") {
      const jobId = argument("--job");
      if (!jobId) throw new Error("--job is required with --retry");
      job = retryBlackRoomJob(state, jobId, argument("--error") || "Metricool o Chrome no disponible");
    } else if (selectedCommand === "record-source") {
      const durationSeconds = Number(argument("--duration"));
      if (!BLACKROOM_DURATION_VARIANTS.includes(durationSeconds as BlackRoomExperimentDuration)) {
        throw new Error("--duration must be 15, 30, 60, 120, 300, or 600");
      }
      job = recordBlackRoomSourceUsage(state, {
        videoId: argument("--video") || "",
        jobId: argument("--job") || "",
        dj: argument("--dj") || "unknown",
        format: argument("--format") === "horizontal" ? "horizontal" : "vertical",
        language: argument("--language") === "es" ? "es" : "en",
        durationSeconds: durationSeconds as BlackRoomExperimentDuration,
        segmentStartSeconds: Number(argument("--start-second") || 0),
        segmentEndSeconds: Number(argument("--end-second") || durationSeconds || 60),
      });
    }
    await writeBlackRoomQueue(state, queuePath);
    return { recovered, created, job, summary: summarizeBlackRoomQueue(state) };
  });

  console.log(JSON.stringify({ mode: "blackroom_daily_agent", command: selectedCommand, queuePath, ...result }, null, 2));
}

main().catch((error) => {
  console.error("[blackroom-daily-agent]", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
