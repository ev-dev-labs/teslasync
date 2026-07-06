/**
 * vehicle-cost/constants — configuration contract tests.
 *
 * constants.ts is a data-only module: two exported values (WINDOW_OPTIONS,
 * TOP_N) plus the WindowOption shape. It carries no components, hooks, or
 * side effects, so the value of a test here is to LOCK the exact invariants
 * its consumers silently depend on — a copy-paste edit to a preset or the cap
 * must not regress the UI without a red test. Each block mirrors a real
 * consumer:
 *   WINDOW_OPTIONS → VehicleCostToolbar  (window <Select>: value=String(days),
 *                                         label=t(labelKey, fallback))
 *   WINDOW_OPTIONS → VehicleCostPage     (useState(30) default → the toolbar
 *                                         Select MUST contain a days:30 preset
 *                                         or it opens with nothing selected)
 *   TOP_N          → VehicleCostPage      (rankVehicles(…, TOP_N) caps the cost
 *                                         chart + top-talkers list at TOP_N)
 *
 * The render block additionally proves WINDOW_OPTIONS drives a genuinely
 * accessible, keyboard-selectable control whose values round-trip through the
 * toolbar's String(days)/Number(value) mapping — a non-numeric preset would
 * hand NaN to onWindowChange — and the rankVehicles block proves TOP_N is
 * honoured as the real cap by the actual helper the page calls.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ComponentProps } from 'react';

import { WINDOW_OPTIONS, TOP_N, type WindowOption } from './constants';
import { rankVehicles } from './helpers';
import { VehicleCostToolbar } from './VehicleCostToolbar';
import type { VehicleCostRow } from '@/types/admin-operator-confidence';

// react-i18next → return the developer fallback string so option labels and
// the refresh button's accessible name are deterministic under jsdom (mirrors
// the VehicleCostPage.test.tsx convention). Only useTranslation is overridden;
// every other real export is preserved for transitive importers.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: string) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

// The page's default trailing window (VehicleCostPage: useState<number>(30)).
// The toolbar renders `value={String(windowDays)}`, so a preset with this
// exact day count MUST exist or the control opens with nothing selected.
const PAGE_DEFAULT_WINDOW_DAYS = 30;

describe('WINDOW_OPTIONS — structure & i18n contract', () => {
  it('exposes exactly the four trailing-window presets, narrowest → widest', () => {
    expect(WINDOW_OPTIONS.map((o) => o.days)).toEqual([1, 7, 30, 90]);
  });

  it('declares every WindowOption well-formed (positive-int days, non-empty key + fallback)', () => {
    WINDOW_OPTIONS.forEach((opt: WindowOption) => {
      expect(Number.isInteger(opt.days)).toBe(true);
      expect(opt.days).toBeGreaterThan(0);
      expect(typeof opt.labelKey).toBe('string');
      expect(opt.labelKey.trim().length).toBeGreaterThan(0);
      expect(typeof opt.fallback).toBe('string');
      expect(opt.fallback.trim().length).toBeGreaterThan(0);
    });
  });

  it('orders the presets by strictly ascending, unique day counts', () => {
    const days = WINDOW_OPTIONS.map((o) => o.days);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
    expect(new Set(days).size).toBe(days.length);
  });

  it('includes the page default (30d) so the toolbar Select always has a selected option', () => {
    expect(WINDOW_OPTIONS.some((o) => o.days === PAGE_DEFAULT_WINDOW_DAYS)).toBe(true);
  });

  it('namespaces every labelKey as a unique admin.vehicleCost.window{n}d key matching its days', () => {
    const keys = WINDOW_OPTIONS.map((o) => o.labelKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const opt of WINDOW_OPTIONS) {
      expect(opt.labelKey).toBe(`admin.vehicleCost.window${opt.days}d`);
      expect(opt.labelKey.startsWith('admin.vehicleCost.')).toBe(true);
    }
  });

  it('pluralises each fallback correctly (1 → "day", >1 → "days") and names its day count', () => {
    for (const opt of WINDOW_OPTIONS) {
      expect(opt.fallback).toContain(String(opt.days));
      expect(opt.fallback).toBe(
        opt.days === 1 ? 'Last 1 day' : `Last ${opt.days} days`,
      );
    }
  });
});

describe('VehicleCostToolbar — WINDOW_OPTIONS as a real, accessible control', () => {
  type ToolbarProps = ComponentProps<typeof VehicleCostToolbar>;

  function setup(overrides: Partial<ToolbarProps> = {}) {
    const onWindowChange = vi.fn();
    const onRefresh = vi.fn();
    const props: ToolbarProps = {
      windowDays: PAGE_DEFAULT_WINDOW_DAYS,
      onWindowChange,
      onRefresh,
      refreshing: false,
      ...overrides,
    };
    render(<VehicleCostToolbar {...props} />);
    return { onWindowChange, onRefresh };
  }

  it('renders one accessible, selectable <option> per preset', () => {
    setup();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(WINDOW_OPTIONS.length);
    for (const opt of WINDOW_OPTIONS) {
      expect(screen.getByRole('option', { name: opt.fallback })).toBeInTheDocument();
    }
  });

  it('shows the page default (30d) as the initially selected window', () => {
    setup();
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('30');
  });

  it('reflects a non-default windowDays as the selected option', () => {
    setup({ windowDays: 7 });
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('7');
  });

  it('reports a NUMERIC day count (not the string value) when the operator changes preset', () => {
    const { onWindowChange } = setup();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '7' } });
    expect(onWindowChange).toHaveBeenCalledTimes(1);
    expect(onWindowChange).toHaveBeenCalledWith(7);
    // Guards the String(days) → Number(value) round-trip: a non-numeric preset
    // would hand NaN straight to the page's `since` derivation.
    expect(typeof onWindowChange.mock.calls[0][0]).toBe('number');
    expect(Number.isNaN(onWindowChange.mock.calls[0][0])).toBe(false);
  });

  it('exposes an idle, labelled, icon-only refresh control that fires onRefresh once', () => {
    const { onRefresh } = setup();
    const btn = screen.getByRole('button', { name: 'Refresh vehicle cost data' });
    expect(btn).toBeEnabled();
    const icon = btn.querySelector('svg');
    // Icon is decorative — the accessible name comes from the button aria-label.
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon?.getAttribute('class') ?? '').not.toContain('animate-spin');
    fireEvent.click(btn);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('disables the refresh control and spins its glyph while a fetch is in flight', () => {
    setup({ refreshing: true });
    const btn = screen.getByRole('button', { name: 'Refresh vehicle cost data' });
    expect(btn).toBeDisabled();
    const icon = btn.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon?.getAttribute('class') ?? '').toContain('animate-spin');
  });
});

describe('TOP_N — value contract', () => {
  it('is a small positive integer cap (exactly 8)', () => {
    expect(Number.isSafeInteger(TOP_N)).toBe(true);
    expect(TOP_N).toBeGreaterThan(0);
    expect(TOP_N).toBe(8);
  });

  it('stays a readable subset of the 100-row page fetch yet large enough to surface an outlier', () => {
    // VehicleCostPage fetches up to 100 rows; the visual sections focus on the
    // heaviest TOP_N so the table below stays the full breakdown.
    expect(TOP_N).toBeGreaterThanOrEqual(3);
    expect(TOP_N).toBeLessThan(100);
  });
});

describe('TOP_N — rankVehicles cap contract (real consumer)', () => {
  const nameOf = (r: VehicleCostRow): string => r.display_name ?? `Vehicle #${r.vehicle_id}`;

  function makeRow(id: number, bytes: number, rows: number): VehicleCostRow {
    return {
      vehicle_id: id,
      display_name: `V${id}`,
      signal_row_count: rows,
      signal_bytes_est: bytes,
      ingest_rate_per_minute_24h: 0,
      dlq_failures_24h: 0,
      last_seen_at: '2024-01-01T00:00:00Z',
    };
  }

  it('caps the cost chart at TOP_N when more vehicles exist, keeping the heaviest bytes', () => {
    // id i → i*1000 bytes; largest id is the heaviest consumer.
    const rows = Array.from({ length: TOP_N + 5 }, (_, i) => makeRow(i + 1, (i + 1) * 1000, i + 1));
    const ranked = rankVehicles(rows, nameOf, 'bytes', TOP_N);

    expect(ranked).toHaveLength(TOP_N);
    expect(ranked[0].bytes).toBe((TOP_N + 5) * 1000);
    // The five lightest vehicles are dropped — the smallest never makes the cut.
    expect(ranked.some((r) => r.bytes === 1000)).toBe(false);
    expect(Math.min(...ranked.map((r) => r.bytes))).toBe(6 * 1000);
  });

  it('caps the top-talkers list at TOP_N by ROW count, keeping the loudest', () => {
    const rows = Array.from({ length: TOP_N + 3 }, (_, i) => makeRow(i + 1, i + 1, (i + 1) * 10));
    const ranked = rankVehicles(rows, nameOf, 'rows', TOP_N);

    expect(ranked).toHaveLength(TOP_N);
    expect(ranked[0].rows).toBe((TOP_N + 3) * 10);
  });

  it('returns every vehicle when fewer than TOP_N exist (no padding to the cap)', () => {
    const rows = Array.from({ length: TOP_N - 3 }, (_, i) => makeRow(i + 1, (i + 1) * 5, i + 1));
    const ranked = rankVehicles(rows, nameOf, 'bytes', TOP_N);

    expect(ranked).toHaveLength(TOP_N - 3);
    expect(ranked.length).toBeLessThan(TOP_N);
  });
});
