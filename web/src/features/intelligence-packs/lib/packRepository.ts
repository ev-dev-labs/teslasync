/**
 * Generic `PackRepository` implementation over a pluggable `KvStore`.
 *
 * Storage layout: three JSON blobs, one per logical table
 * (`installed`, `trust`, `audit`), each written atomically via a single
 * `KvStore.setItem` call. A per-repository operation queue serializes
 * read-modify-write cycles against a given table so concurrent calls (e.g.
 * two rapid clicks) cannot race and silently drop a write.
 *
 * NOTE on "atomicity": each table's blob is written in one `setItem` call,
 * so a single logical record (e.g. one `InstalledPackRecord`, including its
 * `previousVersions` history) is always written whole-or-not-at-all from
 * that table's point of view. Multi-table sequences (e.g. "install" also
 * appends an audit entry) are NOT cross-table transactional — this is a
 * single-user, client-side, local-first store, and full cross-table ACID
 * transactions would be significant complexity for no realistic benefit
 * here. This is a deliberate, documented limitation, not an oversight.
 */

import { MAX_AUDIT_LOG_ENTRIES, type AuditLogEntry } from './auditLog';
import { createMemoryKvStore, type KvStore } from './kvStore';
import type { SignedPackEnvelope } from './manifestTypes';
import type { TrustDecision } from './trust';
import type { VerificationResult } from './verifyEnvelope';

export interface PackVersionSnapshot {
  version: string;
  envelope: SignedPackEnvelope;
  verification: VerificationResult;
  archivedAtIso: string;
}

export interface InstalledPackRecord {
  packId: string;
  envelope: SignedPackEnvelope;
  verification: VerificationResult;
  enabled: boolean;
  installedAtIso: string;
  updatedAtIso: string;
  /** Rollback stack — most-recently-superseded version last. */
  previousVersions: PackVersionSnapshot[];
}

export const MAX_VERSION_HISTORY = 5;

export interface PackRepository {
  listInstalled(): Promise<InstalledPackRecord[]>;
  getInstalled(packId: string): Promise<InstalledPackRecord | null>;
  putInstalled(record: InstalledPackRecord): Promise<void>;
  removeInstalled(packId: string): Promise<void>;

  getTrustDecision(packId: string): Promise<TrustDecision | null>;
  putTrustDecision(decision: TrustDecision): Promise<void>;

  listAuditLog(limit?: number): Promise<AuditLogEntry[]>;
  appendAuditLog(entry: AuditLogEntry): Promise<void>;

  /** Test/dev convenience — wipes all three tables. */
  clearAll(): Promise<void>;
}

const KEYS = { installed: 'installed', trust: 'trust', audit: 'audit' } as const;

function safeJsonParseArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/** Serializes async callbacks per named lane so concurrent read-modify-write calls on the same table never interleave. */
function createLaneQueue() {
  const lanes = new Map<string, Promise<unknown>>();
  return function withLane<T>(lane: string, fn: () => Promise<T>): Promise<T> {
    const previous = lanes.get(lane) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    // Swallow rejections in the chain itself (not in the returned promise)
    // so one failed operation doesn't permanently wedge the lane for every
    // operation queued after it.
    lanes.set(
      lane,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  };
}

export function createPackRepository(kv: KvStore): PackRepository {
  const withLane = createLaneQueue();

  const listInstalled = () =>
    withLane('installed', async () => safeJsonParseArray<InstalledPackRecord>(await kv.getItem(KEYS.installed)));

  return {
    listInstalled,

    async getInstalled(packId) {
      const all = await listInstalled();
      return all.find((r) => r.packId === packId) ?? null;
    },

    putInstalled(record) {
      return withLane('installed', async () => {
        const all = safeJsonParseArray<InstalledPackRecord>(await kv.getItem(KEYS.installed));
        const idx = all.findIndex((r) => r.packId === record.packId);
        if (idx >= 0) all[idx] = record;
        else all.push(record);
        await kv.setItem(KEYS.installed, JSON.stringify(all));
      });
    },

    removeInstalled(packId) {
      return withLane('installed', async () => {
        const all = safeJsonParseArray<InstalledPackRecord>(await kv.getItem(KEYS.installed));
        await kv.setItem(KEYS.installed, JSON.stringify(all.filter((r) => r.packId !== packId)));
      });
    },

    async getTrustDecision(packId) {
      const all = await withLane('trust', async () => safeJsonParseArray<TrustDecision>(await kv.getItem(KEYS.trust)));
      return all.find((d) => d.packId === packId) ?? null;
    },

    putTrustDecision(decision) {
      return withLane('trust', async () => {
        const all = safeJsonParseArray<TrustDecision>(await kv.getItem(KEYS.trust));
        const idx = all.findIndex((d) => d.packId === decision.packId);
        if (idx >= 0) all[idx] = decision;
        else all.push(decision);
        await kv.setItem(KEYS.trust, JSON.stringify(all));
      });
    },

    listAuditLog(limit) {
      return withLane('audit', async () => {
        const all = safeJsonParseArray<AuditLogEntry>(await kv.getItem(KEYS.audit));
        const sorted = [...all].sort((a, b) => b.timestampIso.localeCompare(a.timestampIso));
        return typeof limit === 'number' ? sorted.slice(0, limit) : sorted;
      });
    },

    appendAuditLog(entry) {
      return withLane('audit', async () => {
        const all = safeJsonParseArray<AuditLogEntry>(await kv.getItem(KEYS.audit));
        all.push(entry);
        const trimmed = all.length > MAX_AUDIT_LOG_ENTRIES ? all.slice(all.length - MAX_AUDIT_LOG_ENTRIES) : all;
        await kv.setItem(KEYS.audit, JSON.stringify(trimmed));
      });
    },

    async clearAll() {
      await Promise.all([kv.removeItem(KEYS.installed), kv.removeItem(KEYS.trust), kv.removeItem(KEYS.audit)]);
    },
  };
}

/** Convenience: the in-memory test adapter, ready to use with no setup. */
export function createInMemoryPackRepository(): PackRepository {
  return createPackRepository(createMemoryKvStore());
}
