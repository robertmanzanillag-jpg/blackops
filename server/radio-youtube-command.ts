import path from "node:path";
import { extractGoogleDriveFileIdFromUrl } from "./google-drive-file-url";
import { extractGoogleDriveFolderIdFromUrl } from "./google-drive-folder-url";
import type { RadioDriveVideoProcessResult, RadioYoutubeProcessResult } from "./radio-video-edit-agent";

export type DirectRadioYoutubeCommand = {
  youtubeUrl: string;
  driveFolderPath: string[];
  driveParentFolderId?: string;
  createFolderIfMissing?: boolean;
  driveFolderPathFromYoutubeTitle?: boolean;
  djName?: string;
  musicUrl?: string;
  instagramClipCount?: number;
  tiktokClipCount?: number;
  deleteSourceAfterSuccess?: boolean;
  needsMusicUrl?: boolean;
  content: string;
  command: string;
};

export type DirectRadioDriveVideoCommand = {
  sourceDriveFileId: string;
  sourceDriveUrl?: string;
  driveFolderPath: string[];
  driveParentFolderId?: string;
  createFolderIfMissing?: boolean;
  djName?: string;
  musicUrl?: string;
  instagramClipCount?: number;
  tiktokClipCount?: number;
  deleteSourceAfterSuccess?: boolean;
  needsMusicUrl?: boolean;
  content: string;
  command: string;
};

const ESTIMATED_COST_PER_EDITED_VIDEO_USD = 0;
const DEFAULT_DRIVE_CLIP_FOLDER_PATH = ["Videos creados"];
const MAX_CLIPS_PER_PLATFORM = 10;

export function directRadioYoutubeCommandNeedsDriveFolder(command: DirectRadioYoutubeCommand): boolean {
  return !command.driveFolderPath.length && !command.driveFolderPathFromYoutubeTitle && !command.driveParentFolderId;
}

export function directRadioDriveVideoCommandNeedsDriveFolder(command: DirectRadioDriveVideoCommand): boolean {
  return !command.driveFolderPath.length && !command.driveParentFolderId;
}

function normalizeText(message: string): string {
  return message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s:/.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractFirstUrl(message: string): string | null {
  return message.match(/https?:\/\/[^\s"'<>]+/i)?.[0]?.replace(/[),.;]+$/, "") || null;
}

function extractUrls(message: string): string[] {
  return [...message.matchAll(/https?:\/\/[^\s"'<>]+/gi)]
    .map((match) => match[0].replace(/[),.;]+$/, ""));
}

function removeDriveUrls(message: string): string {
  return message.replace(/https?:\/\/drive\.google\.com\/[^\s"'<>]+/gi, " ");
}

function isYouTubeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    return host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be";
  } catch {
    return false;
  }
}

function cleanFolderHint(value?: string): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\b(?:por favor|please|hazlo|hacerlo|sacalos|sácalos|youtube|link)\b/gi, " ")
    .replace(/\b(?:drive|drives|google\s+drive|google\s+drives|carpeta|carpte|carte|caroeta|folder)\b/gi, " ")
    .replace(/\s+(?:y|para|con)\s+(?:que|cuando|si)\b.*$/i, "")
    .replace(/\s+con\s+(?:el\s+)?t[ií]tulo\b.*$/i, "")
    .replace(/^(?:de|del)\s+(?:google\s+)?drive\b.*$/i, "")
    .replace(/^(?:llamada?|nombrada?|named|called)\s+/i, "")
    .replace(/[."'“”‘’]+$/g, "")
    .replace(/^["'“”‘’]+/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:]+|[\s:]+$/g, "")
    .trim();

  if (/^(?:de|del|la|el|los|las|mi|mis|tu|tus|su|sus|en|a|esta|este|esa|ese|enviada?|enviado|link|url|aqui|ah[ií]|drive|google drive)$/i.test(cleaned)) return null;
  return cleaned.length >= 2 ? cleaned : null;
}

function splitDriveFolderPath(value: string): string[] {
  return value
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function cleanCreateFolderHint(value?: string): string | null {
  const cleaned = cleanFolderHint(value)
    ?.replace(/\b(?:crea|crear|creame|créame|carpeta|carpte|carte|caroeta|subcarpeta|folder|drive|drives|google drive|google drives)\b/gi, " ")
    .replace(/^(?:de|del|la|el|los|las|con)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned && cleaned.length >= 2 ? cleaned : null;
}

function cleanChildFolderHint(value?: string): string | null {
  if (!value) return null;
  if (/videos?\s+que\s+creaste|clips?\s+que\s+creaste/i.test(value)) {
    return "Videos creados";
  }
  return cleanCreateFolderHint(value);
}

function buildDriveFolderPath(parent?: string | null, child?: string | null): string[] | null {
  const parentParts = parent ? splitDriveFolderPath(parent) : [];
  const childParts = child ? splitDriveFolderPath(child) : [];
  const driveFolderPath = [...parentParts, ...childParts].filter(Boolean);
  return driveFolderPath.length ? driveFolderPath : null;
}

function extractDriveCreateFolderPath(message: string): string[] | null {
  const quotedPath = message.match(/\b(?:carpeta|subcarpeta|folder)\s+["“”']([^"“”']{2,160})["“”']/i)?.[1];
  const quotedCleaned = cleanCreateFolderHint(quotedPath);
  if (quotedCleaned) return splitDriveFolderPath(quotedCleaned);

  const nestedPatterns = [
    /(?:en|dentro\s+de)\s+(?:la\s+)?carpeta\s+(.+?)\s+crea(?:r|me)?\s+(?:una\s+)?(?:subcarpeta|carpeta|folder)\s+(?:llamada\s+|nombre\s+|de\s+|para\s+)?(.+?)(?:\s+(?:de|del)\s+(?:google\s+)?drive\b|[.,;]|$)/i,
    /crea(?:r|me)?\s+(?:una\s+)?(?:subcarpeta|carpeta|folder)\s+(?:llamada\s+|nombre\s+|de\s+|para\s+)?(.+?)\s+(?:en|dentro\s+de)\s+(?:la\s+)?carpeta\s+(.+?)(?:\s+(?:de|del)\s+(?:google\s+)?drive\b|[.,;]|$)/i,
  ];

  const firstNested = message.match(nestedPatterns[0]);
  if (firstNested) {
    return buildDriveFolderPath(cleanCreateFolderHint(firstNested[1]), cleanChildFolderHint(firstNested[2]));
  }

  const secondNested = message.match(nestedPatterns[1]);
  if (secondNested) {
    return buildDriveFolderPath(cleanCreateFolderHint(secondNested[2]), cleanChildFolderHint(secondNested[1]));
  }

  return null;
}

function cleanDjHint(value?: string): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\b(?:y|con|en|para|guard|guarda|sube|carpeta|drive)\b.*$/i, "")
    .replace(/[^a-zA-Z0-9ÁÉÍÓÚÜÑáéíóúüñ ._-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length >= 2 && cleaned.length <= 60 ? cleaned : null;
}

function extractDjNameFromMessage(message: string): string | null {
  const patterns = [
    /\b(?:dj|nombre\s+del\s+dj|artista)\s*(?:es|:|-)?\s+([a-zA-Z0-9ÁÉÍÓÚÜÑáéíóúüñ ._-]{2,60})(?:[.,;]|$)/i,
    /\b(?:para|de)\s+(?:el\s+)?dj\s+([a-zA-Z0-9ÁÉÍÓÚÜÑáéíóúüñ ._-]{2,60})(?:[.,;]|$)/i,
  ];

  for (const pattern of patterns) {
    const cleaned = cleanDjHint(message.match(pattern)?.[1]);
    if (cleaned) return cleaned;
  }

  return null;
}

function normalizeRequestedClipCount(value?: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.min(MAX_CLIPS_PER_PLATFORM, parsed);
}

function extractRequestedRadioClipCounts(message: string): { instagramClipCount?: number; tiktokClipCount?: number } {
  const text = normalizeText(message);
  const enumeratesOneClipPerPlatform = (
    /\b1[\s.)/-]+(?:tiktok|reels?)\b[\s\S]{0,180}\b2[\s.)/-]+(?:ig|instagram)\b/.test(text) ||
    /\b1[\s.)/-]+(?:ig|instagram)\b[\s\S]{0,180}\b2[\s.)/-]+(?:tiktok|reels?)\b/.test(text)
  );
  const totalClipCount = normalizeRequestedClipCount(
    text.match(/\b(\d{1,2})\s+(?:clips?|videos?|reels?|edits?)\s+(?:listos?|total(?:es)?|para\s+publicar)\b/i)?.[1],
  );
  if (enumeratesOneClipPerPlatform && totalClipCount && totalClipCount <= 2) {
    return {};
  }

  const sharedCount = normalizeRequestedClipCount(
    text.match(/\b(\d{1,2})\s+(?:clips?|videos?|reels?|edits?)\b(?=[\s\S]{0,100}\b(?:ig|instagram)\b)(?=[\s\S]{0,100}\btiktok\b)/i)?.[1],
  );
  const instagramClipCount = normalizeRequestedClipCount(
    text.match(/\b(\d{1,2})\s+(?:clips?|videos?|reels?|edits?)\s+(?:diferentes\s+)?(?:para|de|en)?\s*(?:ig|instagram)\b/i)?.[1] ||
    text.match(/\b(\d{1,2})\s+(?:para|de|en)\s+(?:ig|instagram)\b/i)?.[1],
  ) || (/\b(?:ig|instagram)\b/.test(text) ? sharedCount : undefined);
  const tiktokClipCount = normalizeRequestedClipCount(
    text.match(/\b(\d{1,2})\s+(?:clips?|videos?|reels?|edits?)\s+(?:diferentes\s+)?(?:para|de|en)?\s*tiktok\b/i)?.[1] ||
    text.match(/\b(\d{1,2})\s+(?:para|de|en)\s+tiktok\b/i)?.[1],
  ) || (/\btiktok\b/.test(text) ? sharedCount : undefined);

  return { instagramClipCount, tiktokClipCount };
}

function shouldDeleteSourceAfterSuccess(message: string): boolean {
  const text = normalizeText(message);
  if (/\b(?:conserva|guarda|manten|mantener|keep)\b[\s\S]{0,80}\b(?:video largo|video fuente|original|source|mp4)\b/.test(text)) {
    return false;
  }
  return true;
}

function describeRequestedClipCounts(instagramClipCount?: number, tiktokClipCount?: number): string {
  const instagramCount = instagramClipCount || 1;
  const tiktokCount = tiktokClipCount || 1;
  if (instagramCount === 1 && tiktokCount === 1) return "los clips de radio para Instagram y TikTok";
  return `${instagramCount} clip${instagramCount === 1 ? "" : "s"} para Instagram y ${tiktokCount} clip${tiktokCount === 1 ? "" : "s"} para TikTok`;
}

export function extractDriveFolderPathFromMessage(message: string): string[] | null {
  if (extractGoogleDriveFolderIdFromUrl(message)) {
    const messageWithoutDriveUrls = removeDriveUrls(message);
    const driveUrlChildPatterns = [
      /(?:dentro\s+de|en)\s+(?:esa|esta|aqui|ah[ií])?\s*(?:carpeta|folder)?\s*(?:crea(?:r|me)?|haz(?:me)?|usa(?:r)?)?\s*(?:una\s+)?(?:subcarpeta|carpeta|folder)\s+(?:llamada\s+|nombre\s+|de\s+|para\s+)?(.+?)(?:[.,;]|$)/i,
      /(?:subcarpeta|carpeta|folder)\s+(?:llamada\s+|nombre\s+|de\s+|para\s+)?(.+?)\s+(?:dentro\s+de|en)\s+(?:esa|esta|aqui|ah[ií])\b/i,
    ];

    for (const pattern of driveUrlChildPatterns) {
      const match = messageWithoutDriveUrls.match(pattern);
      const matchText = match?.[0] || "";
      if (match && !/\b(?:crea|crear|creame|créame|haz(?:me)?|usa(?:r)?|subcarpeta|llamada?|nombre)\b/i.test(matchText)) {
        continue;
      }
      const cleaned = cleanCreateFolderHint(match?.[1]);
      if (cleaned) return splitDriveFolderPath(cleaned);
    }
  }

  const createFolderPath = extractDriveCreateFolderPath(message);
  if (createFolderPath?.length) return createFolderPath;

  const quotedFolder = message.match(/\b(?:carpeta|folder)\s+["“”']([^"“”']{2,120})["“”']/i)?.[1];
  const quotedCleaned = cleanFolderHint(quotedFolder);
  if (quotedCleaned) return splitDriveFolderPath(quotedCleaned);

  const patterns = [
    /(?:gu[aá]rd(?:a|alo|alos|ame|es)?|sube|pon(?:lo|los)?|save|upload).*?\b(?:en|a)\s+(?:la\s+)?(?:carpeta|carpte|carte|caroeta|folder)\s+(.+?)(?:\s+(?:de|del)\s+(?:google\s+)?drives?\b|[.,;]|$)/i,
    /(?:gu[aá]rd(?:a|alo|alos|ame|es)?|sube|pon(?:lo|los)?|save|upload).*?\b(?:en|a)\s+(.+?)(?:\s+(?:de|del)\s+(?:google\s+)?drives?\b)/i,
    /(?:google\s+drives?|drives?)\s+(?:carpeta|carpte|carte|caroeta|folder)\s+(.+?)(?:[.,;]|$)/i,
    /(?:carpeta|carpte|carte|caroeta|folder)\s+(.+?)(?:\s+(?:de|del)\s+(?:google\s+)?drives?\b|[.,;]|$)/i,
  ];

  for (const pattern of patterns) {
    const cleaned = cleanFolderHint(message.match(pattern)?.[1]);
    if (cleaned) return splitDriveFolderPath(cleaned);
  }

  return null;
}

export function buildDirectRadioYoutubeCommand(message?: string): DirectRadioYoutubeCommand | null {
  if (!message) return null;
  const urls = extractUrls(message);
  const youtubeUrl = urls.find(isYouTubeUrl) || extractFirstUrl(message);
  if (!youtubeUrl || !isYouTubeUrl(youtubeUrl)) return null;

  const text = normalizeText(message);
  const mentionsRadio = /\b(radio|black room|dj|djs)\b/.test(text);
  const mentionsClips = /\b(clips?|videos?|edits?|reels?|tiktok|instagram|ig|shorts?)\b/.test(text);
  const wantsCreate = /\b(haz\w*|saca\w*|genera\w*|edita\w*|prepara\w*|quiero|necesito|guard\w*|sube\w*)\b/.test(text);
  const mentionsDriveDestination = /\b(?:google\s+drives?|drives?|gdrive|carpeta|carpte|carte|caroeta|folder|subcarpeta|guard\w*|sube\w*|agrega\w*)\b/.test(text);
  if (!(mentionsRadio || mentionsDriveDestination) || !mentionsClips || !wantsCreate) return null;

  const musicUrl = urls.find((url) => url !== youtubeUrl && isYouTubeUrl(url));
  const driveParentFolderId = extractGoogleDriveFolderIdFromUrl(message) || undefined;
  const wantsMusicDrop = /\b(audio|cancion|canción|musica|música|song|track|drop)\b/.test(text);
  const driveFolderPath = extractDriveFolderPathFromMessage(message);
  const driveFolderPathFromYoutubeTitle = /\b(?:con|usa(?:r|ndo)?|segun|según)\s+(?:el\s+)?t[ií]tulo\b|\bt[ií]tulo\s+del\s+video\b/.test(text);
  const createFolderIfMissing = driveFolderPathFromYoutubeTitle || /\b(crea\w*|crear|nueva|nuevo|subcarpeta|folder nuevo|new folder)\b/.test(text);
  const djName = extractDjNameFromMessage(message) || undefined;
  const { instagramClipCount, tiktokClipCount } = extractRequestedRadioClipCounts(message);
  const deleteSourceAfterSuccess = shouldDeleteSourceAfterSuccess(message);
  const clipDescription = describeRequestedClipCounts(instagramClipCount, tiktokClipCount);
  if (!driveFolderPath?.length && !driveFolderPathFromYoutubeTitle && mentionsDriveDestination && !driveParentFolderId) {
    return {
      youtubeUrl,
      driveFolderPath: DEFAULT_DRIVE_CLIP_FOLDER_PATH,
      driveParentFolderId,
      createFolderIfMissing: true,
      driveFolderPathFromYoutubeTitle,
      djName,
      musicUrl,
      instagramClipCount,
      tiktokClipCount,
      deleteSourceAfterSuccess,
      content: `Dale. Voy a descargar ese YouTube, sacar ${clipDescription}, usar el drop ${musicUrl ? "de la canción enviada" : "del mismo video"} como audio, nombrarlos con ${djName || "el DJ que lea abajo a la izquierda"}, crear/usar Google Drive: ${DEFAULT_DRIVE_CLIP_FOLDER_PATH.join("/")} y borrar el video largo local al terminar.`,
      command: `[RADIO_YOUTUBE_CLIPS: ${JSON.stringify({ youtubeUrl, driveFolderPath: DEFAULT_DRIVE_CLIP_FOLDER_PATH, driveParentFolderId, createFolderIfMissing: true, driveFolderPathFromYoutubeTitle, djName, musicUrl, sourceAudioDrop: !musicUrl || wantsMusicDrop, instagramClipCount, tiktokClipCount, deleteSourceAfterSuccess })}]`,
    };
  }

  if (!driveFolderPath?.length && !driveFolderPathFromYoutubeTitle) {
    if (driveParentFolderId) {
      return {
        youtubeUrl,
        driveFolderPath: [],
        driveParentFolderId,
        createFolderIfMissing,
        driveFolderPathFromYoutubeTitle,
        djName,
        musicUrl,
        instagramClipCount,
        tiktokClipCount,
        deleteSourceAfterSuccess,
        content: `Dale. Voy a descargar ese YouTube, sacar ${clipDescription}, usar el drop ${musicUrl ? "de la canción enviada" : "del mismo video"} como audio, nombrarlos con ${djName || "el DJ que lea abajo a la izquierda"}, guardarlos en la carpeta de Google Drive que enviaste y borrar el video largo local al terminar.`,
        command: `[RADIO_YOUTUBE_CLIPS: ${JSON.stringify({ youtubeUrl, driveFolderPath: [], driveParentFolderId, createFolderIfMissing, driveFolderPathFromYoutubeTitle, djName, musicUrl, sourceAudioDrop: !musicUrl || wantsMusicDrop, instagramClipCount, tiktokClipCount, deleteSourceAfterSuccess })}]`,
      };
    }

    return {
      youtubeUrl,
      driveFolderPath: [],
      createFolderIfMissing,
      driveFolderPathFromYoutubeTitle,
      djName,
      musicUrl,
      instagramClipCount,
      tiktokClipCount,
      deleteSourceAfterSuccess,
      content: "Puedo hacerlo. Mándame también el nombre o ruta de la carpeta de Google Drive donde quieres que guarde los clips.",
      command: "",
    };
  }

  const resolvedDriveFolderPath = driveFolderPath || [];
  const folderLabel = resolvedDriveFolderPath.join("/");
  return {
    youtubeUrl,
    driveFolderPath: resolvedDriveFolderPath,
    driveParentFolderId,
    createFolderIfMissing,
    driveFolderPathFromYoutubeTitle,
    djName,
    musicUrl,
    instagramClipCount,
    tiktokClipCount,
    deleteSourceAfterSuccess,
    content: `Dale. Voy a descargar ese YouTube, sacar ${clipDescription}, usar el drop ${musicUrl ? "de la canción enviada" : "del mismo video"} como audio, nombrarlos con ${djName || "el DJ que lea abajo a la izquierda"} y ${driveFolderPathFromYoutubeTitle ? `${driveFolderPath?.length ? "crear/usar una subcarpeta con el título del video dentro de" : "crear/usar una carpeta con el título del video en"} Google Drive${folderLabel ? `: ${folderLabel}` : ""}` : `${createFolderIfMissing ? "crear/usar" : "guardar en"} Google Drive${driveParentFolderId ? " dentro de la carpeta enviada" : ""}: ${folderLabel}`}. Después borro el video largo local.`,
    command: `[RADIO_YOUTUBE_CLIPS: ${JSON.stringify({ youtubeUrl, driveFolderPath: resolvedDriveFolderPath, driveParentFolderId, createFolderIfMissing, driveFolderPathFromYoutubeTitle, djName, musicUrl, sourceAudioDrop: !musicUrl || wantsMusicDrop, instagramClipCount, tiktokClipCount, deleteSourceAfterSuccess })}]`,
  };
}

export function buildDirectRadioDriveVideoCommand(message?: string): DirectRadioDriveVideoCommand | null {
  if (!message) return null;
  const urls = extractUrls(message);
  const sourceDriveUrl = urls.find((url) => Boolean(extractGoogleDriveFileIdFromUrl(url)));
  const sourceDriveFileId = extractGoogleDriveFileIdFromUrl(sourceDriveUrl || message);
  if (!sourceDriveFileId) return null;

  const text = normalizeText(message);
  const mentionsRadio = /\b(radio|black room|dj|djs)\b/.test(text);
  const mentionsSourceVideo = /\b(mp4|video largo|video fuente|archivo|file|drive)\b/.test(text);
  const mentionsClips = /\b(clips?|videos?|edits?|reels?|tiktok|instagram|ig|shorts?)\b/.test(text);
  const wantsCreate = /\b(haz\w*|saca\w*|genera\w*|edita\w*|prepara\w*|quiero|necesito|guard\w*|sube\w*|procesa\w*|toma)\b/.test(text);
  if (!(mentionsRadio || mentionsSourceVideo) || !mentionsClips || !wantsCreate) return null;

  const musicUrl = urls.find(isYouTubeUrl);
  const wantsMusicDrop = /\b(audio|cancion|canción|musica|música|song|track|drop)\b/.test(text);
  const driveParentFolderId = extractGoogleDriveFolderIdFromUrl(message) || undefined;
  const driveFolderPath = extractDriveFolderPathFromMessage(message);
  const createFolderIfMissing = /\b(crea\w*|crear|nueva|nuevo|subcarpeta|folder nuevo|new folder)\b/.test(text);
  const djName = extractDjNameFromMessage(message) || undefined;
  const { instagramClipCount, tiktokClipCount } = extractRequestedRadioClipCounts(message);
  const deleteSourceAfterSuccess = shouldDeleteSourceAfterSuccess(message);
  const clipDescription = describeRequestedClipCounts(instagramClipCount, tiktokClipCount);

  if (!driveFolderPath?.length && !driveParentFolderId) {
    return {
      sourceDriveFileId,
      sourceDriveUrl,
      driveFolderPath: [],
      createFolderIfMissing,
      djName,
      musicUrl,
      instagramClipCount,
      tiktokClipCount,
      deleteSourceAfterSuccess,
      content: "Puedo hacerlo con el MP4 de Google Drive. Mándame también el nombre, ruta o link de la carpeta de Google Drive donde quieres que guarde los clips.",
      command: "",
    };
  }

  const resolvedDriveFolderPath = driveFolderPath || [];
  const folderLabel = resolvedDriveFolderPath.join("/");
  return {
    sourceDriveFileId,
    sourceDriveUrl,
    driveFolderPath: resolvedDriveFolderPath,
    driveParentFolderId,
    createFolderIfMissing,
    djName,
    musicUrl,
    instagramClipCount,
    tiktokClipCount,
    deleteSourceAfterSuccess,
    content: `Dale. Voy a descargar el MP4 de Google Drive, sacar ${clipDescription}, usar el drop ${musicUrl ? "de la canción enviada" : "del mismo video"} como audio, nombrarlos con ${djName || "el DJ que lea abajo a la izquierda"} y ${createFolderIfMissing ? "crear/usar" : "guardar en"} Google Drive${driveParentFolderId ? " dentro de la carpeta enviada" : ""}: ${folderLabel || "carpeta enviada"}. Después borro el MP4 fuente local.`,
    command: `[RADIO_DRIVE_VIDEO_CLIPS: ${JSON.stringify({ sourceDriveFileId, sourceDriveUrl, driveFolderPath: resolvedDriveFolderPath, driveParentFolderId, createFolderIfMissing, djName, musicUrl, sourceAudioDrop: !musicUrl || wantsMusicDrop, instagramClipCount, tiktokClipCount, deleteSourceAfterSuccess })}]`,
  };
}

export async function executeDirectRadioYoutubeCommand(command: DirectRadioYoutubeCommand, userId: string): Promise<RadioYoutubeProcessResult> {
  if (directRadioYoutubeCommandNeedsDriveFolder(command)) {
    throw new Error("Falta la carpeta de Google Drive donde guardar los clips.");
  }

  const { processYoutubeRadioVideoLink } = await import("./radio-video-edit-agent");
  return processYoutubeRadioVideoLink({
    userId,
    youtubeUrl: command.youtubeUrl,
    driveFolderPath: command.driveFolderPath,
    driveParentFolderId: command.driveParentFolderId,
    createFolderIfMissing: Boolean(command.createFolderIfMissing),
    driveFolderPathFromYoutubeTitle: Boolean(command.driveFolderPathFromYoutubeTitle),
    djName: command.djName,
    musicUrl: command.musicUrl,
    instagramClipCount: command.instagramClipCount,
    tiktokClipCount: command.tiktokClipCount,
    deleteSourceAfterSuccess: command.deleteSourceAfterSuccess !== false,
  });
}

export async function executeDirectRadioDriveVideoCommand(command: DirectRadioDriveVideoCommand, userId: string): Promise<RadioDriveVideoProcessResult> {
  if (directRadioDriveVideoCommandNeedsDriveFolder(command)) {
    throw new Error("Falta la carpeta de Google Drive donde guardar los clips.");
  }

  const { processDriveRadioVideoFile } = await import("./radio-video-edit-agent");
  return processDriveRadioVideoFile({
    userId,
    sourceDriveFileId: command.sourceDriveFileId,
    sourceDriveUrl: command.sourceDriveUrl,
    driveFolderPath: command.driveFolderPath,
    driveParentFolderId: command.driveParentFolderId,
    createFolderIfMissing: Boolean(command.createFolderIfMissing),
    djName: command.djName,
    musicUrl: command.musicUrl,
    instagramClipCount: command.instagramClipCount,
    tiktokClipCount: command.tiktokClipCount,
    deleteSourceAfterSuccess: command.deleteSourceAfterSuccess !== false,
  });
}

function formatRadioVideoResult(result: RadioYoutubeProcessResult | RadioDriveVideoProcessResult, sourceLabel: string): string {
  if (result.status === "queued" && result.pendingActionId) {
    return [
      "No encontré esa carpeta en Google Drive.",
      `Dejé una confirmación pendiente para crearla y guardar ahí los clips: ${result.pendingActionId}`,
      "Escribe “aprobado” o apruébalo desde Decisiones y aprobaciones.",
    ].join("\n");
  }

  if (result.status === "needs_dj_name" && result.pendingActionId) {
    return [
      `Descargué el ${sourceLabel}, pero no pude leer el nombre del DJ.`,
      `Pendiente para completar el render: ${result.pendingActionId}`,
      `Puedes responder: nombre ${result.pendingActionId} DJ_NAME`,
    ].join("\n");
  }

  if (result.status !== "completed") {
    return [
      `No pude completar los clips: ${result.error || "error desconocido"}`,
      `Gasto estimado de esta edición: $${ESTIMATED_COST_PER_EDITED_VIDEO_USD.toFixed(2)} USD.`,
    ].join("\n");
  }

  const links = (result.clips || [])
    .map((clip) => clip.driveWebViewLink)
    .filter(Boolean) as string[];
  const names = (result.clips || []).map((clip) => `${path.basename(clip.path)} (${clip.width}x${clip.height}, ${clip.durationSeconds}s)`);
  const clipCount = result.clips?.length || 0;
  const totalEstimatedCost = clipCount * ESTIMATED_COST_PER_EDITED_VIDEO_USD;
  const usedMusicDrop = (result.clips || []).some((clip) => clip.audioSource === "music_drop");
  const usedSourceDrop = (result.clips || []).some((clip) => clip.audioSource === "source_drop");

  return [
    `Listo. Generé los clips de ${result.djName || "radio"} y los guardé en ${result.driveFolderPath?.join("/") || "Google Drive"}.`,
    result.driveFolderCreated ? "Carpeta: la creé en Google Drive porque el pedido lo autorizaba." : null,
    usedMusicDrop
      ? "Audio: usé el drop de la canción enviada y lo recorté al largo exacto de cada video."
      : usedSourceDrop
        ? "Audio: usé el drop del mismo video fuente y lo recorté al largo exacto de cada video."
        : "Audio: usé el audio original sincronizado del video.",
    names.length ? `Archivos: ${names.join(" | ")}` : null,
    links.length ? `Links: ${links.join(" | ")}` : null,
    result.sourceVideoDeleted
      ? "Limpieza: borré el video largo local después de subir los clips."
      : result.sourceVideoCleanupError
        ? `Limpieza: los clips se subieron, pero no pude borrar el video largo local (${result.sourceVideoCleanupError}).`
        : null,
    `Costo estimado por video editado: $${ESTIMATED_COST_PER_EDITED_VIDEO_USD.toFixed(2)} USD.`,
    `Total estimado de esta edición: $${totalEstimatedCost.toFixed(2)} USD para ${clipCount} video${clipCount === 1 ? "" : "s"}.`,
    "Nota: usa herramientas locales gratuitas; Google Drive solo puede consumir almacenamiento de tu cuenta.",
  ].filter(Boolean).join("\n");
}

export function formatRadioYoutubeResult(result: RadioYoutubeProcessResult): string {
  return formatRadioVideoResult(result, "video de YouTube");
}

export function formatRadioDriveVideoResult(result: RadioDriveVideoProcessResult): string {
  return formatRadioVideoResult(result, "MP4 de Google Drive");
}
