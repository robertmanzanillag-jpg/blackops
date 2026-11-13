import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  buildRadioTemplateSourceHash,
  forceTransparentBackground,
  renderLocalRadioTemplatePng,
  sanitizeRadioFilenamePart,
} from "../server/radio-template-agent";

test("sanitizeRadioFilenamePart normalizes accents and symbols", () => {
  assert.equal(sanitizeRadioFilenamePart("LUCÌA REINA "), "LUCIA-REINA");
  assert.equal(sanitizeRadioFilenamePart("DANIØ b2b N1T0!!!"), "DANIO-B2B-N1T0");
  assert.equal(sanitizeRadioFilenamePart("   "), "DJ");
});

test("sanitizeRadioFilenamePart caps long names", () => {
  const result = sanitizeRadioFilenamePart("A".repeat(120));
  assert.equal(result.length, 80);
});

test("buildRadioTemplateSourceHash changes when DJ changes", () => {
  const base = {
    eventId: "radio-1",
    eventDate: new Date("2026-06-18T20:00:00-04:00"),
    slotHour: 7,
    rawDescription: "7: Lucia Reina",
  };

  const first = buildRadioTemplateSourceHash({ ...base, djName: "Lucia Reina" });
  const second = buildRadioTemplateSourceHash({ ...base, djName: "DR Rein" });

  assert.notEqual(first, second);
});

test("buildRadioTemplateSourceHash is stable for the same source", () => {
  const input = {
    eventId: "radio-1",
    eventDate: new Date("2026-06-18T20:00:00-04:00"),
    slotHour: 8,
    djName: "Instead of Seven",
    rawDescription: "8: Instead of Seven",
  };

  assert.equal(buildRadioTemplateSourceHash(input), buildRadioTemplateSourceHash(input));
});

test("buildRadioTemplateSourceHash changes when Canva template changes", () => {
  const base = {
    eventId: "radio-1",
    eventDate: new Date("2026-06-18T20:00:00-04:00"),
    slotHour: 9,
    djName: "Jake Anthony",
    rawDescription: "9: Jake Anthony",
  };

  const first = buildRadioTemplateSourceHash({ ...base, canvaBrandTemplateId: "template-a" });
  const second = buildRadioTemplateSourceHash({ ...base, canvaBrandTemplateId: "template-b" });

  assert.notEqual(first, second);
});

test("forceTransparentBackground turns black pixels transparent", async () => {
  const input = await sharp({
    create: {
      width: 6,
      height: 6,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite([
      {
        input: Buffer.from([255, 255, 255, 255]),
        raw: { width: 1, height: 1, channels: 4 },
        left: 3,
        top: 3,
      },
    ])
    .png()
    .toBuffer();

  const output = await forceTransparentBackground(input);
  const { data } = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  assert.equal(data[3], 0);
  assert.equal(data[((3 * 6 + 3) * 4) + 3], 255);
});

test("renderLocalRadioTemplatePng preserves a visible 1280x720 background", async () => {
  const output = await renderLocalRadioTemplatePng("Lucia Reina");
  const metadata = await sharp(output).metadata();

  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 1280);
  assert.equal(metadata.height, 720);

  const { data, info } = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparentPixels = 0;
  let visiblePixels = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    const red = data[index] || 0;
    const green = data[index + 1] || 0;
    const blue = data[index + 2] || 0;
    if (red > 24 || green > 24 || blue > 24) visiblePixels++;
  }
  for (let index = 3; index < data.length; index += info.channels) {
    if (data[index] === 0) transparentPixels++;
  }

  assert.ok(transparentPixels < info.width * info.height * 0.01);
  assert.ok(visiblePixels > info.width * info.height * 0.1);
});
