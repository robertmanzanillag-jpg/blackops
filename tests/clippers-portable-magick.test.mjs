import assert from "node:assert/strict";
import test from "node:test";
import { BUNDLED_FONT_PATH, execMagick, magickCandidates, portableMagickArgs } from "../script/clippers-portable-magick.mjs";

const args = ["-size", "9x9", "-font", "Arial-Bold", "-pointsize", "20", "label:Arial-Bold", "out.png"];

test("off macOS the Arial-Bold font argument becomes the bundled DejaVu font; text stays unchanged", () => {
  const out = portableMagickArgs(args, {}, "linux");
  assert.equal(out[3], BUNDLED_FONT_PATH);
  assert.equal(out[6], "label:Arial-Bold");
  assert.deepEqual(portableMagickArgs(args, {}, "darwin"), args);
  assert.equal(portableMagickArgs(args, { CLIPPERS_FONT_PATH: "/fonts/x.ttf" }, "darwin")[3], "/fonts/x.ttf");
});

test("binary candidates: magick then convert, or exactly the configured one", () => {
  assert.deepEqual(magickCandidates({}), ["magick", "convert"]);
  assert.deepEqual(magickCandidates({ CLIPPERS_MAGICK_BIN: "convert" }), ["convert"]);
  assert.deepEqual(magickCandidates({ CLIPPERS_MAGICK_BIN: "/bin/sh" }), ["magick", "convert"]);
});

test("falls back to convert only when magick is missing (ENOENT); other errors propagate", async () => {
  const calls = [];
  const exec = async (bin, a) => { calls.push(bin); if (bin === "magick") throw Object.assign(new Error("x"), { code: "ENOENT" }); return { stdout: a.join(" ") }; };
  await execMagick(args, {}, { env: {}, platform: "linux", exec });
  assert.deepEqual(calls, ["magick", "convert"]);
  const failing = async () => { throw Object.assign(new Error("render"), { code: 1 }); };
  await assert.rejects(execMagick(args, {}, { env: {}, platform: "linux", exec: failing }), /render/);
});
