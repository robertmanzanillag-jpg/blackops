import assert from "node:assert/strict";
import test from "node:test";
import {
  ROOM_LABEL_MAX, defaultAgentLocations, defaultOfficeLayout, defaultOfficeRooms, mergeStoredLocations, mergeStoredRooms,
  moveOfficeAgent, officeRoomOf, parseStoredOffsets, renameOfficeRoom,
} from "../client/src/lib/office-layout";

test("stored office rooms keep the owner's names and boxes, ignore junk and unknown rooms", () => {
  // Exactly what the classic view saved: the whole room array.
  const saved = defaultOfficeRooms.map(room => (room.id === "kong" ? { ...room, label: "Sala KONG", x: 31 } : room));
  const rooms = mergeStoredRooms(JSON.stringify([...saved, { id: "ghost", label: "Fantasma", x: 1, y: 1, w: 1, h: 1 }]));
  assert.equal(rooms.length, defaultOfficeRooms.length);
  assert.deepEqual(rooms.find(room => room.id === "kong"), { id: "kong", label: "Sala KONG", x: 31, y: 19, w: 22, h: 45 });
  assert.ok(!rooms.some(room => room.id === "ghost"));
  assert.equal(mergeStoredRooms(JSON.stringify([{ id: "dev", label: "   ", x: "a" }])).find(room => room.id === "dev")?.label, "Dev + GitHub");
  assert.deepEqual(mergeStoredRooms("not json"), defaultOfficeRooms);
  assert.deepEqual(mergeStoredRooms(null), defaultOfficeRooms);
  assert.deepEqual(mergeStoredRooms('{"id":"dev"}'), defaultOfficeRooms);
});

test("stored seats and spots merge over the defaults; malformed values are dropped", () => {
  const locations = mergeStoredLocations(JSON.stringify({ code: "meeting", radio: "nowhere", github: 5 }));
  assert.equal(locations.code, "meeting");
  assert.equal(locations.radio, defaultAgentLocations.radio);
  assert.equal(locations.github, defaultAgentLocations.github);
  assert.deepEqual(mergeStoredLocations("{"), defaultAgentLocations);
  assert.deepEqual(parseStoredOffsets(JSON.stringify({ code: { x: 50, y: 40 }, radio: { x: "a", y: 1 }, ceo: null })), { code: { x: 50, y: 40 } });
  assert.deepEqual(parseStoredOffsets("[]"), {});
});

test("renaming a room trims, caps the length and falls back to the original name", () => {
  const rooms = renameOfficeRoom(defaultOfficeRooms, "ops", "  Operaciones   24/7 ");
  assert.equal(rooms.find(room => room.id === "ops")?.label, "Operaciones 24/7");
  assert.equal(renameOfficeRoom(rooms, "ops", "   ").find(room => room.id === "ops")?.label, "Ops");
  assert.equal(renameOfficeRoom(defaultOfficeRooms, "ops", "x".repeat(80)).find(room => room.id === "ops")?.label.length, ROOM_LABEL_MAX);
  assert.deepEqual(renameOfficeRoom(defaultOfficeRooms, "ops", "Nuevo").filter(room => room.id !== "ops"), defaultOfficeRooms.filter(room => room.id !== "ops"));
});

test("seating an agent sets its room and centres it, like the office card; unknown rooms are refused", () => {
  const layout = defaultOfficeLayout();
  const moved = moveOfficeAgent(layout, "code", "meeting");
  assert.equal(moved.locations.code, "meeting");
  assert.deepEqual(moved.offsets.code, { x: 50, y: 50 });
  assert.equal(officeRoomOf(moved, "code")?.label, "Meeting Room");
  assert.equal(layout.locations.code, "dev", "the previous layout is not mutated");
  assert.equal(moveOfficeAgent(layout, "code", "ghost"), layout);
  assert.equal(officeRoomOf(layout, "unknown-agent"), undefined);
});
