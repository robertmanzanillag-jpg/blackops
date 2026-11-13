import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  MINIMUM_PRODUCTION_DURATION_SECONDS,
  assertProbe,
  buildQaSampleTimes,
  buildProceduralPlan,
  generateSleepVideo,
  parseCliArgs,
  parseAstats,
  probeVideo,
  validateVisualAsset,
  validateOptions,
} from "../script/clippers-sleep-video-generator.mjs";

function baseOptions(outputPath) {
  return {
    outputPath,
    durationSeconds: 2,
    seed: 42,
    title: "CI Night Rest",
    width: 320,
    height: 180,
    fps: 1,
    testMode: true,
    overwrite: false,
  };
}

function productionVisualFields() {
  return {
    visualSource: "/tmp/visual.png",
    visualSha256: "a".repeat(64),
    visualRightsEvidence: "/tmp/visual.rights.json",
  };
}

async function createVisualFixture(directory) {
  const sourcePath = path.join(directory, "rain.ppm");
  const pixels = Array.from({ length: 16 * 9 }, (_, index) => `${8 + index % 4} ${20 + index % 7} ${38 + index % 9}`).join("\n");
  await writeFile(sourcePath, `P3\n16 9\n255\n${pixels}\n`);
  const sourceSha256 = createHash("sha256").update(await readFile(sourcePath)).digest("hex");
  const evidencePath = path.join(directory, "rain.rights.json");
  await writeFile(evidencePath, `${JSON.stringify({
    schemaVersion: 1,
    assetType: "generated_original_visual",
    sha256: sourceSha256,
    rightsStatus: "owned_generated_output",
    commercialUseAuthorized: true,
    thirdPartyAssets: [],
    generationMethod: "test fixture",
  })}\n`);
  return { sourcePath, sourceSha256, evidencePath };
}

test("production mode rejects videos shorter than eight hours", () => {
  assert.throws(
    () => validateOptions({ ...baseOptions("sleep.mp4"), testMode: false }),
    /at least 8 hours/,
  );
  assert.equal(
    validateOptions({
      ...baseOptions("sleep.mp4"),
      testMode: false,
      durationSeconds: MINIMUM_PRODUCTION_DURATION_SECONDS,
      ...productionVisualFields(),
    }).durationSeconds,
    MINIMUM_PRODUCTION_DURATION_SECONDS,
  );
});

test("production rain mode requires a hash-verified visual and rights evidence", () => {
  assert.throws(
    () => validateOptions({
      ...baseOptions("sleep.mp4"),
      testMode: false,
      durationSeconds: MINIMUM_PRODUCTION_DURATION_SECONDS,
    }),
    /require --visual-source/,
  );
});

test("short output requires explicit test mode and is capped", () => {
  const options = parseCliArgs([
    "--output", "sleep.mp4",
    "--test-mode",
    "--duration-seconds", "3",
    "--width", "320",
    "--height", "180",
  ]);
  assert.equal(options.testMode, true);
  assert.equal(options.durationSeconds, 3);
  assert.throws(
    () => parseCliArgs(["--output", "sleep.mp4", "--test-mode", "--duration-seconds", "31"]),
    /limited to 30 seconds/,
  );
});

test("procedural plan is deterministic and changes with the seed", () => {
  const first = buildProceduralPlan(baseOptions("a.mp4"));
  const second = buildProceduralPlan(baseOptions("b.mp4"));
  const different = buildProceduralPlan({ ...baseOptions("c.mp4"), seed: 43 });
  assert.deepEqual(first, second);
  assert.notEqual(first.audioExpression, different.audioExpression);
  assert.notEqual(first.background, different.background);
  assert.equal(first.chapterPlan.length, 8);
  assert.match(first.audioExpression, /between\(t,0,0\.28125\)/);
  const production = buildProceduralPlan({
    ...baseOptions("production.mp4"),
    testMode: false,
    durationSeconds: 29100,
  });
  assert.deepEqual(production.chapterPlan.map((chapter) => chapter.nominalStartSeconds), [0, 3600, 7200, 10800, 14400, 18000, 21600, 25200]);
  assert.equal(production.chapterPlan.at(-1).nominalEndSeconds, 29100);
});

test("production QA samples every hour and the final segment", () => {
  assert.deepEqual(buildQaSampleTimes(29100, false), [0, 3600, 7200, 10800, 14400, 18000, 21600, 25200, 28800, 29098]);
  assert.deepEqual(buildQaSampleTimes(2, true), [0, 1]);
});

test("audio QA rejects clipping and silence", () => {
  assert.deepEqual(parseAstats("Peak level dB: -12.5\nRMS level dB: -30.2"), { peakDb: -12.5, rmsDb: -30.2 });
  assert.throws(() => parseAstats("Peak level dB: 0.0\nRMS level dB: -12.0"), /clipping/);
  assert.throws(() => parseAstats("Peak level dB: -70.0\nRMS level dB: -80.0"), /silence/);
});

test("ffprobe gate rejects missing or malformed streams", () => {
  const options = baseOptions("sleep.mp4");
  assert.throws(() => assertProbe({ format: { duration: "2" }, streams: [] }, options), /H\.264/);
  assert.throws(() => assertProbe({ format: { duration: "1" }, streams: [] }, options), /shorter/);
});

test("visual gate rejects hash mismatches, directories, and symlinks", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "clippers-sleep-visual-gate-"));
  try {
    const fixture = await createVisualFixture(directory);
    await assert.rejects(
      validateVisualAsset({
        visualSource: fixture.sourcePath,
        visualSha256: "0".repeat(64),
        visualRightsEvidence: fixture.evidencePath,
      }),
      /SHA-256 mismatch/,
    );
    await assert.rejects(
      validateVisualAsset({
        visualSource: directory,
        visualSha256: fixture.sourceSha256,
        visualRightsEvidence: fixture.evidencePath,
      }),
      /regular file/,
    );
    const symlinkPath = path.join(directory, "rain-link.ppm");
    await symlink(fixture.sourcePath, symlinkPath);
    await assert.rejects(
      validateVisualAsset({
        visualSource: symlinkPath,
        visualSha256: fixture.sourceSha256,
        visualRightsEvidence: fixture.evidencePath,
      }),
      /must not be a symbolic link/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("generates a validated MP4 and rights manifest without external assets", { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "clippers-sleep-test-"));
  const outputPath = path.join(directory, "sleep-ci.mp4");
  try {
    const result = await generateSleepVideo(baseOptions(outputPath));
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
    const probe = await probeVideo(outputPath);
    assertProbe(probe, baseOptions(outputPath));
    assert.equal(manifest.qa.status, "passed");
    assert.equal(manifest.provenance.networkAccessRequired, false);
    assert.deepEqual(manifest.provenance.externalAudioSamples, []);
    assert.deepEqual(manifest.provenance.externalVisualAssets, []);
    assert.equal(manifest.rights.publicationAuthorizedByThisManifest, false);
    assert.match(manifest.output.sha256, /^[a-f0-9]{64}$/);
    assert.match(manifest.provenance.generatorSha256, /^[a-f0-9]{64}$/);
    assert.match(manifest.provenance.synthesisParametersSha256, /^[a-f0-9]{64}$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("visual-backed render records SHA-linked rights evidence and procedural rain", { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "clippers-sleep-rights-test-"));
  try {
    const fixture = await createVisualFixture(directory);
    const outputPath = path.join(directory, "rain-sleep-ci.mp4");
    const options = {
      ...baseOptions(outputPath),
      durationSeconds: 1,
      visualSource: fixture.sourcePath,
      visualSha256: fixture.sourceSha256,
      visualRightsEvidence: fixture.evidencePath,
    };
    const result = await generateSleepVideo(options);
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
    assert.equal(manifest.artifactType, "rights_verified_visual_with_procedural_rain_audio");
    assert.equal(manifest.provenance.externalAudioSamples.length, 0);
    assert.equal(manifest.provenance.externalVisualAssets.length, 1);
    assert.equal(manifest.provenance.externalVisualAssets[0].sha256, fixture.sourceSha256);
    assert.equal(manifest.provenance.externalVisualAssets[0].evidence.rightsStatus, "owned_generated_output");
    assert.equal(manifest.provenance.externalVisualAssets[0].evidence.commercialUseAuthorized, true);
    assert.equal(manifest.provenance.synthesisParameters.rain.externalSamples.length, 0);
    assert.equal(manifest.provenance.synthesisParameters.rain.seed, manifest.provenance.rainSeed);
    assert.match(manifest.provenance.visualMethod, /aspect-preserving/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
