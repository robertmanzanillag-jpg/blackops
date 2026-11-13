import { createHash } from "crypto";
import { existsSync } from "fs";
import path from "path";
import { storage } from "./storage";
import { getRadioSlotsForMonth, type RadioSlot } from "./radio-agent";
import { ensureRadioDriveFolder, uploadRadioTemplatePng } from "./google-drive";
import { syncGoogleCalendarToTasks } from "./calendar-sync";
import { getSystemUserId } from "./user-context";
import { hasRealValue } from "./ceo-doctor-cli";
import type { RadioTemplateAsset } from "@shared/schema";

const RADIO_TIMEZONE = "America/New_York";
const CANVA_REFERENCE_DESIGN_ID = "DAGRzIet_rI";
const DEFAULT_CANVA_RADIO_BRAND_TEMPLATE_ID = "EAHMxABUd6M";
const DEFAULT_CANVA_DJ_FIELD = "dj_name";
const CANVA_TRANSPARENT_EXPORT = false;
const BLACK_BACKGROUND_ALPHA_THRESHOLD = 30;
const EDGE_CLEANUP_PIXELS = 2;
const RADIO_TEMPLATE_WIDTH = 1280;
const RADIO_TEMPLATE_HEIGHT = 720;
const RADIO_TEXT_LEFT = 29;
const RADIO_TEXT_TOP = 647;
const RADIO_TEXT_BOX_WIDTH = 560;
const RADIO_TEXT_BOX_HEIGHT = 58;
const RADIO_TEXT_FONT_SIZE = 36;
const RADIO_TEXT_FONT_FAMILY = "DIN Condensed, Avenir Next Condensed, Impact, Arial Narrow, sans-serif";
const RADIO_TEXT_ERASE_PADDING = 10;
type SharpFactory = typeof import("sharp").default;
let sharpFactoryPromise: Promise<SharpFactory> | null = null;

export interface GeneratedRadioTemplate {
  eventId: string;
  eventDate: string;
  slotHour: number;
  djName: string;
  filename: string;
  canvaDesignId: string | null;
  canvaEditUrl: string | null;
  canvaViewUrl: string | null;
  driveFileId: string | null;
  driveLink: string | null;
  status: "generated" | "skipped" | "failed";
  errorMessage?: string | null;
}

export interface RadioTemplateRunResult {
  dateKey: string;
  generated: number;
  skipped: number;
  failed: number;
  files: GeneratedRadioTemplate[];
}

interface RadioTemplateDesignReference {
  designId: string;
  editUrl: string | null;
  viewUrl: string | null;
}

async function loadSharp(): Promise<SharpFactory> {
  sharpFactoryPromise ||= import("sharp")
    .then((module) => module.default)
    .catch((error) => {
      sharpFactoryPromise = null;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Radio template image rendering requires sharp/libvips. Reinstall optional dependencies before generating radio templates. ${message}`);
    });
  return sharpFactoryPromise;
}

function getRequiredCanvaTemplateConfig() {
  const configuredBrandTemplateId = process.env.CANVA_RADIO_BRAND_TEMPLATE_ID;
  if (configuredBrandTemplateId !== undefined && !hasRealValue(configuredBrandTemplateId)) {
    throw new Error("CANVA_RADIO_BRAND_TEMPLATE_ID must be a real Canva brand template id, not a placeholder.");
  }

  const brandTemplateId = configuredBrandTemplateId || DEFAULT_CANVA_RADIO_BRAND_TEMPLATE_ID;
  const djField = process.env.CANVA_RADIO_DJ_FIELD || DEFAULT_CANVA_DJ_FIELD;

  if (!brandTemplateId) {
    throw new Error(
      `Canva Connect is not configured. Add CANVA_RADIO_BRAND_TEMPLATE_ID. The Canva design ${CANVA_REFERENCE_DESIGN_ID} must be published as a brand template with a ${djField} autofill text field.`
    );
  }

  return { brandTemplateId, djField };
}

function readOptionalRealEnv(name: string): string | null {
  const value = process.env[name];
  return hasRealValue(value) ? value : null;
}

export function getDateKeyInTimezone(date: Date, timezone = RADIO_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function sanitizeRadioFilenamePart(value: string): string {
  const normalized = value
    .replace(/[Øø]/g, "O")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toUpperCase();

  return (normalized || "DJ").slice(0, 80);
}

export function buildRadioTemplateSourceHash(params: {
  eventId: string;
  eventDate: Date;
  slotHour: number;
  djName: string;
  rawDescription?: string | null;
  canvaBrandTemplateId?: string | null;
  canvaDjField?: string | null;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({
      eventId: params.eventId,
      eventDate: params.eventDate.toISOString(),
      slotHour: params.slotHour,
      djName: params.djName.trim(),
      rawDescription: params.rawDescription || "",
      canvaBrandTemplateId:
        params.canvaBrandTemplateId ||
        (hasRealValue(process.env.CANVA_RADIO_BRAND_TEMPLATE_ID) ? process.env.CANVA_RADIO_BRAND_TEMPLATE_ID : DEFAULT_CANVA_RADIO_BRAND_TEMPLATE_ID),
      canvaDjField: params.canvaDjField || process.env.CANVA_RADIO_DJ_FIELD || DEFAULT_CANVA_DJ_FIELD,
      transparentBackground: CANVA_TRANSPARENT_EXPORT,
      template: "local-black-room-radio-miami-photo-v4",
    }))
    .digest("hex");
}

function getSlotName(slot: RadioSlot, slotHour: number): string | null {
  if (slotHour === 7) return slot.slot7;
  if (slotHour === 8) return slot.slot8;
  if (slotHour === 9) return slot.slot9;
  return null;
}

function buildFilename(dateKey: string, slotHour: number, djName: string): string {
  return `${dateKey}_${slotHour}pm_${sanitizeRadioFilenamePart(djName)}.png`;
}

function getTemplateInputs(slot: RadioSlot): Array<{ slotHour: number; djName: string }> {
  const inputs: Array<{ slotHour: number; djName: string }> = [];
  for (const slotHour of [7, 8, 9] as const) {
    const djName = getSlotName(slot, slotHour);
    if (djName) inputs.push({ slotHour, djName });
  }
  return inputs;
}

export async function forceTransparentBackground(input: Buffer): Promise<Buffer> {
  const sharp = await loadSharp();
  const image = sharp(input).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

  for (let index = 0; index < data.length; index += info.channels) {
    const pixelIndex = index / info.channels;
    const x = pixelIndex % info.width;
    const y = Math.floor(pixelIndex / info.width);
    const red = data[index] || 0;
    const green = data[index + 1] || 0;
    const blue = data[index + 2] || 0;
    const alphaIndex = index + 3;

    if (
      red <= BLACK_BACKGROUND_ALPHA_THRESHOLD &&
      green <= BLACK_BACKGROUND_ALPHA_THRESHOLD &&
      blue <= BLACK_BACKGROUND_ALPHA_THRESHOLD
    ) {
      data[alphaIndex] = 0;
    } else if (
      x < EDGE_CLEANUP_PIXELS ||
      y < EDGE_CLEANUP_PIXELS ||
      x >= info.width - EDGE_CLEANUP_PIXELS ||
      y >= info.height - EDGE_CLEANUP_PIXELS
    ) {
      data[alphaIndex] = 0;
    }
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function getRadioTemplatePath(): string {
  const configuredPath = process.env.RADIO_TEMPLATE_IMAGE_PATH;
  const candidates = [
    configuredPath,
    path.join(process.cwd(), "client/public/br-radio-template.png"),
    path.join(process.cwd(), "dist/public/br-radio-template.png"),
    path.join(process.cwd(), "client/public/br-radio-video-template.png"),
    path.join(process.cwd(), "dist/public/br-radio-video-template.png"),
  ].filter(Boolean) as string[];

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("Radio template image not found. Add RADIO_TEMPLATE_IMAGE_PATH or keep client/public/br-radio-template.png.");
  }

  return found;
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildDjTextOverlay(djName: string): Buffer {
  const text = escapeSvgText(djName.trim().toUpperCase());
  const svg = `
    <svg width="${RADIO_TEMPLATE_WIDTH}" height="${RADIO_TEMPLATE_HEIGHT}" viewBox="0 0 ${RADIO_TEMPLATE_WIDTH} ${RADIO_TEMPLATE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <style>
        .dj {
          fill: #ffffff;
          font-family: ${RADIO_TEXT_FONT_FAMILY};
          font-size: ${RADIO_TEXT_FONT_SIZE}px;
          font-weight: 900;
          letter-spacing: 0;
        }
      </style>
      <text x="${RADIO_TEXT_LEFT}" y="${RADIO_TEXT_TOP + RADIO_TEXT_FONT_SIZE}" class="dj">${text}</text>
    </svg>
  `;

  return Buffer.from(svg);
}

export async function renderLocalRadioTemplatePng(djName: string): Promise<Buffer> {
  const sharp = await loadSharp();
  const templatePath = getRadioTemplatePath();
  const template = await sharp(templatePath)
    .resize(RADIO_TEMPLATE_WIDTH, RADIO_TEMPLATE_HEIGHT, { fit: "fill" })
    .ensureAlpha()
    .composite([
      {
        input: {
          create: {
            width: RADIO_TEXT_BOX_WIDTH + RADIO_TEXT_ERASE_PADDING * 2,
            height: RADIO_TEXT_BOX_HEIGHT + RADIO_TEXT_ERASE_PADDING * 2,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 1 },
          },
        },
        left: Math.max(0, RADIO_TEXT_LEFT - RADIO_TEXT_ERASE_PADDING),
        top: Math.max(0, RADIO_TEXT_TOP - RADIO_TEXT_ERASE_PADDING),
      },
    ])
    .png()
    .toBuffer();

  return sharp(template)
    .composite([{ input: buildDjTextOverlay(djName), left: 0, top: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function generateRadioTemplatesForDate(
  userId = getSystemUserId(),
  targetDate = new Date()
): Promise<RadioTemplateRunResult> {
  await syncGoogleCalendarToTasks(userId);

  const { brandTemplateId, djField } = getRequiredCanvaTemplateConfig();
  const dateKey = getDateKeyInTimezone(targetDate);
  const radioSlots = (await getRadioSlotsForMonth(userId))
    .filter((slot) => getDateKeyInTimezone(new Date(slot.date)) === dateKey);

  const files: GeneratedRadioTemplate[] = [];
  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const slot of radioSlots) {
    const dateFolderName = `${dateKey} - Radio`;
    let folderId: string | null = null;

    for (const input of getTemplateInputs(slot)) {
      const eventDate = new Date(slot.date);
      const sourceHash = buildRadioTemplateSourceHash({
        eventId: slot.eventId,
        eventDate,
        slotHour: input.slotHour,
        djName: input.djName,
        rawDescription: slot.rawDescription,
        canvaBrandTemplateId: brandTemplateId,
        canvaDjField: djField,
      });
      const existing = await storage.getRadioTemplateAsset(userId, slot.eventId, input.slotHour);
      const filename = buildFilename(dateKey, input.slotHour, input.djName);

      if (existing?.sourceHash === sourceHash && existing.status === "generated" && existing.driveFileId) {
        skipped++;
        files.push({
          eventId: slot.eventId,
          eventDate: dateKey,
          slotHour: input.slotHour,
          djName: input.djName,
          filename,
          canvaDesignId: existing.canvaDesignId,
          canvaEditUrl: existing.canvaEditUrl,
          canvaViewUrl: existing.canvaViewUrl,
          driveFileId: existing.driveFileId,
          driveLink: existing.driveLink,
          status: "skipped",
        });
        continue;
      }

      const asset = await storage.upsertRadioTemplateAsset(userId, {
        userId,
        eventId: slot.eventId,
        eventDate,
        slotHour: input.slotHour,
        djName: input.djName,
        sourceHash,
        canvaBrandTemplateId: brandTemplateId,
        canvaDesignId: existing?.canvaDesignId || null,
        canvaEditUrl: existing?.canvaEditUrl || null,
        canvaViewUrl: existing?.canvaViewUrl || null,
        driveFileId: existing?.driveFileId || null,
        driveLink: existing?.driveLink || null,
        status: "pending",
        lastGeneratedAt: existing?.lastGeneratedAt || null,
        errorMessage: null,
      });

      try {
        const canvaDesign: RadioTemplateDesignReference = {
          designId: CANVA_REFERENCE_DESIGN_ID,
          editUrl: readOptionalRealEnv("CANVA_RADIO_TEMPLATE_EDIT_URL"),
          viewUrl: readOptionalRealEnv("CANVA_RADIO_TEMPLATE_VIEW_URL"),
        };
        const buffer = await renderLocalRadioTemplatePng(input.djName);
        folderId ||= await ensureRadioDriveFolder(dateFolderName, userId);
        const upload = await uploadRadioTemplatePng({
          buffer,
          filename,
          folderId,
          existingFileId: asset.driveFileId,
          userId,
        });

        await storage.updateRadioTemplateAsset(asset.id, {
          canvaBrandTemplateId: brandTemplateId,
          canvaDesignId: canvaDesign.designId,
          canvaEditUrl: canvaDesign.editUrl,
          canvaViewUrl: canvaDesign.viewUrl,
          driveFileId: upload.fileId,
          driveLink: upload.webViewLink || upload.webContentLink,
          status: "generated",
          lastGeneratedAt: new Date(),
          errorMessage: null,
        } as Partial<RadioTemplateAsset>);

        generated++;
        files.push({
          eventId: slot.eventId,
          eventDate: dateKey,
          slotHour: input.slotHour,
          djName: input.djName,
          filename,
          canvaDesignId: canvaDesign.designId,
          canvaEditUrl: canvaDesign.editUrl,
          canvaViewUrl: canvaDesign.viewUrl,
          driveFileId: upload.fileId,
          driveLink: upload.webViewLink || upload.webContentLink,
          status: "generated",
        });
      } catch (error: any) {
        failed++;
        const message = error?.message || "Failed to generate radio template";
        await storage.updateRadioTemplateAsset(asset.id, {
          status: "failed",
          errorMessage: message,
        } as Partial<RadioTemplateAsset>);
        files.push({
          eventId: slot.eventId,
          eventDate: dateKey,
          slotHour: input.slotHour,
          djName: input.djName,
          filename,
          canvaDesignId: asset.canvaDesignId,
          canvaEditUrl: asset.canvaEditUrl,
          canvaViewUrl: asset.canvaViewUrl,
          driveFileId: asset.driveFileId,
          driveLink: asset.driveLink,
          status: "failed",
          errorMessage: message,
        });
      }
    }
  }

  return { dateKey, generated, skipped, failed, files };
}
