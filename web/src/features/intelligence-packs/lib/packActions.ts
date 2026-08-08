/**
 * Business logic for installing/upgrading/rolling back/uninstalling packs.
 * Operates purely against the `PackRepository` interface — identical
 * behavior regardless of whether the caller wired up IndexedDB,
 * localStorage, or the in-memory test adapter.
 */

import { buildAuditEntry } from './auditLog';
import { MAX_VERSION_HISTORY, type InstalledPackRecord, type PackRepository, type PackVersionSnapshot } from './packRepository';
import type { SignedPackEnvelope } from './manifestTypes';
import type { VerificationResult } from './verifyEnvelope';

export class NoRollbackTargetError extends Error {
  constructor(packId: string) {
    super(`Pack "${packId}" has no previous version to roll back to.`);
    this.name = 'NoRollbackTargetError';
  }
}

export class PackNotInstalledError extends Error {
  constructor(packId: string) {
    super(`Pack "${packId}" is not installed.`);
    this.name = 'PackNotInstalledError';
  }
}

export interface InstallPackInput {
  envelope: SignedPackEnvelope;
  verification: VerificationResult;
  /** Whether the install flow should leave the pack enabled immediately (only allowed when a non-blocked trust decision has already been recorded — enforced by the caller, e.g. the UI action handler). */
  enabled: boolean;
  now?: () => Date;
}

/** Fresh install (or re-install/overwrite) of a pack with no existing record. */
export async function installPack(repo: PackRepository, input: InstallPackInput): Promise<InstalledPackRecord> {
  const clock = input.now ?? (() => new Date());
  const nowIso = clock().toISOString();
  const packId = input.envelope.manifest.id;
  const existing = await repo.getInstalled(packId);

  const record: InstalledPackRecord = {
    packId,
    envelope: input.envelope,
    verification: input.verification,
    enabled: input.enabled,
    installedAtIso: existing?.installedAtIso ?? nowIso,
    updatedAtIso: nowIso,
    previousVersions: existing?.previousVersions ?? [],
  };
  await repo.putInstalled(record);
  await repo.appendAuditLog(
    buildAuditEntry({
      packId,
      packName: input.envelope.manifest.name,
      action: existing ? 'upgrade' : 'install',
      detail: `Installed version ${input.envelope.manifest.version} (${input.verification.status}).`,
      now: clock,
    }),
  );
  return record;
}

export interface UpgradePackInput {
  packId: string;
  envelope: SignedPackEnvelope;
  verification: VerificationResult;
  now?: () => Date;
}

/** Upgrades an already-installed pack: snapshots the current version into `previousVersions` (capped), then activates the new one. Preserves the existing `enabled` state. */
export async function upgradePack(repo: PackRepository, input: UpgradePackInput): Promise<InstalledPackRecord> {
  const clock = input.now ?? (() => new Date());
  const nowIso = clock().toISOString();
  const current = await repo.getInstalled(input.packId);
  if (!current) throw new PackNotInstalledError(input.packId);

  const snapshot: PackVersionSnapshot = {
    version: current.envelope.manifest.version,
    envelope: current.envelope,
    verification: current.verification,
    archivedAtIso: nowIso,
  };
  const history = [...current.previousVersions, snapshot];
  const trimmedHistory = history.length > MAX_VERSION_HISTORY ? history.slice(history.length - MAX_VERSION_HISTORY) : history;

  const next: InstalledPackRecord = {
    packId: input.packId,
    envelope: input.envelope,
    verification: input.verification,
    enabled: current.enabled,
    installedAtIso: current.installedAtIso,
    updatedAtIso: nowIso,
    previousVersions: trimmedHistory,
  };
  await repo.putInstalled(next);
  await repo.appendAuditLog(
    buildAuditEntry({
      packId: input.packId,
      packName: input.envelope.manifest.name,
      action: 'upgrade',
      detail: `Upgraded ${current.envelope.manifest.version} \u2192 ${input.envelope.manifest.version}.`,
      now: clock,
    }),
  );
  return next;
}

/** Restores the most recently superseded version. The rolled-back-FROM version is discarded, not pushed anywhere. */
export async function rollbackPack(repo: PackRepository, packId: string, now?: () => Date): Promise<InstalledPackRecord> {
  const clock = now ?? (() => new Date());
  const nowIso = clock().toISOString();
  const current = await repo.getInstalled(packId);
  if (!current) throw new PackNotInstalledError(packId);
  if (current.previousVersions.length === 0) throw new NoRollbackTargetError(packId);

  const history = [...current.previousVersions];
  const target = history.pop() as PackVersionSnapshot;
  const restored: InstalledPackRecord = {
    packId,
    envelope: target.envelope,
    verification: target.verification,
    enabled: current.enabled,
    installedAtIso: current.installedAtIso,
    updatedAtIso: nowIso,
    previousVersions: history,
  };
  await repo.putInstalled(restored);
  await repo.appendAuditLog(
    buildAuditEntry({
      packId,
      packName: target.envelope.manifest.name,
      action: 'rollback',
      detail: `Rolled back ${current.envelope.manifest.version} \u2192 ${target.envelope.manifest.version}.`,
      now: clock,
    }),
  );
  return restored;
}

export async function uninstallPack(repo: PackRepository, packId: string, now?: () => Date): Promise<void> {
  const clock = now ?? (() => new Date());
  const current = await repo.getInstalled(packId);
  if (!current) throw new PackNotInstalledError(packId);
  await repo.removeInstalled(packId);
  await repo.appendAuditLog(
    buildAuditEntry({
      packId,
      packName: current.envelope.manifest.name,
      action: 'uninstall',
      detail: `Uninstalled version ${current.envelope.manifest.version}.`,
      now: clock,
    }),
  );
}

export async function setPackEnabled(repo: PackRepository, packId: string, enabled: boolean, now?: () => Date): Promise<InstalledPackRecord> {
  const clock = now ?? (() => new Date());
  const nowIso = clock().toISOString();
  const current = await repo.getInstalled(packId);
  if (!current) throw new PackNotInstalledError(packId);
  const next: InstalledPackRecord = { ...current, enabled, updatedAtIso: nowIso };
  await repo.putInstalled(next);
  await repo.appendAuditLog(
    buildAuditEntry({
      packId,
      packName: current.envelope.manifest.name,
      action: enabled ? 'enable' : 'disable',
      detail: enabled ? 'Pack enabled.' : 'Pack disabled.',
      now: clock,
    }),
  );
  return next;
}
