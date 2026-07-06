import { describe, it, expect } from 'vitest';

import { WIDGET_REGISTRY, getWidgetDef } from './registry';
import type { WidgetCategory } from './types';

// Mirrors the WidgetCategory union in ./types. Kept explicit so a stray or
// mistyped category on any widget def fails loudly here, at load time, rather
// than silently dropping out of WidgetPicker's category filter at render time.
const VALID_CATEGORIES: readonly WidgetCategory[] = [
  'vehicle',
  'battery',
  'energy',
  'driving',
  'charging',
  'climate',
  'tires',
  'security',
  'commands',
  'media',
  'telemetry',
  'analytics',
  'alerts',
  'automations',
  'system',
  'maps',
];

describe('WIDGET_REGISTRY', () => {
  it('is a non-empty array holding a substantial widget catalogue', () => {
    expect(Array.isArray(WIDGET_REGISTRY)).toBe(true);
    expect(WIDGET_REGISTRY.length).toBeGreaterThan(50);
  });

  it('assigns every widget a unique id (getWidgetDef relies on this)', () => {
    const ids = WIDGET_REGISTRY.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every widget the complete required metadata shape', () => {
    for (const w of WIDGET_REGISTRY) {
      expect(typeof w.id).toBe('string');
      expect(w.id.length).toBeGreaterThan(0);
      expect(w.name.trim().length).toBeGreaterThan(0);
      expect(w.description.trim().length).toBeGreaterThan(0);
      expect(w.icon).toBeDefined();
      // lazy() yields a react.lazy exotic component — an object, never a bare
      // function or null. A missing/undefined component would crash the grid.
      expect(w.component).toBeDefined();
      expect(typeof w.component).toBe('object');
    }
  });

  it('tags every widget with a known category', () => {
    for (const w of WIDGET_REGISTRY) {
      expect(VALID_CATEGORIES).toContain(w.category);
    }
  });

  it('covers all sixteen widget categories exactly', () => {
    const seen = new Set(WIDGET_REGISTRY.map((w) => w.category));
    for (const category of VALID_CATEGORIES) {
      expect(seen.has(category)).toBe(true);
    }
    expect(seen.size).toBe(VALID_CATEGORIES.length);
  });

  it('keeps size bounds coherent: 1 <= min <= default <= max for cols and rows', () => {
    for (const w of WIDGET_REGISTRY) {
      expect(w.minSize.cols).toBeGreaterThanOrEqual(1);
      expect(w.defaultSize.cols).toBeGreaterThanOrEqual(w.minSize.cols);
      expect(w.maxSize.cols).toBeGreaterThanOrEqual(w.defaultSize.cols);

      expect(w.minSize.rows).toBeGreaterThanOrEqual(1);
      expect(w.defaultSize.rows).toBeGreaterThanOrEqual(w.minSize.rows);
      expect(w.maxSize.rows).toBeGreaterThanOrEqual(w.defaultSize.rows);
    }
  });

  it('constrains every column span to the four-column grid', () => {
    for (const w of WIDGET_REGISTRY) {
      expect(w.minSize.cols).toBeLessThanOrEqual(4);
      expect(w.defaultSize.cols).toBeLessThanOrEqual(4);
      expect(w.maxSize.cols).toBeLessThanOrEqual(4);
    }
  });

  it('well-forms optional help metadata wherever it is present', () => {
    const withHelp = WIDGET_REGISTRY.filter((w) => w.help);
    // The registry ships help on a handful of widgets; guard that the branch
    // below actually runs so this assertion is not vacuously true.
    expect(withHelp.length).toBeGreaterThan(0);

    for (const w of withHelp) {
      const help = w.help;
      if (!help) continue;
      // Help must carry either a translation key or a static string.
      expect(Boolean(help.i18nKey) || Boolean(help.text)).toBe(true);
      // A translated help entry must ship a non-empty default fallback.
      if (help.i18nKey) {
        expect(typeof help.defaultValue).toBe('string');
        expect((help.defaultValue ?? '').length).toBeGreaterThan(0);
      }
    }
  });
});

describe('getWidgetDef', () => {
  it('resolves a known id to its full definition', () => {
    const def = getWidgetDef('battery-gauge');
    expect(def).toBeDefined();
    expect(def?.id).toBe('battery-gauge');
    expect(def?.category).toBe('battery');
    expect(def?.name.length).toBeGreaterThan(0);
  });

  it('returns the exact object reference held in the registry', () => {
    const sample = WIDGET_REGISTRY[0];
    expect(getWidgetDef(sample.id)).toBe(sample);
  });

  it('round-trips every registry id back to its matching definition', () => {
    for (const w of WIDGET_REGISTRY) {
      expect(getWidgetDef(w.id)?.id).toBe(w.id);
    }
  });

  it('returns undefined for an unknown id', () => {
    expect(getWidgetDef('no-such-widget')).toBeUndefined();
  });

  it('returns undefined for an empty-string id', () => {
    expect(getWidgetDef('')).toBeUndefined();
  });

  it('returns undefined for null/undefined ids handed in at runtime', () => {
    expect(getWidgetDef(undefined as unknown as string)).toBeUndefined();
    expect(getWidgetDef(null as unknown as string)).toBeUndefined();
  });

  it('matches ids exactly — case-sensitive and without trimming', () => {
    expect(getWidgetDef('BATTERY-GAUGE')).toBeUndefined();
    expect(getWidgetDef(' battery-gauge ')).toBeUndefined();
  });
});
