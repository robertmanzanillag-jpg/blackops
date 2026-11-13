import { ensureDriveFolderPath } from "./google-drive";
import { writeAuditLog } from "./trust-policy";

export type DirectGoogleDriveFolderCommand = {
  driveFolderPath: string[];
  content: string;
  command: string;
};

export type GoogleDriveFolderCreateResult = {
  folderId: string;
  driveFolderPath: string[];
  webViewLink: string;
};

function normalizeText(message: string): string {
  return message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s:/.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanFolderName(value?: string): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\b(?:por favor|please|hazlo|hacerlo|crea|crear|creame|créame|carpeta|subcarpeta|folder|drive|google drive)\b/gi, " ")
    .replace(/\s+(?:y|para|con)\s+(?:que|cuando|si)\b.*$/i, "")
    .replace(/^(?:de|del|la|el|los|las|con)\s+/i, "")
    .replace(/[."'“”‘’]+$/g, "")
    .replace(/^["'“”‘’]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (/^(?:en|a)$/i.test(cleaned)) return null;
  return cleaned.length >= 2 ? cleaned : null;
}

function cleanChildFolderName(value?: string): string | null {
  if (!value) return null;
  if (/videos?\s+que\s+creaste|clips?\s+que\s+creaste/i.test(value)) {
    return "Videos creados";
  }
  return cleanFolderName(value);
}

function splitDriveFolderPath(value: string): string[] {
  return value
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildPath(parent?: string | null, child?: string | null): string[] | null {
  const parentParts = parent ? splitDriveFolderPath(parent) : [];
  const childParts = child ? splitDriveFolderPath(child) : [];
  const path = [...parentParts, ...childParts].filter(Boolean);
  return path.length > 0 ? path : null;
}

export function extractGoogleDriveCreateFolderPath(message: string): string[] | null {
  const quotedPath = message.match(/\b(?:carpeta|subcarpeta|folder)\s+["“”']([^"“”']{2,160})["“”']/i)?.[1];
  const quotedCleaned = cleanFolderName(quotedPath);
  if (quotedCleaned) return splitDriveFolderPath(quotedCleaned);

  const nestedPatterns = [
    /(?:en|dentro\s+de)\s+(?:la\s+)?carpeta\s+(.+?)\s+crea(?:r|me)?\s+(?:una\s+)?(?:subcarpeta|carpeta|folder)\s+(?:llamada\s+|nombre\s+|de\s+|para\s+)?(.+?)(?:\s+(?:de|del)\s+(?:google\s+)?drive\b|[.,;]|$)/i,
    /crea(?:r|me)?\s+(?:una\s+)?(?:subcarpeta|carpeta|folder)\s+(?:llamada\s+|nombre\s+|de\s+|para\s+)?(.+?)\s+(?:en|dentro\s+de)\s+(?:la\s+)?carpeta\s+(.+?)(?:\s+(?:de|del)\s+(?:google\s+)?drive\b|[.,;]|$)/i,
  ];

  const firstNested = message.match(nestedPatterns[0]);
  if (firstNested) {
    const parent = cleanFolderName(firstNested[1]);
    const child = cleanChildFolderName(firstNested[2]);
    return buildPath(parent, child);
  }

  const secondNested = message.match(nestedPatterns[1]);
  if (secondNested) {
    const child = cleanChildFolderName(secondNested[1]);
    const parent = cleanFolderName(secondNested[2]);
    return buildPath(parent, child);
  }

  const directPatterns = [
    /crea(?:r|me)?\s+(?:una\s+)?(?:carpeta|folder)\s+(?:llamada\s+|nombre\s+|de\s+|para\s+)?(.+?)(?:\s+(?:en|dentro\s+de)\s+(?:google\s+)?drive\b|[.,;]|$)/i,
    /(?:google\s+drive|drive).*?crea(?:r|me)?\s+(?:una\s+)?(?:carpeta|folder)\s+(?:llamada\s+|nombre\s+|de\s+|para\s+)?(.+?)(?:[.,;]|$)/i,
  ];

  for (const pattern of directPatterns) {
    const cleaned = cleanFolderName(message.match(pattern)?.[1]);
    if (cleaned) return splitDriveFolderPath(cleaned);
  }

  return null;
}

export function buildDirectGoogleDriveFolderCommand(message?: string): DirectGoogleDriveFolderCommand | null {
  if (!message) return null;
  const text = normalizeText(message);
  const wantsDrive = /\b(drive|google drive)\b/.test(text);
  const wantsFolder = /\b(carpetas?|subcarpetas?|folders?)\b/.test(text);
  const wantsCreate = /\b(crea\w*|crear|haz\w*|genera\w*)\b/.test(text);
  if (!wantsDrive || !wantsFolder || !wantsCreate) return null;

  const driveFolderPath = extractGoogleDriveCreateFolderPath(message);
  if (!driveFolderPath?.length) {
    return {
      driveFolderPath: [],
      content: "Puedo crearla. Dime la ruta o el nombre exacto de la carpeta en Google Drive.",
      command: "",
    };
  }

  return {
    driveFolderPath,
    content: `Dale. Voy a crear o asegurar esta carpeta en Google Drive: ${driveFolderPath.join("/")}.`,
    command: `[GOOGLE_DRIVE_CREATE_FOLDER: ${JSON.stringify({ driveFolderPath })}]`,
  };
}

export async function createGoogleDriveFolderPath(params: {
  userId: string;
  driveFolderPath: string[] | string;
  origin?: "web" | "telegram" | "scheduler";
}): Promise<GoogleDriveFolderCreateResult> {
  const driveFolderPath = Array.isArray(params.driveFolderPath)
    ? params.driveFolderPath.map((part) => part.trim()).filter(Boolean)
    : splitDriveFolderPath(params.driveFolderPath);
  if (driveFolderPath.length === 0) {
    throw new Error("Falta el nombre o ruta de la carpeta de Google Drive.");
  }

  const folderId = await ensureDriveFolderPath(driveFolderPath, params.userId);
  const result = {
    folderId,
    driveFolderPath,
    webViewLink: `https://drive.google.com/drive/folders/${folderId}`,
  };

  await writeAuditLog({
    userId: params.userId,
    actorType: "assistant",
    actorId: "google-drive-folder-agent",
    origin: params.origin || "web",
    actionType: "google_drive.create_folder",
    resourceType: "drive_folder",
    resourceId: folderId,
    metadata: result,
    status: "succeeded",
    executionMode: "user_requested",
  }).catch(() => undefined);

  return result;
}

export function formatGoogleDriveFolderCreateResult(result: GoogleDriveFolderCreateResult): string {
  return [
    `Listo. La carpeta está lista en Google Drive: ${result.driveFolderPath.join("/")}.`,
    `Link: ${result.webViewLink}`,
  ].join("\n");
}
