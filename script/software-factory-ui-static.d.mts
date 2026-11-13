export interface OfficeUiStaticFile {
  path: string;
  sha256: string;
  content: string;
}
export interface OfficeUiStaticBundle {
  version: 1;
  files: OfficeUiStaticFile[];
}
export interface OfficeUiStaticManifest {
  files: Array<Pick<OfficeUiStaticFile, "path" | "sha256">>;
  sha256: string;
}
export const OFFICE_UI_HARNESS_FILES: readonly string[];
export const OFFICE_UI_STATIC_EXCLUSIONS: readonly string[];
export function validateStaticBundle(value: unknown): OfficeUiStaticManifest;
export function collectStaticBundle(root: string): Promise<OfficeUiStaticBundle>;
export function materializeStaticBundle(bundle: OfficeUiStaticBundle, root: string): Promise<OfficeUiStaticManifest>;
