import assert from "node:assert/strict";
import test from "node:test";
import { parseRadioDescription } from "../shared/radio-slots";

test("production empty headings never become DJ names", () => {
  for (const description of ["7: \n8:\n9:", "7: 8: 9:", "7:&nbsp;<br>8:<br>9:", null]) {
    assert.deepEqual(parseRadioDescription(description), { slot7: null, slot8: null, slot9: null });
  }
});

test("retains assigned DJs next to empty slots", () => {
  assert.deepEqual(parseRadioDescription("7: Lucia Reina\n8:\n9: N1T0"), {
    slot7: "Lucia Reina", slot8: null, slot9: "N1T0",
  });
  assert.deepEqual(parseRadioDescription("7:00 pm - Lucia 8 p.m. — TBA 9. Dani"), {
    slot7: "Lucia", slot8: null, slot9: "Dani",
  });
});

test("numeric DJ names are not slot headings", () => {
  assert.deepEqual(parseRadioDescription("7: DJ 808\n8: 808State\n9: N1T0"), {
    slot7: "DJ 808", slot8: "808State", slot9: "N1T0",
  });
});

test("compact meridiem headings remain supported", () => {
  assert.deepEqual(parseRadioDescription("7pm: Lucia 8p.m.: TBA 9pm: Dani"), {
    slot7: "Lucia", slot8: null, slot9: "Dani",
  });
});
