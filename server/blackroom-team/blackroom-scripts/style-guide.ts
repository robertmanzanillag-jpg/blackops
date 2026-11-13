// Loader for Robert's Black Room video style guide (docs/blackroom-video-style.md).
// Pure parsing plus one injectable file read: tests pass the markdown text directly.
import { readFile } from "node:fs/promises";
import path from "node:path";

export const BLACKROOM_VIDEO_STYLE_GUIDE_PATH = "docs/blackroom-video-style.md";

export type BlackRoomVideoStyleGuide = {
  /** True only when Robert marked the guide "estado: listo" and at least one section has content. */
  present: boolean;
  /** Why the guide is not used, in Spanish (empty when present). */
  reason: string;
  tone: string[];
  language: "es" | "en" | "mixto" | null;
  hooks: string[];
  ctas: string[];
  onScreenText: string[];
  hashtags: string[];
  banned: string[];
  editing: string[];
  examples: string[];
};

const SECTION_KEYS: Record<string, keyof Omit<BlackRoomVideoStyleGuide, "present" | "reason" | "language">> = {
  tono: "tone",
  "hooks que funcionan": "hooks",
  hooks: "hooks",
  "llamados a la accion": "ctas",
  cta: "ctas",
  ctas: "ctas",
  "texto en pantalla": "onScreenText",
  hashtags: "hashtags",
  "palabras prohibidas": "banned",
  prohibido: "banned",
  edicion: "editing",
  ejemplos: "examples",
};

const MAX_ITEMS_PER_SECTION = 20;
const MAX_ITEM_CHARS = 240;

export function emptyBlackRoomVideoStyleGuide(reason: string): BlackRoomVideoStyleGuide {
  return { present: false, reason, tone: [], language: null, hooks: [], ctas: [], onScreenText: [], hashtags: [], banned: [], editing: [], examples: [] };
}

function normalizeHeading(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Parses the markdown guide. Placeholder lines (PENDIENTE) and HTML comments are ignored. */
export function parseBlackRoomVideoStyleGuide(markdown: string): BlackRoomVideoStyleGuide {
  const text = String(markdown || "").replace(/<!--[\s\S]*?-->/g, "");
  const guide = emptyBlackRoomVideoStyleGuide("");
  const status = text.match(/^\s*estado\s*:\s*([a-z]+)/im)?.[1]?.toLowerCase() || "";
  let section: string | null = null;
  let languageRaw = "";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) { section = normalizeHeading(heading[1]); continue; }
    if (!section || !line || line.startsWith("#") || /pendiente/i.test(line)) continue;
    const item = line.replace(/^[-*]\s+/, "").trim().slice(0, MAX_ITEM_CHARS);
    if (!item) continue;
    if (section === "idioma") { languageRaw ||= item.toLowerCase(); continue; }
    const key = SECTION_KEYS[section];
    if (!key) continue;
    const list = guide[key];
    if (list.length < MAX_ITEMS_PER_SECTION) list.push(key === "hashtags" ? item.replace(/^(?!#)/, "#").split(/\s+/)[0] : item);
  }
  guide.language = /mixto|ambos|bilingue/.test(languageRaw) ? "mixto" : /^(en|ingles|english)\b/.test(languageRaw) ? "en" : /^(es|espanol|español)\b/.test(languageRaw) ? "es" : null;
  const hasContent = [guide.tone, guide.hooks, guide.ctas, guide.onScreenText, guide.hashtags, guide.banned, guide.editing, guide.examples].some((list) => list.length) || guide.language !== null;
  if (status !== "listo") {
    return emptyBlackRoomVideoStyleGuide("La guia de estilo de Robert todavia es una plantilla (docs/blackroom-video-style.md).");
  }
  if (!hasContent) return emptyBlackRoomVideoStyleGuide("La guia de estilo esta marcada como lista pero no tiene contenido.");
  return { ...guide, present: true, reason: "" };
}

export type BlackRoomStyleGuideReader = () => Promise<string | null>;

export function defaultBlackRoomStyleGuideReader(root = process.cwd()): BlackRoomStyleGuideReader {
  return async () => {
    try {
      return await readFile(path.resolve(root, BLACKROOM_VIDEO_STYLE_GUIDE_PATH), "utf8");
    } catch (error: any) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  };
}

export async function loadBlackRoomVideoStyleGuide(read: BlackRoomStyleGuideReader): Promise<BlackRoomVideoStyleGuide> {
  let markdown: string | null;
  try {
    markdown = await read();
  } catch (error) {
    return emptyBlackRoomVideoStyleGuide(`No pude leer la guia de estilo: ${error instanceof Error ? error.message.slice(0, 120) : "sin detalle"}.`);
  }
  if (markdown === null) return emptyBlackRoomVideoStyleGuide("No existe docs/blackroom-video-style.md.");
  return parseBlackRoomVideoStyleGuide(markdown);
}

/** True when the text contains a banned word/phrase from the guide (accent and case insensitive). */
export function violatesBlackRoomStyle(text: string, guide: BlackRoomVideoStyleGuide): boolean {
  if (!guide.banned.length) return false;
  const haystack = normalizeHeading(text);
  return guide.banned.some((term) => {
    const needle = normalizeHeading(term);
    return needle.length > 1 && haystack.includes(needle);
  });
}
