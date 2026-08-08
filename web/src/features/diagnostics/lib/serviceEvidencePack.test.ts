import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  analyzeRootCause,
  NO_CAUSAL_PROOF_DISCLAIMER,
  type RawSignalPoint,
  type RootCauseAnalysisResult,
} from './rootCauseIntelligence';
import {
  buildServiceEvidencePack,
  buildServiceEvidencePackCore,
  buildServiceEvidencePackFilename,
  canonicalize,
  canonicalStringify,
  CANONICALIZATION_NOTE,
  CryptoUnavailableError,
  SERVICE_EVIDENCE_PACK_EXCLUDED_FIELD_NOTES,
  SERVICE_EVIDENCE_PACK_INCLUDED_VEHICLE_FIELDS,
  SERVICE_EVIDENCE_PACK_SCHEMA_VERSION,
  sha256Hex,
  toPrettyJson,
  type BuildServiceEvidencePackInput,
  type ServiceEvidencePackDocument,
  type VehicleReference,
} from './serviceEvidencePack';

const MIN = 60_000;
const BASE = Date.UTC(2024, 0, 1, 0, 0, 0);

/** Same deterministic sine-hash jitter used across the diagnostics feature's tests. */
function jitter(i: number, amplitude: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  const frac = x - Math.floor(x);
  return (frac - 0.5) * 2 * amplitude;
}

function jitteredStep(params: {
  count: number;
  before: number;
  after: number;
  shiftAtIndex: number;
  jitterAmplitude: number;
}): RawSignalPoint[] {
  const { count, before, after, shiftAtIndex, jitterAmplitude } = params;
  const points: RawSignalPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const ms = BASE + i * MIN;
    const base = i < shiftAtIndex ? before : after;
    points.push({ timestamp: new Date(ms).toISOString(), valueNum: base + jitter(i, jitterAmplitude) });
  }
  return points;
}

function flatConstant(count: number, value: number): RawSignalPoint[] {
  const points: RawSignalPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    points.push({ timestamp: new Date(BASE + i * MIN).toISOString(), valueNum: value });
  }
  return points;
}

/** A populated, realistic analysis: PackVoltage shifts, PackTemperature leads and
 *  clears the evidence bar, BatteryLevel stays flat (candidate with no evidence). */
function buildPopulatedAnalysis(): RootCauseAnalysisResult {
  return analyzeRootCause({
    focalSignal: 'PackVoltage',
    catalog: ['PackVoltage', 'PackTemperature', 'BatteryLevel'],
    focalPoints: jitteredStep({ count: 90, before: 380, after: 350, shiftAtIndex: 45, jitterAmplitude: 0.4 }),
    relatedSeries: [
      { signal: 'PackTemperature', points: jitteredStep({ count: 90, before: 30, after: 45, shiftAtIndex: 35, jitterAmplitude: 0.3 }) },
      { signal: 'BatteryLevel', points: flatConstant(90, 62) },
    ],
  });
}

/** A fully empty analysis — no focal signal selected at all. */
function buildEmptyAnalysis(): RootCauseAnalysisResult {
  return analyzeRootCause({ focalSignal: '', catalog: [], focalPoints: [], relatedSeries: [] });
}

const FIXED_NOW = '2024-06-01T00:00:00.000Z';

function buildInput(overrides?: Partial<BuildServiceEvidencePackInput>): BuildServiceEvidencePackInput {
  return {
    vehicle: { id: 42, displayName: 'Test Model 3' },
    windowHours: 72,
    analysis: buildPopulatedAnalysis(),
    now: () => FIXED_NOW,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────
// canonicalize / canonicalStringify
// ─────────────────────────────────────────────────────────────────────────

describe('canonicalize', () => {
  it('sorts object keys recursively regardless of insertion order', () => {
    const a = { b: 1, a: 2, c: { z: 1, y: 2 } };
    const b = { a: 2, c: { y: 2, z: 1 }, b: 1 };
    expect(canonicalize(a)).toEqual(canonicalize(b));
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
  });

  it('preserves array element order (order is semantically meaningful there)', () => {
    const value = { list: [3, 1, 2] };
    const canonical = canonicalize(value) as { list: number[] };
    expect(canonical.list).toEqual([3, 1, 2]);
  });

  it('recurses into arrays of objects, sorting each element’s keys independently', () => {
    const value = [{ b: 1, a: 2 }, { d: 4, c: 3 }];
    expect(canonicalStringify(value)).toBe('[{"a":2,"b":1},{"c":3,"d":4}]');
  });

  it('passes primitives through unchanged, including null, booleans, and numbers', () => {
    expect(canonicalize(null)).toBeNull();
    expect(canonicalize(true)).toBe(true);
    expect(canonicalize(42)).toBe(42);
    expect(canonicalize('x')).toBe('x');
  });

  it('handles empty objects and empty arrays', () => {
    expect(canonicalStringify({})).toBe('{}');
    expect(canonicalStringify([])).toBe('[]');
  });

  it('produces a deterministic string across repeated calls with the same (re-ordered) input', () => {
    const first = canonicalStringify({ z: 1, a: { y: 2, x: 1 } });
    const second = canonicalStringify({ a: { x: 1, y: 2 }, z: 1 });
    const third = canonicalStringify({ a: { x: 1, y: 2 }, z: 1 });
    expect(first).toBe(second);
    expect(second).toBe(third);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// sha256Hex
// ─────────────────────────────────────────────────────────────────────────

describe('sha256Hex', () => {
  it('computes the known FIPS-180-2 SHA-256("abc") test vector', async () => {
    const hex = await sha256Hex('abc');
    expect(hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('is deterministic for the same input', async () => {
    const a = await sha256Hex('the quick brown fox');
    const b = await sha256Hex('the quick brown fox');
    expect(a).toBe(b);
  });

  it('produces a different digest for different input (avalanche sanity check)', async () => {
    const a = await sha256Hex('input-a');
    const b = await sha256Hex('input-b');
    expect(a).not.toBe(b);
  });

  it('returns a 64-character lowercase hex string', async () => {
    const hex = await sha256Hex('anything');
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('throws CryptoUnavailableError (not a generic error, not a fallback hash) when crypto.subtle is unavailable', async () => {
    vi.stubGlobal('crypto', { subtle: undefined });
    await expect(sha256Hex('abc')).rejects.toBeInstanceOf(CryptoUnavailableError);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// buildServiceEvidencePackCore
// ─────────────────────────────────────────────────────────────────────────

describe('buildServiceEvidencePackCore', () => {
  it('stamps the stable schema version and the injected clock', () => {
    const core = buildServiceEvidencePackCore(buildInput());
    expect(core.schemaVersion).toBe(SERVICE_EVIDENCE_PACK_SCHEMA_VERSION);
    expect(core.schemaVersion).toBe('1.0.0');
    expect(core.generatedAt).toBe(FIXED_NOW);
  });

  it('never throws for an entirely empty/malformed analysis, and yields sane defaults', () => {
    expect(() =>
      buildServiceEvidencePackCore({
        vehicle: { id: 0, displayName: '' },
        windowHours: Number.NaN,
        analysis: buildEmptyAnalysis(),
        now: () => FIXED_NOW,
      }),
    ).not.toThrow();

    const core = buildServiceEvidencePackCore({
      vehicle: { id: 0, displayName: '' },
      windowHours: Number.NaN,
      analysis: buildEmptyAnalysis(),
      now: () => FIXED_NOW,
    });
    expect(core.focalSignal).toBe('');
    expect(core.hypotheses).toEqual([]);
    expect(core.signalEvidence).toEqual([]);
    expect(core.quality.band).toBe('insufficient');
    expect(core.window.hours).toBe(0);
    expect(core.vehicle.displayName).toBe('Vehicle 0');
  });

  it('never throws even when passed `undefined`/malformed nested fields via an unsafe cast', () => {
    const brokenAnalysis = {} as unknown as RootCauseAnalysisResult;
    expect(() =>
      buildServiceEvidencePackCore({ vehicle: { id: 1, displayName: 'X' }, windowHours: 24, analysis: brokenAnalysis }),
    ).not.toThrow();
  });

  describe('vehicle privacy boundary', () => {
    it('includes only { id, displayName } — never VIN, coordinates, address, or tokens', () => {
      const dirtyVehicle = {
        id: 7,
        displayName: 'My Model Y',
        vin: '5YJ3E1EA1JF000001',
        latitude: 37.7749,
        longitude: -122.4194,
        address: '1 Infinite Loop',
        authToken: 'secret-token-value',
      } as unknown as VehicleReference;

      const core = buildServiceEvidencePackCore(buildInput({ vehicle: dirtyVehicle }));

      expect(Object.keys(core.vehicle).sort()).toEqual(['displayName', 'id']);
      expect(core.vehicle).toEqual({ id: 7, displayName: 'My Model Y' });

      const json = JSON.stringify(core);
      expect(json).not.toContain('5YJ3E1EA1JF000001');
      expect(json).not.toContain('37.7749');
      expect(json).not.toContain('-122.4194');
      expect(json).not.toContain('1 Infinite Loop');
      expect(json).not.toContain('secret-token-value');
    });

    it('falls back to a generated display name and id 0 for missing/blank/non-finite fields', () => {
      const core1 = buildServiceEvidencePackCore(buildInput({ vehicle: { id: Number.NaN, displayName: '   ' } }));
      expect(core1.vehicle.id).toBe(0);
      expect(core1.vehicle.displayName).toBe('Vehicle 0');

      const core2 = buildServiceEvidencePackCore(
        buildInput({ vehicle: { id: 9, displayName: undefined as unknown as string } }),
      );
      expect(core2.vehicle.displayName).toBe('Vehicle 9');
    });

    it('matches the exported privacy-manifest constants exactly', () => {
      const core = buildServiceEvidencePackCore(buildInput());
      expect(core.privacy.includedVehicleFields).toEqual([...SERVICE_EVIDENCE_PACK_INCLUDED_VEHICLE_FIELDS]);
      expect(core.privacy.excludedFields).toEqual([...SERVICE_EVIDENCE_PACK_EXCLUDED_FIELD_NOTES]);
      expect(core.privacy.notes.length).toBeGreaterThan(0);
      // The manifest's claim must be true of the actual data, not just asserted:
      // every declared "included" vehicle field is exactly what is present.
      expect(Object.keys(core.vehicle).sort()).toEqual([...core.privacy.includedVehicleFields].sort());
    });
  });

  describe('signal evidence + hypotheses + narrative pass-through', () => {
    it('derives signalEvidence from the analysis graph nodes (focal first, then candidates)', () => {
      const analysis = buildPopulatedAnalysis();
      const core = buildServiceEvidencePackCore(buildInput({ analysis }));
      expect(core.signalEvidence.length).toBe(analysis.graph.nodes.length);
      expect(core.signalEvidence[0]!.signal).toBe('PackVoltage');
      expect(core.signalEvidence[0]!.role).toBe('focal');
      const battery = core.signalEvidence.find((s) => s.signal === 'BatteryLevel');
      expect(battery?.role).toBe('candidate');
      expect(battery?.hasEvidence).toBe(false);
      const temp = core.signalEvidence.find((s) => s.signal === 'PackTemperature');
      expect(temp?.hasEvidence).toBe(true);
    });

    it('maps ranked hypotheses field-for-field, preserving order', () => {
      const analysis = buildPopulatedAnalysis();
      const core = buildServiceEvidencePackCore(buildInput({ analysis }));
      expect(core.hypotheses.length).toBe(analysis.hypotheses.length);
      expect(core.hypotheses.length).toBeGreaterThan(0);
      core.hypotheses.forEach((h, i) => {
        const src = analysis.hypotheses[i]!;
        expect(h.signal).toBe(src.signal);
        expect(h.relation).toBe(src.relation);
        expect(h.lagMs).toBe(src.lagMs);
        expect(h.shift).toEqual(src.shift);
        expect(h.score).toBe(src.score);
        expect(h.sampleCount).toBe(src.sampleCount);
        expect(h.rationale).toBe(src.rationale);
      });
    });

    it('carries the focal signal’s own detected shift (concrete before/after medians), not just an abstract score', () => {
      const analysis = buildPopulatedAnalysis();
      const core = buildServiceEvidencePackCore(buildInput({ analysis }));
      expect(analysis.focalShift).not.toBeNull();
      expect(core.focalShift).toEqual(analysis.focalShift);
      expect(core.focalShift!.before.median).toBeGreaterThan(core.focalShift!.after.median); // 380 -> 350, a drop
    });

    it('records focalShift as null when the analysis withheld evidence', () => {
      const core = buildServiceEvidencePackCore(buildInput({ analysis: buildEmptyAnalysis() }));
      expect(core.focalShift).toBeNull();
    });

    it('reuses quality / limitations / summary from the analysis verbatim', () => {
      const analysis = buildPopulatedAnalysis();
      const core = buildServiceEvidencePackCore(buildInput({ analysis }));
      expect(core.quality).toEqual(analysis.quality);
      expect(core.limitations).toEqual(analysis.limitations);
      expect(core.summary).toBe(analysis.summary);
    });

    it('repeats the canonical no-causal-proof disclaimer verbatim', () => {
      const core = buildServiceEvidencePackCore(buildInput());
      expect(core.disclaimer).toBe(NO_CAUSAL_PROOF_DISCLAIMER);
    });
  });

  describe('window', () => {
    it('carries the requested window hours plus the analysis-derived data window bounds', () => {
      const analysis = buildPopulatedAnalysis();
      const core = buildServiceEvidencePackCore(buildInput({ analysis, windowHours: 168 }));
      expect(core.window.hours).toBe(168);
      expect(core.window.earliestMs).toBe(analysis.dataWindow.earliestMs);
      expect(core.window.latestMs).toBe(analysis.dataWindow.latestMs);
    });

    it('defaults hours to 0 for non-finite/missing values', () => {
      const core = buildServiceEvidencePackCore(buildInput({ windowHours: Number.POSITIVE_INFINITY }));
      expect(core.window.hours).toBe(0);
    });
  });

  describe('software-update context', () => {
    it('is null when omitted', () => {
      const core = buildServiceEvidencePackCore(buildInput());
      expect(core.softwareUpdates).toBeNull();
    });

    it('is null when explicitly null, and an empty array when explicitly empty', () => {
      expect(buildServiceEvidencePackCore(buildInput({ softwareUpdates: null })).softwareUpdates).toBeNull();
      expect(buildServiceEvidencePackCore(buildInput({ softwareUpdates: [] })).softwareUpdates).toEqual([]);
    });

    it('normalizes valid entries and accepts the installed_at snake_case alias', () => {
      const core = buildServiceEvidencePackCore(
        buildInput({
          softwareUpdates: [
            { version: '2024.20.1', status: 'installed', installedAt: '2024-05-01T00:00:00.000Z' },
            { version: '2024.14.9', status: 'installed', installed_at: '2024-01-01T00:00:00.000Z' },
          ],
        }),
      );
      expect(core.softwareUpdates).toEqual([
        { version: '2024.20.1', status: 'installed', installedAt: '2024-05-01T00:00:00.000Z' },
        { version: '2024.14.9', status: 'installed', installedAt: '2024-01-01T00:00:00.000Z' },
      ]);
    });

    it('drops malformed entries and defaults a missing/blank status to "unknown"', () => {
      const core = buildServiceEvidencePackCore(
        buildInput({
          softwareUpdates: [
            null as unknown as { version?: unknown },
            { version: '' },
            { version: 42 as unknown as string },
            { version: '2024.8.1' },
            { version: '2024.8.2', status: '   ' },
          ],
        }),
      );
      expect(core.softwareUpdates).toEqual([
        { version: '2024.8.1', status: 'unknown', installedAt: null },
        { version: '2024.8.2', status: 'unknown', installedAt: null },
      ]);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// buildServiceEvidencePack (async, with digest)
// ─────────────────────────────────────────────────────────────────────────

describe('buildServiceEvidencePack', () => {
  it('produces a document whose integrity block is a real SHA-256 digest, never a signature claim', async () => {
    const doc = await buildServiceEvidencePack(buildInput());
    expect(doc.integrity.algorithm).toBe('SHA-256');
    expect(doc.integrity.digestHex).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.integrity.isSignature).toBe(false);
    expect(doc.integrity.canonicalizationNote).toBe(CANONICALIZATION_NOTE);
  });

  it('is a single flat document (not wrapped in an array), containing both core and integrity fields', async () => {
    const doc = await buildServiceEvidencePack(buildInput());
    expect(Array.isArray(doc)).toBe(false);
    expect(doc.schemaVersion).toBe(SERVICE_EVIDENCE_PACK_SCHEMA_VERSION);
    expect(doc.focalSignal).toBe('PackVoltage');
    expect(typeof doc.integrity).toBe('object');
  });

  it('computes the digest over exactly the canonical core (recomputable independently offline)', async () => {
    const input = buildInput();
    const doc = await buildServiceEvidencePack(input);
    const core = buildServiceEvidencePackCore(input);
    const expected = await sha256Hex(canonicalStringify(core));
    expect(doc.integrity.digestHex).toBe(expected);
  });

  it('is deterministic: identical input (with a fixed clock) yields an identical digest across repeated calls', async () => {
    const input = buildInput();
    const first = await buildServiceEvidencePack(input);
    const second = await buildServiceEvidencePack(input);
    expect(first.integrity.digestHex).toBe(second.integrity.digestHex);
    expect(first).toEqual(second);
  });

  it('is insensitive to the source object key order used to build the input (canonicalization works end-to-end)', async () => {
    const vehicleA: VehicleReference = { id: 1, displayName: 'A' };
    const vehicleB: VehicleReference = { displayName: 'A', id: 1 };
    const analysis = buildPopulatedAnalysis();
    const docA = await buildServiceEvidencePack({ vehicle: vehicleA, windowHours: 72, analysis, now: () => FIXED_NOW });
    const docB = await buildServiceEvidencePack({ vehicle: vehicleB, windowHours: 72, analysis, now: () => FIXED_NOW });
    expect(docA.integrity.digestHex).toBe(docB.integrity.digestHex);
  });

  it('changes the digest when any analyzed content changes (focal signal, hypothesis set, or window)', async () => {
    const base = await buildServiceEvidencePack(buildInput());

    const differentFocal = await buildServiceEvidencePack(
      buildInput({
        analysis: analyzeRootCause({
          focalSignal: 'PackVoltage',
          catalog: ['PackVoltage', 'PackTemperature', 'BatteryLevel'],
          // A materially different shift location/magnitude changes the effect size/rationale text.
          focalPoints: jitteredStep({ count: 90, before: 380, after: 200, shiftAtIndex: 45, jitterAmplitude: 0.4 }),
          relatedSeries: [
            { signal: 'PackTemperature', points: jitteredStep({ count: 90, before: 30, after: 45, shiftAtIndex: 35, jitterAmplitude: 0.3 }) },
            { signal: 'BatteryLevel', points: flatConstant(90, 62) },
          ],
        }),
      }),
    );
    expect(differentFocal.integrity.digestHex).not.toBe(base.integrity.digestHex);

    const differentWindow = await buildServiceEvidencePack(buildInput({ windowHours: 24 }));
    expect(differentWindow.integrity.digestHex).not.toBe(base.integrity.digestHex);

    const differentVehicle = await buildServiceEvidencePack(buildInput({ vehicle: { id: 999, displayName: 'Other' } }));
    expect(differentVehicle.integrity.digestHex).not.toBe(base.integrity.digestHex);
  });

  it('changes the digest when generatedAt changes, even with otherwise-identical content', async () => {
    const a = await buildServiceEvidencePack(buildInput({ now: () => '2024-01-01T00:00:00.000Z' }));
    const b = await buildServiceEvidencePack(buildInput({ now: () => '2024-01-02T00:00:00.000Z' }));
    expect(a.integrity.digestHex).not.toBe(b.integrity.digestHex);
  });

  it('rejects with CryptoUnavailableError (no silent fallback hash) when Web Crypto is unavailable', async () => {
    vi.stubGlobal('crypto', { subtle: undefined });
    await expect(buildServiceEvidencePack(buildInput())).rejects.toBeInstanceOf(CryptoUnavailableError);
  });

  it('produces a stable, exhaustively-enumerable top-level schema', async () => {
    const doc = await buildServiceEvidencePack(buildInput());
    expect(Object.keys(doc).sort()).toEqual(
      [
        'schemaVersion',
        'generatedAt',
        'vehicle',
        'window',
        'focalSignal',
        'focalDomains',
        'focalShift',
        'signalEvidence',
        'hypotheses',
        'quality',
        'limitations',
        'summary',
        'softwareUpdates',
        'privacy',
        'disclaimer',
        'integrity',
      ].sort(),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// toPrettyJson / buildServiceEvidencePackFilename
// ─────────────────────────────────────────────────────────────────────────

describe('toPrettyJson', () => {
  it('produces indented, round-trippable JSON', async () => {
    const doc = await buildServiceEvidencePack(buildInput());
    const pretty = toPrettyJson(doc);
    expect(pretty).toContain('\n  ');
    expect(JSON.parse(pretty)).toEqual(doc);
  });
});

describe('buildServiceEvidencePackFilename', () => {
  it('embeds the vehicle id and a digest prefix, and ends with .json', async () => {
    const doc = await buildServiceEvidencePack(buildInput());
    const filename = buildServiceEvidencePackFilename(doc);
    expect(filename).toMatch(/^service-evidence-pack-42-[0-9a-f]{12}\.json$/);
  });

  it('falls back gracefully if digestHex were ever short/empty (defensive, never throws)', () => {
    const fakeDoc = {
      vehicle: { id: 5, displayName: 'X' },
      integrity: { algorithm: 'SHA-256', digestHex: '', canonicalizationNote: '', isSignature: false },
    } as unknown as ServiceEvidencePackDocument;
    expect(() => buildServiceEvidencePackFilename(fakeDoc)).not.toThrow();
    expect(buildServiceEvidencePackFilename(fakeDoc)).toBe('service-evidence-pack-5-nodigest.json');
  });
});
