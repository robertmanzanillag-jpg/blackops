import { parseRoleWork as parseTrustedRoleWork } from "./office-role-work";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { sourceDigest, type RoleSnapshot } from "./office-role-snapshots";
export const ROLE_WORK_DEADLINE_ID = "office-role-work-reader-deadline-v1";
export const ROLE_WORK_DEADLINE_ASSERTIONS = ["deadline-respected", "unknown-without-proof", "next-role-completed", "late-reply-ignored", "restart-no-replay", "careers-unchanged"] as const;
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
/** A completed control audit requires a real synthetic record. Empty input is
 * correctly blocked by auditSavedRole and cannot prove next-role continuity. */
export function createDeadlineControlSnapshot(owner: string, now: number): RoleSnapshot {
    const body = { version: 1 as const, role: "control" as const, ownerKey: sourceDigest(owner), observedAt: new Date(now).toISOString(), total: 1,
        rows: [{ id: "deadline-control-fixture", scope: "fixture-read-only", level: "read_only", risk: "low", enabled: true }] };
    return { ...body, sourceDigest: sourceDigest(body) };
}
type Runtime = {
    createRoleWorkRunner: Function;
    parseRoleWork: Function;
};
/** The trusted controller measures the real default 60s lease. No short timeout
 * option is passed to candidate code. SQL and web cases run concurrently. */
export async function measureRoleWorkDeadline(runtime: Runtime) {
    const cases = await Promise.all((["sql", "web"] as const).map(async (reader) => {
        const owner = `deadline-${randomUUID()}`, role = reader === "sql" ? "legal" : "news", epoch = Date.now(), started = performance.now();
        let state: any = { roles: { version: 1, roles: { [role]: { generation: 1 }, control: { generation: 1 } } } }, reads = 0, laterReads = 0;
        const company: any = { careers: { [role]: { generation: 1, life: 100 }, control: { generation: 1, life: 100 } } }, companyHash = sourceDigest(company);
        let release!: (value: unknown) => void;
        const hanging = new Promise(resolve => { release = resolve; });
        let transaction: Promise<unknown> = Promise.resolve();
        const council = { updateOfficeExecution(change: Function) { const next = transaction.then(async () => { state = await change(structuredClone(state), company); return structuredClone(state); }); transaction = next.catch(() => { }); return next; } };
        const now = () => epoch + Math.floor(performance.now() - started);
        const source = (sourceRole: string) => {
            if (sourceRole === "control") return createDeadlineControlSnapshot(owner, now());
            const body = { version: 1, role: sourceRole, ownerKey: sourceDigest(owner), observedAt: new Date(now()).toISOString(), total: 0, rows: [] };
            return { ...body, sourceDigest: sourceDigest(body) };
        };
        const journal = async () => { const trusted = parseTrustedRoleWork(state.roleWork, owner), parsed = await runtime.parseRoleWork(state.roleWork, owner); if (sourceDigest(parsed) !== sourceDigest(trusted) || sourceDigest(parsed) !== sourceDigest(state.roleWork))
            throw Error("DEADLINE_JOURNAL_UNVERIFIED"); return parsed; };
        const options = { owner, council, now, clockMode: "elapsed", read: async (sourceRole: string) => { if (reader === "sql" && sourceRole === role) {
                reads++;
                return hanging;
            } if (sourceRole !== "control")
                throw Error("UNEXPECTED_ROLE"); laterReads++; return source(sourceRole); }, ...(reader === "web" ? { readWeb: async (sourceRole: string) => { if (sourceRole !== role)
                    throw Error("UNEXPECTED_WEB_ROLE"); reads++; return hanging; } } : {}) };
        const checks: Record<string, boolean> = Object.fromEntries(ROLE_WORK_DEADLINE_ASSERTIONS.map(id => [id, false]));
        let runner: any, tick: Promise<unknown> | undefined, watchdog: ReturnType<typeof setTimeout> | undefined, timedOut = false, elapsedMs = 0;
        try {
            runner = runtime.createRoleWorkRunner(options);
            tick = Promise.resolve(runner.tick());
            const completed = await Promise.race([tick.then(() => true), new Promise<boolean>(resolve => { watchdog = setTimeout(() => resolve(false), 68000); })]);
            clearTimeout(watchdog);
            elapsedMs = performance.now() - started;
            timedOut = !completed;
            const recorded = await journal(), first = recorded.jobs.find((j: any) => j.role === role), next = recorded.jobs.find((j: any) => j.role === "control");
            checks["deadline-respected"] = completed && reads === 1 && elapsedMs >= 58000 && elapsedMs < 68000;
            checks["unknown-without-proof"] = first?.status === "unknown" && !first.source && !first.webSource && !first.audit && !first.webAudit && !first.artifactId && !first.completedAt;
            checks["next-role-completed"] = laterReads === 1 && next?.status === "completed" && typeof next.artifactId === "string";
            const before = sourceDigest(recorded);
            release(reader === "web" ? null : source(role));
            await delay(100);
            checks["late-reply-ignored"] = completed && sourceDigest(await journal()) === before;
            if (completed) {
                await Promise.race([runtime.createRoleWorkRunner(options).tick(), delay(1000).then(() => { throw Error("REPLAY_TIMEOUT"); })]);
                checks["restart-no-replay"] = reads === 1 && laterReads === 1 && sourceDigest(await journal()) === before;
            }
            checks["careers-unchanged"] = sourceDigest(company) === companyHash;
        }
        catch { /* Only bounded controller assertions are reported. */ }
        finally {
            clearTimeout(watchdog);
            release(reader === "web" ? null : source(role));
            if (tick)
                await Promise.race([tick.catch(() => { }), delay(1000)]);
        }
        return { reader, passed: ROLE_WORK_DEADLINE_ASSERTIONS.every(id => checks[id]), timedOut, elapsedMs, assertions: ROLE_WORK_DEADLINE_ASSERTIONS.map(id => ({ id, passed: checks[id] })) };
    }));
    return { scenarioId: ROLE_WORK_DEADLINE_ID, passed: cases.every(c => c.passed), cases };
}
