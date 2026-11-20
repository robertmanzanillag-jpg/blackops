import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { createPendingActionsQueue, STREAMER_APPROVAL_ACTION } from '../script/clippers-streamer-discovery.mjs';

const exec = promisify(execFile);
const bin = process.env.FACTORY_TEST_POSTGRES_BIN || '/opt/homebrew/opt/postgresql@16/bin';
// Private throwaway database on a Unix socket; no production connection string is read.
test('streamer approval rows: idempotent insert and takedown rejection on real PostgreSQL', { timeout: 120000 }, async t => {
  try { await access(path.join(bin, 'initdb')); } catch { t.skip('PostgreSQL tools not installed (set FACTORY_TEST_POSTGRES_BIN).'); return; }
  if (process.getuid?.() === 0) { t.skip('initdb refuses to run as root.'); return; }
  const root = await mkdtemp(path.join(os.tmpdir(), 'spg-')), data = path.join(root, 'data');
  const env = { PATH: `${bin}:/usr/bin:/bin`, LANG: 'C', LC_ALL: 'C' };
  let started = false, pool: Pool | undefined;
  try {
    await exec(path.join(bin, 'initdb'), ['-D', data, '-U', 'fixture', '--auth=trust', '--no-locale', '--encoding=UTF8'], { env, timeout: 30000 });
    await exec(path.join(bin, 'pg_ctl'), ['-D', data, '-l', path.join(root, 'pg.log'), '-o', `-F -h '' -k '${root}' -p 55447`, '-w', 'start'], { env, timeout: 30000 }); started = true;
    pool = new Pool({ host: root, port: 55447, user: 'fixture', database: 'postgres', max: 4 });
    // Same columns as shared/schema.ts pendingActions.
    await pool.query(`CREATE TABLE pending_actions (id varchar PRIMARY KEY DEFAULT gen_random_uuid(), user_id varchar NOT NULL, created_by_actor_type text NOT NULL, created_by_actor_id text,
      origin text NOT NULL, action_type text NOT NULL, resource_type text NOT NULL, resource_id text, title text NOT NULL, description text NOT NULL, risk_level text NOT NULL DEFAULT 'medium',
      permission_level_required text NOT NULL DEFAULT 'execute_after_approval', status text NOT NULL DEFAULT 'pending', input jsonb, proposed_changes jsonb, edited_input jsonb, execution_result jsonb,
      approval_reason text, rejection_reason text, snoozed_until timestamp, expires_at timestamp, approved_by varchar, approved_at timestamp, executed_at timestamp,
      created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now())`);
    const q = createPendingActionsQueue((sql, values) => pool!.query(sql, values as unknown[]));
    const row = { userId: 'o', actionType: STREAMER_APPROVAL_ACTION, resourceType: 'clippers_streamer_candidate', resourceId: 'twitch-clip:a', title: 't', description: 'd', riskLevel: 'medium', status: 'pending', input: { a: 1 } };
    const a = await q.insert(row), b = await q.insert(row);
    assert.equal(a, b);
    assert.equal((await pool.query('SELECT count(*)::int n FROM pending_actions')).rows[0].n, 1);
    assert.equal(await q.rejectCandidates('o', ['twitch-clip:a'], 'takedown'), 1);
    assert.equal((await pool.query('SELECT status, rejection_reason FROM pending_actions WHERE id=$1', [a])).rows[0].rejection_reason, 'takedown');
    const c = await q.insert(row);
    assert.notEqual(c, a, 'a rejected row is not reused');
    assert.equal(await q.rejectCandidates('other-owner', ['twitch-clip:a'], 'takedown'), 0);
    // Concurrent runs (separate connections) never create two live rows for one candidate.
    const transaction = async <T>(fn: (q: (sql: string, v?: unknown[]) => Promise<{ rows: any[] }>) => Promise<T>) => {
      const client = await pool!.connect();
      try { await client.query('BEGIN'); const out = await fn((sql, v) => client.query(sql, v as unknown[])); await client.query('COMMIT'); return out; }
      catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; } finally { client.release(); }
    };
    const tq = createPendingActionsQueue((sql, values) => pool!.query(sql, values as unknown[]), { transaction });
    const raced = { ...row, resourceId: 'twitch-clip:race' };
    const ids = await Promise.all([tq.insert(raced), tq.insert(raced), tq.insert(raced), tq.insert(raced)]);
    assert.equal(new Set(ids).size, 1);
    assert.equal((await pool.query("SELECT count(*)::int n FROM pending_actions WHERE resource_id='twitch-clip:race'")).rows[0].n, 1);
  } finally {
    await pool?.end().catch(() => undefined);
    if (started) await exec(path.join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { env, timeout: 15000 }).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
