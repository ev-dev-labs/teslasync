/**
 * SignalHistoryTable — behaviour + hardening coverage.
 *
 * Exercises the paginated signal-history table and locks in the fixes made
 * while elevating it:
 *   - the panel is a labelled landmark region and the decorative header/empty
 *     icons are hidden from assistive tech;
 *   - the header "Page X · N total" caption is null-safe through the shared int
 *     formatter and can be suppressed via `showHeaderMeta={false}`;
 *   - every value kind (number / string / boolean / null) renders the right
 *     cell text AND the right type badge variant;
 *   - the Signal column colour-codes only signals present in `selectedSignals`
 *     (a coloured dot + inline colour), leaving un-selected signals on the
 *     theme text colour with no dot;
 *   - REGRESSION: two samples of the same signal at the same timestamp used to
 *     share a React key (`${created_at}-${signal}`) and therefore expanded /
 *     collapsed together. Row keys are now position-unique, so expanding one
 *     drawer opens exactly one drawer;
 *   - loading shows an announced skeleton (no table); no rows shows the empty
 *     state (no table, no pagination);
 *   - null-safety: `rows` / `selectedSignals` handed to us as `undefined`
 *     degrade to the empty state instead of throwing on `.length` / `.indexOf`;
 *   - pagination is wired straight through to `onPageChange`.
 *
 * Interactions use `fireEvent` — `@testing-library/user-event` is intentionally
 * not a dependency of this repo (see the sibling *.test.tsx convention).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import { SignalHistoryTable, type SignalHistoryTableProps } from './SignalHistoryTable';
import type { SignalLogEntry } from '@/components/SignalQueryControls';
import { CHART_COLORS } from '@/lib/colors';

// i18n stub: echo the English fallback (or the key when no fallback is given,
// which is how this component supplies its copy — `t('Timestamp')`), and
// interpolate `{{var}}` from the options bag so the shared Pagination caption
// resolves to real numbers. Mirrors the SignalDiffBreakdown.test.tsx convention.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, vars?: Record<string, unknown>) => {
      let out = typeof fallback === 'string' ? fallback : key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
      }
      return out;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

const TS = '2026-07-04T12:00:00Z';

function numRow(over: Partial<SignalLogEntry> = {}): SignalLogEntry {
  return {
    created_at: TS,
    signal: 'vehicle_speed',
    value_num: 42,
    value_str: null,
    value_bool: null,
    ...over,
  };
}

function renderTable(over: Partial<SignalHistoryTableProps> = {}) {
  const onPageChange = over.onPageChange ?? vi.fn();
  const props: SignalHistoryTableProps = {
    rows: [numRow()],
    selectedSignals: [],
    page: 1,
    pageSize: 25,
    totalRows: 1,
    onPageChange,
    ...over,
  };
  const utils = render(<SignalHistoryTable {...props} />);
  return { ...utils, onPageChange, props };
}

/** The Signal-column cell that displays `name` (its innermost span). */
function signalNameSpan(name: string): HTMLElement {
  return screen.getByText(name);
}

describe('SignalHistoryTable', () => {
  it('renders a labelled landmark region with a heading and a null-safe count caption', () => {
    const { container } = renderTable({ page: 3, totalRows: 1234 });

    // Region + heading share the same accessible name via aria-labelledby.
    expect(screen.getByRole('region', { name: 'Signal Data' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Signal Data' })).toBeInTheDocument();

    // Caption reads through the shared int formatter (locale separators).
    expect(
      screen.getByText((_c, el) => el?.textContent === 'Page 3 · 1,234 total'),
    ).toBeInTheDocument();

    // The decorative header icon is hidden from assistive tech.
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThanOrEqual(1);
  });

  it('honours a custom title (used as both the heading and the region name)', () => {
    renderTable({ title: 'Signal history' });
    expect(screen.getByRole('region', { name: 'Signal history' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Signal history' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Signal Data' })).toBeNull();
  });

  it('renders all four columns with the timestamp formatted through the shared formatter', () => {
    renderTable();

    expect(screen.getByRole('columnheader', { name: 'Timestamp' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Signal' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Value' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Type' })).toBeInTheDocument();

    // The timestamp cell is populated (year survives every locale/tz permutation).
    const tsCell = screen.getByText((c) => c.includes('2026'));
    expect(tsCell.textContent).not.toBe('—');
    expect(screen.getByText('vehicle_speed')).toBeInTheDocument();
  });

  it('renders each value kind with the correct cell text and type-badge variant', () => {
    renderTable({
      rows: [
        numRow({ signal: 'speed', value_num: 42 }),
        numRow({ signal: 'gear', value_num: null, value_str: 'park' }),
        numRow({ signal: 'charging', value_num: null, value_bool: true }),
        numRow({ signal: 'locked', value_num: null, value_bool: false }),
        numRow({ signal: 'absent', value_num: null, value_str: null, value_bool: null }),
      ],
      totalRows: 5,
    });

    // Values.
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('park')).toBeInTheDocument();
    expect(screen.getByText('true')).toBeInTheDocument();
    expect(screen.getByText('false')).toBeInTheDocument();
    // A fully-null row falls back to the em-dash placeholder, never a crash.
    expect(screen.getByText('—')).toBeInTheDocument();

    // Type badges: number×1, string×2 (real string + null), boolean×2.
    expect(screen.getByText('number')).toBeInTheDocument();
    expect(screen.getAllByText('string')).toHaveLength(2);
    expect(screen.getAllByText('boolean')).toHaveLength(2);
  });

  it('colour-codes only signals present in selectedSignals (dot + inline colour)', () => {
    const { container } = renderTable({
      selectedSignals: ['vehicle_speed'],
      rows: [numRow({ signal: 'vehicle_speed' }), numRow({ signal: 'battery_level' })],
      totalRows: 2,
    });

    // Exactly one coloured dot — for the single selected signal. The dot is the
    // only aria-hidden rounded-full span (Badge is rounded-full but not hidden).
    const dots = container.querySelectorAll('span[aria-hidden="true"].rounded-full');
    expect(dots).toHaveLength(1);

    // The selected signal name carries an inline colour (from the chart palette);
    // the un-selected one has none and stays on the theme text colour.
    const selected = signalNameSpan('vehicle_speed');
    const unselected = signalNameSpan('battery_level');
    expect(selected.getAttribute('style')).toContain('color');
    expect(unselected.getAttribute('style')).toBeNull();
    expect(unselected.className).toContain('text-[var(--text-primary)]');

    // Palette is real (not empty) so index 0 maps to a concrete colour.
    expect(CHART_COLORS.length).toBeGreaterThan(0);
  });

  it('expands exactly one drawer even when two rows share timestamp + signal (key-collision regression)', () => {
    // Same created_at AND signal — the pre-fix `${created_at}-${signal}` key
    // collided and toggled BOTH drawers at once.
    const { container } = renderTable({
      rows: [numRow({ value_num: 1 }), numRow({ value_num: 2 })],
      totalRows: 2,
    });

    expect(container.querySelectorAll('[data-expanded-content="true"]')).toHaveLength(0);

    const expandButtons = screen.getAllByRole('button', { name: 'Expand row' });
    expect(expandButtons).toHaveLength(2);

    fireEvent.click(expandButtons[0]);

    const drawers = container.querySelectorAll('[data-expanded-content="true"]');
    expect(drawers).toHaveLength(1);
    // The opened drawer belongs to the FIRST row (value_num 1), not the second.
    expect(drawers[0].textContent).toContain('"value_num": 1');
    expect(drawers[0].textContent).not.toContain('"value_num": 2');
  });

  it('omits the row-expansion affordance when expandable is false', () => {
    renderTable({ expandable: false, rows: [numRow()], totalRows: 1 });
    expect(screen.queryByRole('button', { name: 'Expand row' })).toBeNull();
    // The table still renders its data.
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('vehicle_speed')).toBeInTheDocument();
  });

  it('shows an announced loading skeleton and no table while loading', () => {
    const { container } = renderTable({ loading: true });

    const status = screen.getByRole('status', { name: 'Loading signal data' });
    expect(status).toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(5);
    // No table, no pagination, no empty-state copy while loading.
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
    expect(screen.queryByText('No signal samples')).toBeNull();
  });

  it('shows the empty state (no table, no pagination) when there are no rows', () => {
    renderTable({ rows: [], totalRows: 0 });

    expect(screen.getByText('No signal samples')).toBeInTheDocument();
    expect(
      screen.getByText('No signal data matches the selected signals and time range.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Expand the time range or choose another signal/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
  });

  it('is null-safe: undefined rows / selectedSignals degrade to the empty state instead of throwing', () => {
    const bad = {
      rows: undefined,
      selectedSignals: undefined,
      page: 1,
      pageSize: 25,
      totalRows: 0,
      onPageChange: vi.fn(),
    } as unknown as SignalHistoryTableProps;

    expect(() => render(<SignalHistoryTable {...bad} />)).not.toThrow();
    expect(screen.getByText('No signal samples')).toBeInTheDocument();
  });

  it('wires pagination controls straight through to onPageChange', () => {
    const onPageChange = vi.fn();
    renderTable({ page: 2, pageSize: 25, totalRows: 100, onPageChange });

    // Shared Pagination integration: the "showing" range reflects page 2.
    expect(
      screen.getByText(
        (c) => c.includes('Showing') && c.includes('26') && c.includes('50') && c.includes('100'),
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenCalledWith(3);

    fireEvent.click(screen.getByRole('button', { name: 'First page' }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('hides the count caption when showHeaderMeta is false and merges a custom className onto the panel', () => {
    const { container } = renderTable({
      showHeaderMeta: false,
      className: 'test-marker',
      totalRows: 1,
    });

    expect(screen.queryByText((_c, el) => el?.textContent === 'Page 1 · 1 total')).toBeNull();

    // The custom class is merged onto the glass panel, not replacing the base padding.
    const panel = container.querySelector('[data-print-card]');
    expect(panel).not.toBeNull();
    expect(panel?.className).toContain('test-marker');
    expect(panel?.className).toContain('p-4');
  });

  it('keeps the type column readable for a plain string value', () => {
    renderTable({
      rows: [numRow({ signal: 'sw_version', value_num: null, value_str: '2026.20.1' })],
      totalRows: 1,
    });
    const cell = within(screen.getByRole('table')).getByText('2026.20.1');
    expect(cell).toBeInTheDocument();
    expect(screen.getByText('string')).toBeInTheDocument();
  });
});
