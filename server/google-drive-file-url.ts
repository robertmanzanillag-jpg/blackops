const DRIVE_FILE_ID_PATTERN = /^[a-zA-Z0-9_-]{10,}$/;

function cleanDriveFileId(value?: string | null): string | null {
  if (!value) return null;
  const decoded = decodeURIComponent(value).trim().replace(/[),.;]+$/, "");
  return DRIVE_FILE_ID_PATTERN.test(decoded) ? decoded : null;
}

export function extractGoogleDriveFileIdFromUrl(value?: string | null): string | null {
  if (!value) return null;

  const filePathMatch = value.match(/https?:\/\/drive\.google\.com\/file\/d\/([^/?#\s]+)/i);
  const filePathId = cleanDriveFileId(filePathMatch?.[1]);
  if (filePathId) return filePathId;

  const urlMatches = value.match(/https?:\/\/drive\.google\.com\/[^\s"'<>]+/gi) || [];
  for (const match of urlMatches) {
    try {
      const url = new URL(match.replace(/[),.;]+$/, ""));
      if (/\/drive\/(?:u\/\d+\/)?folders\//i.test(url.pathname)) continue;
      const id = cleanDriveFileId(url.searchParams.get("id") || url.searchParams.get("fileId"));
      if (id) return id;
    } catch {
      continue;
    }
  }

  return null;
}
