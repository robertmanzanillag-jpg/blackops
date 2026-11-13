const DRIVE_FOLDER_ID_PATTERN = /^[a-zA-Z0-9_-]{10,}$/;

function cleanDriveFolderId(value?: string | null): string | null {
  if (!value) return null;
  const decoded = decodeURIComponent(value).trim().replace(/[),.;]+$/, "");
  return DRIVE_FOLDER_ID_PATTERN.test(decoded) ? decoded : null;
}

export function extractGoogleDriveFolderIdFromUrl(value?: string | null): string | null {
  if (!value) return null;

  const folderPathMatch = value.match(/https?:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([^/?#\s]+)/i);
  const folderPathId = cleanDriveFolderId(folderPathMatch?.[1]);
  if (folderPathId) return folderPathId;

  const urlMatches = value.match(/https?:\/\/drive\.google\.com\/[^\s"'<>]+/gi) || [];
  for (const match of urlMatches) {
    try {
      const url = new URL(match.replace(/[),.;]+$/, ""));
      const id = cleanDriveFolderId(url.searchParams.get("folderId"));
      if (id) return id;
    } catch {
      continue;
    }
  }

  return null;
}
