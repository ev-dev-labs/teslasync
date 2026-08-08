import { describe, it, expect } from 'vitest';
import {
  maskVin,
  resolveVinDisclosure,
  coarsenToDay,
  applyDatePrecision,
  scrubSensitiveRecord,
  buildHardExclusionEntries,
  buildSectionExclusionEntries,
  buildSensitiveFieldEntries,
  buildRedactionManifest,
} from './redaction';
import { ALL_EVIDENCE_SECTIONS, HARD_EXCLUDED_CATEGORIES } from './constants';

describe('VIN disclosure', () => {
  const vin = '5YJ3E1EA7KF123456';

  it('excludes the VIN entirely by default ("excluded")', () => {
    expect(resolveVinDisclosure(vin, 'excluded')).toEqual({ vin_masked: null, vin_full: null });
  });

  it('masked shows only the masked form, never the raw VIN', () => {
    const result = resolveVinDisclosure(vin, 'masked');
    expect(result.vin_full).toBeNull();
    expect(result.vin_masked).toBe(maskVin(vin));
    expect(result.vin_masked).not.toContain(vin);
  });

  it('full includes both the masked and full VIN', () => {
    const result = resolveVinDisclosure(vin, 'full');
    expect(result.vin_full).toBe(vin);
    expect(result.vin_masked).toBe(maskVin(vin));
  });

  it('handles a missing/null VIN gracefully for every disclosure level', () => {
    expect(resolveVinDisclosure(null, 'full')).toEqual({ vin_masked: null, vin_full: null });
    expect(resolveVinDisclosure(undefined, 'masked')).toEqual({ vin_masked: null, vin_full: null });
  });
});

describe('date precision', () => {
  it('coarsenToDay truncates an ISO timestamp to YYYY-MM-DD', () => {
    expect(coarsenToDay('2024-03-15T13:45:30.123Z')).toBe('2024-03-15');
  });

  it('coarsenToDay passes through null', () => {
    expect(coarsenToDay(null)).toBeNull();
    expect(coarsenToDay(undefined)).toBeNull();
  });

  it('coarsenToDay returns malformed input unchanged rather than throwing', () => {
    expect(coarsenToDay('not-a-date')).toBe('not-a-date');
  });

  it('applyDatePrecision("day") truncates; applyDatePrecision("exact") passes through unchanged', () => {
    const iso = '2024-03-15T13:45:30.123Z';
    expect(applyDatePrecision(iso, 'day')).toBe('2024-03-15');
    expect(applyDatePrecision(iso, 'exact')).toBe(iso);
  });
});

describe('scrubSensitiveRecord (opaque warranty payload scrubber)', () => {
  it('drops keys matching sensitive patterns at the top level', () => {
    const scrubbed = scrubSensitiveRecord({
      vin: '5YJ3E1EA7KF123456',
      warranty_plan: 'Basic',
      owner_email: 'someone@example.com',
    }) as Record<string, unknown>;
    expect(scrubbed).not.toHaveProperty('vin');
    expect(scrubbed).not.toHaveProperty('owner_email');
    expect(scrubbed.warranty_plan).toBe('Basic');
  });

  it('drops sensitive keys recursively inside nested objects and arrays', () => {
    const scrubbed = scrubSensitiveRecord({
      plans: [
        { name: 'Basic', account_id: 'acct_123', expires: '2026-01-01' },
        { name: 'Extended', driver_name: 'Jane Doe', expires: '2027-01-01' },
      ],
      service_address: { street: '123 Main St', city: 'Springfield' },
    }) as Record<string, unknown>;
    const plans = scrubbed.plans as Array<Record<string, unknown>>;
    expect(plans[0]).not.toHaveProperty('account_id');
    expect(plans[1]).not.toHaveProperty('driver_name');
    expect(plans[0]?.name).toBe('Basic');
    expect(scrubbed).not.toHaveProperty('service_address');
  });

  it('drops keys referencing coordinates (lat/lng/latitude/longitude/geo)', () => {
    const scrubbed = scrubSensitiveRecord({
      lat: 37.7,
      lng: -122.4,
      latitude: 37.7,
      longitude: -122.4,
      geo_hash: 'abc123',
      plan: 'Basic',
    }) as Record<string, unknown>;
    expect(Object.keys(scrubbed)).toEqual(['plan']);
  });

  it('is null-safe and total: never throws on odd input shapes', () => {
    expect(scrubSensitiveRecord(null)).toBeNull();
    expect(scrubSensitiveRecord(undefined)).toBeNull();
    expect(scrubSensitiveRecord(NaN)).toBeNull();
    expect(scrubSensitiveRecord(() => 1)).toBeNull();
    expect(scrubSensitiveRecord(new Map([['a', 1]]))).toBeNull();
  });

  it('produces a plain, canonicalizable JSON value (no functions/undefined survive)', () => {
    const scrubbed = scrubSensitiveRecord({ a: 1, b: undefined, c: () => 1, d: { e: 'ok' } });
    expect(() => JSON.stringify(scrubbed)).not.toThrow();
  });
});

describe('redaction manifest assembly', () => {
  it('always includes every hard-excluded category, regardless of selection', () => {
    const entries = buildHardExclusionEntries();
    expect(entries.map((e) => e.field).sort()).toEqual([...HARD_EXCLUDED_CATEGORIES].sort());
    for (const entry of entries) {
      expect(entry.reason.length).toBeGreaterThan(10);
    }
  });

  it('hard exclusions appear even for a maximally-permissive custom selection with every field opted in', () => {
    const manifest = buildRedactionManifest(ALL_EVIDENCE_SECTIONS, ALL_EVIDENCE_SECTIONS, {
      vinDisclosure: 'full',
      exactTimestamps: true,
    });
    expect(manifest.hard_excluded.length).toBe(HARD_EXCLUDED_CATEGORIES.length);
  });

  it('lists sections omitted by the current profile under excluded_by_selection', () => {
    const entries = buildSectionExclusionEntries(ALL_EVIDENCE_SECTIONS, ['vehicle_identity', 'battery']);
    const excludedFields = entries.map((e) => e.field);
    expect(excludedFields).toContain('evidence.driving_history');
    expect(excludedFields).toContain('evidence.security_incidents');
    expect(excludedFields).not.toContain('evidence.vehicle_identity');
    expect(excludedFields).not.toContain('evidence.battery');
  });

  it('when all sections are selected, excluded_by_selection is empty', () => {
    expect(buildSectionExclusionEntries(ALL_EVIDENCE_SECTIONS, ALL_EVIDENCE_SECTIONS)).toEqual([]);
  });

  it('default (day precision, VIN excluded) selection yields a coarsened timestamp entry and no included_with_warning entries', () => {
    const { coarsened, includedWithWarning } = buildSensitiveFieldEntries({
      vinDisclosure: 'excluded',
      exactTimestamps: false,
    });
    expect(coarsened).toHaveLength(1);
    expect(includedWithWarning).toHaveLength(0);
  });

  it('opting into exact timestamps AND a VIN disclosure level produces matching included_with_warning entries', () => {
    const { coarsened, includedWithWarning } = buildSensitiveFieldEntries({
      vinDisclosure: 'masked',
      exactTimestamps: true,
    });
    expect(coarsened).toHaveLength(0);
    expect(includedWithWarning.map((e) => e.field)).toEqual(
      expect.arrayContaining(['timestamps', 'vehicle_identity.vin_masked']),
    );
    for (const entry of includedWithWarning) {
      expect(entry.reason).toMatch(/warning/i);
    }
  });

  it('full VIN disclosure warning is distinct from masked VIN disclosure warning', () => {
    const full = buildSensitiveFieldEntries({ vinDisclosure: 'full', exactTimestamps: false });
    const masked = buildSensitiveFieldEntries({ vinDisclosure: 'masked', exactTimestamps: false });
    expect(full.includedWithWarning[0]?.field).toBe('vehicle_identity.vin_full');
    expect(masked.includedWithWarning[0]?.field).toBe('vehicle_identity.vin_masked');
    expect(full.includedWithWarning[0]?.reason).not.toBe(masked.includedWithWarning[0]?.reason);
  });
});
