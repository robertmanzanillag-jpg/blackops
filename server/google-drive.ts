import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Readable } from "stream";
import { pipeline } from "node:stream/promises";
import { getGoogleAccessToken, getGoogleOAuthClient, hasReplitGoogleConnectorEnv } from "./google-calendar";
import { getGoogleDriveOAuthClient, getGoogleDriveRefreshTokenFromEnv, hasGoogleDriveOAuthClientConfig } from "./google-drive-oauth";
import { getSystemUserId } from "./user-context";
import { hasRealValue } from "./ceo-doctor-cli";

const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
const DEFAULT_MAX_DRIVE_VIDEO_DOWNLOAD_BYTES = 3 * 1024 * 1024 * 1024;
const ALLOWED_VIDEO_MIME_TYPES = new Set(["application/octet-stream"]);
export const DRIVE_APP_ROOT_FOLDER = "Robert A";
export const DRIVE_RADIO_FLYERS_FOLDER = "Flyers de la radio";
export const DRIVE_BLACK_ROOM_VIDEOS_FOLDER = "Videos de Black Room";
export const DRIVE_KONG_VIDEOS_FOLDER = "Videos de Kong";
export const DRIVE_CLIPPERS_MEDIA_FOLDER = "Clippers Metricool Media";

export interface DriveUploadResult {
  fileId: string;
  webViewLink: string | null;
  webContentLink: string | null;
}

export function buildGoogleDrivePublicDownloadUrl(fileId: string): string {
  const cleaned = fileId.trim();
  if (!/^[a-zA-Z0-9_-]{10,160}$/.test(cleaned)) {
    throw new Error("Google Drive file id is invalid.");
  }
  const params = new URLSearchParams({
    id: cleaned,
    export: "download",
    confirm: "t",
  });
  return `https://drive.usercontent.google.com/download?${params.toString()}`;
}

export async function ensureDriveFilePublicDownload(params: {
  fileId: string;
  userId?: string;
}): Promise<string> {
  try {
    const drive = await getDriveClient(params.userId || getSystemUserId());
    const permissions = await drive.permissions.list({
      fileId: params.fileId,
      fields: "permissions(id,type,role)",
      supportsAllDrives: true,
    });
    const alreadyPublic = (permissions.data.permissions || [])
      .some((permission: any) => permission.type === "anyone" && permission.role === "reader");
    if (!alreadyPublic) {
      await drive.permissions.create({
        fileId: params.fileId,
        requestBody: { type: "anyone", role: "reader" },
        supportsAllDrives: true,
      });
    }
    return buildGoogleDrivePublicDownloadUrl(params.fileId);
  } catch (error: any) {
    if (isDrivePermissionError(error)) {
      throw new Error("Google Drive permission is missing or public link sharing is disabled.");
    }
    throw error;
  }
}

export interface DriveDownloadResult {
  fileId: string;
  name: string;
  mimeType: string | null;
  filePath: string;
}

export interface DriveFolderSetupResult {
  rootFolderId: string;
  folders: Array<{
    label: string;
    path: string[];
    folderId: string;
  }>;
}

async function getGoogleDriveApi() {
  return import("googleapis/build/src/apis/drive/index.js");
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function isDrivePermissionError(error: any): boolean {
  const status = error?.code || error?.response?.status;
  const message = String(error?.message || error?.response?.data?.error_description || "");
  return status === 401 || status === 403 || /insufficient|permission|scope|unauthorized/i.test(message);
}

function readOptionalRealDriveFolderId(envName: string): string | null {
  const value = process.env[envName];
  if (!value) return null;
  if (hasRealValue(value)) return value;
  throw new Error(`${envName} must be a real Google Drive folder id, not a placeholder.`);
}

export function getConfiguredClippersDriveRootFolderId(): string | null {
  return (
    readOptionalRealDriveFolderId("GOOGLE_DRIVE_CLIPPERS_ROOT_FOLDER_ID") ||
    readOptionalRealDriveFolderId("CLIPPERS_DRIVE_ROOT_FOLDER_ID")
  );
}

async function getDriveClient(userId: string) {
  const googleDrive = await getGoogleDriveApi();
  if (
    getGoogleDriveRefreshTokenFromEnv() ||
    hasGoogleDriveOAuthClientConfig()
  ) {
    return googleDrive.drive({ version: "v3", auth: await getGoogleDriveOAuthClient(userId) });
  }

  if (!hasReplitGoogleConnectorEnv()) {
    throw new Error("Google Drive is not connected. Open /api/google-drive/auth to connect Drive before asking the agent to save videos there.");
  }

  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken();
  } catch (error: any) {
    if (/Google connector not connected/i.test(error?.message || "")) {
      throw new Error("Google Drive connector is not connected. Open /api/google-drive/auth or reconnect the Google Drive Replit connector before asking the agent to save videos there.");
    }
    throw error;
  }
  return googleDrive.drive({ version: "v3", auth: await getGoogleOAuthClient(accessToken) });
}

async function findFolder(drive: any, name: string, parentId: string): Promise<string | null> {
  const query = [
    `mimeType = '${DRIVE_FOLDER_MIME}'`,
    `name = '${escapeDriveQueryValue(name)}'`,
    `'${escapeDriveQueryValue(parentId)}' in parents`,
    "trashed = false",
  ].join(" and ");

  const response = await drive.files.list({
    q: query,
    fields: "files(id, name)",
    spaces: "drive",
    pageSize: 1,
  });

  return response.data.files?.[0]?.id || null;
}

export async function findDriveFolderPath(folderNames: string[], userId = getSystemUserId()): Promise<string | null> {
  return findDriveFolderPathUnderParent(folderNames, "root", userId);
}

export async function findDriveFolderPathUnderParent(folderNames: string[], parentFolderId: string, userId = getSystemUserId()): Promise<string | null> {
  try {
    const drive = await getDriveClient(userId);
    let parentId = parentFolderId.trim() || "root";
    for (const folderName of folderNames) {
      const cleanName = folderName.trim();
      if (!cleanName) continue;
      const folderId = await findFolder(drive, cleanName, parentId);
      if (!folderId) return null;
      parentId = folderId;
    }
    return parentId;
  } catch (error: any) {
    if (isDrivePermissionError(error)) {
      throw new Error("Google Drive permission is missing.");
    }
    throw error;
  }
}

export async function searchDriveFoldersByName(folderName: string, userId = getSystemUserId()): Promise<Array<{ id: string; name: string; webViewLink: string | null }>> {
  try {
    const cleanName = folderName.trim();
    if (!cleanName) return [];
    const drive = await getDriveClient(userId);
    const query = [
      `mimeType = '${DRIVE_FOLDER_MIME}'`,
      `name = '${escapeDriveQueryValue(cleanName)}'`,
      "trashed = false",
    ].join(" and ");

    const response = await drive.files.list({
      q: query,
      fields: "files(id, name, webViewLink)",
      spaces: "drive",
      pageSize: 10,
    });

    return (response.data.files || [])
      .filter((file: any) => file.id && file.name)
      .map((file: any) => ({
        id: file.id,
        name: file.name,
        webViewLink: file.webViewLink || null,
      }));
  } catch (error: any) {
    if (isDrivePermissionError(error)) {
      throw new Error("Google Drive permission is missing.");
    }
    throw error;
  }
}

async function createFolder(drive: any, name: string, parentId: string): Promise<string> {
  const response = await drive.files.create({
    requestBody: {
      name,
      mimeType: DRIVE_FOLDER_MIME,
      parents: [parentId],
    },
    fields: "id",
  });

  if (!response.data.id) {
    throw new Error(`Google Drive did not return an id for folder ${name}`);
  }

  return response.data.id;
}

async function findOrCreateFolder(drive: any, name: string, parentId: string): Promise<string> {
  return (await findFolder(drive, name, parentId)) || createFolder(drive, name, parentId);
}

export async function ensureDriveFolderPath(folderNames: string[], userId = getSystemUserId()): Promise<string> {
  return ensureDriveFolderPathUnderParent(folderNames, "root", userId);
}

export async function ensureDriveFolderPathUnderParent(folderNames: string[], parentFolderId: string, userId = getSystemUserId()): Promise<string> {
  try {
    const drive = await getDriveClient(userId);
    let parentId = parentFolderId.trim() || "root";
    for (const folderName of folderNames) {
      const cleanName = folderName.trim();
      if (!cleanName) continue;
      parentId = await findOrCreateFolder(drive, cleanName, parentId);
    }
    return parentId;
  } catch (error: any) {
    if (isDrivePermissionError(error)) {
      throw new Error("Google Drive permission is missing.");
    }
    throw error;
  }
}

export async function ensureAppDriveFolderPath(folderNames: string[], userId = getSystemUserId()): Promise<string> {
  return ensureDriveFolderPath([DRIVE_APP_ROOT_FOLDER, ...folderNames], userId);
}

export async function ensureAppDriveStructure(userId = getSystemUserId()): Promise<DriveFolderSetupResult> {
  const rootFolderId = await ensureDriveFolderPath([DRIVE_APP_ROOT_FOLDER], userId);
  const folderSpecs = [
    { label: "Flyers de la radio", path: [DRIVE_RADIO_FLYERS_FOLDER] },
    { label: "Videos de Black Room", path: [DRIVE_BLACK_ROOM_VIDEOS_FOLDER] },
    { label: "Videos de Black Room / Instagram", path: [DRIVE_BLACK_ROOM_VIDEOS_FOLDER, "Instagram"] },
    { label: "Videos de Black Room / TikTok", path: [DRIVE_BLACK_ROOM_VIDEOS_FOLDER, "TikTok"] },
    { label: "Videos de Kong", path: [DRIVE_KONG_VIDEOS_FOLDER] },
  ];

  const folders = [];
  for (const spec of folderSpecs) {
    folders.push({
      label: spec.label,
      path: [DRIVE_APP_ROOT_FOLDER, ...spec.path],
      folderId: await ensureAppDriveFolderPath(spec.path, userId),
    });
  }

  return { rootFolderId, folders };
}

export async function ensureRadioDriveFolder(dateFolderName: string, userId = getSystemUserId()): Promise<string> {
  try {
    const drive = await getDriveClient(userId);
    const configuredRootId = readOptionalRealDriveFolderId("GOOGLE_DRIVE_RADIO_FOLDER_ID");
    const appRootId = configuredRootId || (await findOrCreateFolder(drive, DRIVE_APP_ROOT_FOLDER, "root"));
    const flyersRootId = await findOrCreateFolder(drive, DRIVE_RADIO_FLYERS_FOLDER, appRootId);
    return findOrCreateFolder(drive, dateFolderName, flyersRootId);
  } catch (error: any) {
    if (isDrivePermissionError(error)) {
      throw new Error("Google Drive permission is missing.");
    }
    throw error;
  }
}

export async function ensureDriveFolderAtRoot(folderName: string, userId = getSystemUserId()): Promise<string> {
  try {
    const drive = await getDriveClient(userId);
    return findOrCreateFolder(drive, folderName, "root");
  } catch (error: any) {
    if (isDrivePermissionError(error)) {
      throw new Error("Google Drive permission is missing.");
    }
    throw error;
  }
}

async function findFileInFolder(drive: any, filename: string, folderId: string): Promise<string | null> {
  const query = [
    `name = '${escapeDriveQueryValue(filename)}'`,
    `'${escapeDriveQueryValue(folderId)}' in parents`,
    "trashed = false",
  ].join(" and ");

  const response = await drive.files.list({
    q: query,
    fields: "files(id, name)",
    spaces: "drive",
    pageSize: 1,
  });

  return response.data.files?.[0]?.id || null;
}

function sanitizeDriveDownloadFilename(value: string, fallback: string, mimeType?: string | null): string {
  const cleaned = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 140);
  const base = cleaned || fallback;
  if (path.extname(base)) return base;
  if (mimeType === "video/mp4") return `${base}.mp4`;
  if (mimeType === "video/quicktime") return `${base}.mov`;
  return base;
}

function getMaxDriveVideoDownloadBytes(): number {
  const raw = process.env.RADIO_MAX_DRIVE_VIDEO_BYTES || process.env.MAX_DRIVE_VIDEO_DOWNLOAD_BYTES;
  if (!raw) return DEFAULT_MAX_DRIVE_VIDEO_DOWNLOAD_BYTES;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_DRIVE_VIDEO_DOWNLOAD_BYTES;
}

function isAllowedDriveVideoMimeType(mimeType?: string | null): boolean {
  if (!mimeType) return true;
  if (mimeType.startsWith("video/")) return true;
  return ALLOWED_VIDEO_MIME_TYPES.has(mimeType);
}

export async function downloadDriveFileToPath(params: {
  fileId: string;
  outputDir: string;
  userId?: string;
  allowedExtensions?: Set<string>;
}): Promise<DriveDownloadResult> {
  try {
    const drive = await getDriveClient(params.userId || getSystemUserId());
    const metadata = await drive.files.get({
      fileId: params.fileId,
      fields: "id, name, mimeType, size",
      supportsAllDrives: true,
    });
    const name = String(metadata.data.name || `${params.fileId}.mp4`);
    const mimeType = metadata.data.mimeType || null;
    const sizeBytes = metadata.data.size ? Number(metadata.data.size) : null;
    if (mimeType?.startsWith("application/vnd.google-apps.")) {
      throw new Error("El archivo de Drive no es un MP4 descargable. Sube o comparte el archivo de video original.");
    }
    if (!isAllowedDriveVideoMimeType(mimeType)) {
      throw new Error(`El archivo de Drive debe ser un video MP4/MOV/M4V, pero recibí ${mimeType}.`);
    }
    const maxBytes = getMaxDriveVideoDownloadBytes();
    if (sizeBytes && sizeBytes > maxBytes) {
      throw new Error(`El video de Drive pesa ${(sizeBytes / 1024 / 1024 / 1024).toFixed(1)}GB y supera el límite configurado de ${(maxBytes / 1024 / 1024 / 1024).toFixed(1)}GB.`);
    }

    const filename = sanitizeDriveDownloadFilename(name, `${params.fileId}.mp4`, mimeType);
    const extension = path.extname(filename).toLowerCase();
    if (params.allowedExtensions?.size && !params.allowedExtensions.has(extension)) {
      throw new Error(`El archivo de Drive debe ser video MP4/MOV/M4V, pero recibí ${extension || "sin extensión"}.`);
    }

    const safeFileId = params.fileId.replace(/[^a-zA-Z0-9_-]+/g, "").slice(0, 48) || "drive-file";
    const jobDir = path.join(params.outputDir, `${Date.now()}-${randomUUID()}-${safeFileId}`);
    await fs.promises.mkdir(jobDir, { recursive: true });
    const filePath = path.join(jobDir, filename);
    const response = await drive.files.get(
      { fileId: params.fileId, alt: "media", supportsAllDrives: true },
      { responseType: "stream" },
    );
    try {
      await pipeline(response.data as NodeJS.ReadableStream, fs.createWriteStream(filePath));
    } catch (error) {
      await fs.promises.rm(filePath, { force: true }).catch(() => undefined);
      throw error;
    }

    return {
      fileId: params.fileId,
      name,
      mimeType,
      filePath,
    };
  } catch (error: any) {
    if (isDrivePermissionError(error)) {
      throw new Error("Google Drive permission is missing.");
    }
    throw error;
  }
}

export async function uploadLocalFileToDriveFolder(params: {
  filePath: string;
  folderId: string;
  mimeType?: string;
  userId?: string;
}): Promise<DriveUploadResult> {
  try {
    const drive = await getDriveClient(params.userId || getSystemUserId());
    const filename = path.basename(params.filePath);
    const existingFileId = await findFileInFolder(drive, filename, params.folderId);
    const media = {
      mimeType: params.mimeType || "application/octet-stream",
      body: Readable.from(fs.readFileSync(params.filePath)),
    };

    const response = existingFileId
      ? await drive.files.update({
          fileId: existingFileId,
          media,
          requestBody: { name: filename },
          fields: "id, webViewLink, webContentLink",
        })
      : await drive.files.create({
          requestBody: {
            name: filename,
            parents: [params.folderId],
          },
          media,
          fields: "id, webViewLink, webContentLink",
        });

    if (!response.data.id) {
      throw new Error(`Google Drive did not return an id for ${filename}`);
    }

    return {
      fileId: response.data.id,
      webViewLink: response.data.webViewLink || null,
      webContentLink: response.data.webContentLink || null,
    };
  } catch (error: any) {
    if (isDrivePermissionError(error)) {
      throw new Error("Google Drive permission is missing.");
    }
    throw error;
  }
}

export async function uploadRadioTemplatePng(params: {
  buffer: Buffer;
  filename: string;
  folderId: string;
  existingFileId?: string | null;
  userId?: string;
}): Promise<DriveUploadResult> {
  try {
    const drive = await getDriveClient(params.userId || getSystemUserId());
    const media = {
      mimeType: "image/png",
      body: Readable.from(params.buffer),
    };

    const response = params.existingFileId
      ? await drive.files.update({
          fileId: params.existingFileId,
          media,
          requestBody: { name: params.filename },
          fields: "id, webViewLink, webContentLink",
        })
      : await drive.files.create({
          requestBody: {
            name: params.filename,
            parents: [params.folderId],
          },
          media,
          fields: "id, webViewLink, webContentLink",
        });

    if (!response.data.id) {
      throw new Error(`Google Drive did not return an id for ${params.filename}`);
    }

    return {
      fileId: response.data.id,
      webViewLink: response.data.webViewLink || null,
      webContentLink: response.data.webContentLink || null,
    };
  } catch (error: any) {
    if (isDrivePermissionError(error)) {
      throw new Error("Google Drive permission is missing.");
    }
    throw error;
  }
}
