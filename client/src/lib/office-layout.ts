import { ownerOfficeStorageKey } from "@/lib/owner-office-storage";

// Owner's office layout: room names (and their box on the old 2D map), which room each BlackOps
// agent sits in, and its spot inside that room. It has always lived only in this browser's
// localStorage, one copy per owner (keys below, suffixed by ownerOfficeStorageKey); there is no
// server copy. The 3D office reads it for the agent card ("Área", "Caminar a…", room chips) and the
// central panel edits it. Storage can be unavailable (private mode, blocked site data): every
// access is guarded and the layout then lasts for this visit only.

export type OfficeRoom = { id: string; label: string; x: number; y: number; w: number; h: number };
export type OfficeAgentLocations = Record<string, string>;
export type OfficeAgentOffsets = Record<string, { x: number; y: number }>;
export type OfficeLayout = { rooms: OfficeRoom[]; locations: OfficeAgentLocations; offsets: OfficeAgentOffsets };

export const OFFICE_LAYOUT_KEY = "agentsOffice.roomLayout.v1";
export const OFFICE_AGENT_LOCATIONS_KEY = "agentsOffice.agentLocations.v1";
export const OFFICE_AGENT_OFFSETS_KEY = "agentsOffice.agentOffsets.v1";
export const ROOM_LABEL_MAX = 40;

export const defaultOfficeRooms: OfficeRoom[] = [
  { id: "reception", label: "Recepcion", x: 10, y: 19, w: 18, h: 29 },
  { id: "kong", label: "Kong", x: 29, y: 19, w: 22, h: 45 },
  { id: "deals", label: "Deals + Websites", x: 54, y: 27, w: 10, h: 29 },
  { id: "dev", label: "Dev + GitHub", x: 65, y: 19, w: 25, h: 43 },
  { id: "finance", label: "Finance", x: 10, y: 52, w: 18, h: 25 },
  { id: "dropshipping-lab", label: "Dropshipping Lab", x: 46, y: 58, w: 18, h: 20 },
  { id: "marketing-hq", label: "Marketing HQ", x: 65, y: 52, w: 15, h: 11 },
  { id: "meeting", label: "Meeting Room", x: 31, y: 65, w: 14, h: 17 },
  { id: "ops", label: "Ops", x: 10, y: 82, w: 18, h: 13 },
  { id: "black-room", label: "Black Room", x: 30, y: 84, w: 13, h: 12 },
  { id: "clippers", label: "Clippers", x: 68, y: 65, w: 12, h: 17 },
  { id: "security", label: "Cybersecurity", x: 82, y: 65, w: 12, h: 17 },
  { id: "legal", label: "Legal", x: 82, y: 84, w: 10, h: 12 },
  { id: "break-room", label: "Break Room", x: 45, y: 84, w: 24, h: 12 },
];

export const defaultAgentLocations: OfficeAgentLocations = {
  assistant: "reception",
  ceo: "kong",
  revenue: "deals",
  dropshipping: "dropshipping-lab",
  "marketing-cmo": "marketing-hq",
  code: "dev",
  github: "dev",
  "claude-reviewer": "dev",
  portfolio: "finance",
  radio: "black-room",
  clippers: "clippers",
  automations: "ops",
  cybersecurity: "security",
  "app-qa": "dev",
  legal: "legal",
  control: "security",
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const roomIds = new Set(defaultOfficeRooms.map(room => room.id));

function parseJson(raw: string | null): unknown {
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}

/** Stored rooms over the defaults: only known rooms, only valid fields (pure; tested). */
export function mergeStoredRooms(raw: string | null): OfficeRoom[] {
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) return defaultOfficeRooms;
  const byId = new Map<string, Record<string, unknown>>();
  for (const item of parsed) if (isRecord(item) && typeof item.id === "string") byId.set(item.id, item);
  return defaultOfficeRooms.map(room => {
    const stored = byId.get(room.id);
    if (!stored) return room;
    const label = typeof stored.label === "string" && stored.label.trim() ? stored.label.trim().slice(0, ROOM_LABEL_MAX) : room.label;
    const num = (key: "x" | "y" | "w" | "h") => (typeof stored[key] === "number" && Number.isFinite(stored[key]) ? (stored[key] as number) : room[key]);
    return { ...room, label, x: num("x"), y: num("y"), w: num("w"), h: num("h") };
  });
}

/** Stored agent → room choices over the defaults; unknown rooms are ignored (pure; tested). */
export function mergeStoredLocations(raw: string | null): OfficeAgentLocations {
  const parsed = parseJson(raw);
  const next: OfficeAgentLocations = { ...defaultAgentLocations };
  if (!isRecord(parsed)) return next;
  for (const [agentId, roomId] of Object.entries(parsed)) if (typeof roomId === "string" && roomIds.has(roomId)) next[agentId] = roomId;
  return next;
}

/** Stored spots inside rooms (percent of the room box); malformed entries are dropped (pure; tested). */
export function parseStoredOffsets(raw: string | null): OfficeAgentOffsets {
  const parsed = parseJson(raw);
  const next: OfficeAgentOffsets = {};
  if (!isRecord(parsed)) return next;
  for (const [agentId, value] of Object.entries(parsed)) {
    if (isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y)) next[agentId] = { x: Number(value.x), y: Number(value.y) };
  }
  return next;
}

/** Renames a room; an empty name puts the default name back (pure; tested). */
export function renameOfficeRoom(rooms: OfficeRoom[], roomId: string, label: string): OfficeRoom[] {
  const clean = label.replace(/\s+/g, " ").trim().slice(0, ROOM_LABEL_MAX);
  const fallback = defaultOfficeRooms.find(room => room.id === roomId)?.label ?? roomId;
  return rooms.map(room => (room.id === roomId ? { ...room, label: clean || fallback } : room));
}

/** Seats an agent in a room, centred like "Caminar a…" in the office card (pure; tested). */
export function moveOfficeAgent(layout: OfficeLayout, agentId: string, roomId: string): OfficeLayout {
  if (!layout.rooms.some(room => room.id === roomId)) return layout;
  return { ...layout, locations: { ...layout.locations, [agentId]: roomId }, offsets: { ...layout.offsets, [agentId]: { x: 50, y: 50 } } };
}

export function defaultOfficeLayout(): OfficeLayout {
  return { rooms: defaultOfficeRooms, locations: { ...defaultAgentLocations }, offsets: {} };
}

export function officeRoomOf(layout: OfficeLayout, agentId: string): OfficeRoom | undefined {
  const roomId = layout.locations[agentId] || defaultAgentLocations[agentId];
  return layout.rooms.find(room => room.id === roomId);
}

const keysFor = (ownerId: string) => ({
  rooms: ownerOfficeStorageKey(OFFICE_LAYOUT_KEY, ownerId),
  locations: ownerOfficeStorageKey(OFFICE_AGENT_LOCATIONS_KEY, ownerId),
  offsets: ownerOfficeStorageKey(OFFICE_AGENT_OFFSETS_KEY, ownerId),
});

function readKey(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeKey(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* Kept in memory for this visit only. */ }
}

export function loadOfficeLayout(ownerId: string): OfficeLayout {
  if (typeof window === "undefined") return defaultOfficeLayout();
  const keys = keysFor(ownerId);
  return { rooms: mergeStoredRooms(readKey(keys.rooms)), locations: mergeStoredLocations(readKey(keys.locations)), offsets: parseStoredOffsets(readKey(keys.offsets)) };
}

export function saveOfficeRooms(ownerId: string, rooms: OfficeRoom[]) { writeKey(keysFor(ownerId).rooms, rooms); }
export function saveOfficeLocations(ownerId: string, locations: OfficeAgentLocations) { writeKey(keysFor(ownerId).locations, locations); }
export function saveOfficeOffsets(ownerId: string, offsets: OfficeAgentOffsets) { writeKey(keysFor(ownerId).offsets, offsets); }
export function saveOfficeLayout(ownerId: string, layout: OfficeLayout) {
  saveOfficeRooms(ownerId, layout.rooms);
  saveOfficeLocations(ownerId, layout.locations);
  saveOfficeOffsets(ownerId, layout.offsets);
}
