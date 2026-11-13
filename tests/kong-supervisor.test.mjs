import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyKongSupervision, parseKongSupervision, reviewKongReadiness } from '../shared/kong-supervisor.ts';
const now = Date.parse('2026-11-05T00:00:00Z');
test('missing backends remain blocked even if callers invent a working status', () => {
  const result = reviewKongReadiness(emptyKongSupervision(), { 'kong:KONG AI': { state: 'working' } }, now);
  assert.equal(result.records.length, 5);
  assert.ok(result.records.every(record => record.result === 'blocked'));
});
test('only a fresh supplied video status can complete the readiness task', () => {
  const result = reviewKongReadiness(emptyKongSupervision(), { 'kong-videos': { state: 'working' } }, now);
  assert.equal(result.records[0].result, 'completed');
  assert.match(result.records[0].reason, /No se produjo ni publico/);
  assert.ok(result.records.slice(1).every(record => record.result === 'blocked'));
});
test('missing content is a dependency, not an agent failure; reader errors are failures', () => {
  for (const state of ['needs-setup', 'checking', 'offline', 'new-unknown-state']) assert.equal(reviewKongReadiness(emptyKongSupervision(), { 'kong-videos': { state } }, now).records[0].result, 'blocked');
  for (const state of ['error']) assert.equal(reviewKongReadiness(emptyKongSupervision(), { 'kong-videos': { state } }, now).records[0].result, 'failed');
});
test('history is bounded and input state is unchanged', () => {
  const before = emptyKongSupervision();
  let state = before;
  for (let n = 0; n < 50; n++) state = reviewKongReadiness(state, {}, now + n);
  assert.equal(state.records.length, 50);
  assert.deepEqual(before, emptyKongSupervision());
  assert.deepEqual(parseKongSupervision(JSON.parse(JSON.stringify(state))), state);
});
test('old council state and corrupt records recover without claiming work', () => {
  assert.deepEqual(parseKongSupervision(undefined), emptyKongSupervision());
  const parsed = parseKongSupervision({ version: 1, records: [null, {}, { agentId: 'outsider', task: 'review-readiness', result: 'completed', reason: 'yes', checkedAt: new Date(now).toISOString() }] });
  assert.deepEqual(parsed.records, []);
  assert.equal(parsed.lastRunAt, null);
});
