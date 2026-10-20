import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatDate } from '@/lib/dateFormat';
import { getGlobalLocale, setGlobalLocale } from '@/lib/numberFormat';
import { summarizeExplorer, type Destination } from '../../lib/explorer';
import { DestinationDirectory } from './DestinationDirectory';
import type { DataTable } from '@/components/ui';

type TableProps = ComponentProps<typeof DataTable<Destination>>;
const capturedTable = vi.hoisted(() => ({ props: null as TableProps | null }));
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...actual,
    DataTable: (props: TableProps) => {
      capturedTable.props = props;
      return <actual.DataTable {...props} />;
    },
  };
});

const preferences = vi.hoisted(() => ({
  locale: undefined as string | undefined,
  tz: undefined as string | undefined,
}));

vi.mock('@/hooks/useDateFormat', async () => {
  const { formatDate } = await import('@/lib/dateFormat');
  return {
    useDateFormat: () => {
      const options = { ...preferences };
      return {
        formatDate: (value: string | Date | null | undefined) => formatDate(value, options),
      };
    },
  };
});

const destination: Destination = {
  id: 'destination-one',
  ordinal: 1,
  label: 'A long destination name that must remain fully readable in details',
  visits: 7,
  repeatVisits: 6,
  distanceFromBaseM: 12345,
  firstVisitedAt: '2026-09-01T12:00:00Z',
  lastVisitedAt: '2026-09-02T12:00:00Z',
  firstVisitMonth: '2026-09',
};

const formatDistance = (meters: number | null | undefined) => `${meters} m`;

function show(width: number, baseSufficient = true, destinations = [destination]) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(0, 0, width, 44),
  );
  const summary = summarizeExplorer([]);
  summary.destinations = destinations;
  summary.eligibility.eligible = 10;
  summary.evidence.baseSufficient = baseSufficient;
  return render(
    <MemoryRouter>
      <DestinationDirectory
        summary={summary}
        state={{ isLoading: false, error: null, onRetry: vi.fn() }}
        formatDistance={formatDistance}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  preferences.locale = undefined;
  preferences.tz = undefined;
});
const originalLocale = getGlobalLocale();
afterEach(() => {
  vi.restoreAllMocks();
  capturedTable.props = null;
  setGlobalLocale(originalLocale);
});

describe('DestinationDirectory number formatting', () => {
  const cases: [string, unknown, string][] = [
    ['missing null', null, '—'],
    ['missing undefined', undefined, '—'],
    ['NaN', NaN, '—'],
    ['positive infinity', Infinity, '—'],
    ['negative infinity', -Infinity, '—'],
    ['numeric string', '1234', '—'],
    ['measured zero', 0, '0'],
    ['positive count', 1234, '1,234'],
    ['negative count', -1234, '-1,234'],
    ['positive fraction', 1234.6, '1,235'],
    ['negative fraction', -1234.6, '-1,235'],
  ];

  describe.each([375, 1280])('at width %i', (width) => {
    it.each(cases)('formats %s without changing source operands', async (_name, value, expected) => {
      setGlobalLocale('en-US');
      const arrival = { ...destination };
      // Malformed runtime values must not be confused with measured zero.
      Object.assign(arrival, { visits: value, repeatVisits: value });
      show(width, true, [arrival]);
      if (width === 375) {
        await userEvent.setup().click(screen.getByRole('button', { name: arrival.label! }));
      }
      const surface = width === 375
        ? screen.getByRole('dialog')
        : screen.getByRole('table', { name: 'Observed destination directory' });
      expect(within(surface).getAllByText(expected)).toHaveLength(2);
      expect(arrival.visits).toBe(value);
      expect(arrival.repeatVisits).toBe(value);
      const props = capturedTable.props!;
      expect(props.data[0]).toBe(arrival);
      for (const key of ['visits', 'repeatVisits']) {
        const column = props.columns.find((candidate) => candidate.key === key)!;
        expect(column.key).toBe(key);
        expect(column.sortable).toBe(true);
        expect(column.filterValue?.(arrival)).toBe(value ?? null);
        expect(props.mobilePresentation?.displayValue(arrival, key)).toBe(expected);
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        const exported = JSON.parse(JSON.stringify(arrival));
        expect(exported.visits).toBe(value);
        expect(exported.repeatVisits).toBe(value);
      }
    });
  });

  it('retains raw numeric sort keys and filter values for rounded fractional counts', async () => {
    setGlobalLocale('en-US');
    const user = userEvent.setup();
    const rows = [
      { ...destination, id: 'larger', label: 'Larger count', visits: 1000.4 },
      { ...destination, id: 'smaller', label: 'Smaller count', visits: 999.6 },
    ];
    show(1280, true, rows);
    const table = screen.getByRole('table', { name: 'Observed destination directory' });
    expect(within(table).getAllByText('1,000')).toHaveLength(2);
    const column = capturedTable.props!.columns.find((candidate) => candidate.key === 'visits')!;
    expect(column.sortable).toBe(true);
    expect(column.key).toBe('visits');
    expect(capturedTable.props!.data).toBe(rows);
    expect(rows.map((row) => column.filterValue?.(row))).toEqual([1000.4, 999.6]);
    await user.click(screen.getByRole('button', { name: 'Visits filter' }));
    const filter = screen.getByRole('dialog', { name: 'Visits filter' });
    // Filter options group by the visible label; both raw operands stay in that one option.
    expect(within(filter).getByText('1,000')).toBeVisible();
    expect(within(filter).getByText('2')).toBeVisible();
  });
});

describe('DestinationDirectory responsive field preservation', () => {
  it.each([375, 1280])('updates preference-aware dates at width %i without changing raw timestamps', async (width) => {
    const user = userEvent.setup();
    preferences.locale = 'en-US';
    preferences.tz = 'UTC';
    const arrival = { ...destination, firstVisitedAt: '2026-10-14T00:30:00Z' };
    const view = show(width, true, [arrival]);
    if (width === 375) {
      await user.click(screen.getByRole('button', { name: arrival.label! }));
    }
    expect(screen.getByText('Oct 14, 2026')).toBeVisible();

    preferences.locale = 'de-DE';
    preferences.tz = 'America/Los_Angeles';
    const summary = summarizeExplorer([]);
    summary.destinations = [arrival];
    summary.eligibility.eligible = 10;
    summary.evidence.baseSufficient = true;
    view.rerender(
      <MemoryRouter>
        <DestinationDirectory
          summary={summary}
          state={{ isLoading: false, error: null, onRetry: vi.fn() }}
          formatDistance={formatDistance}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('13. Okt. 2026')).toBeVisible();
    expect(screen.queryByText('Oct 14, 2026')).not.toBeInTheDocument();
    expect(arrival.firstVisitedAt).toBe('2026-10-14T00:30:00Z');
    expect(summary.destinations[0].firstVisitedAt).toBe('2026-10-14T00:30:00Z');

    if (width === 1280) {
      await user.click(screen.getByRole('button', { name: 'First visit filter' }));
      const filter = screen.getByRole('dialog', { name: 'First visit filter' });
      expect(within(filter).getByText('13. Okt. 2026')).toBeVisible();
    }
  });

  it('opens every field by keyboard on mobile and restores focus on Escape', async () => {
    const user = userEvent.setup();
    const { container } = show(375);
    expect(container.querySelector('[data-mobile-table]')).not.toBeNull();
    const row = screen.getByRole('button', { name: destination.label! });
    row.focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog');
    for (const label of ['Place', 'Visits', 'Repeat arrivals', 'From inferred base', 'First visit']) {
      expect(within(dialog).getByText(label)).toBeVisible();
    }
    for (const value of [destination.label!, '7', '6', '12345 m', formatDate(destination.firstVisitedAt)]) {
      expect(within(dialog).getByText(value)).toBeVisible();
    }
    expect(within(dialog).getByText(destination.label!)).not.toHaveClass('truncate');
    expect(screen.getAllByRole('button', { name: 'Close' }).at(-1)).toHaveClass('min-h-11', 'min-w-11');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(row).toHaveFocus());
    await user.keyboard(' ');
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('keeps insufficient base evidence unknown in the full mobile details', async () => {
    const user = userEvent.setup();
    show(375, false, [{ ...destination, label: null }]);
    await user.click(screen.getByRole('button', { name: 'Unnamed destination 1' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('—')).toBeVisible();
    expect(within(dialog).queryByText('12345 m')).not.toBeInTheDocument();
    expect(within(dialog).getByText('Repeat arrivals')).toBeVisible();
  });

  it('retains the desktop table, all five column keys and the existing controls', () => {
    const { container } = show(1280);
    const table = screen.getByRole('table', { name: 'Observed destination directory' });
    expect(Array.from(table.querySelectorAll('th[data-column-key]'), cell => cell.getAttribute('data-column-key')))
      .toEqual(['label', 'visits', 'repeatVisits', 'distanceFromBaseM', 'firstVisitedAt']);
    expect(within(table).getByText('12345 m')).toBeVisible();
    expect(container.querySelector('[data-mobile-table]')).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Search loaded rows' })).toBeVisible();
    expect(screen.getByRole('button', { name: /export/i })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Repeat arrivals filter' })).toBeVisible();
  });

  it('keeps mobile pagination and searching in the same table pipeline', async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 30 }, (_, index) => ({
      ...destination, id: `destination-${index}`, label: `Place ${index}`,
    }));
    show(375, true, rows);
    expect(screen.queryByRole('button', { name: 'Place 29', exact: true })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Load \d+ more/ }));
    expect(screen.getByRole('button', { name: 'Place 29', exact: true })).toBeVisible();
    await user.type(screen.getByRole('searchbox', { name: 'Search loaded rows' }), 'Place 29');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Place 0', exact: true })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Place 29', exact: true })).toBeVisible();
  });
});
