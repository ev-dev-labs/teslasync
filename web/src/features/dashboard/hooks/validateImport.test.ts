/**
 * validateImport unit tests.
 *
 * This module is the pure, network-free "safe import" layer for dashboard
 * layouts. It has four exports and these tests drive every branch of each:
 *
 *   - validateImportData(raw)   — parse + shape-check + registry-availability
 *     filtering + layout sanitisation. Covered: malformed JSON, non-object /
 *     array roots, each missing-required-field, registry hit/miss/all-miss,
 *     duplicate + missing widget-id de-duplication, name truncation, config
 *     passthrough, layout item dropping, and the coordinate sanitiser's
 *     integer + fit-inside-grid guarantees (the two bugs this file fixes).
 *   - toUrlSafeBase64 / fromUrlSafeBase64 — ASCII + full-UTF-8 round trips,
 *     URL-safe alphabet (no + / =), and empty input.
 *   - buildMinimalExport — strips ids/timestamps, keeps name/widgets/layouts,
 *     preserves/omits per-widget config, and survives a full
 *     export → encode → decode → re-validate round trip.
 *
 * The real widget registry runs (no mock) so availability reflects production:
 * `vehicle-hero`, `battery-gauge`, `recent-drives` are canonical ids;
 * `not-a-real-widget` never is. No network, timers, or DOM are touched.
 */
import { describe, it, expect } from 'vitest';

import {
  validateImportData,
  toUrlSafeBase64,
  fromUrlSafeBase64,
  buildMinimalExport,
  type ImportValidation,
} from './validateImport';
import type { SavedDashboard } from '../widgets/types';

// ── Canonical registry ids (see registry/*.ts) + a guaranteed-missing one. ──
const REAL_A = 'vehicle-hero';
const REAL_B = 'battery-gauge';
const REAL_C = 'recent-drives';
const MISSING = 'not-a-real-widget';

/** Assert a validation succeeded and return the non-null dashboard, narrowed. */
function expectValidDashboard(result: ImportValidation): SavedDashboard {
  expect(result.isValid).toBe(true);
  const { dashboard } = result;
  if (!dashboard) throw new Error('expected a non-null dashboard on a valid import');
  return dashboard;
}

function validRaw(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: 'My Fleet Dashboard',
    widgets: [
      { id: 'w1', widgetId: REAL_A },
      { id: 'w2', widgetId: REAL_B },
    ],
    layouts: {
      lg: [
        { i: 'w1', x: 0, y: 0, w: 2, h: 2 },
        { i: 'w2', x: 2, y: 0, w: 2, h: 2 },
      ],
    },
    ...overrides,
  });
}

describe('validateImportData — parsing + root shape', () => {
  it('rejects malformed JSON with a single error and a null dashboard', () => {
    const result = validateImportData('definitely {not} json');

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(['Invalid JSON format']);
    expect(result.dashboard).toBeNull();
    expect(result.availableWidgets).toEqual([]);
    expect(result.missingWidgets).toEqual([]);
  });

  it('rejects a JSON array root (not an object)', () => {
    const result = validateImportData('[1, 2, 3]');
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Expected a JSON object');
    expect(result.dashboard).toBeNull();
  });

  it.each([
    ['a bare number', '42'],
    ['a bare string', '"hello"'],
    ['a literal null', 'null'],
  ])('rejects %s root as not-an-object', (_label, raw) => {
    const result = validateImportData(raw);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Expected a JSON object');
  });
});

describe('validateImportData — required fields', () => {
  it('flags a missing/invalid name field', () => {
    const result = validateImportData(validRaw({ name: 123 }));
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Missing or invalid "name" field');
    expect(result.dashboard).toBeNull();
  });

  it('flags a missing widgets array', () => {
    const result = validateImportData(validRaw({ widgets: 'nope' }));
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Missing or invalid "widgets" array');
  });

  it('flags a missing layouts object', () => {
    const result = validateImportData(validRaw({ layouts: null }));
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Missing or invalid "layouts" object');
  });

  it('accumulates every missing-field error at once', () => {
    const result = validateImportData(JSON.stringify({}));
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'Missing or invalid "name" field',
        'Missing or invalid "widgets" array',
        'Missing or invalid "layouts" object',
      ]),
    );
    expect(result.errors).toHaveLength(3);
  });
});

describe('validateImportData — widget availability', () => {
  it('builds a validated dashboard from registry-available widgets', () => {
    const result = validateImportData(validRaw());
    const dashboard = expectValidDashboard(result);

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.availableWidgets).toEqual([REAL_A, REAL_B]);
    expect(result.missingWidgets).toEqual([]);
    expect(dashboard.name).toBe('My Fleet Dashboard');
    expect(dashboard.widgets).toHaveLength(2);
    expect(dashboard.isDefault).toBe(false);
    expect(dashboard.id).toMatch(/^import-\d+$/);
    // ISO timestamps are stamped fresh for the imported copy.
    expect(dashboard.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(dashboard.updatedAt).toBe(dashboard.createdAt);
  });

  it('warns about unavailable widgets, keeps the compatible ones, and records both sets', () => {
    const raw = validRaw({
      widgets: [
        { id: 'w1', widgetId: REAL_A },
        { id: 'wX', widgetId: MISSING },
      ],
      layouts: { lg: [{ i: 'w1', x: 0, y: 0, w: 2, h: 2 }] },
    });
    const result = validateImportData(raw);
    const dashboard = expectValidDashboard(result);

    expect(result.warnings).toContain('1 widget(s) not available and will be skipped');
    expect(result.availableWidgets).toEqual([REAL_A]);
    expect(result.missingWidgets).toEqual([MISSING]);
    expect(dashboard.widgets.map((w) => w.widgetId)).toEqual([REAL_A]);
  });

  it('fails when no widget is compatible with the registry', () => {
    const raw = validRaw({
      widgets: [{ id: 'wX', widgetId: MISSING }],
      layouts: { lg: [] },
    });
    const result = validateImportData(raw);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('No compatible widgets found in this layout');
    expect(result.dashboard).toBeNull();
    expect(result.missingWidgets).toEqual([MISSING]);
  });

  it('skips malformed widget entries (non-objects and those without a string widgetId)', () => {
    const raw = validRaw({
      widgets: [
        null,
        42,
        { id: 'bad', widgetId: 999 },
        { id: 'good', widgetId: REAL_C },
      ],
      layouts: { lg: [{ i: 'good', x: 0, y: 0, w: 1, h: 1 }] },
    });
    const dashboard = expectValidDashboard(validateImportData(raw));

    expect(dashboard.widgets).toHaveLength(1);
    expect(dashboard.widgets[0].widgetId).toBe(REAL_C);
  });

  it('assigns unique ids to widgets that share or omit an id', () => {
    const raw = validRaw({
      widgets: [
        { id: 'dup', widgetId: REAL_A },
        { id: 'dup', widgetId: REAL_B },
        { widgetId: REAL_C },
      ],
      layouts: { lg: [] },
    });
    const dashboard = expectValidDashboard(validateImportData(raw));

    const ids = dashboard.widgets.map((w) => w.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it('preserves object config and drops non-object config to undefined', () => {
    const raw = validRaw({
      widgets: [
        { id: 'w1', widgetId: REAL_A, config: { chartType: 'bar' } },
        { id: 'w2', widgetId: REAL_B, config: 'not-an-object' },
      ],
      layouts: { lg: [] },
    });
    const dashboard = expectValidDashboard(validateImportData(raw));

    expect(dashboard.widgets[0].config).toEqual({ chartType: 'bar' });
    expect(dashboard.widgets[1].config).toBeUndefined();
  });

  it('truncates an overlong name to 100 characters', () => {
    const dashboard = expectValidDashboard(
      validateImportData(validRaw({ name: 'x'.repeat(250) })),
    );
    expect(dashboard.name).toHaveLength(100);
  });
});

describe('validateImportData — layout sanitisation', () => {
  it('keeps a widget inside the grid when x + w would overflow the columns', () => {
    // lg has 4 columns. x=3,w=3 => x+w=6 overflows the right edge; the
    // sanitiser must pull x back to cols - w (= 1) so the widget fits.
    const raw = validRaw({
      widgets: [{ id: 'w1', widgetId: REAL_A }],
      layouts: { lg: [{ i: 'w1', x: 3, y: 0, w: 3, h: 2 }] },
    });
    const dashboard = expectValidDashboard(validateImportData(raw));
    const item = dashboard.layouts.lg[0];

    expect(item.w).toBe(3);
    expect(item.x).toBe(1);
    expect(item.x + item.w).toBeLessThanOrEqual(4);
  });

  it('floors fractional grid coordinates to integers', () => {
    const raw = validRaw({
      widgets: [{ id: 'w1', widgetId: REAL_A }],
      layouts: { lg: [{ i: 'w1', x: 1.7, y: 0.9, w: 2.8, h: 3.4 }] },
    });
    const item = expectValidDashboard(validateImportData(raw)).layouts.lg[0];

    for (const coord of [item.x, item.y, item.w, item.h]) {
      expect(Number.isInteger(coord)).toBe(true);
    }
    expect(item).toMatchObject({ x: 1, y: 0, w: 2, h: 3 });
  });

  it('replaces negative / non-finite coordinates and out-of-range sizes with safe defaults', () => {
    const raw = validRaw({
      widgets: [{ id: 'w1', widgetId: REAL_A }],
      layouts: { lg: [{ i: 'w1', x: -5, y: -3, w: 0, h: 99 }] },
    });
    const item = expectValidDashboard(validateImportData(raw)).layouts.lg[0];

    expect(item.x).toBe(0);
    expect(item.y).toBe(0);
    expect(item.w).toBe(1); // clamped up to the minimum width
    expect(item.h).toBe(8); // clamped down to the maximum height
  });

  it('drops layout entries that reference an unavailable / unknown widget id', () => {
    const raw = validRaw({
      widgets: [{ id: 'w1', widgetId: REAL_A }],
      layouts: {
        lg: [
          { i: 'w1', x: 0, y: 0, w: 1, h: 1 },
          { i: 'ghost', x: 1, y: 0, w: 1, h: 1 },
          { i: 42, x: 2, y: 0, w: 1, h: 1 },
        ],
      },
    });
    const item = expectValidDashboard(validateImportData(raw)).layouts.lg;

    expect(item).toHaveLength(1);
    expect(item[0].i).toBe('w1');
  });

  it('skips non-array breakpoints so they can be regenerated on import', () => {
    const raw = validRaw({
      widgets: [{ id: 'w1', widgetId: REAL_A }],
      layouts: {
        lg: [{ i: 'w1', x: 0, y: 0, w: 1, h: 1 }],
        md: 'garbage',
      },
    });
    const layouts = expectValidDashboard(validateImportData(raw)).layouts;

    expect(layouts.lg).toHaveLength(1);
    expect(layouts.md).toBeUndefined();
  });
});

describe('toUrlSafeBase64 / fromUrlSafeBase64', () => {
  it('round-trips ASCII text', () => {
    const input = 'hello world 123';
    expect(fromUrlSafeBase64(toUrlSafeBase64(input))).toBe(input);
  });

  it('round-trips multi-byte UTF-8 (accents + emoji) without corruption', () => {
    const input = 'café — naïve façade 🚗🔋 日本語';
    const encoded = toUrlSafeBase64(input);
    expect(fromUrlSafeBase64(encoded)).toBe(input);
  });

  it('emits a URL-safe alphabet with no +, / or = padding', () => {
    const encoded = toUrlSafeBase64('any subject / plus+slash payload ????');
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('round-trips the empty string', () => {
    expect(fromUrlSafeBase64(toUrlSafeBase64(''))).toBe('');
  });

  it('round-trips a JSON payload verbatim', () => {
    const json = JSON.stringify({ name: 'Ünïcödé Dash', widgets: [{ id: 'a', widgetId: REAL_A }] });
    expect(fromUrlSafeBase64(toUrlSafeBase64(json))).toBe(json);
  });
});

describe('buildMinimalExport', () => {
  function makeDashboard(overrides: Partial<SavedDashboard> = {}): SavedDashboard {
    return {
      id: 'dash-1',
      name: 'Overview',
      widgets: [
        { id: 'w1', widgetId: REAL_A, config: { chartType: 'line' } },
        { id: 'w2', widgetId: REAL_B },
      ],
      layouts: { lg: [{ i: 'w1', x: 0, y: 0, w: 1, h: 1 }] },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-15T00:00:00.000Z',
      isDefault: true,
      ...overrides,
    };
  }

  it('keeps name/widgets/layouts and strips ids, timestamps and flags', () => {
    const parsed = JSON.parse(buildMinimalExport(makeDashboard())) as Record<string, unknown>;

    expect(Object.keys(parsed).sort()).toEqual(['layouts', 'name', 'widgets']);
    expect(parsed.name).toBe('Overview');
    expect(parsed).not.toHaveProperty('id');
    expect(parsed).not.toHaveProperty('createdAt');
    expect(parsed).not.toHaveProperty('updatedAt');
    expect(parsed).not.toHaveProperty('isDefault');
  });

  it('preserves per-widget config only when present', () => {
    const parsed = JSON.parse(buildMinimalExport(makeDashboard())) as {
      widgets: Array<Record<string, unknown>>;
    };

    expect(parsed.widgets[0]).toEqual({ id: 'w1', widgetId: REAL_A, config: { chartType: 'line' } });
    expect(parsed.widgets[1]).toEqual({ id: 'w2', widgetId: REAL_B });
    expect(parsed.widgets[1]).not.toHaveProperty('config');
  });

  it('produces a payload that survives a full export → encode → decode → re-validate cycle', () => {
    const encoded = toUrlSafeBase64(buildMinimalExport(makeDashboard()));
    const result = validateImportData(fromUrlSafeBase64(encoded));
    const dashboard = expectValidDashboard(result);

    expect(dashboard.name).toBe('Overview');
    expect(dashboard.widgets.map((w) => w.widgetId)).toEqual([REAL_A, REAL_B]);
    expect(dashboard.widgets[0].config).toEqual({ chartType: 'line' });
  });
});
