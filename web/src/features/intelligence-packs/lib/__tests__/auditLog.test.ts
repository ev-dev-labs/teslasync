import { describe, it, expect } from 'vitest';
import { buildAuditEntry, MAX_AUDIT_LOG_ENTRIES } from '../auditLog';

describe('buildAuditEntry', () => {
  it('generates a unique id per call', () => {
    const a = buildAuditEntry({ packId: 'p', packName: 'P', action: 'install', detail: 'd' });
    const b = buildAuditEntry({ packId: 'p', packName: 'P', action: 'install', detail: 'd' });
    expect(a.id).not.toBe(b.id);
  });

  it('uses the provided clock when given', () => {
    const entry = buildAuditEntry({ packId: 'p', packName: 'P', action: 'install', detail: 'd', now: () => new Date('2020-01-01T00:00:00.000Z') });
    expect(entry.timestampIso).toBe('2020-01-01T00:00:00.000Z');
  });

  it('copies through packId/packName/action/detail unchanged', () => {
    const entry = buildAuditEntry({ packId: 'pack-1', packName: 'Pack One', action: 'rollback', detail: 'rolled back' });
    expect(entry.packId).toBe('pack-1');
    expect(entry.packName).toBe('Pack One');
    expect(entry.action).toBe('rollback');
    expect(entry.detail).toBe('rolled back');
  });

  it('MAX_AUDIT_LOG_ENTRIES is a sane positive bound', () => {
    expect(MAX_AUDIT_LOG_ENTRIES).toBeGreaterThan(0);
  });
});
