import os from "node:os";
import path from "node:path";

import {
  getClipperStatus,
  recordClipperSourceRights,
} from "../server/clippers-agent";

const ownedMemeSourcePattern = /^memes-owned-\d{2}(?:-\d+)?\.mp4$/;
const ownerNotePath = process.env.CLIPPERS_OWNER_NOTE_PATH
  || path.join(os.homedir(), "Documents/asistente/clippers_workspace/source-drop/memes/owned-meme-production-notes.md");
const rightsNote = [
  "Owned source generated locally for Meme Radar;",
  `owner note path ${ownerNotePath};`,
  "no third-party footage;",
  "no copyrighted music;",
  "duplicate imports, when present, are byte-identical copies of the locally generated owned source files.",
].join(" ");

async function main() {
  const status = await getClipperStatus();
  const ownedMemeAssets = status.productionQueue.sourceAssets
    .filter((asset) => ownedMemeSourcePattern.test(asset.fileName))
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
  const missingRights = ownedMemeAssets.filter((asset) => asset.rightsStatus !== "owned_or_permissioned");

  for (const asset of missingRights) {
    await recordClipperSourceRights({
      assetId: asset.id,
      rightsStatus: "owned_or_permissioned",
      notes: `${rightsNote} Asset ${asset.fileName}.`,
    });
  }

  const refreshed = await getClipperStatus();
  const refreshedOwnedMemeAssets = refreshed.productionQueue.sourceAssets
    .filter((asset) => ownedMemeSourcePattern.test(asset.fileName));
  const rightsReady = refreshedOwnedMemeAssets
    .filter((asset) => asset.rightsStatus === "owned_or_permissioned").length;

  console.log(JSON.stringify({
    scanned: ownedMemeAssets.length,
    recorded: missingRights.length,
    rightsReady,
    realPublishEnabled: refreshed.metricoolExecutionQueue.realPublishEnabled,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
