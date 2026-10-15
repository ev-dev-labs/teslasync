import { describe, it, expect, vi } from 'vitest';
import { createInMemoryPackRepository, createPackRepository, type InstalledPackRecord } from '../packRepository';
import { createMemoryKvStore } from '../kvStore';
import { buildAuditEntry, MAX_AUDIT_LOG_ENTRIES } from '../auditLog';
import { EFFICIENCY_INSIGHTS_ENVELOPE, COMMUNITY_DRAFT_ENVELOPE } from '../catalogFixtures';
import type { VerificationResult } from '../verifyEnvelope';
import type { TrustDecision } from '../trust';

const dummyVerification: VerificationResult = {
  status: 'signature-valid',
  recomputedDigestSha256Hex: 'a'.repeat(64),
  recomputedPublisherFingerprint: 'b'.repeat(64),
  claimedFingerprintMismatch: false,
  recognizedPublisherName: 'Test Publisher',
  summary: 'ok',
};

describe('createPackRepository — storage failures', () => {
  it.each(['installed', 'trust', 'audit'] as const)('rejects corrupt %s reads and mutations without overwriting data', async (table) => {
    for (const raw of ['', '{broken', '{}', 'null']) {
      const kv = createMemoryKvStore();
      await kv.setItem(table, raw);
      const repo = createPackRepository(kv);
      const read = () => table === 'installed' ? repo.listInstalled()
        : table === 'trust' ? repo.getTrustDecision('p') : repo.listAuditLog();
      const write = () => table === 'installed' ? repo.putInstalled(makeRecord())
        : table === 'trust' ? repo.putTrustDecision({
          packId: 'p', decision: 'blocked', publisherFingerprint: null,
          decidedAtIso: 'now', approvedCapabilities: [],
        }) : repo.appendAuditLog(buildAuditEntry({ packId: 'p', packName: 'P', action: 'install', detail: 'd' }));
      await expect(read()).rejects.toThrow();
      await expect(write()).rejects.toThrow();
      expect(await kv.getItem(table)).toBe(raw);
    }
  });

  it('propagates read, write and removal failures and recovers the operation lane', async () => {
    const kv = createMemoryKvStore();
    const repo = createPackRepository(kv);
    const record = makeRecord();
    await repo.putInstalled(record);
    const error = new Error('Storage unavailable');
    vi.spyOn(kv, 'getItem').mockRejectedValueOnce(error);
    await expect(repo.listInstalled()).rejects.toBe(error);
    vi.spyOn(kv, 'setItem').mockRejectedValueOnce(error);
    await expect(repo.putInstalled({ ...record, enabled: true })).rejects.toBe(error);
    expect(await repo.getInstalled(record.packId)).toEqual(record);
    await repo.putInstalled({ ...record, enabled: true });
    expect((await repo.getInstalled(record.packId))?.enabled).toBe(true);
    vi.spyOn(kv, 'removeItem').mockRejectedValueOnce(error);
    await expect(repo.clearAll()).rejects.toBe(error);
    expect((await repo.getInstalled(record.packId))?.enabled).toBe(true);
  });
});

function makeRecord(overrides: Partial<InstalledPackRecord> = {}): InstalledPackRecord {
  return {
    packId: EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id,
    envelope: EFFICIENCY_INSIGHTS_ENVELOPE,
    verification: dummyVerification,
    enabled: false,
    installedAtIso: '2024-01-01T00:00:00.000Z',
    updatedAtIso: '2024-01-01T00:00:00.000Z',
    previousVersions: [],
    ...overrides,
  };
}

describe('createInMemoryPackRepository — installed packs CRUD', () => {
  it('starts empty', async () => {
    const repo = createInMemoryPackRepository();
    expect(await repo.listInstalled()).toEqual([]);
    expect(await repo.getInstalled('nonexistent')).toBeNull();
  });

  it('put then get round-trips a record', async () => {
    const repo = createInMemoryPackRepository();
    const record = makeRecord();
    await repo.putInstalled(record);
    const fetched = await repo.getInstalled(record.packId);
    expect(fetched).toEqual(record);
  });

  it('put overwrites an existing record with the same packId (no duplicates)', async () => {
    const repo = createInMemoryPackRepository();
    await repo.putInstalled(makeRecord({ enabled: false }));
    await repo.putInstalled(makeRecord({ enabled: true }));
    const all = await repo.listInstalled();
    expect(all).toHaveLength(1);
    expect(all[0].enabled).toBe(true);
  });

  it('removeInstalled deletes the record', async () => {
    const repo = createInMemoryPackRepository();
    const record = makeRecord();
    await repo.putInstalled(record);
    await repo.removeInstalled(record.packId);
    expect(await repo.getInstalled(record.packId)).toBeNull();
  });

  it('persists multiple distinct packs independently', async () => {
    const repo = createInMemoryPackRepository();
    await repo.putInstalled(makeRecord({ packId: 'pack-a' }));
    await repo.putInstalled(makeRecord({ packId: 'pack-b' }));
    expect(await repo.listInstalled()).toHaveLength(2);
  });
});

describe('createInMemoryPackRepository — trust decisions', () => {
  it('returns null for a pack with no trust decision', async () => {
    const repo = createInMemoryPackRepository();
    expect(await repo.getTrustDecision('unknown')).toBeNull();
  });

  it('put then get round-trips a trust decision', async () => {
    const repo = createInMemoryPackRepository();
    const decision: TrustDecision = {
      packId: 'pack-a',
      decision: 'trusted-signed-recognized',
      publisherFingerprint: 'a'.repeat(64),
      decidedAtIso: '2024-01-01T00:00:00.000Z',
      approvedCapabilities: ['read:battery-sample'],
    };
    await repo.putTrustDecision(decision);
    expect(await repo.getTrustDecision('pack-a')).toEqual(decision);
  });

  it('overwrites an existing trust decision for the same pack', async () => {
    const repo = createInMemoryPackRepository();
    await repo.putTrustDecision({
      packId: 'pack-a',
      decision: 'trusted-dev-unsigned',
      publisherFingerprint: null,
      decidedAtIso: '2024-01-01T00:00:00.000Z',
      approvedCapabilities: [],
    });
    await repo.putTrustDecision({
      packId: 'pack-a',
      decision: 'blocked',
      publisherFingerprint: null,
      decidedAtIso: '2024-01-02T00:00:00.000Z',
      approvedCapabilities: [],
    });
    const result = await repo.getTrustDecision('pack-a');
    expect(result?.decision).toBe('blocked');
  });
});

describe('createInMemoryPackRepository — audit log', () => {
  it('appends entries and lists them newest-first', async () => {
    const repo = createInMemoryPackRepository();
    await repo.appendAuditLog(buildAuditEntry({ packId: 'p', packName: 'P', action: 'install', detail: 'first', now: () => new Date('2024-01-01T00:00:00Z') }));
    await repo.appendAuditLog(buildAuditEntry({ packId: 'p', packName: 'P', action: 'enable', detail: 'second', now: () => new Date('2024-01-02T00:00:00Z') }));
    const list = await repo.listAuditLog();
    expect(list).toHaveLength(2);
    expect(list[0].detail).toBe('second');
    expect(list[1].detail).toBe('first');
  });

  it('respects an optional limit', async () => {
    const repo = createInMemoryPackRepository();
    for (let i = 0; i < 5; i++) {
      await repo.appendAuditLog(buildAuditEntry({ packId: 'p', packName: 'P', action: 'install', detail: `entry-${i}`, now: () => new Date(2024, 0, i + 1) }));
    }
    const limited = await repo.listAuditLog(2);
    expect(limited).toHaveLength(2);
  });

  it('caps the audit log at MAX_AUDIT_LOG_ENTRIES, dropping the oldest first', async () => {
    const repo = createInMemoryPackRepository();
    const total = MAX_AUDIT_LOG_ENTRIES + 10;
    for (let i = 0; i < total; i++) {
      await repo.appendAuditLog(
        buildAuditEntry({ packId: 'p', packName: 'P', action: 'install', detail: `entry-${i}`, now: () => new Date(2024, 0, 1, 0, 0, i) }),
      );
    }
    const all = await repo.listAuditLog();
    expect(all.length).toBe(MAX_AUDIT_LOG_ENTRIES);
    // The oldest entries (entry-0 .. entry-9) should have been dropped.
    expect(all.some((e) => e.detail === 'entry-0')).toBe(false);
    expect(all.some((e) => e.detail === `entry-${total - 1}`)).toBe(true);
  });
});

describe('createInMemoryPackRepository — clearAll', () => {
  it('wipes installed packs, trust decisions, and audit log', async () => {
    const repo = createInMemoryPackRepository();
    await repo.putInstalled(makeRecord());
    await repo.putTrustDecision({ packId: 'x', decision: 'blocked', publisherFingerprint: null, decidedAtIso: 'now', approvedCapabilities: [] });
    await repo.appendAuditLog(buildAuditEntry({ packId: 'x', packName: 'X', action: 'install', detail: 'd' }));
    await repo.clearAll();
    expect(await repo.listInstalled()).toEqual([]);
    expect(await repo.getTrustDecision('x')).toBeNull();
    expect(await repo.listAuditLog()).toEqual([]);
  });
});

describe('createInMemoryPackRepository — concurrency safety (lane queue)', () => {
  it('does not drop writes when many putInstalled calls for distinct packs race', async () => {
    const repo = createInMemoryPackRepository();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => repo.putInstalled(makeRecord({ packId: `pack-${i}` }))),
    );
    const all = await repo.listInstalled();
    expect(all).toHaveLength(20);
  });

  it('does not drop audit entries when many appendAuditLog calls race concurrently', async () => {
    const repo = createInMemoryPackRepository();
    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        repo.appendAuditLog(buildAuditEntry({ packId: 'p', packName: 'P', action: 'install', detail: `race-${i}` }))),
    );
    const all = await repo.listAuditLog();
    expect(all).toHaveLength(30);
  });
});

// A quick sanity check that the unsigned community draft record shape also round-trips fine.
describe('createInMemoryPackRepository — unsigned pack records', () => {
  it('stores an unsigned pack record without error', async () => {
    const repo = createInMemoryPackRepository();
    await repo.putInstalled(
      makeRecord({
        packId: COMMUNITY_DRAFT_ENVELOPE.manifest.id,
        envelope: COMMUNITY_DRAFT_ENVELOPE,
        verification: { ...dummyVerification, status: 'unsigned', recomputedPublisherFingerprint: null, recognizedPublisherName: null },
      }),
    );
    const fetched = await repo.getInstalled(COMMUNITY_DRAFT_ENVELOPE.manifest.id);
    expect(fetched?.envelope.signature).toBeNull();
  });
});
