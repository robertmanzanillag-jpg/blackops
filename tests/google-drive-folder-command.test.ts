import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDirectGoogleDriveFolderCommand, extractGoogleDriveCreateFolderPath } from "../server/google-drive-folder-command";

test("extracts nested Google Drive folder creation paths", () => {
  assert.deepEqual(
    extractGoogleDriveCreateFolderPath("en la carpeta de radio crea una carpeta con los videos que creaste"),
    ["radio", "Videos creados"],
  );

  assert.deepEqual(
    extractGoogleDriveCreateFolderPath("crea una subcarpeta Junio en la carpeta Robert A/Videos de Black Room del Drive"),
    ["Robert A", "Videos de Black Room", "Junio"],
  );
});

test("builds direct Google Drive folder command", () => {
  const command = buildDirectGoogleDriveFolderCommand("crea carpeta Robert A/Videos de Black Room/Radio Junio en Google Drive");
  assert.deepEqual(command?.driveFolderPath, ["Robert A", "Videos de Black Room", "Radio Junio"]);
  assert.match(command?.command || "", /GOOGLE_DRIVE_CREATE_FOLDER/);
});

test("asks for a folder path when Drive request is incomplete", () => {
  const command = buildDirectGoogleDriveFolderCommand("crea una carpeta en Google Drive");
  assert.equal(command?.driveFolderPath.length, 0);
  assert.match(command?.content || "", /ruta|nombre exacto/i);
});
