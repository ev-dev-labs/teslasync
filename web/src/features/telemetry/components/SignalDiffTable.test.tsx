/**
 * SignalDiffTable — behavioural + unit contract tests.
 *
 * Covers every export of the module:
 *   - asNumber   (unknown → number|null coercion, incl. boolean/whitespace edges)
 *   - formatRaw  (unknown → display string, incl. the NaN/object fallbacks)
 *   - deltaLabel (the num / change / none classifier that drives the Δ column)
 *   - SignalDiffTable (the virtualized diff table itself)
 *   - SignalDiffTableProps / SignalDiffPinKey (type surface — referenced below)
 *
 * `react-i18next` is stubbed with an interpolating `t` so copy + aria-label
 * assertions stay stable. `usePinned`/`useTogglePin` are stubbed so the
 * per-row `<PinButton>` never touches the network. `@tanstack/react-virtual`
 * is stubbed to emit the full window: jsdom reports a 0px viewport, so the
 * real virtualizer renders no body rows and cell-level assertions would be
 * impossible otherwise.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SignalDiffRow } from '@/api/hooks/useTelemetry';

// Interpolating i18n stub: supports both `t(key, 'Default')` and the
// `t(key, { defaultValue: 'More info about {{x}}' })` object form the legend
// help-tooltips use.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (tpl: string, vars: Record<string, unknown>) =>
    tpl.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars[name] ?? ''));
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, second?: unknown, third?: unknown) => {
        if (typeof second === 'string') {
          const vars = (third && typeof third === 'object' ? third : {}) as Record<string, unknown>;
          return interpolate(second, vars);
        }
        if (second && typeof second === 'object') {
          const vars = second as Record<string, unknown>;
          const tpl = typeof vars.defaultValue === 'string' ? vars.defaultValue : key;
          return interpolate(tpl, vars);
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

// The pin column mounts a real <PinButton>, which reads/writes pins via
// react-query. Stub the hooks so the button renders deterministically and
// never issues a fetch.
vi.mock('@/api/hooks/usePinned', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/usePinned')>(
    '@/api/hooks/usePinned',
  );
  return {
    ...actual,
    usePinned: () => ({ data: [] }),
    useTogglePin: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  };
});

// Force full-window virtualization so the DataTable renders every body row
// under jsdom's zero-height viewport.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number; estimateSize?: () => number }) => {
    const size = opts.estimateSize?.() ?? 36;
    const items = Array.from({ length: opts.count }, (_, index) => ({
      index,
      key: index,
      start: index * size,
      end: (index + 1) * size,
      size,
      lane: 0,
    }));
    return {
      getVirtualItems: () => items,
      getTotalSize: () => opts.count * size,
      measureElement: () => undefined,
      scrollToIndex: () => undefined,
      scrollToOffset: () => undefined,
    };
  },
}));

import {
  SignalDiffTable,
  asNumber,
  formatRaw,
  deltaLabel,
  type SignalDiffTableProps,
  type SignalDiffPinKey,
} from './SignalDiffTable';

// ── fixtures ─────────────────────────────────────────────────────────────
const SAMPLE_ROWS: SignalDiffRow[] = [
  // numeric increase → positive Δ + percent
  { name: 'battery_level', value_a: 80, value_b: 88, source_a: 'l1', source_b: 'l2', age_ms_a: 500, age_ms_b: 65_000, changed: true },
  // numeric decrease → negative Δ + percent
  { name: 'cabin_temp', value_a: 22, value_b: 19, source_a: 'log', source_b: 'stale', changed: true },
  // non-numeric change → "changed"; no sources → "unknown" badge glyph
  { name: 'gear', value_a: 'D', value_b: 'P', changed: true },
  // identical → em-dash Δ; explicit sources so the only "—" in the row is Δ
  { name: 'vin_locked', value_a: 'yes', value_b: 'yes', source_a: 'l1', source_b: 'l1', changed: false },
];

function renderTable(props?: Partial<SignalDiffTableProps>) {
  const onSelectionChange = props?.onSelectionChange ?? vi.fn();
  const merged: SignalDiffTableProps = {
    rows: SAMPLE_ROWS,
    vehicleId: 7,
    selectedSignals: [],
    pinnedSignals: new Set<string>(),
    ...props,
    onSelectionChange,
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <SignalDiffTable {...merged} />
    </QueryClientProvider>,
  );
  return { ...utils, onSelectionChange };
}

// The signal-name column is the only place the name string is rendered; hop
// up to its <tr> so per-row assertions can be scoped with `within`.
function rowFor(name: string): HTMLElement {
  const cell = screen.getByText(name);
  const tr = cell.closest('tr');
  if (!tr) throw new Error(`no <tr> found for signal "${name}"`);
  return tr as HTMLElement;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── asNumber ─────────────────────────────────────────────────────────────
describe('asNumber', () => {
  it('returns finite numbers verbatim and rejects NaN/Infinity', () => {
    expect(asNumber(42)).toBe(42);
    expect(asNumber(-3.5)).toBe(-3.5);
    expect(asNumber(0)).toBe(0);
    expect(asNumber(NaN)).toBeNull();
    expect(asNumber(Infinity)).toBeNull();
    expect(asNumber(-Infinity)).toBeNull();
  });

  it('parses numeric strings but rejects blank / non-numeric ones', () => {
    expect(asNumber('12.5')).toBe(12.5);
    expect(asNumber('  7  ')).toBe(7); // Number() trims surrounding whitespace
    expect(asNumber('')).toBeNull();
    expect(asNumber('   ')).toBeNull();
    expect(asNumber('12px')).toBeNull();
    expect(asNumber('abc')).toBeNull();
  });

  it('coerces booleans and rejects nullish / object inputs', () => {
    expect(asNumber(true)).toBe(1);
    expect(asNumber(false)).toBe(0);
    expect(asNumber(null)).toBeNull();
    expect(asNumber(undefined)).toBeNull();
    expect(asNumber({ a: 1 })).toBeNull();
  });
});

// ── formatRaw ────────────────────────────────────────────────────────────
describe('formatRaw', () => {
  it('renders an em-dash for nullish and non-finite numbers', () => {
    expect(formatRaw(null)).toBe('—');
    expect(formatRaw(undefined)).toBe('—');
    expect(formatRaw(NaN)).toBe('—');
    expect(formatRaw(Infinity)).toBe('—');
  });

  it('formats finite numbers through the shared precision formatter', () => {
    expect(formatRaw(42)).toBe('42.00');
    expect(formatRaw(-3.5)).toBe('-3.50');
  });

  it('stringifies booleans, strings and objects', () => {
    expect(formatRaw(true)).toBe('true');
    expect(formatRaw(false)).toBe('false');
    expect(formatRaw('hello')).toBe('hello');
    expect(formatRaw({ a: 1 })).toBe('{"a":1}');
  });
});

// ── deltaLabel ───────────────────────────────────────────────────────────
describe('deltaLabel', () => {
  it('classifies a numeric increase with signed delta + percent', () => {
    expect(deltaLabel(80, 88)).toEqual({ kind: 'num', delta: 8, pct: 10 });
  });

  it('classifies a numeric decrease and computes percent off |A|', () => {
    const res = deltaLabel(22, 19);
    expect(res.kind).toBe('num');
    expect(res.delta).toBe(-3);
    expect(res.pct).toBeCloseTo(-13.636, 2);
  });

  it('omits percent when the baseline is zero (avoids divide-by-zero)', () => {
    const res = deltaLabel(0, 5);
    expect(res.kind).toBe('num');
    expect(res.delta).toBe(5);
    expect(res.pct).toBeUndefined();
  });

  it('coerces cross-type numeric values (boolean vs number) before diffing', () => {
    expect(deltaLabel(true, 1)).toEqual({ kind: 'num', delta: 0, pct: 0 });
  });

  it('returns "none" for equal non-numeric values and nullish pairs', () => {
    expect(deltaLabel('open', 'open')).toEqual({ kind: 'none' });
    expect(deltaLabel(null, null)).toEqual({ kind: 'none' });
  });

  it('returns "change" for differing non-numeric or null-vs-value pairs', () => {
    expect(deltaLabel('open', 'closed')).toEqual({ kind: 'change' });
    expect(deltaLabel(null, 5)).toEqual({ kind: 'change' });
  });
});

// ── SignalDiffTable — loading / empty ────────────────────────────────────
describe('SignalDiffTable — loading & empty states', () => {
  it('renders only the loading placeholder while loading (no table)', () => {
    renderTable({ loading: true });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('Signal')).toBeNull();
  });

  it('shows the no-differences empty copy when there are no rows', () => {
    renderTable({ rows: [] });
    expect(screen.getByText('No differences between the two snapshots')).toBeInTheDocument();
    expect(screen.queryByTestId('pin-button')).toBeNull();
  });

  it('swaps to the filtered-empty copy when a filter is active', () => {
    renderTable({ rows: [], filterActive: true });
    expect(screen.getByText('No signals match the current filter')).toBeInTheDocument();
    expect(screen.queryByText('No differences between the two snapshots')).toBeNull();
  });
});

// ── SignalDiffTable — headers, legend & a11y ─────────────────────────────
describe('SignalDiffTable — headers, legend & accessibility', () => {
  it('renders the full column header set', () => {
    renderTable();
    expect(screen.getByText('Signal')).toBeInTheDocument();
    expect(screen.getByText('Window A')).toBeInTheDocument();
    expect(screen.getByText('Window B')).toBeInTheDocument();
    expect(screen.getByText('Src A')).toBeInTheDocument();
    expect(screen.getByText('Src B')).toBeInTheDocument();
  });

  it('exposes a labelled help tooltip for the Δ and source columns', () => {
    renderTable();
    expect(
      screen.getByRole('button', { name: 'More info about the Δ column' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'More info about the source-layer column' }),
    ).toBeInTheDocument();
  });

  it('applies the extra className to the outer wrapper', () => {
    const { container } = renderTable({ className: 'diff-wrap-x' });
    expect(container.querySelector('.diff-wrap-x')).not.toBeNull();
  });
});

// ── SignalDiffTable — row rendering ──────────────────────────────────────
describe('SignalDiffTable — row content', () => {
  it('renders raw window values through formatRaw', () => {
    renderTable();
    const battery = rowFor('battery_level');
    expect(within(battery).getByText('80.00')).toBeInTheDocument();
    expect(within(battery).getByText('88.00')).toBeInTheDocument();
  });

  it('colours a positive Δ emerald with a signed value + percent', () => {
    renderTable();
    const delta = within(rowFor('battery_level')).getByText(/\+8\.00 \(\+10\.0%\)/);
    expect(delta.className).toContain('text-emerald-300');
  });

  it('colours a negative Δ rose with a signed value + percent', () => {
    renderTable();
    const delta = within(rowFor('cabin_temp')).getByText(/-3\.00 \(-13\.6%\)/);
    expect(delta.className).toContain('text-rose-300');
  });

  it('shows "changed" for a non-numeric difference and "—" for equal values', () => {
    renderTable();
    expect(within(rowFor('gear')).getByText('changed')).toBeInTheDocument();
    expect(within(rowFor('vin_locked')).getByText('—')).toBeInTheDocument();
  });

  it('renders a source-layer badge per window, tagged with the layer', () => {
    renderTable();
    const badges = within(rowFor('battery_level')).getAllByTestId('source-layer-badge');
    expect(badges).toHaveLength(2);
    expect(badges[0].getAttribute('data-source')).toBe('l1');
    expect(badges[1].getAttribute('data-source')).toBe('l2');
    // A row with no reported source falls back to the "unknown" layer.
    const gearBadges = within(rowFor('gear')).getAllByTestId('source-layer-badge');
    expect(gearBadges[0].getAttribute('data-source')).toBe('unknown');
  });

  it('mounts a pin affordance on every row', () => {
    renderTable();
    expect(screen.getAllByTestId('pin-button')).toHaveLength(SAMPLE_ROWS.length);
  });
});

// ── SignalDiffTable — selection & pinned-first ordering ──────────────────
describe('SignalDiffTable — selection & ordering', () => {
  it('emits the toggled signal name when a row checkbox is clicked', () => {
    const { onSelectionChange } = renderTable();
    const checkbox = within(rowFor('battery_level')).getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(onSelectionChange).toHaveBeenCalledWith(['battery_level']);
  });

  it('select-all emits every signal, pinned rows sorted first', () => {
    const { onSelectionChange } = renderTable({ pinnedSignals: new Set(['gear']) });
    fireEvent.click(screen.getByRole('checkbox', { name: /select all rows/i }));
    expect(onSelectionChange).toHaveBeenCalledWith([
      'gear',
      'battery_level',
      'cabin_temp',
      'vin_locked',
    ]);
  });

  it('does not crash and shows the empty copy when rows is nullish', () => {
    // Defensive null-safety: the column is required by the type but the page
    // may hand through `data?.data`. `rows ?? []` must keep the table alive.
    renderTable({ rows: undefined as unknown as SignalDiffRow[] });
    expect(screen.getByText('No differences between the two snapshots')).toBeInTheDocument();
  });
});

// ── exported type surface ────────────────────────────────────────────────
describe('SignalDiffTable — exported types', () => {
  it('exposes SignalDiffPinKey as a string alias', () => {
    const key: SignalDiffPinKey = 'signal:battery_level';
    expect(typeof key).toBe('string');
  });
});
