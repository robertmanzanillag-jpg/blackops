import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  buildMotivationVisualFilters,
  buildMotivationVisualPlan,
  buildProceduralAudioPlan,
  buildSrt,
  canonicalScript,
  renderMotivationShort,
  validateManifestShape,
  volumeBlocker,
  wrapCaptionText,
} from "../script/clippers-motivation-shorts.mjs";

const execFileAsync = promisify(execFile);
const sha256File = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");

function baseManifest() {
  return {
    schemaVersion: 1,
    shortId: "motiva-001",
    channelId: "motivation-es",
    language: "es",
    format: "youtube_short_9x16",
    script: {
      hook: "No necesitas sentirte listo para comenzar.",
      beats: [
        "Da hoy un paso pequeño, incluso si nadie lo aplaude.",
        "La disciplina crece cuando cumples la promesa que te hiciste.",
      ],
      close: "Empieza ahora y deja que tus acciones construyan la confianza.",
      originality: {
        status: "owned_original",
        author: "Equipo Clippers",
        thirdPartyQuotes: false,
        thirdPartySpeeches: false,
        sources: [],
      },
      structure: { conflict: "hook", idea: "beats", action: "close" },
    },
    contentSafety: {
      celebrities: false,
      podcasts: false,
      clonedVoices: false,
      thirdPartyQuotes: false,
      wealthPromises: false,
      healthPromises: false,
    },
    qualityGate: {
      approved: true,
      hookFirstSecond: true,
      actionable: true,
      noQuotaFiller: true,
      reviewedBy: "Robert",
      reviewedAt: "2026-08-24T12:00:00.000Z",
    },
    voice: {
      sourceType: "local_recording",
      file: "input/motiva-001.wav",
      rightsEvidenceFile: "rights/motiva-001-voice.json",
      sha256: "a".repeat(64),
    },
    style: { backgroundColor: "#111827" },
  };
}

function proceduralManifest() {
  const manifest = baseManifest();
  delete manifest.voice;
  manifest.audio = {
    mode: "procedural_original",
    durationSeconds: 20,
    seed: 20260824,
    parameters: {
      noiseColor: "pink",
      amplitude: 0.12,
      highpassHz: 55,
      lowpassHz: 3800,
      volumeDb: -14,
      fadeSeconds: 1,
    },
    provenance: {
      status: "owned_original",
      generator: "ffmpeg_lavfi_anoisesrc_v1",
      thirdPartyAssets: false,
      networkUsed: false,
      paidCostUsd: 0,
    },
  };
  return manifest;
}

async function writeAuthorizedManifest(workspace, manifest = baseManifest()) {
  await mkdir(path.join(workspace, "input"), { recursive: true });
  await mkdir(path.join(workspace, "rights"), { recursive: true });
  await mkdir(path.join(workspace, "manifests"), { recursive: true });
  const voiceFile = path.join(workspace, manifest.voice.file);
  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000:duration=20",
    "-c:a", "pcm_s16le", voiceFile,
  ]);
  manifest.voice.sha256 = await sha256File(voiceFile);
  await writeFile(path.join(workspace, manifest.voice.rightsEvidenceFile), `${JSON.stringify({
    schemaVersion: 1,
    assetType: "voice_recording",
    shortId: manifest.shortId,
    file: manifest.voice.file,
    sha256: manifest.voice.sha256,
    rightsStatus: "owned",
    speakerConsent: true,
    commercialUseAuthorized: true,
    provenance: "local_recording",
    verifiedBy: "Robert",
    verifiedAt: "2026-08-24T12:00:00.000Z",
  }, null, 2)}\n`);
  const manifestPath = path.join(workspace, "manifests", `${manifest.shortId}.json`);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, manifestFile: path.relative(workspace, manifestPath) };
}

test("validates explicit Spanish original-script manifest and deterministic captions", () => {
  const manifest = baseManifest();
  assert.deepEqual(validateManifestShape(manifest), []);
  const script = canonicalScript(manifest);
  const first = buildSrt(script, 24);
  assert.equal(first, buildSrt(script, 24));
  assert.match(first, /00:00:00,000 -->/);
  assert.match(first, /00:00:24,000/);
  assert.ok(first.split("\n\n").every((cue) => cue.split("\n").at(-1).length <= 34));
});

test("fails closed for non-original material and absent local voice authorization", () => {
  const manifest = baseManifest();
  manifest.script.originality.thirdPartySpeeches = true;
  manifest.script.originality.sources = ["https://example.com/speech"];
  manifest.voice.sourceType = "remote_tts";
  const blockers = validateManifestShape(manifest);
  assert.ok(blockers.includes("third_party_speeches_not_excluded"));
  assert.ok(blockers.includes("external_script_sources_present"));
  assert.ok(blockers.includes("voice_not_local_recording"));
});

test("accepts an explicit procedural-original bed and builds a deterministic non-melodic plan", () => {
  const manifest = proceduralManifest();
  assert.deepEqual(validateManifestShape(manifest), []);
  const first = buildProceduralAudioPlan(manifest.audio);
  assert.deepEqual(first, buildProceduralAudioPlan(manifest.audio));
  assert.equal(first.generator, "ffmpeg_lavfi_anoisesrc_v1");
  assert.match(first.filter, /^anoisesrc=color=pink:/);
  assert.match(first.filter, /seed=20260824/);
  assert.doesNotMatch(first.filter, /sine|music|file|https?/i);
});

test("builds a deterministic, seed-variable visual plan with explicit safe zones and first-second hook", () => {
  const input = { seed: 20260824, language: "es", backgroundColor: "#111827", durationSeconds: 24 };
  const first = buildMotivationVisualPlan(input);
  assert.deepEqual(first, buildMotivationVisualPlan(input));
  assert.notDeepEqual(first, buildMotivationVisualPlan({ ...input, seed: 20260825 }));
  assert.equal(first.generator, "ffmpeg_gradients_magick_kinetic_v2");
  assert.deepEqual(first.dimensions, { width: 1080, height: 1920, frameRate: 30 });
  assert.deepEqual(first.safeZone, { left: 150, right: 150, top: 180, bottom: 310 });
  assert.ok(first.progress.x >= first.safeZone.left);
  assert.ok(first.progress.x + first.progress.width <= first.dimensions.width - first.safeZone.right);
  assert.ok(first.progress.y + first.progress.height <= first.dimensions.height - first.safeZone.bottom);
  assert.equal(first.hook.startsAtSeconds, 0);
  assert.ok(first.hook.emphasisEndsAtSeconds <= 1);
  assert.equal(first.provenance.thirdPartyAssets, false);
  assert.equal(first.provenance.networkUsed, false);
  assert.equal(first.provenance.paidCostUsd, 0);
});

test("wraps caption cards without changing their words or exceeding the visual line width", () => {
  const text = "El problema no es que te falte disciplina para empezar";
  const wrapped = wrapCaptionText(text);
  assert.equal(wrapped.replace(/\n/g, " "), text);
  assert.ok(wrapped.split("\n").every((line) => line.length <= 22));
  assert.ok(wrapped.includes("\n"));

  const longToken = "AnticonstitucionalmenteAnticonstitucionalmente";
  const wrappedLongToken = wrapCaptionText(longToken);
  assert.equal(wrappedLongToken.replace(/\n/g, ""), longToken);
  assert.ok(wrappedLongToken.split("\n").every((line) => line.length <= 22));
});

test("uses only the fixed local FFmpeg visual allowlist and includes motion plus progress", () => {
  const plan = buildMotivationVisualPlan({ seed: 19, language: "en", backgroundColor: "#111827", durationSeconds: 20 });
  const filters = buildMotivationVisualFilters(plan);
  assert.match(filters.gradientSource, /^gradients=size=1080x1920:rate=30:/);
  assert.match(filters.gradientSource, /seed=19/);
  assert.match(filters.gradientSource, /speed=0\.\d+/);
  assert.match(filters.backgroundFilters, /vignette=/);
  assert.match(filters.backgroundFilters, /drawgrid=/);
  assert.match(filters.backgroundFilters, /mod\(t\*/);
  assert.match(filters.backgroundFilters, /780\*min\(t\/20\.000/);
  assert.match(filters.captionOverlay, /^overlay=/);
  const completePlan = JSON.stringify({ plan, filters });
  assert.doesNotMatch(completePlan, /https?:|file=|movie=|amovie=|subtitles=|ass=/i);
  assert.ok(["linear", "radial", "circular", "spiral", "square"].includes(plan.theme.gradientType));

  const injected = structuredClone(plan);
  injected.theme.colors[0] = "red:movie=https://example.com/a.mp4";
  assert.throws(() => buildMotivationVisualFilters(injected), /visual_plan_invalid/);
  const unsafeMotion = structuredClone(plan);
  unsafeMotion.motion.captionPhase = "0);movie=/tmp/untrusted";
  assert.throws(() => buildMotivationVisualFilters(unsafeMotion), /visual_plan_invalid/);
});

test("rejects mixed voice/procedural inputs and unsafe external audio fields", () => {
  const mixed = proceduralManifest();
  mixed.voice = baseManifest().voice;
  assert.ok(validateManifestShape(mixed).includes("audio_modes_must_not_be_mixed"));

  const external = proceduralManifest();
  external.audio.file = "downloads/soundtrack.mp3";
  external.audio.url = "https://example.com/audio.mp3";
  assert.ok(validateManifestShape(external).includes("procedural_audio_unsafe_or_mixed_fields"));

  const remote = proceduralManifest();
  remote.audio.provenance.networkUsed = true;
  assert.ok(validateManifestShape(remote).includes("procedural_audio_provenance_invalid"));

  const coerced = proceduralManifest();
  coerced.audio.seed = "20260824";
  coerced.audio.parameters.volumeDb = "-14";
  const coercionBlockers = validateManifestShape(coerced);
  assert.ok(coercionBlockers.includes("procedural_audio_seed_invalid"));
  assert.ok(coercionBlockers.includes("procedural_audio_parameters_invalid"));
});

test("requires the conflict, idea and action structure plus all content exclusions", () => {
  const manifest = baseManifest();
  manifest.script.structure.action = "beats";
  manifest.contentSafety.wealthPromises = true;
  const blockers = validateManifestShape(manifest);
  assert.ok(blockers.includes("motivation_structure_invalid"));
  assert.ok(blockers.includes("content_safety_exclusions_missing"));
});

test("allows five daily renders independently for Spanish and English channels", () => {
  const now = new Date("2026-08-24T16:00:00.000Z");
  const spanish = Array.from({ length: 5 }, (_, index) => ({ channelId: "motivation-es", language: "es", renderedAt: new Date(now.getTime() - index * 1000).toISOString() }));
  const english = Array.from({ length: 4 }, (_, index) => ({ channelId: "motivation-en", language: "en", renderedAt: new Date(now.getTime() - index * 1000).toISOString() }));
  assert.equal(volumeBlocker([...spanish, ...english], now, "motivation-es"), "daily_channel_render_limit_reached");
  assert.equal(volumeBlocker([...spanish, ...english], now, "motivation-en"), null);
  assert.equal(volumeBlocker(spanish, new Date("2026-08-25T16:00:00.000Z"), "motivation-es"), null);
});

test("accepts independent ES and EN channel manifests but fails closed without quality approval", () => {
  const spanish = baseManifest();
  const english = baseManifest();
  english.shortId = "motivate-001";
  english.channelId = "motivation-en";
  english.language = "en";
  english.script.hook = "You do not need to feel ready before you begin.";
  assert.deepEqual(validateManifestShape(spanish), []);
  assert.deepEqual(validateManifestShape(english), []);
  english.qualityGate.noQuotaFiller = false;
  assert.ok(validateManifestShape(english).includes("quality_gate_not_approved"));
});

test("example content pack contains seven safe procedural days of five per language channel", async () => {
  const examplesDir = path.join(process.cwd(), "examples", "clippers-motivation");
  const files = (await readdir(examplesDir)).filter((name) => name.endsWith(".json")).sort();
  const manifests = await Promise.all(files.map(async (name) => JSON.parse(await readFile(path.join(examplesDir, name), "utf8"))));
  const spanish = manifests.filter((manifest) => manifest.language === "es" && manifest.channelId === "motivation-es");
  const english = manifests.filter((manifest) => manifest.language === "en" && manifest.channelId === "motivation-en");
  assert.equal(manifests.length, 70);
  assert.equal(spanish.length, 35);
  assert.equal(english.length, 35);
  assert.equal(new Set(manifests.map((manifest) => manifest.shortId)).size, 70);
  assert.equal(new Set(manifests.map(canonicalScript)).size, 70);
  assert.equal(new Set(manifests.map((manifest) => manifest.audio?.seed)).size, 70);

  for (const [index, manifest] of manifests.entries()) {
    assert.deepEqual(validateManifestShape(manifest), [], manifest.shortId);
    assert.equal(files[index], `${manifest.shortId}.json`);
    assert.equal(manifest.audio.mode, "procedural_original");
    assert.equal(manifest.voice, undefined);
    assert.equal(manifest.audio.file, undefined);
    assert.equal(manifest.audio.url, undefined);
    assert.equal(manifest.audio.rightsEvidenceFile, undefined);
    assert.equal(manifest.audio.provenance.status, "owned_original");
    assert.equal(manifest.audio.provenance.thirdPartyAssets, false);
    assert.equal(manifest.audio.provenance.networkUsed, false);
    assert.equal(manifest.audio.provenance.paidCostUsd, 0);
    assert.equal(manifest.script.originality.sources.length, 0);
    assert.ok(Number.isInteger(manifest.launchDay) && manifest.launchDay >= 1 && manifest.launchDay <= 7);
    assert.ok(Number.isInteger(manifest.launchPosition) && manifest.launchPosition >= 1 && manifest.launchPosition <= 5);
  }

  for (const [language, channelId] of [["es", "motivation-es"], ["en", "motivation-en"]]) {
    for (let launchDay = 1; launchDay <= 7; launchDay += 1) {
      const daily = manifests.filter((manifest) => manifest.language === language
        && manifest.channelId === channelId
        && manifest.launchDay === launchDay);
      assert.equal(daily.length, 5, `${channelId} day ${launchDay}`);
      assert.deepEqual(daily.map((manifest) => manifest.launchPosition).sort((a, b) => a - b), [1, 2, 3, 4, 5]);
    }
  }
});

test("fails closed when channel identity or supported language is missing", () => {
  const manifest = baseManifest();
  delete manifest.channelId;
  manifest.language = "fr";
  const blockers = validateManifestShape(manifest);
  assert.ok(blockers.includes("channel_id_invalid"));
  assert.ok(blockers.includes("language_must_be_es_or_en"));
});

test("renders an authorized local voice to a deduplicated 9:16 Short with QA evidence", { timeout: 120_000 }, async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "clippers-motivation-test-"));
  const { manifestFile } = await writeAuthorizedManifest(workspace);

  const result = await renderMotivationShort({ workspaceRoot: workspace, manifestFile, now: new Date("2026-08-24T13:00:00.000Z") });
  assert.equal(result.status, "rendered", JSON.stringify(result));
  assert.equal(result.width, 1080);
  assert.equal(result.height, 1920);
  assert.equal(result.publishEnabled, false);
  assert.equal(result.apiCostUsd, 0);
  assert.equal(result.evidenceFrames.length, 3);
  assert.equal(new Set(result.evidenceFrames.map((frame) => frame.sha256)).size, 3);
  assert.equal(result.visualPlan.generator, "ffmpeg_gradients_magick_kinetic_v2");
  assert.match(result.visualPlanSha256, /^[a-f0-9]{64}$/);
  assert.ok((await stat(path.join(workspace, result.outputFile))).size > 1000);
  assert.equal(result.channelId, "motivation-es");
  assert.equal(result.language, "es");
  assert.ok((await stat(path.join(workspace, "evidence-drop", "motivation", "motivation-es", "motiva-001", "provenance.json"))).size > 100);

  const duplicate = await renderMotivationShort({ workspaceRoot: workspace, manifestFile });
  assert.equal(duplicate.status, "duplicate");
  assert.deepEqual(duplicate.blockers, ["already_rendered"]);
});

test("renders procedural-original audio without voice files or voice-rights evidence", { timeout: 120_000 }, async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "clippers-motivation-procedural-test-"));
  await mkdir(path.join(workspace, "manifests"), { recursive: true });
  const manifest = proceduralManifest();
  const manifestFile = "manifests/motiva-001.json";
  await writeFile(path.join(workspace, manifestFile), `${JSON.stringify(manifest, null, 2)}\n`);

  const result = await renderMotivationShort({ workspaceRoot: workspace, manifestFile, now: new Date("2026-08-24T13:00:00.000Z") });
  assert.equal(result.status, "rendered", JSON.stringify(result));
  assert.equal(result.audioMode, "procedural_original");
  assert.equal(result.durationSeconds, 20);
  assert.equal(result.rights.audio, "owned_original_procedural");
  assert.equal(result.rights.thirdPartyMaterial, false);
  assert.equal(result.voiceFile, undefined);
  assert.equal(result.voiceRightsEvidenceFile, undefined);
  assert.match(result.audioPlanSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.audioPlan.seed, 20260824);
  assert.equal(result.visualPlan.seed, 20260824);
  assert.equal(result.visualPlan.provenance.paidCostUsd, 0);
  assert.match(result.visualPlanSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.apiCostUsd, 0);
  assert.equal(result.publishEnabled, false);
  assert.ok((await stat(path.join(workspace, result.outputFile))).size > 1000);

  const provenance = JSON.parse(await readFile(path.join(workspace, "evidence-drop", "motivation", "motivation-es", "motiva-001", "provenance.json"), "utf8"));
  assert.equal(provenance.audioMode, "procedural_original");
  assert.equal(provenance.audioPlan.generator, "ffmpeg_lavfi_anoisesrc_v1");
  assert.equal(provenance.rights.audio, "owned_original_procedural");
});

test("blocks existing artifacts without deleting files when the ledger is missing", { timeout: 120_000 }, async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "clippers-motivation-test-"));
  const { manifestFile } = await writeAuthorizedManifest(workspace);
  const existingOutput = path.join(workspace, "motivation", "rendered", "motivation-es", "motiva-001", "motiva-001.mp4");
  await mkdir(path.dirname(existingOutput), { recursive: true });
  await writeFile(existingOutput, "do not delete");

  const result = await renderMotivationShort({ workspaceRoot: workspace, manifestFile });
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockers, ["existing_artifact_without_ledger"]);
  assert.equal(await readFile(existingOutput, "utf8"), "do not delete");
  assert.equal(result.publishEnabled, false);
});

test("cleans its partial SRT after a transient render failure so a retry can succeed", { timeout: 120_000 }, async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "clippers-motivation-test-"));
  const { manifestFile } = await writeAuthorizedManifest(workspace);
  const subtitlePath = path.join(workspace, "motivation", "rendered", "motivation-es", "motiva-001", "motiva-001.srt");
  let failedOnce = false;
  const transientRun = async (binary, args) => {
    if (!failedOnce && binary === "ffmpeg" && args.includes("-filter_complex")) {
      failedOnce = true;
      throw new Error("transient ffmpeg failure");
    }
    return execFileAsync(binary, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  };

  const failed = await renderMotivationShort({ workspaceRoot: workspace, manifestFile, run: transientRun });
  assert.equal(failed.status, "blocked");
  assert.deepEqual(failed.blockers, ["render_failed"]);
  await assert.rejects(access(subtitlePath));

  const retry = await renderMotivationShort({ workspaceRoot: workspace, manifestFile });
  assert.equal(retry.status, "rendered", JSON.stringify(retry));
  assert.notDeepEqual(retry.blockers, ["existing_artifact_without_ledger"]);
  assert.ok((await stat(subtitlePath)).size > 0);
});

test("blocks missing voice files without generating or publishing anything", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "clippers-motivation-test-"));
  await mkdir(path.join(workspace, "manifests"), { recursive: true });
  const manifest = baseManifest();
  await writeFile(path.join(workspace, "manifests", "missing.json"), `${JSON.stringify(manifest)}\n`);
  const result = await renderMotivationShort({ workspaceRoot: workspace, manifestFile: "manifests/missing.json" });
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockers, ["voice_missing_or_unsafe"]);
  assert.equal(result.publishEnabled, false);
});
