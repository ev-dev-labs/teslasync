// Tests for the settings export/import shared schema.
//
// Covers every export: the two public constants, the runtime validator
// (`validateSettingsBundle`) across all of its rejection branches and the
// happy path, the deterministic filename builder (`defaultExportFilename`,
// including the invalid-Date guard), and the count aggregator
// (`summariseImportResult`, including its null-safety on wire-shaped data).
// The exported types are exercised via typed helpers/fixtures so a shape
// regression trips `tsc --noEmit`.

import { describe, it, expect } from 'vitest';
import {
  SETTINGS_BUNDLE_SCHEMA_VERSION,
  SETTINGS_BUNDLE_SECTION_KEYS,
  validateSettingsBundle,
  defaultExportFilename,
  summariseImportResult,
  type SettingsBundle,
  type SettingsBundleSectionKey,
  type SettingsImportResult,
  type SettingsImportSectionResult,
} from './settingsImportSchema';

/** Narrow a validator result to a bundle, failing loudly on a rejection. */
function expectBundle(input: unknown): SettingsBundle {
  const result = validateSettingsBundle(input);
  if (typeof result === 'string') {
    throw new Error(`expected a valid bundle but validation failed: ${result}`);
  }
  return result;
}

/** A minimal, always-valid bundle fixture (fresh object per call). */
function validInput(): Record<string, unknown> {
  return {
    schema_version: SETTINGS_BUNDLE_SCHEMA_VERSION,
    exported_at: '2026-01-09T12:34:56Z',
    sections: {},
  };
}

describe('SETTINGS_BUNDLE_SCHEMA_VERSION', () => {
  it('is the positive integer 1', () => {
    expect(SETTINGS_BUNDLE_SCHEMA_VERSION).toBe(1);
    expect(Number.isInteger(SETTINGS_BUNDLE_SCHEMA_VERSION)).toBe(true);
  });
});

describe('SETTINGS_BUNDLE_SECTION_KEYS', () => {
  it('enumerates the four sections in a stable, documented order', () => {
    expect(SETTINGS_BUNDLE_SECTION_KEYS).toEqual([
      'settings',
      'alert_rules',
      'geofences',
      'quiet_hours',
    ]);
  });

  it('contains no duplicate keys', () => {
    expect(new Set(SETTINGS_BUNDLE_SECTION_KEYS).size).toBe(
      SETTINGS_BUNDLE_SECTION_KEYS.length,
    );
  });

  it('is assignable to SettingsBundleSectionKey[]', () => {
    const keys: SettingsBundleSectionKey[] = [...SETTINGS_BUNDLE_SECTION_KEYS];
    expect(keys).toContain('settings');
    expect(keys).toContain('quiet_hours');
  });
});

describe('validateSettingsBundle — top-level shape', () => {
  it('rejects null', () => {
    expect(validateSettingsBundle(null)).toBe('Bundle must be a JSON object');
  });

  it('rejects undefined', () => {
    expect(validateSettingsBundle(undefined)).toBe('Bundle must be a JSON object');
  });

  it('rejects primitives (string, number, boolean)', () => {
    expect(validateSettingsBundle('{}')).toBe('Bundle must be a JSON object');
    expect(validateSettingsBundle(7)).toBe('Bundle must be a JSON object');
    expect(validateSettingsBundle(true)).toBe('Bundle must be a JSON object');
  });

  it('does not crash on an array, falling through to the version check', () => {
    // `typeof [] === 'object'`, so an array passes the first guard and is
    // rejected only because it lacks a schema_version.
    expect(validateSettingsBundle([])).toBe('schema_version must be a positive integer');
  });
});

describe('validateSettingsBundle — schema_version', () => {
  it('rejects a missing version', () => {
    const input = validInput();
    delete input.schema_version;
    expect(validateSettingsBundle(input)).toBe('schema_version must be a positive integer');
  });

  it('rejects a non-number version', () => {
    expect(validateSettingsBundle({ ...validInput(), schema_version: '1' })).toBe(
      'schema_version must be a positive integer',
    );
  });

  it('rejects NaN and Infinity', () => {
    expect(validateSettingsBundle({ ...validInput(), schema_version: NaN })).toBe(
      'schema_version must be a positive integer',
    );
    expect(validateSettingsBundle({ ...validInput(), schema_version: Infinity })).toBe(
      'schema_version must be a positive integer',
    );
  });

  it('rejects zero and negative versions', () => {
    expect(validateSettingsBundle({ ...validInput(), schema_version: 0 })).toBe(
      'schema_version must be a positive integer',
    );
    expect(validateSettingsBundle({ ...validInput(), schema_version: -3 })).toBe(
      'schema_version must be a positive integer',
    );
  });

  it('rejects a fractional version with the integer message (not the "newer" branch)', () => {
    expect(validateSettingsBundle({ ...validInput(), schema_version: 1.5 })).toBe(
      'schema_version must be a positive integer',
    );
  });

  it('rejects a version newer than this build supports', () => {
    const future = SETTINGS_BUNDLE_SCHEMA_VERSION + 1;
    expect(validateSettingsBundle({ ...validInput(), schema_version: future })).toBe(
      `schema_version ${future} is newer than this build supports (max ${SETTINGS_BUNDLE_SCHEMA_VERSION})`,
    );
  });
});

describe('validateSettingsBundle — exported_at', () => {
  it('rejects a missing exported_at', () => {
    const input = validInput();
    delete input.exported_at;
    expect(validateSettingsBundle(input)).toBe(
      'exported_at must be a non-empty ISO-8601 string',
    );
  });

  it('rejects a non-string exported_at', () => {
    expect(validateSettingsBundle({ ...validInput(), exported_at: 1736424896 })).toBe(
      'exported_at must be a non-empty ISO-8601 string',
    );
  });

  it('rejects a whitespace-only exported_at', () => {
    expect(validateSettingsBundle({ ...validInput(), exported_at: '   ' })).toBe(
      'exported_at must be a non-empty ISO-8601 string',
    );
  });
});

describe('validateSettingsBundle — sections container', () => {
  it('rejects a missing sections object', () => {
    const input = validInput();
    delete input.sections;
    expect(validateSettingsBundle(input)).toBe('sections must be a JSON object');
  });

  it('rejects a null sections value', () => {
    expect(validateSettingsBundle({ ...validInput(), sections: null })).toBe(
      'sections must be a JSON object',
    );
  });

  it('rejects a non-object sections value', () => {
    expect(validateSettingsBundle({ ...validInput(), sections: 'nope' })).toBe(
      'sections must be a JSON object',
    );
  });

  it('rejects an unknown section key', () => {
    expect(
      validateSettingsBundle({ ...validInput(), sections: { bogus: {} } }),
    ).toBe('Unknown section "bogus"');
  });
});

describe('validateSettingsBundle — per-section payload types', () => {
  it('rejects a non-object settings payload', () => {
    expect(
      validateSettingsBundle({ ...validInput(), sections: { settings: 'x' } }),
    ).toBe('sections.settings must be an object');
  });

  it('rejects non-array alert_rules / geofences / quiet_hours', () => {
    expect(
      validateSettingsBundle({ ...validInput(), sections: { alert_rules: {} } }),
    ).toBe('sections.alert_rules must be an array');
    expect(
      validateSettingsBundle({ ...validInput(), sections: { geofences: 5 } }),
    ).toBe('sections.geofences must be an array');
    expect(
      validateSettingsBundle({ ...validInput(), sections: { quiet_hours: 'nope' } }),
    ).toBe('sections.quiet_hours must be an array');
  });
});

describe('validateSettingsBundle — happy paths', () => {
  it('accepts a minimal bundle with empty sections', () => {
    const bundle = expectBundle(validInput());
    expect(bundle.schema_version).toBe(1);
    expect(bundle.exported_at).toBe('2026-01-09T12:34:56Z');
    expect(bundle.sections).toEqual({
      settings: undefined,
      alert_rules: undefined,
      geofences: undefined,
      quiet_hours: undefined,
    });
  });

  it('accepts and preserves a fully-populated bundle', () => {
    const bundle = expectBundle({
      schema_version: 1,
      exported_at: '2026-02-02T00:00:00Z',
      sections: {
        settings: { theme: 'dark', units: 'imperial' },
        alert_rules: [{ id: 1 }, { id: 2 }],
        geofences: [{ id: 'home' }],
        quiet_hours: [],
      },
    });
    expect(bundle.sections.settings).toEqual({ theme: 'dark', units: 'imperial' });
    expect(bundle.sections.alert_rules).toHaveLength(2);
    expect(bundle.sections.geofences).toEqual([{ id: 'home' }]);
    expect(bundle.sections.quiet_hours).toEqual([]);
  });

  it('accepts a partial bundle and leaves absent sections undefined', () => {
    const bundle = expectBundle({
      schema_version: 1,
      exported_at: '2026-03-03T00:00:00Z',
      sections: { alert_rules: [{ id: 9 }] },
    });
    expect(bundle.sections.alert_rules).toEqual([{ id: 9 }]);
    expect(bundle.sections.settings).toBeUndefined();
    expect(bundle.sections.geofences).toBeUndefined();
  });

  it('normalises away unknown top-level fields', () => {
    const bundle = expectBundle({
      ...validInput(),
      exported_at: '2026-04-04T00:00:00Z',
      injected: 'should be dropped',
    });
    expect(Object.keys(bundle).sort()).toEqual([
      'exported_at',
      'schema_version',
      'sections',
    ]);
    expect((bundle as Record<string, unknown>).injected).toBeUndefined();
  });
});

describe('defaultExportFilename', () => {
  it('formats a UTC date with zero-padded month and day', () => {
    // Date.UTC keeps the assertion timezone-independent.
    expect(defaultExportFilename(new Date(Date.UTC(2026, 0, 9)))).toBe(
      'teslasync-settings-20260109.json',
    );
  });

  it('renders double-digit month and day without padding artefacts', () => {
    expect(defaultExportFilename(new Date(Date.UTC(2026, 10, 25)))).toBe(
      'teslasync-settings-20261125.json',
    );
  });

  it('returns a well-formed name for the default (current) date', () => {
    expect(defaultExportFilename()).toMatch(/^teslasync-settings-\d{8}\.json$/);
  });

  it('falls back to a valid name for an invalid Date rather than emitting NaN', () => {
    const name = defaultExportFilename(new Date('not-a-real-date'));
    expect(name).toMatch(/^teslasync-settings-\d{8}\.json$/);
    expect(name).not.toContain('NaN');
  });
});

describe('summariseImportResult', () => {
  it('sums per-section counts, with total counting added+updated only', () => {
    const result: SettingsImportResult = {
      dry_run: true,
      sections: {
        settings: { added: 1, updated: 2, skipped: 3 },
        alert_rules: { added: 4, updated: 5, skipped: 6 },
      },
    };
    expect(summariseImportResult(result)).toEqual({
      added: 5,
      updated: 7,
      skipped: 9,
      total: 12,
    });
  });

  it('returns all zeroes for an empty sections map', () => {
    const result: SettingsImportResult = { dry_run: false, sections: {} };
    expect(summariseImportResult(result)).toEqual({
      added: 0,
      updated: 0,
      skipped: 0,
      total: 0,
    });
  });

  it('skips undefined section entries', () => {
    const result: SettingsImportResult = {
      dry_run: true,
      sections: {
        settings: undefined,
        geofences: { added: 2, updated: 0, skipped: 1 },
      },
    };
    expect(summariseImportResult(result)).toEqual({
      added: 2,
      updated: 0,
      skipped: 1,
      total: 2,
    });
  });

  it('ignores the optional conflicts array when aggregating', () => {
    const section: SettingsImportSectionResult = {
      added: 1,
      updated: 1,
      skipped: 0,
      conflicts: ['rule-42 already exists'],
    };
    const result: SettingsImportResult = { dry_run: true, sections: { alert_rules: section } };
    expect(summariseImportResult(result)).toEqual({
      added: 1,
      updated: 1,
      skipped: 0,
      total: 2,
    });
  });

  it('treats missing per-section counts as 0 instead of producing NaN', () => {
    // Wire-shaped drift: a section object arrives without every count.
    const partial = { added: 3 } as unknown as SettingsImportSectionResult;
    const result = {
      dry_run: true,
      sections: { settings: partial },
    } as unknown as SettingsImportResult;
    const summary = summariseImportResult(result);
    expect(summary.added).toBe(3);
    expect(summary.updated).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(Number.isNaN(summary.total)).toBe(false);
    expect(summary.total).toBe(3);
  });

  it('does not throw when sections is absent from the payload', () => {
    const missing = { dry_run: true } as unknown as SettingsImportResult;
    expect(() => summariseImportResult(missing)).not.toThrow();
    expect(summariseImportResult(missing)).toEqual({
      added: 0,
      updated: 0,
      skipped: 0,
      total: 0,
    });
  });

  it('does not throw when the whole result is nullish', () => {
    const nothing = undefined as unknown as SettingsImportResult;
    expect(summariseImportResult(nothing)).toEqual({
      added: 0,
      updated: 0,
      skipped: 0,
      total: 0,
    });
  });
});
