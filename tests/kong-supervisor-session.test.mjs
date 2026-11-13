import test from 'node:test';
import assert from 'node:assert/strict';
import { kongSupervisorSessionScope } from '../client/src/components/kong-supervisor-session.ts';
const owner = { authenticated: true, user: { id: 'owner' } };
const other = { authenticated: true, user: { id: 'other' } };
test('cached private state is scoped to a fresh matching authenticated session', () => {
  assert.equal(kongSupervisorSessionScope(owner, owner, false, false), 'owner');
  assert.equal(kongSupervisorSessionScope(other, owner, false, false), null);
  assert.equal(kongSupervisorSessionScope(owner, other, false, false), null);
  assert.equal(kongSupervisorSessionScope(other, other, false, false), 'other');
});
test('logout and session revalidation immediately hide private cached state', () => {
  assert.equal(kongSupervisorSessionScope({ authenticated: false }, owner, false, false), null);
  assert.equal(kongSupervisorSessionScope(owner, owner, true, false), null);
  assert.equal(kongSupervisorSessionScope(owner, owner, false, true), null);
  assert.equal(kongSupervisorSessionScope(undefined, owner, false, false), null);
  assert.equal(kongSupervisorSessionScope(owner, undefined, false, false), null);
});
test('retained success data cannot reopen the gate after a failed session revalidation', () => {
  assert.equal(kongSupervisorSessionScope(owner, owner, false, false), 'owner');
  assert.equal(kongSupervisorSessionScope(owner, owner, false, true), null);
  // Query caches retain data when the refresh fails; the error flag must win.
  assert.equal(kongSupervisorSessionScope(owner, owner, false, false, true), null);
  assert.equal(kongSupervisorSessionScope(owner, owner, false, false, false, true), null);
});
