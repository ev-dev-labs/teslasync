/**
 * signals.ts — the signal-field catalog that backs the automation
 * trigger/condition builders. This is a pure data + helper module, so the
 * tests lock the *contract* (every export, in canonical order) and the
 * *invariants* the two consumers (ConditionBuilder / TriggerConfigurator)
 * depend on:
 *   - BOOL_FIELD_KEYS drives the true/false editor branch,
 *   - `state` is the one string signal (special-cased by key),
 *   - SIGNAL_FIELD_OPTIONS / buildSignalFieldOptions feed <Select>.
 *
 * No network, no React — buildSignalFieldOptions takes a plain `t`, stubbed
 * the same way the repo's other lib tests stub it (echo the fallback string).
 */
import { describe, it, expect, vi } from 'vitest';
import type { TFunction } from 'i18next';
import {
  SIGNAL_FIELDS,
  NUMERIC_SIGNAL_FIELDS,
  BOOLEAN_SIGNAL_FIELDS,
  BOOL_FIELD_KEYS,
  SIGNAL_FIELD_OPTIONS,
  buildSignalFieldOptions,
  type SignalField,
  type SignalFieldType,
  type SignalFieldOption,
} from './signals';

/** i18n stub echoing the developer fallback (mirrors charging-list/helpers.test.ts). */
const echoT = ((_key: string, fallback?: string) => fallback ?? _key) as unknown as TFunction;

const VALID_TYPES: readonly SignalFieldType[] = ['numeric', 'boolean', 'string'];

/** The exact, canonical catalog — this data file is a consumed contract. */
const EXPECTED_FIELDS = [
  { key: 'battery_level', label: 'Battery Level', labelKey: 'automations.builder.signals.batteryLevel', type: 'numeric', unit: '%' },
  { key: 'inside_temp', label: 'Inside Temperature', labelKey: 'automations.builder.signals.insideTemp', type: 'numeric', unit: '°C' },
  { key: 'outside_temp', label: 'Outside Temperature', labelKey: 'automations.builder.signals.outsideTemp', type: 'numeric', unit: '°C' },
  { key: 'speed', label: 'Speed', labelKey: 'automations.builder.signals.speed', type: 'numeric', unit: 'mph' },
  { key: 'is_locked', label: 'Is Locked', labelKey: 'automations.builder.signals.isLocked', type: 'boolean' },
  { key: 'is_charging', label: 'Is Charging', labelKey: 'automations.builder.signals.isCharging', type: 'boolean' },
  { key: 'is_climate_on', label: 'Climate On', labelKey: 'automations.builder.signals.isClimateOn', type: 'boolean' },
  { key: 'sentry_mode', label: 'Sentry Mode', labelKey: 'automations.builder.signals.sentryMode', type: 'boolean' },
  { key: 'state', label: 'Vehicle State', labelKey: 'automations.builder.signals.state', type: 'string' },
];

// ── SIGNAL_FIELDS catalog ─────────────────────────────────────────────────────

describe('SIGNAL_FIELDS', () => {
  it('matches the canonical nine-signal catalog exactly (order included)', () => {
    expect(SIGNAL_FIELDS).toEqual(EXPECTED_FIELDS);
    expect(SIGNAL_FIELDS).toHaveLength(9);
  });

  it('gives every field a non-empty key, label and namespaced labelKey', () => {
    SIGNAL_FIELDS.forEach((field: SignalField) => {
      expect(field.key.length).toBeGreaterThan(0);
      expect(field.label.length).toBeGreaterThan(0);
      expect(field.labelKey.startsWith('automations.builder.signals.')).toBe(true);
    });
  });

  it('only ever uses the three declared field types', () => {
    for (const field of SIGNAL_FIELDS) {
      expect(VALID_TYPES).toContain(field.type);
    }
  });

  it('has unique keys and unique labelKeys (no duplicate signals)', () => {
    const keys = SIGNAL_FIELDS.map((f) => f.key);
    const labelKeys = SIGNAL_FIELDS.map((f) => f.labelKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(labelKeys).size).toBe(labelKeys.length);
  });

  it('attaches a display unit to numeric signals only', () => {
    for (const field of SIGNAL_FIELDS) {
      if (field.type === 'numeric') {
        expect(typeof field.unit).toBe('string');
        expect(field.unit).toBeTruthy();
      } else {
        expect(field.unit).toBeUndefined();
      }
    }
  });

  it('partitions cleanly into numeric + boolean + one string signal', () => {
    const stringFields = SIGNAL_FIELDS.filter((f) => f.type === 'string');
    expect(stringFields.map((f) => f.key)).toEqual(['state']);
    expect(
      NUMERIC_SIGNAL_FIELDS.length + BOOLEAN_SIGNAL_FIELDS.length + stringFields.length,
    ).toBe(SIGNAL_FIELDS.length);
  });
});

// ── Derived partitions ────────────────────────────────────────────────────────

describe('NUMERIC_SIGNAL_FIELDS', () => {
  it('lists exactly the four numeric signal keys', () => {
    expect(NUMERIC_SIGNAL_FIELDS.map((f) => f.key)).toEqual([
      'battery_level',
      'inside_temp',
      'outside_temp',
      'speed',
    ]);
  });

  it('contains only numeric-typed, unit-bearing fields', () => {
    for (const field of NUMERIC_SIGNAL_FIELDS) {
      expect(field.type).toBe('numeric');
      expect(field.unit).toBeTruthy();
    }
  });

  it('excludes boolean signals and the string "state" signal', () => {
    const keys = NUMERIC_SIGNAL_FIELDS.map((f) => f.key);
    expect(keys).not.toContain('is_locked');
    expect(keys).not.toContain('state');
  });
});

describe('BOOLEAN_SIGNAL_FIELDS', () => {
  it('lists exactly the four boolean signal keys', () => {
    expect(BOOLEAN_SIGNAL_FIELDS.map((f) => f.key)).toEqual([
      'is_locked',
      'is_charging',
      'is_climate_on',
      'sentry_mode',
    ]);
  });

  it('contains only boolean-typed, unitless fields', () => {
    for (const field of BOOLEAN_SIGNAL_FIELDS) {
      expect(field.type).toBe('boolean');
      expect(field.unit).toBeUndefined();
    }
  });
});

// ── BOOL_FIELD_KEYS lookup set ────────────────────────────────────────────────

describe('BOOL_FIELD_KEYS', () => {
  it('reports membership for every boolean signal', () => {
    for (const field of BOOLEAN_SIGNAL_FIELDS) {
      expect(BOOL_FIELD_KEYS.has(field.key)).toBe(true);
    }
  });

  it('rejects numeric keys, the string "state" signal, and unknown keys', () => {
    expect(BOOL_FIELD_KEYS.has('battery_level')).toBe(false);
    expect(BOOL_FIELD_KEYS.has('speed')).toBe(false);
    expect(BOOL_FIELD_KEYS.has('state')).toBe(false);
    expect(BOOL_FIELD_KEYS.has('does_not_exist')).toBe(false);
    expect(BOOL_FIELD_KEYS.has('')).toBe(false);
  });

  it('stays in exact sync with BOOLEAN_SIGNAL_FIELDS', () => {
    expect(BOOL_FIELD_KEYS.size).toBe(BOOLEAN_SIGNAL_FIELDS.length);
    expect([...BOOL_FIELD_KEYS].sort()).toEqual(
      BOOLEAN_SIGNAL_FIELDS.map((f) => f.key).sort(),
    );
  });
});

// ── SIGNAL_FIELD_OPTIONS (untranslated fallback) ──────────────────────────────

describe('SIGNAL_FIELD_OPTIONS', () => {
  it('emits one {value,label} option per field, preserving order', () => {
    expect(SIGNAL_FIELD_OPTIONS).toHaveLength(SIGNAL_FIELDS.length);
    expect(SIGNAL_FIELD_OPTIONS.map((o) => o.value)).toEqual(SIGNAL_FIELDS.map((f) => f.key));
  });

  it('uses the raw key as value and the English label as label', () => {
    SIGNAL_FIELD_OPTIONS.forEach((opt: SignalFieldOption, i) => {
      expect(opt.value).toBe(SIGNAL_FIELDS[i].key);
      expect(opt.label).toBe(SIGNAL_FIELDS[i].label);
    });
    expect(SIGNAL_FIELD_OPTIONS[0]).toEqual({ value: 'battery_level', label: 'Battery Level' });
  });
});

// ── buildSignalFieldOptions (locale-aware) ────────────────────────────────────

describe('buildSignalFieldOptions', () => {
  it('falls back to the English label when the translator echoes the fallback', () => {
    expect(buildSignalFieldOptions(echoT)).toEqual(SIGNAL_FIELD_OPTIONS);
  });

  it('translates the label while keeping the raw signal key as value', () => {
    const localised = ((_key: string, fallback?: string) => `de:${fallback ?? _key}`) as unknown as TFunction;
    const options = buildSignalFieldOptions(localised);
    expect(options[0]).toEqual({ value: 'battery_level', label: 'de:Battery Level' });
    expect(options.map((o) => o.value)).toEqual(SIGNAL_FIELDS.map((f) => f.key));
    expect(options.every((o) => o.label.startsWith('de:'))).toBe(true);
  });

  it('invokes t exactly once per field with (labelKey, englishLabel)', () => {
    const spy = vi.fn((_key: string, fallback?: string) => fallback ?? _key);
    buildSignalFieldOptions(spy as unknown as TFunction);
    expect(spy).toHaveBeenCalledTimes(SIGNAL_FIELDS.length);
    expect(spy).toHaveBeenCalledWith('automations.builder.signals.batteryLevel', 'Battery Level');
    expect(spy).toHaveBeenCalledWith('automations.builder.signals.state', 'Vehicle State');
  });

  it('returns a fresh array each call so it is safe to memoise', () => {
    const first = buildSignalFieldOptions(echoT);
    const second = buildSignalFieldOptions(echoT);
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });
});
