import { describe, it, expect } from 'vitest';
import { createInMemoryPackRepository } from '../packRepository';
import {
  installPack,
  upgradePack,
  rollbackPack,
  uninstallPack,
  setPackEnabled,
  NoRollbackTargetError,
  PackNotInstalledError,
} from '../packActions';
import { EFFICIENCY_INSIGHTS_ENVELOPE } from '../catalogFixtures';
import type { SignedPackEnvelope } from '../manifestTypes';
import type { VerificationResult } from '../verifyEnvelope';

const verification: VerificationResult = {
  status: 'signature-valid',
  recomputedDigestSha256Hex: 'a'.repeat(64),
  recomputedPublisherFingerprint: EFFICIENCY_INSIGHTS_ENVELOPE.manifest.publisher.fingerprint,
  claimedFingerprintMismatch: false,
  recognizedPublisherName: 'TeslaSync Labs (Sample Publisher)',
  summary: 'ok',
};

function withVersion(version: string): SignedPackEnvelope {
  const clone: SignedPackEnvelope = JSON.parse(JSON.stringify(EFFICIENCY_INSIGHTS_ENVELOPE));
  clone.manifest.version = version;
  return clone;
}

describe('installPack', () => {
  it('installs a new pack and records an audit entry', async () => {
    const repo = createInMemoryPackRepository();
    const record = await installPack(repo, { envelope: EFFICIENCY_INSIGHTS_ENVELOPE, verification, enabled: false });
    expect(record.packId).toBe(EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id);
    expect(record.enabled).toBe(false);
    expect(record.previousVersions).toEqual([]);

    const auditLog = await repo.listAuditLog();
    expect(auditLog).toHaveLength(1);
    expect(auditLog[0].action).toBe('install');
  });

  it('respects the requested enabled flag', async () => {
    const repo = createInMemoryPackRepository();
    const record = await installPack(repo, { envelope: EFFICIENCY_INSIGHTS_ENVELOPE, verification, enabled: true });
    expect(record.enabled).toBe(true);
  });
});

describe('upgradePack', () => {
  it('throws PackNotInstalledError if the pack is not yet installed', async () => {
    const repo = createInMemoryPackRepository();
    await expect(
      upgradePack(repo, { packId: 'not-installed', envelope: EFFICIENCY_INSIGHTS_ENVELOPE, verification }),
    ).rejects.toThrow(PackNotInstalledError);
  });

  it('snapshots the current version into previousVersions and activates the new version', async () => {
    const repo = createInMemoryPackRepository();
    const v1 = withVersion('1.0.0');
    await installPack(repo, { envelope: v1, verification, enabled: true });

    const v2 = withVersion('1.1.0');
    const upgraded = await upgradePack(repo, { packId: v1.manifest.id, envelope: v2, verification });

    expect(upgraded.envelope.manifest.version).toBe('1.1.0');
    expect(upgraded.previousVersions).toHaveLength(1);
    expect(upgraded.previousVersions[0].version).toBe('1.0.0');
  });

  it('preserves the enabled state across an upgrade', async () => {
    const repo = createInMemoryPackRepository();
    const v1 = withVersion('1.0.0');
    await installPack(repo, { envelope: v1, verification, enabled: true });
    const upgraded = await upgradePack(repo, { packId: v1.manifest.id, envelope: withVersion('2.0.0'), verification });
    expect(upgraded.enabled).toBe(true);
  });

  it('caps version history at MAX_VERSION_HISTORY, dropping the oldest snapshot first', async () => {
    const repo = createInMemoryPackRepository();
    const packId = EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id;
    await installPack(repo, { envelope: withVersion('1.0.0'), verification, enabled: true });
    for (let i = 1; i <= 7; i++) {
      await upgradePack(repo, { packId, envelope: withVersion(`1.0.${i}`), verification });
    }
    const record = await repo.getInstalled(packId);
    expect(record?.previousVersions.length).toBeLessThanOrEqual(5);
    // The oldest superseded version (1.0.0) should have been dropped by now.
    expect(record?.previousVersions.some((v) => v.version === '1.0.0')).toBe(false);
  });
});

describe('rollbackPack', () => {
  it('throws PackNotInstalledError if the pack is not installed', async () => {
    const repo = createInMemoryPackRepository();
    await expect(rollbackPack(repo, 'nope')).rejects.toThrow(PackNotInstalledError);
  });

  it('throws NoRollbackTargetError when there is no previous version', async () => {
    const repo = createInMemoryPackRepository();
    const v1 = withVersion('1.0.0');
    await installPack(repo, { envelope: v1, verification, enabled: true });
    await expect(rollbackPack(repo, v1.manifest.id)).rejects.toThrow(NoRollbackTargetError);
  });

  it('restores the most recently superseded version and discards the version rolled back from', async () => {
    const repo = createInMemoryPackRepository();
    const packId = EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id;
    await installPack(repo, { envelope: withVersion('1.0.0'), verification, enabled: true });
    await upgradePack(repo, { packId, envelope: withVersion('2.0.0'), verification });
    await upgradePack(repo, { packId, envelope: withVersion('3.0.0'), verification });

    const rolledBack = await rollbackPack(repo, packId);
    expect(rolledBack.envelope.manifest.version).toBe('2.0.0');
    // 3.0.0 (rolled-back-FROM) must be discarded entirely -- not present anywhere.
    expect(rolledBack.previousVersions.some((v) => v.version === '3.0.0')).toBe(false);
    // 1.0.0 remains as the sole entry in the rollback stack.
    expect(rolledBack.previousVersions.map((v) => v.version)).toEqual(['1.0.0']);
  });

  it('rolling back twice in a row pops the stack again (simple stack semantics)', async () => {
    const repo = createInMemoryPackRepository();
    const packId = EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id;
    await installPack(repo, { envelope: withVersion('1.0.0'), verification, enabled: true });
    await upgradePack(repo, { packId, envelope: withVersion('2.0.0'), verification });
    await upgradePack(repo, { packId, envelope: withVersion('3.0.0'), verification });

    await rollbackPack(repo, packId); // now at 2.0.0, stack: [1.0.0]
    const secondRollback = await rollbackPack(repo, packId); // now at 1.0.0, stack: []
    expect(secondRollback.envelope.manifest.version).toBe('1.0.0');
    expect(secondRollback.previousVersions).toEqual([]);
    await expect(rollbackPack(repo, packId)).rejects.toThrow(NoRollbackTargetError);
  });

  it('preserves enabled state through a rollback', async () => {
    const repo = createInMemoryPackRepository();
    const packId = EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id;
    await installPack(repo, { envelope: withVersion('1.0.0'), verification, enabled: true });
    await upgradePack(repo, { packId, envelope: withVersion('2.0.0'), verification });
    const rolledBack = await rollbackPack(repo, packId);
    expect(rolledBack.enabled).toBe(true);
  });

  it('records an audit entry describing the rollback direction', async () => {
    const repo = createInMemoryPackRepository();
    const packId = EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id;
    await installPack(repo, { envelope: withVersion('1.0.0'), verification, enabled: true });
    await upgradePack(repo, { packId, envelope: withVersion('2.0.0'), verification });
    await rollbackPack(repo, packId);
    const log = await repo.listAuditLog();
    const rollbackEntry = log.find((e) => e.action === 'rollback');
    expect(rollbackEntry?.detail).toMatch(/2\.0\.0.*1\.0\.0/);
  });
});

describe('uninstallPack', () => {
  it('throws PackNotInstalledError if the pack is not installed', async () => {
    const repo = createInMemoryPackRepository();
    await expect(uninstallPack(repo, 'nope')).rejects.toThrow(PackNotInstalledError);
  });

  it('removes the pack and records an audit entry', async () => {
    const repo = createInMemoryPackRepository();
    const packId = EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id;
    await installPack(repo, { envelope: EFFICIENCY_INSIGHTS_ENVELOPE, verification, enabled: true });
    await uninstallPack(repo, packId);
    expect(await repo.getInstalled(packId)).toBeNull();
    const log = await repo.listAuditLog();
    expect(log.some((e) => e.action === 'uninstall')).toBe(true);
  });
});

describe('setPackEnabled', () => {
  it('throws PackNotInstalledError if the pack is not installed', async () => {
    const repo = createInMemoryPackRepository();
    await expect(setPackEnabled(repo, 'nope', true)).rejects.toThrow(PackNotInstalledError);
  });

  it('toggles enabled state and records an appropriate audit action', async () => {
    const repo = createInMemoryPackRepository();
    const packId = EFFICIENCY_INSIGHTS_ENVELOPE.manifest.id;
    await installPack(repo, { envelope: EFFICIENCY_INSIGHTS_ENVELOPE, verification, enabled: false });

    const enabled = await setPackEnabled(repo, packId, true);
    expect(enabled.enabled).toBe(true);
    const disabled = await setPackEnabled(repo, packId, false);
    expect(disabled.enabled).toBe(false);

    const log = await repo.listAuditLog();
    expect(log.filter((e) => e.action === 'enable')).toHaveLength(1);
    expect(log.filter((e) => e.action === 'disable')).toHaveLength(1);
  });
});
