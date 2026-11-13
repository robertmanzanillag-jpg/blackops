import assert from "node:assert/strict";
import test from "node:test";
import { createTelegramUpdateDeduper, shouldProcessTelegramUpdate } from "../server/telegram-webhook-dedupe";

test("deduplicates Telegram webhook updates by update_id", () => {
  const deduper = createTelegramUpdateDeduper();

  assert.equal(deduper.shouldProcess({ update_id: 100 }), true);
  assert.equal(deduper.shouldProcess({ update_id: 100 }), false);
  assert.equal(deduper.shouldProcess({ update_id: 101 }), true);
});

test("allows malformed Telegram webhook updates to flow through", () => {
  const deduper = createTelegramUpdateDeduper();

  assert.equal(deduper.shouldProcess({}), true);
  assert.equal(deduper.shouldProcess({ update_id: "100" }), true);
});

test("evicts old Telegram update ids when the dedupe window is full", () => {
  const deduper = createTelegramUpdateDeduper(2);

  assert.equal(deduper.shouldProcess({ update_id: 1 }), true);
  assert.equal(deduper.shouldProcess({ update_id: 2 }), true);
  assert.equal(deduper.shouldProcess({ update_id: 3 }), true);
  assert.equal(deduper.size(), 2);
  assert.equal(deduper.shouldProcess({ update_id: 1 }), true);
});

test("uses durable Telegram update recorder before in-memory dedupe", async () => {
  const recorded = new Set<number>();
  const memoryDeduper = createTelegramUpdateDeduper();
  const recorder = {
    async recordTelegramProcessedUpdate(updateId: number) {
      if (recorded.has(updateId)) return false;
      recorded.add(updateId);
      return true;
    },
  };

  assert.equal(await shouldProcessTelegramUpdate({ update_id: 100 }, recorder, memoryDeduper), true);
  assert.equal(await shouldProcessTelegramUpdate({ update_id: 100 }, recorder, memoryDeduper), false);
  assert.equal(memoryDeduper.size(), 0);
});

test("falls back to in-memory Telegram update dedupe when durable recorder fails", async () => {
  const memoryDeduper = createTelegramUpdateDeduper();
  const errors: unknown[] = [];
  const recorder = {
    async recordTelegramProcessedUpdate() {
      throw new Error("relation telegram_processed_updates does not exist");
    },
  };

  assert.equal(await shouldProcessTelegramUpdate({ update_id: 200 }, recorder, memoryDeduper, (error) => errors.push(error)), true);
  assert.equal(await shouldProcessTelegramUpdate({ update_id: 200 }, recorder, memoryDeduper, (error) => errors.push(error)), false);
  assert.equal(errors.length, 2);
});
