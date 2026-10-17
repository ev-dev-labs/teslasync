import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import i18n from 'i18next';
import en from '@/i18n/en.json';
import { fmtNumber, getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { RECONSTRUCTION } from './constants';
import { alignSignalHistoryToClip, resolveClipEpochMs, toReconstructionMarkers, type SignalPointLike } from './timelineAlignment';

const preferences = getFormatterPreferences();
beforeAll(async () => {
  await i18n.init({
    lng: 'en', fallbackLng: 'en',
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
});
afterEach(async () => {
  await i18n.changeLanguage('en');
  setGlobalLocale(preferences.locale);
  setGlobalPrecision(preferences.precision);
});

const clipStartEpochMs = Date.parse('2026-10-14T12:00:00Z');
const timestamp = (seconds: number) => new Date(clipStartEpochMs + seconds * 1000).toISOString();

function align(points: SignalPointLike[], preRollSeconds = 0, postRollSeconds = 0) {
  return alignSignalHistoryToClip({
    clipStartEpochMs,
    clipDurationSeconds: 100,
    preRollSeconds,
    postRollSeconds,
    seriesInput: [{ signal: 'Test', points }],
  });
}

const samples = (offsets: number[]) => offsets.map((seconds) => ({ timestamp: timestamp(seconds), valueNum: 0 }));

describe('requested-window coverage', () => {
  it.each([
    ['leading', [60, 80, 100]],
    ['trailing', [0, 20, 40]],
    ['interior', [0, 10, 90, 100]],
  ])('reports the actual %s gap rather than inventing continuity', (_, offsets) => {
    const result = align(samples(offsets));
    expect(result.series[0].coverage).toBe('partial');
    expect(result.overallQuality).toBe('partial');
    expect(result.series[0].gapNotes[0]).toContain(offsets.length === 3 ? `${fmtNumber(60)}s (60%` : `${fmtNumber(80)}s (80%`);
    expect(result.series[0].points.map((point) => point.atSeconds)).toEqual(offsets);
  });

  it('uses the existing strict gap fraction threshold', () => {
    const threshold = RECONSTRUCTION.gapWindowFraction * 100;
    expect(align(samples([threshold, 70, 100])).series[0].coverage).toBe('good');
    expect(align(samples([threshold + 0.001, 70, 100])).series[0].coverage).toBe('partial');
    expect(align(samples([0, 30, 100 - threshold])).series[0].coverage).toBe('good');
    expect(align(samples([0, 30, 100 - threshold - 0.001])).series[0].coverage).toBe('partial');
  });

  it('includes requested pre/post roll in boundary gap accounting', () => {
    const result = align(samples([0, 50, 100]), 100, 10);
    expect(result.reconstructionWindow).toEqual({ startSeconds: -100, endSeconds: 110 });
    expect(result.series[0].coverage).toBe('partial');
    expect(result.series[0].gapNotes[0]).toContain(`${fmtNumber(100)}s (48%`);
    expect(align(samples([0, 50, 100]), 10, 100).series[0].coverage).toBe('partial');
  });

  it('keeps sparse and absent coverage distinct', () => {
    expect(align([]).series[0].coverage).toBe('none');
    expect(align(samples([0, 100])).series[0].coverage).toBe('sparse');
  });
});

describe('retained measurement evidence', () => {
  it('retains all points, duplicate timestamps, signed values and fractional offsets without sampling', () => {
    const offsets = Array.from({ length: 501 }, (_, i) => -0.5 + i * 0.25);
    const input = offsets.map((seconds, i) => ({ timestamp: timestamp(seconds), valueNum: (i - 250) / 8 }));
    input.push({ timestamp: timestamp(0), valueNum: -0.125 });
    const result = align(input.reverse(), 0.5, 24.5);
    expect(result.series[0].points).toHaveLength(502);
    expect(result.series[0].points[0]).toMatchObject({ atSeconds: -0.5, value: -31.25 });
    expect(result.series[0].points.at(-1)).toMatchObject({ atSeconds: 124.5, value: 31.25 });
    expect(result.series[0].points.filter((point) => point.atSeconds === 0)).toHaveLength(2);
    expect(result.series[0].points.some((point) => point.value === 0)).toBe(true);
    expect(result.series[0].coverage).toBe('good');
  });

  describe('aggregate reconstruction coverage', () => {
    const window = { clipStartEpochMs, clipDurationSeconds: 100, preRollSeconds: 0, postRollSeconds: 0 };
    const populated = {
      signal: 'DoorState',
      points: [0, 25, 50, 75, 100].map((seconds) => ({
        timestamp: timestamp(seconds),
        valueBool: seconds >= 50,
      })),
    };

    it.each([
      { signal: 'Empty', points: [] },
      { signal: 'Unusable', points: [{ timestamp: timestamp(0), valueNum: NaN }] },
      { signal: 'Outside', points: samples([101]) },
    ])('reports partial for good coverage mixed with missing $signal coverage', (missing) => {
      const baseline = alignSignalHistoryToClip({ ...window, seriesInput: [populated] });
      const result = alignSignalHistoryToClip({ ...window, seriesInput: [missing, populated] });

      expect(baseline.overallQuality).toBe('good');
      expect(result.overallQuality).toBe('partial');
      expect(result.series.map((series) => series.signal)).toEqual([missing.signal, populated.signal]);
      expect(result.series[0].coverage).toBe('none');
      expect(result.series[0].points).toEqual(missing.signal === 'Unusable'
        ? [{ atSeconds: 0, timestamp: timestamp(0), value: null }]
        : []);
      expect(result.series[0].gapNotes).toHaveLength(1);
      expect(result.series[0].gapNotes[0]).toContain(`"${missing.signal}"`);
      expect(result.series[1]).toEqual(baseline.series[0]);
      expect(result.qualityNotes).toEqual(result.series.flatMap((series) => series.gapNotes));
      expect(baseline.incidentSequence).toHaveLength(1);
      expect(result.incidentSequence).toEqual([
        { ...baseline.incidentSequence[0], id: expect.any(String) },
      ]);
      expect(result.clipWindow).toEqual(baseline.clipWindow);
      expect(result.reconstructionWindow).toEqual(baseline.reconstructionWindow);
    });

    it('retains none and per-series evidence when all selected coverage is missing', () => {
      const result = alignSignalHistoryToClip({
        ...window,
        seriesInput: [
          { signal: 'Empty', points: [] },
          { signal: 'Unusable', points: [{ timestamp: timestamp(0) }] },
        ],
      });

      expect(result.overallQuality).toBe('none');
      expect(result.series.map((series) => series.coverage)).toEqual(['none', 'none']);
      expect(result.series.map((series) => series.signal)).toEqual(['Empty', 'Unusable']);
      expect(result.series[1].points).toEqual([{ atSeconds: 0, timestamp: timestamp(0), value: null }]);
      expect(result.qualityNotes).toHaveLength(2);
      expect(result.incidentSequence).toEqual([]);
    });

    it.each([
      { offsets: [0, 25], coverage: 'sparse', overallQuality: 'partial' },
      { offsets: [0, 1, 100], coverage: 'partial', overallQuality: 'partial' },
      { offsets: [0, 25, 50, 75, 100], coverage: 'good', overallQuality: 'good' },
    ])('preserves populated $coverage coverage', ({ offsets, coverage, overallQuality }) => {
      const result = alignSignalHistoryToClip({
        ...window,
        seriesInput: [populated, { signal: 'Measured', points: samples(offsets) }],
      });

      expect(result.overallQuality).toBe(overallQuality);
      expect(result.series.map((series) => series.coverage)).toEqual(['good', coverage]);
      expect(result.series[1].points.map((point) => point.atSeconds)).toEqual(offsets);
      expect(result.series[1].gapNotes).toHaveLength(coverage === 'good' ? 0 : 1);
      expect(result.incidentSequence).toEqual([
        expect.objectContaining({ signal: 'DoorState', kind: 'state_change', atSeconds: 50 }),
      ]);
    });

    it('retains the explicit no-selection result', () => {
      const result = alignSignalHistoryToClip({ ...window, seriesInput: [] });

      expect(result.overallQuality).toBe('none');
      expect(result.series).toEqual([]);
      expect(result.qualityNotes).toEqual(['No telemetry signals were selected for this reconstruction.']);
      expect(result.incidentSequence).toEqual([]);
    });
  });

  it('retains missing and non-finite values as null, not measured zero or coverage', () => {
    const points: SignalPointLike[] = [
      { timestamp: timestamp(0) },
      { timestamp: timestamp(10), valueNum: NaN },
      { timestamp: timestamp(20), valueNum: Infinity },
      { timestamp: timestamp(100), valueNum: -Infinity },
    ];
    const result = align(points);
    expect(result.series[0].points.map((point) => point.value)).toEqual([null, null, null, null]);
    expect(result.series[0].coverage).toBe('none');
    expect(result.series[0].gapNotes[0]).toContain('No usable telemetry values');
    expect(result.incidentSequence).toEqual([]);
    expect(align(samples([0, 30, 60, 100])).series[0].coverage).toBe('good');
  });

  it('does not use unknown boundary values to fill uncovered spans', () => {
    const result = align([{ timestamp: timestamp(0) }, ...samples([60, 80, 100])]);
    expect(result.series[0].points).toHaveLength(4);
    expect(result.series[0].coverage).toBe('partial');
    expect(result.series[0].gapNotes[0]).toContain(`${fmtNumber(60)}s`);
  });

  describe('localized generated evidence', () => {
    it('uses catalog plurals without changing sample counts or identifiers', () => {
      const signal = 'Raw<&>{{signal}}';
      for (const count of [1, 2]) {
        const result = alignSignalHistoryToClip({
          clipStartEpochMs, clipDurationSeconds: 100, preRollSeconds: 0, postRollSeconds: 0,
          seriesInput: [{ signal, points: samples([0, 100].slice(0, count)) }],
        });
        expect(result.series[0].gapNotes).toEqual([
          `Only ${count} ${count === 1 ? 'sample' : 'samples'} for "${signal}" — too few to plot a reliable trend.`,
        ]);
        expect(result.series[0].signal).toBe(signal);
        expect(result.series[0].points).toHaveLength(count);
      }
    });

    it('localizes templates, directions and hints, preserving signed raw evidence and stored descriptions', async () => {
      i18n.addResourceBundle('de', 'translation', { dashcam: { reconstruction: {
        clipStart: 'Clip-Anfang', clipEnd: 'Clip-Ende',
        generated: {
          sparse_one: '{{samples}} Messpunkt: {{signal}}',
          sparse_other: '{{samples}} Messpunkte: {{signal}}',
          gap: '{{signal}} Lücke {{gap}}s ({{percent}}%)',
          decrease: 'Abnahme', increase: 'Zunahme', hardBrake: 'starkes Bremsen',
          hintedSpike: '{{signal}} {{hint}} {{direction}} z={{z}} t={{at}}s',
          spike: '{{signal}} {{direction}} {{delta}} z={{z}} t={{at}}s',
          stateChange: '{{signal}} Zustand {{value}} t={{at}}s',
          noSamples: '{{signal}} keine Messpunkte',
          noValues: '{{signal}} keine Werte',
          noSelection: 'Keine Signale ausgewählt',
        },
      } } }, true, true);
      const params = {
        clipStartEpochMs, clipDurationSeconds: 100, preRollSeconds: 10, postRollSeconds: 0,
        seriesInput: [
          { signal: 'Raw<&>', points: [0, -0.01, -0.02, -2.345].map((valueNum, i) => ({
            timestamp: timestamp(-5 + i), valueNum,
          })) },
          { signal: 'VehicleBrakePressure', points: [0, 0.01, 0.02, 2.345].map((valueNum, i) => ({
            timestamp: timestamp(i), valueNum,
          })) },
          { signal: 'DoorState', points: [
            { timestamp: timestamp(-1.25), valueBool: false },
            { timestamp: timestamp(-0.5), valueStr: 'RAW<&>{{value}}' },
          ] },
          { signal: 'Missing', points: [] },
          { signal: 'Unknown', points: [{ timestamp: timestamp(0) }] },
        ],
      };
      const stored = alignSignalHistoryToClip(params);
      const snapshot = JSON.stringify(stored);
      await i18n.changeLanguage('de');
      setGlobalLocale('de-DE');
      setGlobalPrecision(3);
      const localized = alignSignalHistoryToClip(params);
      expect(localized.series[0].gapNotes[0]).toBe('Raw<&> Lücke 102,000s (93%)');
      expect(localized.series[2].gapNotes[0]).toBe('2 Messpunkte: DoorState');
      expect(localized.series[3].gapNotes[0]).toBe('Missing keine Messpunkte');
      expect(localized.series[4].gapNotes[0]).toBe('Unknown keine Werte');
      expect(localized.incidentSequence.map((event) => event.description)).toEqual([
        'Raw<&> Abnahme -2,325 z=232,500 t=-2,000s',
        'DoorState Zustand RAW<&>{{value}} t=-0,500s',
        'VehicleBrakePressure starkes Bremsen Zunahme z=232,500 t=3,000s',
      ]);
      expect(localized.series.map(({ gapNotes: _notes, ...series }) => series))
        .toEqual(stored.series.map(({ gapNotes: _notes, ...series }) => series));
      expect(localized.incidentSequence.map(({ description: _text, id: _id, ...event }) => event))
        .toEqual(stored.incidentSequence.map(({ description: _text, id: _id, ...event }) => event));
      expect(localized.overallQuality).toBe(stored.overallQuality);
      const markers = toReconstructionMarkers(stored);
      expect(markers.slice(0, 2).map((marker) => marker.label)).toEqual(['Clip-Anfang', 'Clip-Ende']);
      expect(markers.slice(2).map((marker) => marker.label)).toEqual(stored.incidentSequence.map((event) => event.description));
      expect(JSON.stringify(stored)).toBe(snapshot);
      expect(alignSignalHistoryToClip({ ...params, seriesInput: [] }).qualityNotes).toEqual(['Keine Signale ausgewählt']);
    });

    it('keeps tiny negative deltas visible instead of rounding them to unsigned zero', () => {
      setGlobalPrecision(0);
      const result = align([0, -0.000001, -0.000002, -0.0001].map((valueNum, i) => ({
        timestamp: timestamp(i), valueNum,
      })));
      expect(result.incidentSequence[0].description).toContain('-9.80E-5');
      expect(result.series[0].points.at(-1)?.value).toBe(-0.0001);
    });
  });

  it('preserves false and empty text as real observations and skips unalignable timestamps', () => {
    const result = align([
      { timestamp: 'invalid', valueNum: 0 },
      { timestamp: timestamp(0), valueBool: false },
      { timestamp: timestamp(30), valueStr: '' },
      { timestamp: timestamp(60), valueNum: 0 },
      { timestamp: timestamp(100), valueNum: -0.25 },
    ]);
    expect(result.series[0].points.map((point) => point.value)).toEqual([false, '', 0, -0.25]);
    expect(result.series[0].coverage).toBe('good');
  });

  it('distinguishes invalid clock inputs from zero and signed fractional timezone offsets', () => {
    expect(resolveClipEpochMs(null, 0)).toBeNull();
    expect(resolveClipEpochMs('invalid', 0)).toBeNull();
    for (const offset of [NaN, Infinity, -Infinity]) {
      expect(resolveClipEpochMs('2026-10-14T12:00:00', offset)).toBeNull();
    }
    for (const offset of [0, -420, 330, -0.5, 0.5]) {
      expect(resolveClipEpochMs('2026-10-14T12:00:00', offset)).toBe(clipStartEpochMs - offset * 60_000);
    }
  });
});
