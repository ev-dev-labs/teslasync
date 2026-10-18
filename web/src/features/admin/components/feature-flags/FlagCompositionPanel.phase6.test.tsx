import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getFormatterPreferences,
  setGlobalLocale,
  setGlobalPrecision,
} from '@/lib/numberFormat';
import { gaugeTone } from '@/lib/tokens';
import type { FeatureFlagEntry } from '@/types/admin-diagnostics';

import { FlagCompositionPanel } from './FlagCompositionPanel';

vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));

const kinds = [
  { label: 'Boolean', value: false, color: gaugeTone.success },
  { label: 'Number', value: 0, color: gaugeTone.info },
  { label: 'String', value: '', color: gaugeTone.purple },
  { label: 'Object', value: {}, color: gaugeTone.warning },
  { label: 'Array', value: [], color: gaugeTone.info },
  { label: 'Null', value: null, color: gaugeTone.neutral },
] as const;

function flag(key: string, value: unknown): FeatureFlagEntry {
  return { key, value };
}

function panel(flags: FeatureFlagEntry[], loading = false) {
  return <FlagCompositionPanel flags={flags} loading={loading} error={null} onRetry={vi.fn()} />;
}

function fillOf(bar: HTMLElement): HTMLElement {
  const fill = bar.querySelector<HTMLElement>('[data-metric-fill]');
  expect(fill).not.toBeNull();
  return fill!;
}

beforeEach(() => {
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});

afterEach(() => {
  cleanup();
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  vi.restoreAllMocks();
});

describe('FlagCompositionPanel phase6 existing semantic solid-fill adoption', () => {
  it('uses the existing role map for all six kinds without changing labels, counts or rounded percentages', () => {
    render(panel(kinds.map(({ label, value }) => flag(label, value))));
    const list = screen.getByRole('list', { name: 'Returned flag value presentation; stored values are text' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(6);

    kinds.forEach(({ label, color }, index) => {
      const bar = within(rows[index]).getByRole('progressbar', { name: label });
      expect(bar).toHaveAttribute('aria-valuemin', '0');
      expect(bar).toHaveAttribute('aria-valuenow', '1');
      expect(bar).toHaveAttribute('aria-valuemax', '6');
      expect(within(rows[index]).getByText('1 · 17%')).toBeInTheDocument();
      expect(fillOf(bar).style.background).toBe(color);
      expect(fillOf(bar).getAttribute('style')).not.toContain('gradient');
      expect(within(rows[index]).getByText(label)).toHaveClass('text-[var(--text-secondary)]');
      expect(within(rows[index]).getByText('1 · 17%')).toHaveClass('text-[var(--text-primary)]');
    });
  });

  it('keeps frequency sorting and tie order independent of colors and input order', () => {
    render(panel([
      flag('array', []), flag('string1', 'a'), flag('boolean', true),
      flag('number', 3), flag('string2', 'b'), flag('object', {}),
    ]));
    const rows = screen.getAllByRole('listitem');
    const expected = [
      ['String', '2 · 33%', gaugeTone.purple, '2'],
      ['Boolean', '1 · 17%', gaugeTone.success, '1'],
      ['Number', '1 · 17%', gaugeTone.info, '1'],
      ['Object', '1 · 17%', gaugeTone.warning, '1'],
      ['Array', '1 · 17%', gaugeTone.info, '1'],
    ];
    expected.forEach(([label, readout, color, count], index) => {
      const bar = within(rows[index]).getByRole('progressbar', { name: label });
      expect(bar).toHaveAttribute('aria-valuenow', count);
      expect(bar).toHaveAttribute('aria-valuemax', '6');
      expect(within(rows[index]).getByText(readout)).toBeInTheDocument();
      expect(fillOf(bar).style.background).toBe(color);
    });
  });

  it('retains nullish entries and a complete single-kind scale without adding zero buckets', () => {
    const { rerender } = render(panel([
      flag('null', null), flag('undefined', undefined),
      undefined as unknown as FeatureFlagEntry, flag('number', 0),
    ]));
    const nullBar = screen.getByRole('progressbar', { name: 'Null' });
    expect(nullBar).toHaveAttribute('aria-valuenow', '3');
    expect(nullBar).toHaveAttribute('aria-valuemax', '4');
    expect(screen.getByText('3 · 75%')).toBeInTheDocument();
    expect(fillOf(nullBar).style.background).toBe(gaugeTone.neutral);
    expect(screen.getAllByRole('progressbar')).toHaveLength(2);

    rerender(panel([flag('a', 1), flag('b', 2), flag('c', 3)]));
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    const numberBar = screen.getByRole('progressbar', { name: 'Number' });
    expect(numberBar).toHaveAttribute('aria-valuenow', '3');
    expect(numberBar).toHaveAttribute('aria-valuemax', '3');
    expect(screen.getByText('3 · 100%')).toBeInTheDocument();
    expect(fillOf(numberBar).style.background).toBe(gaugeTone.info);
  });

  it('reacts to replacement data while retaining populated content during refresh', () => {
    const { rerender, container } = render(panel([flag('a', true)], true));
    expect(screen.getByText('1 · 100%')).toBeInTheDocument();
    expect(container.querySelector('[class*="--skeleton-bg"]')).toBeNull();

    rerender(panel([flag('a', 42), flag('b', 'new')], true));
    expect(screen.queryByRole('progressbar', { name: 'Boolean' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    for (const label of ['Number', 'String']) {
      const bar = screen.getByRole('progressbar', { name: label });
      expect(bar).toHaveAttribute('aria-valuenow', '1');
      expect(bar).toHaveAttribute('aria-valuemax', '2');
      expect(within(bar).getByText('1 · 50%')).toBeInTheDocument();
    }
    expect(container.querySelector('[class*="--skeleton-bg"]')).toBeNull();
  });

  it('preserves the caller readout when existing formatter preferences update', () => {
    render(panel([flag('a', true), flag('b', true), flag('c', 0)]));
    act(() => {
      setGlobalLocale('de-DE');
      setGlobalPrecision(4);
    });
    expect(getFormatterPreferences()).toEqual({ locale: 'de-DE', precision: 4 });
    expect(screen.getByText('2 · 67%')).toBeInTheDocument();
    expect(screen.getByText('1 · 33%')).toBeInTheDocument();
    expect(screen.queryByText('2,0000')).not.toBeInTheDocument();
    expect(screen.queryByText('1,0000')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Boolean' })).toHaveAttribute('aria-valuenow', '2');
  });

  it.each(['dark', 'light', 'oled', 'auto'])(
    'leaves saved theme identity and custom colors untouched in %s mode',
    (mode) => {
      const saved = {
        'teslasync-theme': 'matrix-green',
        'teslasync-mode': mode,
        'teslasync-custom-primary': '#123456',
        'teslasync-custom-accent': '#abcdef',
      };
      const previous = Object.keys(saved).map((key) => [key, localStorage.getItem(key)] as const);
      try {
        for (const [key, value] of Object.entries(saved)) localStorage.setItem(key, value);
        const write = vi.spyOn(Storage.prototype, 'setItem');
        const { rerender } = render(panel(kinds.map(({ label, value }) => flag(label, value))));
        rerender(panel(kinds.map(({ label, value }) => flag(label, value)), true));
        expect(write).not.toHaveBeenCalled();
        for (const [key, value] of Object.entries(saved)) expect(localStorage.getItem(key)).toBe(value);
        for (const { label, color } of kinds) {
          expect(fillOf(screen.getByRole('progressbar', { name: label })).style.background).toBe(color);
        }
      } finally {
        vi.restoreAllMocks();
        for (const [key, value] of previous) {
          if (value === null) localStorage.removeItem(key);
          else localStorage.setItem(key, value);
        }
      }
    },
  );

  it('keeps the existing forced-colors track and fill contracts with neutral readouts', () => {
    render(panel([flag('a', true)]));
    const bar = screen.getByRole('progressbar', { name: 'Boolean' });
    expect(bar.querySelector('[data-metric-track]')).toHaveClass(
      'forced-colors:outline-1', 'forced-colors:outline-[CanvasText]',
      'forced-colors:!bg-[Canvas]', 'forced-colors:[forced-color-adjust:none]',
    );
    expect(fillOf(bar)).toHaveClass(
      'forced-colors:!bg-[Highlight]', 'forced-colors:!bg-none',
      'forced-colors:[forced-color-adjust:none]',
    );
    expect(screen.getByText('1 · 100%')).toHaveClass('text-[var(--text-primary)]');
  });
});
