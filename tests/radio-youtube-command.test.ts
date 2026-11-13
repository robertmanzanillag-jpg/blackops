import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { test } from "node:test";
import { buildDirectRadioDriveVideoCommand, buildDirectRadioYoutubeCommand, directRadioDriveVideoCommandNeedsDriveFolder, directRadioYoutubeCommandNeedsDriveFolder, extractDriveFolderPathFromMessage, formatRadioDriveVideoResult, formatRadioYoutubeResult } from "../server/radio-youtube-command";
import { extractGoogleDriveFileIdFromUrl } from "../server/google-drive-file-url";
import { buildYtDlpCommandSpecs, formatYtDlpFailureMessage } from "../server/youtube-downloader";

test("extracts Drive folder path from radio YouTube request", () => {
  assert.deepEqual(
    extractDriveFolderPathFromMessage("sacame clips de radio de https://youtu.be/abc123 y guardalos en la carpeta Radio Junio del Drive"),
    ["Radio Junio"],
  );

  assert.deepEqual(
    extractDriveFolderPathFromMessage("haz videos radio https://youtube.com/watch?v=abc en carpeta \"Robert A/Videos de Black Room/Junio\""),
    ["Robert A", "Videos de Black Room", "Junio"],
  );

  assert.deepEqual(
    extractDriveFolderPathFromMessage("sacalos de radio y guardalos en Radio Junio del Drive"),
    ["Radio Junio"],
  );

  assert.deepEqual(
    extractDriveFolderPathFromMessage("saca clips de radio de https://youtu.be/abc y en la carpeta de radio crea una carpeta con los videos que creaste"),
    ["radio", "Videos creados"],
  );

  assert.deepEqual(
    extractDriveFolderPathFromMessage("https://youtu.be/abc123 sacame un clip y guardalo en Drive en una carpeta llamada Codex QA Replit 2026-06-21."),
    ["Codex QA Replit 2026-06-21"],
  );
});

test("builds direct radio YouTube command only for radio clip requests", () => {
  const command = buildDirectRadioYoutubeCommand("hazme los clips de radio de https://youtu.be/abc123 y guardalos en carpeta Radio Junio del Drive");
  assert.equal(command?.youtubeUrl, "https://youtu.be/abc123");
  assert.deepEqual(command?.driveFolderPath, ["Radio Junio"]);

  assert.equal(buildDirectRadioYoutubeCommand("mira este link https://youtu.be/abc123"), null);
});

test("builds direct YouTube clip command when Drive destination is requested without saying radio", () => {
  const command = buildDirectRadioYoutubeCommand("https://youtu.be/GcVZvXKz2jU quiero que me saques los clips de este video y me lo agregues en la carpeta Robert A/Videos de Lucia Reina del Drive");
  assert.equal(command?.youtubeUrl, "https://youtu.be/GcVZvXKz2jU");
  assert.deepEqual(command?.driveFolderPath, ["Robert A", "Videos de Lucia Reina"]);
  assert.match(command?.command || "", /RADIO_YOUTUBE_CLIPS/);
});

test("extracts a Google Drive file id without confusing folder urls", () => {
  assert.equal(
    extractGoogleDriveFileIdFromUrl("https://drive.google.com/file/d/1abcDEFghiJKLmnopQRSTuv/view?usp=sharing"),
    "1abcDEFghiJKLmnopQRSTuv",
  );
  assert.equal(
    extractGoogleDriveFileIdFromUrl("https://drive.google.com/open?id=1abcDEFghiJKLmnopQRSTuv"),
    "1abcDEFghiJKLmnopQRSTuv",
  );
  assert.equal(
    extractGoogleDriveFileIdFromUrl("https://drive.google.com/drive/folders/1DFAJg05WgnKj1rXu0YUrOWWrT15ilVWW"),
    null,
  );
});

test("builds direct Drive MP4 clip command with source cleanup", () => {
  const command = buildDirectRadioDriveVideoCommand(
    "Toma este MP4 de Drive https://drive.google.com/file/d/1abcDEFghiJKLmnopQRSTuv/view saca 3 videos de IG y TikTok diferentes, guardalos en carpeta Robert A/Lucia Reina del Drive y despues borra el video largo",
  );

  assert.equal(command?.sourceDriveFileId, "1abcDEFghiJKLmnopQRSTuv");
  assert.deepEqual(command?.driveFolderPath, ["Robert A", "Lucia Reina"]);
  assert.equal(command?.instagramClipCount, 3);
  assert.equal(command?.tiktokClipCount, 3);
  assert.equal(command?.deleteSourceAfterSuccess, true);
  assert.match(command?.content || "", /MP4 de Google Drive/);
  assert.match(command?.command || "", /RADIO_DRIVE_VIDEO_CLIPS/);
});

test("uses a Google Drive folder URL as destination for Drive MP4 clips", () => {
  const command = buildDirectRadioDriveVideoCommand(
    "https://drive.google.com/file/d/1abcDEFghiJKLmnopQRSTuv/view sacame clips y guardalos en https://drive.google.com/drive/folders/1DFAJg05WgnKj1rXu0YUrOWWrT15ilVWW?usp=drive_link",
  );

  assert.equal(command?.sourceDriveFileId, "1abcDEFghiJKLmnopQRSTuv");
  assert.equal(command?.driveParentFolderId, "1DFAJg05WgnKj1rXu0YUrOWWrT15ilVWW");
  assert.deepEqual(command?.driveFolderPath, []);
  assert.equal(command ? directRadioDriveVideoCommandNeedsDriveFolder(command) : true, false);
});

test("asks for Drive destination when only a Drive MP4 source is provided", () => {
  const command = buildDirectRadioDriveVideoCommand(
    "https://drive.google.com/file/d/1abcDEFghiJKLmnopQRSTuv/view sacame clips para tiktok e instagram",
  );

  assert.ok(command);
  assert.equal(command ? directRadioDriveVideoCommandNeedsDriveFolder(command) : false, true);
  assert.match(command?.content || "", /carpeta de Google Drive/i);
  assert.equal(command?.command, "");
});

test("does not treat Drive open file links as destination folders", () => {
  const command = buildDirectRadioDriveVideoCommand(
    "https://drive.google.com/open?id=1abcDEFghiJKLmnopQRSTuv sacame clips para tiktok e instagram",
  );

  assert.ok(command);
  assert.equal(command?.sourceDriveFileId, "1abcDEFghiJKLmnopQRSTuv");
  assert.equal(command?.driveParentFolderId, undefined);
  assert.equal(command ? directRadioDriveVideoCommandNeedsDriveFolder(command) : false, true);
  assert.equal(command?.command, "");
});

test("uses a Google Drive folder URL as the parent destination", () => {
  const command = buildDirectRadioYoutubeCommand("https://youtu.be/GcVZvXKz2jU sacame clips y guardalos en https://drive.google.com/drive/folders/1DFAJg05WgnKj1rXu0YUrOWWrT15ilVWW?usp=drive_link");
  assert.equal(command?.youtubeUrl, "https://youtu.be/GcVZvXKz2jU");
  assert.equal(command?.driveParentFolderId, "1DFAJg05WgnKj1rXu0YUrOWWrT15ilVWW");
  assert.deepEqual(command?.driveFolderPath, []);
  assert.equal(command ? directRadioYoutubeCommandNeedsDriveFolder(command) : true, false);
});

test("does not invent a child folder from a bare Google Drive folder URL prompt", () => {
  const command = buildDirectRadioYoutubeCommand(
    "Toma este video de YouTube: https://youtu.be/GcVZvXkz2jU Descárgalo en 1080p, no en 720p. Crea 2 clips listos para publicar: 1. TikTok/Reels vertical 9:16, 1080x1920, 30 segundos. 2. Instagram feed/reel 4:5, 1080x1350, 60 segundos. Usa el momento con más energía del set. Nómbralos con DJ QA TEST. Después de crear los clips, borra el video largo local. Guarda los clips en esta carpeta de Google Drive: https://drive.google.com/drive/folders/1DFAJg05WgnKj1rXu0YUrOWWrT15ilVWW",
  );

  assert.equal(command?.driveParentFolderId, "1DFAJg05WgnKj1rXu0YUrOWWrT15ilVWW");
  assert.deepEqual(command?.driveFolderPath, []);
  assert.equal(command?.instagramClipCount, undefined);
  assert.equal(command?.tiktokClipCount, undefined);
  assert.match(command?.content || "", /los clips de radio para Instagram y TikTok/);
  assert.doesNotMatch(command?.content || "", /esta/);
});

test("does not invent a child folder from my Drive folder URL wording", () => {
  const command = buildDirectRadioYoutubeCommand(
    "Toma este video de YouTube: https://youtu.be/GcVZvXkz2jU Descárgalo en 1080p, no en 720p. Crea 2 clips listos para publicar: 1. TikTok/Reels vertical 9:16, 1080x1920, 30 segundos. 2. Instagram feed/reel 4:5, 1080x1350, 60 segundos. Usa el momento con más energía del set. Nómbralos con DJ QA_REPLIT_FINAL. Después de crear los clips, borra el video largo local. Guarda los clips en mi carpeta de Google Drive: https://drive.google.com/drive/folders/1DFAJg05WgnKj1rXu0YUrOWWrT15ilVWW",
  );

  assert.equal(command?.driveParentFolderId, "1DFAJg05WgnKj1rXu0YUrOWWrT15ilVWW");
  assert.deepEqual(command?.driveFolderPath, []);
  assert.doesNotMatch(command?.content || "", /: mi\b/);
  assert.match(command?.content || "", /carpeta de Google Drive que enviaste/);
});

test("extracts a child folder inside a Google Drive folder URL", () => {
  const command = buildDirectRadioYoutubeCommand("https://youtu.be/GcVZvXKz2jU sacame clips y guardalos en https://drive.google.com/drive/folders/1DFAJg05WgnKj1rXu0YUrOWWrT15ilVWW dentro de esta carpeta crea una subcarpeta llamada Codex Clips");
  assert.equal(command?.driveParentFolderId, "1DFAJg05WgnKj1rXu0YUrOWWrT15ilVWW");
  assert.deepEqual(command?.driveFolderPath, ["Codex Clips"]);
  assert.match(command?.command || "", /driveParentFolderId/);
});

test("uses YouTube title as Drive folder when requested", () => {
  const command = buildDirectRadioYoutubeCommand("https://youtu.be/GcVZvXKz2jU quiero que me saques los clips de este video y me lo agregues en la carpeta de drive con el titulo");
  assert.equal(command?.youtubeUrl, "https://youtu.be/GcVZvXKz2jU");
  assert.equal(command?.driveFolderPathFromYoutubeTitle, true);
  assert.equal(command?.createFolderIfMissing, true);
  assert.deepEqual(command?.driveFolderPath, []);
  assert.match(command?.command || "", /driveFolderPathFromYoutubeTitle/);
  assert.equal(command ? directRadioYoutubeCommandNeedsDriveFolder(command) : true, false);
});

test("extracts music URL for drop-based radio edits", () => {
  const command = buildDirectRadioYoutubeCommand("haz clips de radio de https://youtu.be/video123 con drop de esta cancion https://youtu.be/song456 y guardalos en carpeta Radio Junio del Drive");
  assert.equal(command?.youtubeUrl, "https://youtu.be/video123");
  assert.equal(command?.musicUrl, "https://youtu.be/song456");
  assert.match(command?.content || "", /drop de la canción/i);
});

test("uses source video drop when a drop is requested without a song link", () => {
  const command = buildDirectRadioYoutubeCommand("haz clips de radio de https://youtu.be/video123 con un drop de una cancion y guardalos en carpeta Radio Junio del Drive");
  assert.equal(command?.needsMusicUrl, undefined);
  assert.equal(command?.musicUrl, undefined);
  assert.match(command?.content || "", /drop del mismo video/i);
});

test("extracts explicit DJ name when provided", () => {
  const command = buildDirectRadioYoutubeCommand("haz clips de radio de https://youtu.be/video123 DJ Lucía Reina y guardalos en carpeta Radio Junio del Drive");
  assert.equal(command?.djName, "Lucía Reina");
  assert.match(command?.command || "", /Lucía Reina/);
});

test("extracts requested Instagram and TikTok clip counts and source cleanup", () => {
  const command = buildDirectRadioYoutubeCommand(
    "https://youtu.be/GcVZvXkz2jU saca 3 videos de IG y de TikTok diferentes, guardalos en carpeta Robert A/Lucia Reina del Drive y despues borra el video largo",
  );

  assert.equal(command?.instagramClipCount, 3);
  assert.equal(command?.tiktokClipCount, 3);
  assert.equal(command?.deleteSourceAfterSuccess, true);
  assert.match(command?.command || "", /"instagramClipCount":3/);
  assert.match(command?.command || "", /"tiktokClipCount":3/);
  assert.match(command?.content || "", /3 clips para Instagram y 3 clips para TikTok/);
  assert.match(command?.content || "", /borr[ao]r? el video largo local/i);
});

test("marks Drive folder creation as approved when user asks for a subfolder", () => {
  const command = buildDirectRadioYoutubeCommand("https://youtu.be/video123 saca clips de radio y en la carpeta Robert A crea una subcarpeta LUCIA REINA del Drive");
  assert.equal(command?.createFolderIfMissing, true);
  assert.match(command?.command || "", /createFolderIfMissing/);
});

test("asks for Drive folder when missing", () => {
  const command = buildDirectRadioYoutubeCommand("saca clips de radio de https://youtu.be/abc123");
  assert.equal(command?.driveFolderPath.length, 0);
  assert.match(command?.content || "", /carpeta de Google Drive/i);
});

test("includes estimated cost in completed radio YouTube summary", () => {
  const summary = formatRadioYoutubeResult({
    youtubeUrl: "https://youtu.be/abc123",
    videoPath: "/tmp/source.mp4",
    status: "completed",
    djName: "MYNA",
    driveFolderPath: ["Radio Junio"],
    clips: [
      {
        kind: "horizontal_ig",
        path: "/tmp/MYNA_60s_horizontal_ig.mp4",
        durationSeconds: 60,
        width: 1080,
        height: 1350,
        audioSource: "source_drop",
        musicDropSecond: 42,
      },
      {
        kind: "vertical_tiktok",
        path: "/tmp/MYNA_30s_vertical_tiktok.mp4",
        durationSeconds: 30,
        width: 1080,
        height: 1920,
        audioSource: "source_drop",
        musicDropSecond: 42,
      },
    ],
    sourceVideoDeleted: true,
    sourceVideoDeletedPath: "/tmp/source.mp4",
  });

  assert.match(summary, /Audio: usé el drop del mismo video fuente/);
  assert.match(summary, /borré el video largo local/);
  assert.match(summary, /Costo estimado por video editado: \$0\.00 USD/);
  assert.match(summary, /Total estimado de esta edición: \$0\.00 USD para 2 videos/);
});

test("includes estimated cost in failed radio video summary", () => {
  const summary = formatRadioDriveVideoResult({
    sourceDriveFileId: "1abcDEFghiJKLmnopQRSTuv",
    videoPath: "https://drive.google.com/file/d/1abcDEFghiJKLmnopQRSTuv/view",
    status: "failed",
    error: "Drive download failed",
  });

  assert.match(summary, /No pude completar los clips: Drive download failed/);
  assert.match(summary, /Gasto estimado de esta edición: \$0\.00 USD/);
});

test("includes local source cleanup in completed Drive MP4 summary", () => {
  const summary = formatRadioDriveVideoResult({
    sourceDriveFileId: "1abcDEFghiJKLmnopQRSTuv",
    videoPath: "/tmp/source.mp4",
    status: "completed",
    djName: "LUCIA_REINA",
    driveFolderPath: ["Robert A", "Lucia Reina"],
    clips: [
      {
        kind: "vertical_tiktok",
        path: "/tmp/LUCIA_REINA_30s_vertical_tiktok.mp4",
        durationSeconds: 30,
        width: 1080,
        height: 1920,
        audioSource: "source_drop",
      },
    ],
    sourceVideoDeleted: true,
    sourceVideoDeletedPath: "/tmp/source.mp4",
  });

  assert.match(summary, /LUCIA_REINA/);
  assert.match(summary, /borré el video largo local/);
  assert.match(summary, /Total estimado de esta edición: \$0\.00 USD para 1 video/);
});

test("yt-dlp command specs try 1080p video with bounded JS solver fallbacks by default", () => {
  const previousRuntimeConfig = process.env.YT_DLP_JS_RUNTIMES;
  const previousRemoteComponents = process.env.YT_DLP_REMOTE_COMPONENTS;
  const previousImpersonateTargets = process.env.YT_DLP_IMPERSONATE_TARGETS;
  const previousMaxVariants = process.env.YT_DLP_MAX_VARIANTS;

  try {
    delete process.env.YT_DLP_JS_RUNTIMES;
    delete process.env.YT_DLP_REMOTE_COMPONENTS;
    delete process.env.YT_DLP_IMPERSONATE_TARGETS;
    delete process.env.YT_DLP_MAX_VARIANTS;
    const specs = buildYtDlpCommandSpecs({
      url: "https://youtu.be/GcVZvXkz2jU",
      outputTemplate: "/tmp/%(id)s.%(ext)s",
      mode: "video",
      explicitBinary: "/workspace/bin/yt-dlp",
      cookieArgs: ["--cookies", "/tmp/youtube-cookies.txt"],
    });

    assert.ok(specs.some((spec) => spec.command === "/workspace/bin/yt-dlp"));
    assert.ok(specs.length <= 18);
    assert.ok(specs.some((spec) => !spec.args.includes("--js-runtimes")));
    assert.ok(specs.some((spec) => spec.args.includes("--js-runtimes") && spec.args.includes("node")));
    assert.ok(specs.every((spec) => !spec.args.includes("deno")));
    assert.ok(specs.every((spec) => !spec.args.includes("--impersonate")));
    assert.ok(specs.every((spec) => spec.args.includes("--socket-timeout") && spec.args.includes("30")));
    assert.ok(specs.some((spec) => spec.args.includes("--remote-components") && spec.args.includes("ejs:github")));
    assert.ok(specs.some((spec) => spec.args.includes("bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080][ext=mp4]/b[height<=1080]/best[height<=1080]/best")));
    assert.ok(specs.every((spec) => {
      const formatIndex = spec.args.indexOf("-f");
      return formatIndex !== -1 && /height<=1080|best/.test(spec.args[formatIndex + 1] || "");
    }));
    assert.ok(specs.every((spec) => spec.args.includes("--cookies") && spec.args.includes("/tmp/youtube-cookies.txt")));
  } finally {
    if (previousRuntimeConfig === undefined) {
      delete process.env.YT_DLP_JS_RUNTIMES;
    } else {
      process.env.YT_DLP_JS_RUNTIMES = previousRuntimeConfig;
    }
    if (previousRemoteComponents === undefined) {
      delete process.env.YT_DLP_REMOTE_COMPONENTS;
    } else {
      process.env.YT_DLP_REMOTE_COMPONENTS = previousRemoteComponents;
    }
    if (previousImpersonateTargets === undefined) {
      delete process.env.YT_DLP_IMPERSONATE_TARGETS;
    } else {
      process.env.YT_DLP_IMPERSONATE_TARGETS = previousImpersonateTargets;
    }
    if (previousMaxVariants === undefined) {
      delete process.env.YT_DLP_MAX_VARIANTS;
    } else {
      process.env.YT_DLP_MAX_VARIANTS = previousMaxVariants;
    }
  }
});

test("yt-dlp command specs use impersonation only when a fresh Python package is available", () => {
  const previousImpersonateTargets = process.env.YT_DLP_IMPERSONATE_TARGETS;
  const previousMaxVariants = process.env.YT_DLP_MAX_VARIANTS;

  try {
    delete process.env.YT_DLP_IMPERSONATE_TARGETS;
    process.env.YT_DLP_MAX_VARIANTS = "100";
    const specs = buildYtDlpCommandSpecs({
      url: "https://youtu.be/GcVZvXkz2jU",
      outputTemplate: "/tmp/%(id)s.%(ext)s",
      mode: "video",
      explicitBinary: "/workspace/bin/yt-dlp",
      cookieArgs: ["--cookies", "/tmp/youtube-cookies.txt"],
      freshPythonPackageDir: "/tmp/robplanner-yt-dlp-python",
    });

    assert.ok(specs.some((spec) => spec.args.includes("--impersonate") && spec.args.includes("chrome")));
  } finally {
    if (previousImpersonateTargets === undefined) {
      delete process.env.YT_DLP_IMPERSONATE_TARGETS;
    } else {
      process.env.YT_DLP_IMPERSONATE_TARGETS = previousImpersonateTargets;
    }
    if (previousMaxVariants === undefined) {
      delete process.env.YT_DLP_MAX_VARIANTS;
    } else {
      process.env.YT_DLP_MAX_VARIANTS = previousMaxVariants;
    }
  }
});

test("yt-dlp command specs allow disabling impersonation attempts", () => {
  const previousImpersonateTargets = process.env.YT_DLP_IMPERSONATE_TARGETS;

  try {
    process.env.YT_DLP_IMPERSONATE_TARGETS = "off";
    const specs = buildYtDlpCommandSpecs({
      url: "https://youtu.be/GcVZvXkz2jU",
      outputTemplate: "/tmp/%(id)s.%(ext)s",
      mode: "video",
      explicitBinary: "/workspace/bin/yt-dlp",
      cookieArgs: ["--cookies", "/tmp/youtube-cookies.txt"],
    });

    assert.ok(specs.length > 0);
    assert.ok(specs.every((spec) => !spec.args.includes("--impersonate")));
  } finally {
    if (previousImpersonateTargets === undefined) {
      delete process.env.YT_DLP_IMPERSONATE_TARGETS;
    } else {
      process.env.YT_DLP_IMPERSONATE_TARGETS = previousImpersonateTargets;
    }
  }
});

test("yt-dlp command specs allow explicit JS runtime flags", () => {
  const previousRuntimeConfig = process.env.YT_DLP_JS_RUNTIMES;
  const previousRemoteComponents = process.env.YT_DLP_REMOTE_COMPONENTS;
  const previousMaxVariants = process.env.YT_DLP_MAX_VARIANTS;

  try {
    process.env.YT_DLP_JS_RUNTIMES = "deno,node";
    delete process.env.YT_DLP_REMOTE_COMPONENTS;
    process.env.YT_DLP_MAX_VARIANTS = "100";
    const specs = buildYtDlpCommandSpecs({
      url: "https://youtu.be/GcVZvXkz2jU",
      outputTemplate: "/tmp/%(id)s.%(ext)s",
      mode: "video",
      explicitBinary: "/workspace/bin/yt-dlp",
      cookieArgs: ["--cookies", "/tmp/youtube-cookies.txt"],
    });

    assert.ok(specs.some((spec) => !spec.args.includes("--js-runtimes")));
    assert.ok(specs.some((spec) => spec.args.includes("--js-runtimes") && spec.args.includes("deno")));
    assert.ok(specs.some((spec) => spec.args.includes("--js-runtimes") && spec.args.includes("node")));
    assert.ok(specs.some((spec) => spec.args.includes("--remote-components") && spec.args.includes("ejs:github")));
  } finally {
    if (previousRuntimeConfig === undefined) {
      delete process.env.YT_DLP_JS_RUNTIMES;
    } else {
      process.env.YT_DLP_JS_RUNTIMES = previousRuntimeConfig;
    }
    if (previousRemoteComponents === undefined) {
      delete process.env.YT_DLP_REMOTE_COMPONENTS;
    } else {
      process.env.YT_DLP_REMOTE_COMPONENTS = previousRemoteComponents;
    }
    if (previousMaxVariants === undefined) {
      delete process.env.YT_DLP_MAX_VARIANTS;
    } else {
      process.env.YT_DLP_MAX_VARIANTS = previousMaxVariants;
    }
  }
});

test("yt-dlp command specs materialize YouTube cookies from base64 secret", () => {
  const previous = {
    YT_DLP_COOKIES_PATH: process.env.YT_DLP_COOKIES_PATH,
    YT_DLP_COOKIES_B64: process.env.YT_DLP_COOKIES_B64,
    YT_DLP_COOKIES_B64_1: process.env.YT_DLP_COOKIES_B64_1,
    YT_DLP_COOKIES_B64_2: process.env.YT_DLP_COOKIES_B64_2,
    YT_DLP_COOKIES_BASE64: process.env.YT_DLP_COOKIES_BASE64,
    YT_DLP_COOKIES: process.env.YT_DLP_COOKIES,
    YT_DLP_COOKIES_FROM_BROWSER: process.env.YT_DLP_COOKIES_FROM_BROWSER,
  };
  const cookieFile = [
    "# Netscape HTTP Cookie File",
    ".youtube.com\tTRUE\t/\tTRUE\t1893456000\tVISITOR_INFO1_LIVE\tfake-test-value",
  ].join("\n");
  let materializedPath = "";

  try {
    delete process.env.YT_DLP_COOKIES_PATH;
    delete process.env.YT_DLP_COOKIES_BASE64;
    delete process.env.YT_DLP_COOKIES;
    delete process.env.YT_DLP_COOKIES_FROM_BROWSER;
    delete process.env.YT_DLP_COOKIES_B64_1;
    delete process.env.YT_DLP_COOKIES_B64_2;
    process.env.YT_DLP_COOKIES_B64 = Buffer.from(cookieFile, "utf8").toString("base64");

    const specs = buildYtDlpCommandSpecs({
      url: "https://youtu.be/GcVZvXkz2jU",
      outputTemplate: "/tmp/%(id)s.%(ext)s",
      mode: "video",
    });

    const firstCookiesIndex = specs[0].args.indexOf("--cookies");
    assert.notEqual(firstCookiesIndex, -1);
    materializedPath = specs[0].args[firstCookiesIndex + 1];
    assert.match(materializedPath, /yt-dlp-youtube-cookies-[a-f0-9]+\.txt$/);
    assert.ok(existsSync(materializedPath));
    assert.equal(readFileSync(materializedPath, "utf8"), `${cookieFile}\n`);
    assert.ok(specs.some((spec) => spec.args.includes("--cookies") && spec.args.includes(materializedPath)));
    assert.ok(specs.some((spec) => !spec.args.includes("--cookies")));
  } finally {
    if (materializedPath) rmSync(materializedPath, { force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("yt-dlp command specs prefer chunked base64 YouTube cookies over single secret", () => {
  const previous = {
    YT_DLP_COOKIES_PATH: process.env.YT_DLP_COOKIES_PATH,
    YT_DLP_COOKIES_B64: process.env.YT_DLP_COOKIES_B64,
    YT_DLP_COOKIES_B64_1: process.env.YT_DLP_COOKIES_B64_1,
    YT_DLP_COOKIES_B64_2: process.env.YT_DLP_COOKIES_B64_2,
    YT_DLP_COOKIES_BASE64: process.env.YT_DLP_COOKIES_BASE64,
    YT_DLP_COOKIES: process.env.YT_DLP_COOKIES,
    YT_DLP_COOKIES_FROM_BROWSER: process.env.YT_DLP_COOKIES_FROM_BROWSER,
  };
  const cookieFile = [
    "# Netscape HTTP Cookie File",
    ".youtube.com\tTRUE\t/\tTRUE\t1893456000\tLOGIN_INFO\tfull-cookie-test-value",
  ].join("\n");
  const encoded = Buffer.from(cookieFile, "utf8").toString("base64");
  let materializedPath = "";

  try {
    delete process.env.YT_DLP_COOKIES_PATH;
    delete process.env.YT_DLP_COOKIES_BASE64;
    delete process.env.YT_DLP_COOKIES;
    delete process.env.YT_DLP_COOKIES_FROM_BROWSER;
    process.env.YT_DLP_COOKIES_B64 = Buffer.from("stale-cookie", "utf8").toString("base64");
    process.env.YT_DLP_COOKIES_B64_1 = encoded.slice(0, 12);
    process.env.YT_DLP_COOKIES_B64_2 = encoded.slice(12);

    const specs = buildYtDlpCommandSpecs({
      url: "https://youtu.be/GcVZvXkz2jU",
      outputTemplate: "/tmp/%(id)s.%(ext)s",
      mode: "video",
    });

    const firstCookiesIndex = specs[0].args.indexOf("--cookies");
    assert.notEqual(firstCookiesIndex, -1);
    materializedPath = specs[0].args[firstCookiesIndex + 1];
    assert.equal(readFileSync(materializedPath, "utf8"), `${cookieFile}\n`);
  } finally {
    if (materializedPath) rmSync(materializedPath, { force: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("yt-dlp command specs skip invalid chunks and fall through to valid single key", () => {
  const names = [
    "YT_DLP_COOKIES_PATH",
    "YT_DLP_COOKIES_B64",
    "YT_DLP_COOKIES_BASE64",
    "YT_DLP_COOKIES",
    "YT_DLP_COOKIES_FROM_BROWSER",
    ...Array.from({ length: 200 }, (_, index) => `YT_DLP_COOKIES_B64_${index + 1}`),
    ...Array.from({ length: 200 }, (_, index) => `YT_DLP_COOKIES_B64_${String(index + 1).padStart(3, "0")}`),
    ...Array.from({ length: 200 }, (_, index) => `YT_DLP_COOKIES_BASE64_${index + 1}`),
    ...Array.from({ length: 200 }, (_, index) => `YT_DLP_COOKIES_BASE64_${String(index + 1).padStart(3, "0")}`),
  ];
  const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const cookieFile = [
    "# Netscape HTTP Cookie File",
    ".youtube.com\tTRUE\t/\tTRUE\t1893456000\tLOGIN_INFO\tvalid-single-key",
    ".google.com\tTRUE\t/\tTRUE\t1893456000\tSID\tvalid-google-cookie",
  ].join("\n");
  let materializedPath = "";

  try {
    for (const name of names) delete process.env[name];
    process.env.YT_DLP_COOKIES_B64_1 = Buffer.from("not cookies\tbut\tmany\ttabs\tthat\tlook\tstructured\n", "utf8").toString("base64");
    process.env.YT_DLP_COOKIES_B64_2 = Buffer.from("also\tinvalid\tand\tmissing\tyoutube\tdomains\n", "utf8").toString("base64");
    process.env.YT_DLP_COOKIES_B64 = Buffer.from(cookieFile, "utf8").toString("base64");

    const specs = buildYtDlpCommandSpecs({
      url: "https://youtu.be/GcVZvXkz2jU",
      outputTemplate: "/tmp/%(id)s.%(ext)s",
      mode: "video",
    });

    const firstCookiesIndex = specs[0].args.indexOf("--cookies");
    assert.notEqual(firstCookiesIndex, -1);
    materializedPath = specs[0].args[firstCookiesIndex + 1];
    assert.equal(readFileSync(materializedPath, "utf8"), `${cookieFile}\n`);
  } finally {
    if (materializedPath) rmSync(materializedPath, { force: true });
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("yt-dlp cookie chunks tolerate Replit lexicographic secret ordering", () => {
  const names = [
    "YT_DLP_COOKIES_PATH",
    "YT_DLP_COOKIES_B64",
    "YT_DLP_COOKIES_BASE64",
    "YT_DLP_COOKIES",
    "YT_DLP_COOKIES_FROM_BROWSER",
    ...Array.from({ length: 12 }, (_, index) => `YT_DLP_COOKIES_B64_${index + 1}`),
  ];
  const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    const cookieFile = [
      "# Netscape HTTP Cookie File",
      ".youtube.com\tTRUE\t/\tTRUE\t1893456000\tVISITOR_INFO1_LIVE\tabc",
      ".google.com\tTRUE\t/\tTRUE\t1893456000\tSID\tdef",
      "",
    ].join("\n");
    const encoded = Buffer.from(cookieFile, "utf8").toString("base64");
    const chunkSize = Math.ceil(encoded.length / 12);
    const chunks = Array.from({ length: 12 }, (_, index) => encoded.slice(index * chunkSize, (index + 1) * chunkSize));
    const keysInReplitVisualOrder = [1, 10, 11, 12, 2, 3, 4, 5, 6, 7, 8, 9];
    keysInReplitVisualOrder.forEach((keyNumber, index) => {
      process.env[`YT_DLP_COOKIES_B64_${keyNumber}`] = chunks[index];
    });

    const specs = buildYtDlpCommandSpecs({
      url: "https://youtu.be/GcVZvXKz2jU",
      outputTemplate: "/tmp/%(id)s.%(ext)s",
      mode: "video",
      freshPythonPackageDir: null,
    });
    const firstCookiesIndex = specs[0].args.indexOf("--cookies");
    assert.notEqual(firstCookiesIndex, -1);
    const materializedPath = specs[0].args[firstCookiesIndex + 1];
    assert.ok(existsSync(materializedPath));
    const materialized = readFileSync(materializedPath, "utf8");
    assert.match(materialized, /Netscape HTTP Cookie File/);
    assert.match(materialized, /\.youtube\.com/);
  } finally {
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("yt-dlp command specs prefer fresh Python package when available", () => {
  const specs = buildYtDlpCommandSpecs({
    url: "https://youtu.be/GcVZvXkz2jU",
    outputTemplate: "/tmp/%(id)s.%(ext)s",
    mode: "video",
    freshPythonPackageDir: "/tmp/robplanner-yt-dlp-python",
  });

  assert.equal(specs[0].command, "python3");
  assert.deepEqual(specs[0].args.slice(0, 2), ["-m", "yt_dlp"]);
  assert.match(specs[0].env?.PYTHONPATH || "", /\/tmp\/robplanner-yt-dlp-python/);
});

test("yt-dlp failure message explains YouTube bot blocks without routing to GitHub", () => {
  const message = formatYtDlpFailureMessage(
    "ERROR: [youtube] GcVZvXkz2jU: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for the authentication.",
    "video",
  );

  assert.match(message, /YouTube bloqueó la descarga desde Replit/);
  assert.match(message, /YT_DLP_COOKIES_B64|YT_DLP_COOKIES_PATH|MP4 fuente/);
  assert.doesNotMatch(message, /GitHub|handoff|PR/i);
});

test("yt-dlp failure message explains stale extractor format errors", () => {
  const message = formatYtDlpFailureMessage(
    "WARNING: [youtube] YouTube said: ERROR - Precondition check failed. ERROR: Requested format is not available. Only images are available for download.",
    "video",
  );

  assert.match(message, /formatos inválidos o incompletos/);
  assert.match(message, /yt-dlp está viejo|cookies de YouTube/);
  assert.match(message, /YT_DLP_COOKIES_B64|MP4 fuente/);
});

test("yt-dlp failure message does not let unsupported js runtime variants hide bot blocks", () => {
  const message = formatYtDlpFailureMessage(
    [
      "yt-dlp failed with code 2: __main__.py: error: no such option: --js-runtimes",
      "ERROR: [youtube] GcVZvXkz2jU: Sign in to confirm you're not a bot. Use --cookies for the authentication.",
    ].join("\n"),
    "video",
  );

  assert.match(message, /YouTube bloqueó la descarga desde Replit/);
  assert.doesNotMatch(message, /no soporta --js-runtimes|demasiado vieja/);
});
