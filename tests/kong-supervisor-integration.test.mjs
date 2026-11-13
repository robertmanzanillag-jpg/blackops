import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentCouncil } from '../server/agent-council.ts';

test('council cycle persists and reloads readiness review without scoring unconnected roles', async () => {
  let raw = null;
  const deps = {
    now: () => Date.parse('2026-11-05T00:00:00Z'),
    userId: () => 'test-owner',
    readState: async () => raw,
    writeState: async value => { raw = value; },
    collect: async () => ({}),
    collectStatuses: async () => ({ 'kong-videos': { state: 'offline', label: 'Contenido desactualizado', detail: 'Entrega antigua' } }),
    submitProposal: async () => { throw new Error('No proposals expected'); },
    getPendingActionStatus: async () => null,
    fetchLatestRelease: async () => null,
    log: () => {},
  };
  const council = createAgentCouncil(deps);
  const state = await council.runCycle();
  assert.equal(state.lastCycleError, null);
  assert.equal(state.kongSupervision.records.length, 5);
  assert.equal(state.kongSupervision.records[0].result, 'blocked');
  assert.equal(state.company.careers['kong:KONG AI'], undefined);
  const reloaded = await createAgentCouncil(deps).view();
  // The public council view carries the readiness records but never the owner-only conversation.
  const { messages, ...publicPart } = state.kongSupervision;
  assert.deepEqual(reloaded.kongSupervision, publicPart);
  assert.equal(reloaded.kongSupervision.messages, undefined);
  assert.equal(JSON.parse(raw).kongSupervision.owner, 'kong-supervisor');
});
