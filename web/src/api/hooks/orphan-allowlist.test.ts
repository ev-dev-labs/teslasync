import { describe, it, expect } from 'vitest';
import {
  INTENTIONAL_ORPHANS,
  isIntentionalOrphan,
  type OrphanWaiver,
} from './orphan-allowlist';

/**
 * The allowlist is a governance surface: it exempts specific hook files from the
 * ORPHAN-blocks-the-audit rule, and the Honesty Covenant (rule 11) requires each
 * waiver to carry a documented reason + tracking note. These tests lock both the
 * `isIntentionalOrphan` predicate contract (exact, bare-filename match) and the
 * data-integrity guarantees that keep the allowlist from decaying into stealth
 * dead-code retention.
 */
describe('isIntentionalOrphan', () => {
  it('returns true for every file registered in the allowlist', () => {
    expect(INTENTIONAL_ORPHANS.length).toBeGreaterThan(0);
    for (const entry of INTENTIONAL_ORPHANS) {
      expect(isIntentionalOrphan(entry.file)).toBe(true);
    }
  });

  it('recognises the specific known waivers', () => {
    expect(isIntentionalOrphan('useAlerts.ts')).toBe(true);
    expect(isIntentionalOrphan('useDashboardLayouts.ts')).toBe(true);
  });

  it('returns false for hooks that are not waived', () => {
    expect(isIntentionalOrphan('useVehicles.ts')).toBe(false);
    expect(isIntentionalOrphan('useCharging.ts')).toBe(false);
    expect(isIntentionalOrphan('useDefinitelyNotAHook.ts')).toBe(false);
  });

  it('is an exact match — it does not strip or assume the .ts extension', () => {
    expect(isIntentionalOrphan('useAlerts')).toBe(false);
    expect(isIntentionalOrphan('useAlerts.tsx')).toBe(false);
    expect(isIntentionalOrphan('useAlerts.ts.map')).toBe(false);
  });

  it('is case-sensitive (matches exactly what the audit emits)', () => {
    expect(isIntentionalOrphan('usealerts.ts')).toBe(false);
    expect(isIntentionalOrphan('UseAlerts.ts')).toBe(false);
    expect(isIntentionalOrphan('USEALERTS.TS')).toBe(false);
  });

  it('does not match a path-qualified name (bare-filename contract)', () => {
    expect(isIntentionalOrphan('hooks/useAlerts.ts')).toBe(false);
    expect(isIntentionalOrphan('api/hooks/useAlerts.ts')).toBe(false);
    expect(isIntentionalOrphan('src/api/hooks/useAlerts.ts')).toBe(false);
  });

  it('does not trim surrounding whitespace before matching', () => {
    expect(isIntentionalOrphan(' useAlerts.ts')).toBe(false);
    expect(isIntentionalOrphan('useAlerts.ts ')).toBe(false);
    expect(isIntentionalOrphan('useAlerts.ts\n')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isIntentionalOrphan('')).toBe(false);
  });

  it('returns false for nullish input from untyped audit callers', () => {
    expect(isIntentionalOrphan(undefined as unknown as string)).toBe(false);
    expect(isIntentionalOrphan(null as unknown as string)).toBe(false);
  });

  it('is a pure predicate — repeated calls are stable', () => {
    const first = isIntentionalOrphan('useAlerts.ts');
    const second = isIntentionalOrphan('useAlerts.ts');
    expect(first).toBe(second);
    expect(first).toBe(true);
  });
});

describe('INTENTIONAL_ORPHANS data integrity (Honesty Covenant rule 11)', () => {
  it('is a non-empty list', () => {
    expect(Array.isArray(INTENTIONAL_ORPHANS)).toBe(true);
    expect(INTENTIONAL_ORPHANS.length).toBeGreaterThan(0);
  });

  it('every entry conforms to the OrphanWaiver shape (exactly file/reason/tracking)', () => {
    for (const entry of INTENTIONAL_ORPHANS) {
      const waiver: OrphanWaiver = entry;
      expect(Object.keys(waiver).sort()).toEqual(['file', 'reason', 'tracking']);
      expect(typeof waiver.file).toBe('string');
      expect(typeof waiver.reason).toBe('string');
      expect(typeof waiver.tracking).toBe('string');
    }
  });

  it('every entry has a non-empty, non-whitespace file / reason / tracking', () => {
    for (const entry of INTENTIONAL_ORPHANS) {
      expect(entry.file.trim().length).toBeGreaterThan(0);
      expect(entry.reason.trim().length).toBeGreaterThan(0);
      expect(entry.tracking.trim().length).toBeGreaterThan(0);
    }
  });

  it('every reason is a documented justification, not a placeholder', () => {
    for (const entry of INTENTIONAL_ORPHANS) {
      // Honesty Covenant: a waiver without a real reason is stealth dead-code
      // retention. Require substance rather than a stub like "n/a" / "TODO".
      expect(entry.reason.trim().length).toBeGreaterThan(20);
      expect(/^(n\/?a|tbd|todo|none|-)$/i.test(entry.reason.trim())).toBe(false);
    }
  });

  it('every tracking note points at a backlog issue or a TODO marker', () => {
    for (const entry of INTENTIONAL_ORPHANS) {
      expect(/todo|https?:\/\/|#\d+|issue/i.test(entry.tracking)).toBe(true);
    }
  });

  it('every file is a bare filename (no leading path) ending in .ts', () => {
    for (const entry of INTENTIONAL_ORPHANS) {
      expect(entry.file).not.toContain('/');
      expect(entry.file).not.toContain('\\');
      expect(entry.file.endsWith('.ts')).toBe(true);
    }
  });

  it('contains no duplicate file entries', () => {
    const files = INTENTIONAL_ORPHANS.map((entry) => entry.file);
    const unique = new Set(files);
    expect(unique.size).toBe(files.length);
  });

  it('is round-trip consistent with isIntentionalOrphan', () => {
    for (const entry of INTENTIONAL_ORPHANS) {
      expect(isIntentionalOrphan(entry.file)).toBe(true);
    }
    // A filename guaranteed not to be present must not be reported as waived.
    const synthetic = `useNeverRegistered-${Date.now()}.ts`;
    expect(INTENTIONAL_ORPHANS.some((e) => e.file === synthetic)).toBe(false);
    expect(isIntentionalOrphan(synthetic)).toBe(false);
  });
});
