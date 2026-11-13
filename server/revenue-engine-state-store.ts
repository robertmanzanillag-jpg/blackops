import { and, eq, sql } from "drizzle-orm";
import { revenueEngineState } from "@shared/schema";

export interface RevenueEngineStateCollection<T = unknown> {
  ownerUserId: string;
  kind: string;
  data: T;
  revision: number;
  updatedAt: Date;
}

export interface RevenueEngineStateUpsert<T = unknown> {
  ownerUserId: string;
  kind: string;
  data: T;
}

export interface RevenueEngineStateWrite<T = unknown> extends RevenueEngineStateUpsert<T> {
  expectedRevision?: number;
  updatedAt: Date;
}

export interface RevenueEngineStateAdapter {
  initialize(): Promise<void>;
  loadCollections(ownerUserId: string): Promise<RevenueEngineStateCollection[]>;
  upsertCollection(input: RevenueEngineStateWrite): Promise<RevenueEngineStateCollection>;
  health?(): Promise<void>;
}

export interface RevenueEngineStateStoreHealth {
  status: "ready" | "error";
  initialized: boolean;
  pendingWrites: number;
  error?: string;
}

type RevenueEngineDatabase = typeof import("./db").db;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireKey(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

export function createDrizzleRevenueEngineStateAdapter(
  database: RevenueEngineDatabase,
): RevenueEngineStateAdapter {
  return {
    async initialize() {
      await database.execute(sql`
        CREATE TABLE IF NOT EXISTS revenue_engine_state (
          owner_user_id varchar NOT NULL,
          kind text NOT NULL,
          data jsonb NOT NULL,
          revision integer NOT NULL DEFAULT 1,
          updated_at timestamp NOT NULL DEFAULT now(),
          PRIMARY KEY (owner_user_id, kind)
        )
      `);
      await database.execute(sql`
        ALTER TABLE revenue_engine_state
        ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1
      `);
    },

    async loadCollections(ownerUserId) {
      return database
        .select()
        .from(revenueEngineState)
        .where(eq(revenueEngineState.ownerUserId, ownerUserId));
    },

    async upsertCollection(input) {
      const [row] = input.expectedRevision === undefined
        ? await database
          .insert(revenueEngineState)
          .values({
            ownerUserId: input.ownerUserId,
            kind: input.kind,
            data: input.data,
            revision: 1,
            updatedAt: input.updatedAt,
          })
          .onConflictDoNothing()
          .returning()
        : await database
          .update(revenueEngineState)
          .set({
            data: input.data,
            revision: input.expectedRevision + 1,
            updatedAt: input.updatedAt,
          })
          .where(and(
            eq(revenueEngineState.ownerUserId, input.ownerUserId),
            eq(revenueEngineState.kind, input.kind),
            eq(revenueEngineState.revision, input.expectedRevision),
          ))
          .returning();

      if (!row) {
        throw new Error(`Revenue Engine state conflict for ${input.ownerUserId}/${input.kind}; reload before retrying`);
      }
      return row;
    },

    async health() {
      await database.execute(sql`SELECT 1`);
    },
  };
}

async function loadDefaultAdapter(): Promise<RevenueEngineStateAdapter> {
  const { db } = await import("./db");
  return createDrizzleRevenueEngineStateAdapter(db);
}

export class RevenueEngineStateStore {
  private adapterPromise?: Promise<RevenueEngineStateAdapter>;
  private readonly adapterInput?: RevenueEngineStateAdapter | Promise<RevenueEngineStateAdapter>;
  private initializationPromise?: Promise<void>;
  private writeQueue: Promise<void> = Promise.resolve();
  private initialized = false;
  private pendingWrites = 0;
  private lastError?: string;
  private writeErrors: string[] = [];
  private revisions = new Map<string, number>();

  constructor(adapter?: RevenueEngineStateAdapter | Promise<RevenueEngineStateAdapter>) {
    this.adapterInput = adapter;
  }

  private getAdapter(): Promise<RevenueEngineStateAdapter> {
    this.adapterPromise ??= Promise.resolve(this.adapterInput ?? loadDefaultAdapter());
    return this.adapterPromise;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializationPromise) return this.initializationPromise;

    const attempt = this.getAdapter()
      .then((adapter) => adapter.initialize())
      .then(() => {
        this.initialized = true;
        this.lastError = undefined;
      })
      .catch((error: unknown) => {
        this.lastError = errorMessage(error);
        this.initializationPromise = undefined;
        throw error;
      });

    this.initializationPromise = attempt;
    return attempt;
  }

  async loadCollections<T = unknown>(ownerUserId: string): Promise<Array<RevenueEngineStateCollection<T>>> {
    const normalizedOwnerUserId = requireKey(ownerUserId, "ownerUserId");
    await this.writeQueue;
    await this.initialize();

    try {
      const adapter = await this.getAdapter();
      const rows = await adapter.loadCollections(normalizedOwnerUserId);
      for (const row of rows) {
        this.revisions.set(`${row.ownerUserId}:${row.kind}`, row.revision);
      }
      this.lastError = undefined;
      return rows as Array<RevenueEngineStateCollection<T>>;
    } catch (error) {
      this.lastError = errorMessage(error);
      throw error;
    }
  }

  upsertCollection<T = unknown>(input: RevenueEngineStateUpsert<T>): Promise<RevenueEngineStateCollection<T>> {
    const normalizedInput: RevenueEngineStateUpsert<T> & { updatedAt: Date } = {
      ownerUserId: requireKey(input.ownerUserId, "ownerUserId"),
      kind: requireKey(input.kind, "kind"),
      data: input.data,
      updatedAt: new Date(),
    };

    this.pendingWrites += 1;
    const operation = this.writeQueue.then(async () => {
      await this.initialize();
      const adapter = await this.getAdapter();
      const revisionKey = `${normalizedInput.ownerUserId}:${normalizedInput.kind}`;
      const row = await adapter.upsertCollection({
        ...normalizedInput,
        expectedRevision: this.revisions.get(revisionKey),
      }) as RevenueEngineStateCollection<T>;
      this.revisions.set(revisionKey, row.revision);
      return row;
    });

    this.writeQueue = operation.then(
      () => {
        this.pendingWrites -= 1;
        this.lastError = undefined;
      },
      (error: unknown) => {
        this.pendingWrites -= 1;
        this.lastError = errorMessage(error);
        this.writeErrors.push(this.lastError);
      },
    );

    return operation;
  }

  async flush(): Promise<void> {
    await this.writeQueue;
    if (this.writeErrors.length > 0) {
      const errors = this.writeErrors.splice(0, this.writeErrors.length);
      throw new Error(`Revenue Engine durable write failed: ${errors.join("; ")}`);
    }
  }

  async health(): Promise<RevenueEngineStateStoreHealth> {
    try {
      await this.flush();
      await this.initialize();
      const adapter = await this.getAdapter();
      await adapter.health?.();
      this.lastError = undefined;
      return {
        status: "ready",
        initialized: this.initialized,
        pendingWrites: this.pendingWrites,
      };
    } catch (error) {
      this.lastError = errorMessage(error);
      return {
        status: "error",
        initialized: this.initialized,
        pendingWrites: this.pendingWrites,
        error: this.lastError,
      };
    }
  }
}

export function createRevenueEngineStateStore(
  adapter?: RevenueEngineStateAdapter | Promise<RevenueEngineStateAdapter>,
): RevenueEngineStateStore {
  return new RevenueEngineStateStore(adapter);
}
