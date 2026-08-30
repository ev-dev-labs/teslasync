/**
 * DRIVING_WIDGETS registry — contract, wiring, integration, and consumer coverage.
 *
 * `driving.ts` is a pure metadata module: one `DRIVING_WIDGETS` export declaring
 * the driving-category dashboard widgets (id, name, description, icon, category,
 * three grid-size envelopes, a `React.lazy` component, and — for one widget —
 * contextual help copy). A bare `import` proves nothing, so — following the
 * repo's "pin the contract at its boundary" precedent (dashboard/types.test.tsx,
 * WidgetPicker.test.tsx) — these tests exercise the data through the invariants
 * and the REAL consumers that read it:
 *
 *   1. Catalogue contract — every entry has non-empty identity/copy, the
 *      'driving' category, unique ids, and coherent size envelopes
 *      (1 ≤ min ≤ default ≤ max on both axes, within the 1..4-column grid). The
 *      optional `help` metadata is well-formed only where a widget declares it.
 *   2. Lazy wiring — every `component` is a genuine `React.lazy` boundary AND
 *      each lazy import path actually resolves to a module with a callable
 *      default export. A typo'd path or a widget that lost its default export is
 *      the one bug class this file can carry (it would 404 the chunk at runtime),
 *      so we drive the registry's own lazy factory to prove resolution.
 *   3. Shared-registry integration — every driving widget is reachable through
 *      `WIDGET_REGISTRY` and `getWidgetDef`, no driving id collides with a widget
 *      from another category (so the `.find()` lookup is unambiguous), and an
 *      unknown id resolves to `undefined`.
 *   4. Real consumer — the <WidgetPicker> drawer renders the driving metadata as
 *      add-cards under the 'Driving' category, hides other categories, surfaces
 *      each widget's default grid size, and adds the correct id on click.
 *
 * `react-i18next` is stubbed with an interpolating passthrough (repo convention)
 * so the consumer renders deterministic English copy; the global test-setup stubs
 * `useSettings`/`useTimezone`. No network is touched — <WidgetPicker> is pure
 * presentation over the static registry and mounts only widget *metadata*, never
 * the lazy components themselves.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

// Interpolating passthrough i18n — resolve the English default (2nd arg) and
// substitute `{{vars}}` from the options bag so assertions read production copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string, opts?: Record<string, unknown>) => {
      let out = typeof defaultValue === 'string' ? defaultValue : key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
      }
      return out;
    },
    i18n: { language: 'en', changeLanguage: () => Promise.resolve() },
  }),
}));

import { DRIVING_WIDGETS } from './driving';
import { WIDGET_REGISTRY, getWidgetDef } from './index';
import type { WidgetDef, WidgetSize } from '../types';
import { WidgetPicker } from '@/features/dashboard/components/WidgetPicker';

const REACT_LAZY_TYPE = Symbol.for('react.lazy');

/**
 * The canonical driving catalogue, in shipped order. An explicit expectation
 * documents the contract and makes an accidental add / drop / rename fail loudly
 * rather than silently drifting.
 */
const EXPECTED_IDS = [
  'recent-drives',
  'drive-score',
  'recent-drives-list',
  'drive-score-gauge',
  'drive-efficiency-chart',
  'speed-heatmap',
  'driving-dynamics',
  'speed-profile',
  'regen-efficiency',
  'route-efficiency',
  'driving-coach',
  'trip-summary',
  'drive-telemetry',
] as const;

/** Uniquely-targetable copy for the <WidgetPicker> consumer assertions. */
const REGEN_DESC = 'Regenerative braking recovery rate, total kWh recovered, max regen power';
const RECENT_DRIVES_DESC = 'Last 5 drives with distance and efficiency';
const TRIP_SUMMARY_DESC = 'Recent trips: start→end, distance, duration, drive segments, charge stops';
// A widget from another category — must NOT surface once 'Driving' is selected.
const BATTERY_GAUGE_DESC = 'Battery percentage with level gauge';

/**
 * Drive the registry's OWN `React.lazy` factory to completion so we prove the
 * embedded import path resolves to a real module (rather than duplicating the
 * paths in the test). React 18 parks the `import()` thenable on
 * `_payload._result` once `_init` transitions the payload out of Uninitialized.
 */
async function loadLazyModule(def: WidgetDef): Promise<Record<string, unknown>> {
  const lazy = def.component as unknown as {
    _payload: { _status: number; _result: unknown };
    _init: (payload: unknown) => unknown;
  };
  const { _payload: payload } = lazy;
  if (payload._status === -1 /* Uninitialized */) {
    try {
      // Fires the dynamic import; suspends by throwing the pending thenable.
      lazy._init(payload);
    } catch {
      /* expected — the import() promise is now parked on payload._result */
    }
  }
  return (await payload._result) as Record<string, unknown>;
}

function isPositiveInt(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}

function renderPicker(overrides: Partial<React.ComponentProps<typeof WidgetPicker>> = {}) {
  const onClose = vi.fn();
  const onAddWidgets = vi.fn();
  const onApplyPreset = vi.fn();
  const utils = render(
    <WidgetPicker
      open
      onClose={onClose}
      onAddWidgets={onAddWidgets}
      onApplyPreset={onApplyPreset}
      activeWidgetIds={[]}
      {...overrides}
    />,
  );
  return { ...utils, onClose, onAddWidgets, onApplyPreset };
}

/** Select the 'Driving' category filter so only driving widgets remain on screen. */
function filterToDriving() {
  fireEvent.click(screen.getByRole('button', { name: 'Driving' }));
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

// ── 1. Catalogue contract ────────────────────────────────────────────────────
describe('DRIVING_WIDGETS — catalogue contract', () => {
  it('exports the canonical driving catalogue, in order and without duplicates', () => {
    const ids = DRIVING_WIDGETS.map((w) => w.id);
    expect(ids).toEqual([...EXPECTED_IDS]);
    // Uniqueness is what keeps getWidgetDef()/react keys deterministic.
    expect(new Set(ids).size).toBe(ids.length);
    expect(DRIVING_WIDGETS).toHaveLength(EXPECTED_IDS.length);
  });

  it('gives every widget non-empty identity + copy and tags it as driving', () => {
    for (const w of DRIVING_WIDGETS) {
      expect(typeof w.id, w.id).toBe('string');
      expect(w.id.trim().length, w.id).toBeGreaterThan(0);
      expect(w.name.trim().length, `${w.id} name`).toBeGreaterThan(0);
      expect(w.description.trim().length, `${w.id} description`).toBeGreaterThan(0);
      // lucide icons are forwardRef objects; some are plain function components.
      expect(['object', 'function'], `${w.id} icon`).toContain(typeof w.icon);
      expect(w.icon, `${w.id} icon`).toBeTruthy();
      expect(w.category, w.id).toBe('driving');
    }
  });

  it('declares coherent grid-size envelopes (1 ≤ min ≤ default ≤ max, ≤ 4 cols)', () => {
    const within4Cols = (s: WidgetSize) => s.cols >= 1 && s.cols <= 4;
    for (const w of DRIVING_WIDGETS) {
      const { minSize, defaultSize, maxSize } = w;
      for (const s of [minSize, defaultSize, maxSize]) {
        expect(isPositiveInt(s.cols), `${w.id} cols`).toBe(true);
        expect(isPositiveInt(s.rows), `${w.id} rows`).toBe(true);
      }
      // The dashboard grid is 1..4 columns wide; every envelope must fit it.
      expect(within4Cols(minSize), `${w.id} min cols`).toBe(true);
      expect(within4Cols(defaultSize), `${w.id} default cols`).toBe(true);
      expect(within4Cols(maxSize), `${w.id} max cols`).toBe(true);

      // min ≤ default ≤ max on both axes — otherwise resize/clamp math breaks.
      expect(minSize.cols, `${w.id} cols min≤default`).toBeLessThanOrEqual(defaultSize.cols);
      expect(defaultSize.cols, `${w.id} cols default≤max`).toBeLessThanOrEqual(maxSize.cols);
      expect(minSize.rows, `${w.id} rows min≤default`).toBeLessThanOrEqual(defaultSize.rows);
      expect(defaultSize.rows, `${w.id} rows default≤max`).toBeLessThanOrEqual(maxSize.rows);
    }
  });

  it('attaches well-formed help metadata only where a widget declares it', () => {
    const withHelp = DRIVING_WIDGETS.filter((w) => w.help);
    // Exactly the regen widget ships inline help today.
    expect(withHelp.map((w) => w.id)).toEqual(['regen-efficiency']);

    const regen = getWidgetDef('regen-efficiency');
    expect(regen?.help?.i18nKey).toBe('help.regenEfficiency.body');
    expect(typeof regen?.help?.defaultValue).toBe('string');
    expect((regen?.help?.defaultValue ?? '').length).toBeGreaterThan(20);

    // Widgets without help must be genuinely absent, not an empty object.
    expect(getWidgetDef('recent-drives')?.help).toBeUndefined();
  });
});

// ── 2. Lazy component wiring ──────────────────────────────────────────────────
describe('DRIVING_WIDGETS — lazy component wiring', () => {
  it('wires a real React.lazy boundary for every widget', () => {
    for (const w of DRIVING_WIDGETS) {
      const comp = w.component as unknown as { $$typeof?: symbol };
      expect(typeof w.component, w.id).toBe('object');
      expect(comp.$$typeof, w.id).toBe(REACT_LAZY_TYPE);
    }
  });

  it('resolves every lazy import to a module with a callable default export', async () => {
    const modules = await Promise.all(DRIVING_WIDGETS.map((w) => loadLazyModule(w)));
    expect(modules).toHaveLength(EXPECTED_IDS.length);
    modules.forEach((mod, i) => {
      // A missing/renamed file or a dropped default export would fail here.
      expect(typeof mod.default, DRIVING_WIDGETS[i].id).toBe('function');
    });
  });
});

// ── 3. Shared-registry integration ────────────────────────────────────────────
describe('DRIVING_WIDGETS — shared registry integration', () => {
  it('surfaces every driving widget through WIDGET_REGISTRY and getWidgetDef', () => {
    for (const w of DRIVING_WIDGETS) {
      // Same object reference — spread into the mega-registry, not a copy.
      expect(WIDGET_REGISTRY, w.id).toContain(w);
      expect(getWidgetDef(w.id), w.id).toBe(w);
    }
  });

  it('never lets a driving id collide with another category (find stays unambiguous)', () => {
    for (const id of EXPECTED_IDS) {
      const matches = WIDGET_REGISTRY.filter((w) => w.id === id);
      expect(matches, id).toHaveLength(1);
      expect(matches[0].category, id).toBe('driving');
    }
  });

  it('returns undefined for an unknown widget id', () => {
    expect(getWidgetDef('no-such-driving-widget')).toBeUndefined();
    expect(getWidgetDef('')).toBeUndefined();
  });
});

// ── 4. Real consumer — <WidgetPicker> ─────────────────────────────────────────
describe('DRIVING_WIDGETS — via <WidgetPicker>', () => {
  it('lists every driving widget as an add-card under the Driving category and hides other categories', () => {
    renderPicker();
    filterToDriving();

    // Section header for the filtered group.
    expect(screen.getByRole('heading', { name: 'Driving' })).toBeInTheDocument();

    // Every driving widget's description reaches the drawer as a card.
    for (const w of DRIVING_WIDGETS) {
      expect(screen.getByText(w.description), w.id).toBeInTheDocument();
    }

    // A widget from another category is excluded by the filter.
    expect(screen.queryByText(BATTERY_GAUGE_DESC)).toBeNull();
  });

  it('renders a driving widget card with its icon, name and default grid size', () => {
    renderPicker();
    filterToDriving();

    const regenCard = screen.getByRole('button', { name: /Regen Braking/i });
    expect(within(regenCard).getByText(REGEN_DESC)).toBeInTheDocument();
    // defaultSize {cols:1, rows:2} is surfaced verbatim on the card.
    expect(within(regenCard).getByText('1×2 grid')).toBeInTheDocument();
    // Icon-only glyph renders as an aria-hidden svg (decorative alongside text).
    expect(regenCard.querySelector('svg')).not.toBeNull();
  });

  it('adds the correct widget id when its driving card is clicked', () => {
    const { onAddWidgets, onClose } = renderPicker();
    filterToDriving();

    fireEvent.click(screen.getByRole('button', { name: /Regen Braking/i }));

    expect(onAddWidgets).toHaveBeenCalledTimes(1);
    expect(onAddWidgets).toHaveBeenCalledWith(['regen-efficiency']);
    // A plain click adds without dismissing the drawer.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('disables a driving widget that is already on the dashboard', () => {
    const { onAddWidgets } = renderPicker({ activeWidgetIds: ['recent-drives'] });
    filterToDriving();

    const card = screen.getByRole('button', { name: new RegExp(RECENT_DRIVES_DESC, 'i') });
    expect(card).toBeDisabled();
    fireEvent.click(card);
    expect(onAddWidgets).not.toHaveBeenCalled();

    // A different driving widget stays addable.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(TRIP_SUMMARY_DESC, 'i') }));
    expect(onAddWidgets).toHaveBeenCalledWith(['trip-summary']);
  });
});
