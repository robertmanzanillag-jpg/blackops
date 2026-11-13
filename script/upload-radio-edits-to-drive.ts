import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { google } from "googleapis";
import { hasRealValue } from "../server/ceo-doctor-cli";

const DEFAULT_FOLDER_ID = "1DFAJg05WgnKj1rXu0YUrOWWrT15ilVWW";

function resolveSourceDir(): string {
  if (!process.env.RADIO_EDIT_OUTPUT_DIR) return path.join(process.cwd(), "radio_video_edits", "03_listos_para_subir");
  if (hasRealValue(process.env.RADIO_EDIT_OUTPUT_DIR)) return process.env.RADIO_EDIT_OUTPUT_DIR;
  throw new Error("RADIO_EDIT_OUTPUT_DIR must be a real filesystem path, not a placeholder.");
}

function resolveDriveFolderId(): string {
  if (!process.env.GOOGLE_DRIVE_IG_EDITS_FOLDER_ID) return DEFAULT_FOLDER_ID;
  if (hasRealValue(process.env.GOOGLE_DRIVE_IG_EDITS_FOLDER_ID)) return process.env.GOOGLE_DRIVE_IG_EDITS_FOLDER_ID;
  throw new Error("GOOGLE_DRIVE_IG_EDITS_FOLDER_ID must be a real Google Drive folder id, not a placeholder.");
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findExistingFile(drive: any, driveFolderId: string, filename: string): Promise<string | null> {
  const response = await drive.files.list({
    q: [
      `'${escapeDriveQueryValue(driveFolderId)}' in parents`,
      `name = '${escapeDriveQueryValue(filename)}'`,
      "trashed = false",
    ].join(" and "),
    fields: "files(id, name)",
    spaces: "drive",
    pageSize: 1,
  });

  return response.data.files?.[0]?.id || null;
}

async function uploadFile(drive: any, driveFolderId: string, filePath: string) {
  const filename = path.basename(filePath);
  const existingFileId = await findExistingFile(drive, driveFolderId, filename);
  const media = {
    mimeType: "video/mp4",
    body: Readable.from(fs.readFileSync(filePath)),
  };

  const response = existingFileId
    ? await drive.files.update({
        fileId: existingFileId,
        media,
        requestBody: { name: filename },
        fields: "id, webViewLink",
      })
    : await drive.files.create({
        requestBody: {
          name: filename,
          parents: [driveFolderId],
        },
        media,
        fields: "id, webViewLink",
      });

  console.log(`${existingFileId ? "Actualizado" : "Subido"}: ${filename}`);
  if (response.data.webViewLink) console.log(`Link: ${response.data.webViewLink}`);
}

async function main() {
  const driveFolderId = resolveDriveFolderId();
  const sourceDir = resolveSourceDir();

  if (!fs.existsSync(sourceDir)) {
    throw new Error(`No existe la carpeta de edits: ${sourceDir}`);
  }

  const files = fs
    .readdirSync(sourceDir)
    .filter((file) => file.toLowerCase().endsWith(".mp4"))
    .map((file) => path.join(sourceDir, file));

  if (files.length === 0) {
    console.log(`No hay .mp4 para subir en ${sourceDir}`);
    return;
  }

  const auth = new google.auth.GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });
  const drive = google.drive({ version: "v3", auth });

  for (const file of files) {
    await uploadFile(drive, driveFolderId, file);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
