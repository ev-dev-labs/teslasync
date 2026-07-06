/**
 * LiveSignalsTable contract tests — Live Signal Inspector snapshot table.
 *
 * The component owns three concerns on top of the shared <DataTable>: the
 * name filter, the name/timestamp sort (driven by the real useSortToggle),
 * and per-row cell rendering (typed value colours, kind badge, source-layer
 * badge, freshness). These tests pin every one of those facets plus the
 * defensive branches:
 *   - the always-on shell (filter box + labelled table + all five headers),
 *   - the name filter (case-insensitive substring, restore-on-clear, and the
 *     "no match" empty message — never a blank body),
 *   - renderValue's type→colour map (number→cyan, boolean→purple,
 *     string→amber) and its null / undefined / object degradations,
 *   - the kind → Badge variant mapping (numeric/boolean/enum/compound),
 *   - the source cell (SourceLayerBadge wiring vs the "—" fallback),
 *   - the timestamp cell (relative TimeStamp vs the formatAge fallback),
 *   - sorting: clicking a header toggles direction + reorders + updates
 *     aria-sort, and timestamp sort puts the newest row first,
 *   - null-safety: a nullish `rows` prop renders the empty table instead of
 *     crashing on the filter/sort spread,
 *   - sort robustness: an unparseable timestamp is treated as epoch 0 instead
 *     of poisoning the comparator with NaN.
 *
 * `react-i18next` is stubbed so `t(key, 'Default')` yields the English
 * default. `@/components/data-display` is stubbed so TimeStamp / SourceLayerBadge
 * render deterministic prop-probes (no timezone / settings / tooltip stack).
 * Everything else — DataTable, Input, Badge, Text, Caption, useSortToggle —
 * renders for real. `@testing-library/user-event` is not installed in this
 * repo, so interactions use fireEvent (matching the sibling suites).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/components/data-display', () => ({
  TimeStamp: ({ value, format }: { value: unknown; format?: string }) => (
    <span data-testid="timestamp" data-format={format}>
      {String(value)}
    </span>
  ),
  SourceLayerBadge: ({
    source,
    ageMs,
    showLabel,
  }: {
    source: unknown;
    ageMs?: number | null;
    showLabel?: boolean;
  }) => (
    <span
      data-testid="source-badge"
      data-source={String(source)}
      data-agems={ageMs == null ? '' : String(ageMs)}
      data-showlabel={showLabel ? 'true' : 'false'}
    >
      {String(source)}
    </span>
  ),
}));

import { LiveSignalsTable } from './LiveSignalsTable';
import type { LiveSignalRow } from './liveSignalStats';

function makeRow(overrides: Partial<LiveSignalRow> = {}): LiveSignalRow {
  return {
    name: 'signal',
    value: 0,
    ...overrides,
  };
}

/** Resolve the <tr> that owns a given signal name (exact-match name cell). */
function getRow(name: string): HTMLElement {
  const cell = screen.getByText(name);
  const tr = cell.closest('tr');
  if (!tr) throw new Error(`no <tr> found for signal "${name}"`);
  return tr as HTMLElement;
}

/** Body-row signal names, in DOM (render) order. First cell === name. */
function bodyRowNames(): string[] {
  return Array.from(document.querySelectorAll('tbody tr'))
    .map((tr) => tr.querySelector('td')?.textContent?.trim() ?? '')
    .filter((s) => s.length > 0);
}

function getFilterInput(): HTMLInputElement {
  return screen.getByRole('textbox', {
    name: /filter signals/i,
  }) as HTMLInputElement;
}

describe('LiveSignalsTable — shell & accessibility', () => {
  it('renders the filter box, a table, and all five column headers', () => {
    const { container } = render(
      <LiveSignalsTable rows={[makeRow({ name: 'a' }), makeRow({ name: 'b' })]} />,
    );

    expect(getFilterInput()).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();

    for (const header of ['Signal', 'Value', 'Kind', 'Source', 'Last update']) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }

    // The decorative search glyph is hidden from assistive tech.
    expect(
      container.querySelector('svg[aria-hidden="true"]'),
    ).not.toBeNull();
  });

  it('renders one body row per signal, each with the five data cells', () => {
    render(
      <LiveSignalsTable
        rows={[makeRow({ name: 'alpha' }), makeRow({ name: 'bravo' })]}
      />,
    );

    expect(bodyRowNames()).toEqual(['alpha', 'bravo']);
    const cells = within(getRow('alpha')).getAllByRole('cell');
    expect(cells).toHaveLength(5);
  });
});

describe('LiveSignalsTable — name filter', () => {
  const rows = [
    makeRow({ name: 'battery_level' }),
    makeRow({ name: 'battery_range' }),
    makeRow({ name: 'vehicle_speed' }),
  ];

  it('filters case-insensitively by substring and restores on clear', () => {
    render(<LiveSignalsTable rows={rows} />);
    const input = getFilterInput();

    // Upper-case query still matches the lower-case signal names.
    fireEvent.change(input, { target: { value: 'BATT' } });
    expect(bodyRowNames()).toEqual(['battery_level', 'battery_range']);
    expect(screen.queryByText('vehicle_speed')).toBeNull();

    // Clearing the filter brings every row back.
    fireEvent.change(input, { target: { value: '' } });
    expect(bodyRowNames()).toEqual([
      'battery_level',
      'battery_range',
      'vehicle_speed',
    ]);
  });

  it('shows the empty message (never a blank body) when nothing matches', () => {
    render(<LiveSignalsTable rows={rows} />);
    fireEvent.change(getFilterInput(), { target: { value: 'zzz-none' } });

    expect(
      screen.getByText('No signals match this filter.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('battery_level')).toBeNull();
    expect(bodyRowNames()).toEqual(['No signals match this filter.']);
  });
});

describe('LiveSignalsTable — value rendering', () => {
  it('colours primitive values by JS type', () => {
    render(
      <LiveSignalsTable
        rows={[
          makeRow({ name: 'num', value: 42 }),
          makeRow({ name: 'bool', value: true }),
          makeRow({ name: 'str', value: 'hello' }),
        ]}
      />,
    );

    expect(screen.getByText('42')).toHaveClass('text-cyan-300');
    expect(screen.getByText('true')).toHaveClass('text-purple-300');
    expect(screen.getByText('hello')).toHaveClass('text-amber-300');
  });

  it('degrades null, undefined, and object values without crashing', () => {
    render(
      <LiveSignalsTable
        rows={[
          makeRow({ name: 'is-null', value: null }),
          // give the undefined-value row a source+timestamp so its ONLY
          // em-dash is the value cell.
          makeRow({
            name: 'is-undef',
            value: undefined,
            source: 'l2',
            ageMs: 50,
            timestamp: '2023-01-01T00:00:00Z',
          }),
          makeRow({ name: 'is-obj', value: { a: 1 } }),
        ]}
      />,
    );

    // null → literal "null" in the muted colour.
    expect(screen.getByText('null')).toHaveClass('text-[var(--text-muted)]');

    // undefined → the shared em-dash (scoped to its row's value cell).
    const undefValueCell = within(getRow('is-undef')).getByText('—');
    expect(undefValueCell).toHaveClass('text-[var(--text-muted)]');

    // object → JSON-stringified in the secondary colour.
    const objText = screen.getByText('{"a":1}');
    expect(objText).toHaveClass('text-[var(--text-secondary)]');
  });
});

describe('LiveSignalsTable — kind badge', () => {
  it('maps each value-kind to its Badge variant colour + label', () => {
    render(
      <LiveSignalsTable
        rows={[
          makeRow({ name: 'k-num', kind: 'ValueKindFloat', value: 1 }),
          makeRow({ name: 'k-bool', kind: 'ValueKindBool', value: true }),
          makeRow({ name: 'k-enum', kind: 'ValueKindEnum', value: 3 }),
          // no kind + object value → classifyKind falls back to "compound".
          makeRow({ name: 'k-comp', value: { x: 1 } }),
        ]}
      />,
    );

    expect(screen.getByText('Numeric')).toHaveClass('bg-blue-100');
    expect(screen.getByText('Boolean')).toHaveClass('bg-yellow-100');
    expect(screen.getByText('Enum')).toHaveClass('bg-green-100');
    expect(screen.getByText('Compound')).toHaveClass('bg-red-100');
  });
});

describe('LiveSignalsTable — source cell', () => {
  it('wires SourceLayerBadge with source + age + label when a source is present', () => {
    render(
      <LiveSignalsTable
        rows={[makeRow({ name: 'has-src', source: 'l1', ageMs: 1200, value: 1 })]}
      />,
    );

    const badge = within(getRow('has-src')).getByTestId('source-badge');
    expect(badge).toHaveAttribute('data-source', 'l1');
    expect(badge).toHaveAttribute('data-agems', '1200');
    expect(badge).toHaveAttribute('data-showlabel', 'true');
  });

  it('falls back to an em-dash in the source cell when no source is present', () => {
    render(
      <LiveSignalsTable
        rows={[makeRow({ name: 'no-src', value: 7, timestamp: '2022-01-01T00:00:00Z' })]}
      />,
    );

    const row = getRow('no-src');
    expect(within(row).queryByTestId('source-badge')).toBeNull();
    // Cell order: name(0) value(1) kind(2) source(3) timestamp(4).
    const cells = within(row).getAllByRole('cell');
    expect(cells[3]).toHaveTextContent('—');
  });
});

describe('LiveSignalsTable — timestamp cell', () => {
  it('renders a relative TimeStamp when a timestamp is present', () => {
    render(
      <LiveSignalsTable
        rows={[
          makeRow({ name: 'has-ts', timestamp: '2022-05-05T12:00:00Z', value: 1 }),
        ]}
      />,
    );

    const stamp = within(getRow('has-ts')).getByTestId('timestamp');
    expect(stamp).toHaveAttribute('data-format', 'relative');
    expect(stamp).toHaveTextContent('2022-05-05T12:00:00Z');
  });

  it('falls back to a formatted age when no timestamp is present', () => {
    render(
      <LiveSignalsTable
        rows={[makeRow({ name: 'no-ts', ageMs: 1500, source: 'l1', value: 2 })]}
      />,
    );

    const row = getRow('no-ts');
    expect(within(row).queryByTestId('timestamp')).toBeNull();
    const cells = within(row).getAllByRole('cell');
    // formatAge(1500) → "1.5s".
    expect(cells[4]).toHaveTextContent('1.5s');
  });
});

describe('LiveSignalsTable — sorting', () => {
  it('sorts by name ascending by default and toggles to descending on click', () => {
    render(
      <LiveSignalsTable
        rows={[
          makeRow({ name: 'charlie' }),
          makeRow({ name: 'alpha' }),
          makeRow({ name: 'bravo' }),
        ]}
      />,
    );

    // Default: name ascending.
    expect(bodyRowNames()).toEqual(['alpha', 'bravo', 'charlie']);
    const nameHeader = screen.getByRole('columnheader', { name: 'Signal' });
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');

    // Clicking the Signal header toggles to descending and reorders.
    fireEvent.click(screen.getByRole('button', { name: 'Signal' }));
    expect(bodyRowNames()).toEqual(['charlie', 'bravo', 'alpha']);
    expect(
      screen.getByRole('columnheader', { name: 'Signal' }),
    ).toHaveAttribute('aria-sort', 'descending');
  });

  it('sorts by timestamp with the newest row first when the header is clicked', () => {
    render(
      <LiveSignalsTable
        rows={[
          makeRow({ name: 'a', timestamp: '2020-01-01T00:00:00Z' }),
          makeRow({ name: 'b', timestamp: '2021-01-01T00:00:00Z' }),
          makeRow({ name: 'c', timestamp: '2022-01-01T00:00:00Z' }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Last update' }));

    // Descending by timestamp → newest (2022) first.
    expect(bodyRowNames()).toEqual(['c', 'b', 'a']);
    expect(
      screen.getByRole('columnheader', { name: 'Last update' }),
    ).toHaveAttribute('aria-sort', 'descending');
  });

  it('treats an unparseable timestamp as epoch 0 instead of a NaN comparator', () => {
    render(
      <LiveSignalsTable
        rows={[
          makeRow({ name: 'valid-new', timestamp: '2022-06-01T00:00:00Z' }),
          makeRow({ name: 'garbage', timestamp: 'not-a-date' }),
          makeRow({ name: 'valid-old', timestamp: '2020-01-01T00:00:00Z' }),
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Last update' }));

    // Descending: newest valid, older valid, then the garbage row (→ 0, oldest).
    // Without the NaN guard the garbage row would not sink deterministically.
    expect(bodyRowNames()).toEqual(['valid-new', 'valid-old', 'garbage']);
  });
});

describe('LiveSignalsTable — null-safety', () => {
  it('renders the empty table (no crash) when rows is undefined or null', () => {
    const { unmount } = render(
      <LiveSignalsTable rows={undefined as unknown as LiveSignalRow[]} />,
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(
      screen.getByText('No signals match this filter.'),
    ).toBeInTheDocument();
    unmount();

    render(<LiveSignalsTable rows={null as unknown as LiveSignalRow[]} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(
      screen.getByText('No signals match this filter.'),
    ).toBeInTheDocument();
  });
});
