/**
 * SignalQueryControls — behaviour + hardening coverage.
 *
 * Exercises EVERY export of the module:
 *   - pure helpers: toLocalDatetimeStr, formatTimestampMs, getValueType,
 *     formatValue, adaptSignalHistoryPoint, adaptSignalHistoryResp
 *   - constant maps: TYPE_BADGE_COLOR (Badge-variant fix), TYPE_VALUE_COLOR,
 *     PAGE_SIZES
 *   - typed shapes: SignalLogEntry, SignalHistoryPagination,
 *     SignalHistoryResponse
 *   - components: SignalMultiSelect (catalog query loading/error/empty/max +
 *     add/remove + combobox a11y), DateTimeRangeControls (label association +
 *     preset active state), QueryControls (rows select + query button), and
 *     SignalDataTable (loading skeleton, columns, value/type rendering, the
 *     Badge-variant fix, null-safety, and the a11y-labelled pager).
 *
 * The network boundary (`@/api/client` `request`) is mocked — never real
 * network. i18n is stubbed to echo the English fallback with {{var}}
 * interpolation so assertions can target the rendered copy. Interactions use
 * `fireEvent` (the repo's installed test toolchain — user-event is not a dep).
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { SignalHistoryPoint, SignalHistoryResp } from '@/api/types';

// ── i18n stub: echo the fallback string, interpolating {{var}} tokens. ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          const o = opts as Record<string, unknown>;
          return fallbackOrOpts.replace(/{{(\w+)}}/g, (_m, name: string) =>
            name in o ? String(o[name]) : `{{${name}}}`,
          );
        }
        return fallbackOrOpts;
      }
      return key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── network seam ──
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

import { request } from '@/api/client';
import {
  toLocalDatetimeStr,
  formatTimestampMs,
  getValueType,
  formatValue,
  adaptSignalHistoryPoint,
  adaptSignalHistoryResp,
  TYPE_BADGE_COLOR,
  TYPE_VALUE_COLOR,
  PAGE_SIZES,
  SignalMultiSelect,
  DateTimeRangeControls,
  QueryControls,
  SignalDataTable,
  type SignalLogEntry,
  type SignalHistoryPagination,
  type SignalHistoryResponse,
} from './SignalQueryControls';

const mockRequest = request as unknown as Mock;

// jsdom lacks matchMedia; DataTable's density plumbing may read it.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function renderWithClient(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(node, { wrapper: Wrapper });
}

const entry = (over: Partial<SignalLogEntry> = {}): SignalLogEntry => ({
  created_at: '2026-05-13T01:04:51.177Z',
  signal: 'Odometer',
  value_num: null,
  value_str: null,
  value_bool: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockRequest.mockResolvedValue([]);
});

// ────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ────────────────────────────────────────────────────────────────────────────

describe('toLocalDatetimeStr', () => {
  it('zero-pads every component of a local Date into datetime-local form', () => {
    const d = new Date(2026, 0, 5, 9, 3, 7); // local Jan 5 2026 09:03:07
    expect(toLocalDatetimeStr(d)).toBe('2026-01-05T09:03:07');
  });

  it('keeps already-two-digit months/days intact', () => {
    const d = new Date(2026, 10, 23, 14, 30, 59); // Nov 23 2026 14:30:59
    expect(toLocalDatetimeStr(d)).toBe('2026-11-23T14:30:59');
  });
});

describe('formatTimestampMs', () => {
  it('formats a valid instant to millisecond precision (round-tripped, TZ-stable)', () => {
    const local = new Date(2026, 4, 13, 1, 4, 51, 177);
    // toISOString → UTC; formatTimestampMs parses back to the same instant and
    // reads local getters, so the local components round-trip regardless of TZ.
    expect(formatTimestampMs(local.toISOString())).toBe('2026-05-13 01:04:51.177');
  });

  it('returns the em-dash placeholder for an unparseable timestamp', () => {
    expect(formatTimestampMs('not-a-date')).toBe('—');
    expect(formatTimestampMs('')).toBe('—');
  });
});

describe('getValueType', () => {
  it('classifies by the first non-null discriminator (num > str > bool)', () => {
    expect(getValueType(entry({ value_num: 42 }))).toBe('num');
    expect(getValueType(entry({ value_str: 'hi' }))).toBe('str');
    expect(getValueType(entry({ value_bool: true }))).toBe('bool');
    expect(getValueType(entry())).toBe('null');
  });

  it('treats falsy-but-present values (0, "", false) as their real type, not null', () => {
    expect(getValueType(entry({ value_num: 0 }))).toBe('num');
    expect(getValueType(entry({ value_str: '' }))).toBe('str');
    expect(getValueType(entry({ value_bool: false }))).toBe('bool');
  });
});

describe('formatValue', () => {
  it('stringifies numbers/strings and maps booleans to "true"/"false"', () => {
    expect(formatValue(entry({ value_num: 43.5 }))).toBe('43.5');
    expect(formatValue(entry({ value_str: 'Driving' }))).toBe('Driving');
    expect(formatValue(entry({ value_bool: true }))).toBe('true');
    expect(formatValue(entry({ value_bool: false }))).toBe('false');
  });

  it('preserves 0 as "0" and falls back to the em-dash for an all-null row', () => {
    expect(formatValue(entry({ value_num: 0 }))).toBe('0');
    expect(formatValue(entry())).toBe('—');
  });
});

describe('adaptSignalHistoryPoint / adaptSignalHistoryResp', () => {
  const pt = (value: SignalHistoryPoint['value']): SignalHistoryPoint => ({
    ts: '2026-05-13T01:04:51.177Z',
    kind: 'ValueKindDouble',
    value,
  });

  it('routes a typed value into the matching legacy column', () => {
    expect(adaptSignalHistoryPoint(pt(12.5), 'Odometer')).toEqual<SignalLogEntry>({
      created_at: '2026-05-13T01:04:51.177Z',
      signal: 'Odometer',
      value_num: 12.5,
      value_str: null,
      value_bool: null,
    });
    expect(adaptSignalHistoryPoint(pt('Driving'), 'Gear').value_str).toBe('Driving');
    expect(adaptSignalHistoryPoint(pt(false), 'Locked').value_bool).toBe(false);
  });

  it('nulls non-finite numbers and null values (no spurious zero/empty)', () => {
    expect(adaptSignalHistoryPoint(pt(Number.NaN), 'X').value_num).toBeNull();
    expect(adaptSignalHistoryPoint(pt(Number.POSITIVE_INFINITY), 'X').value_num).toBeNull();
    const nul = adaptSignalHistoryPoint(pt(null), 'X');
    expect(nul.value_num).toBeNull();
    expect(nul.value_str).toBeNull();
  });

  it('adaptSignalHistoryResp returns [] for null/undefined/missing data and stamps resp.signal', () => {
    expect(adaptSignalHistoryResp(null)).toEqual([]);
    expect(adaptSignalHistoryResp(undefined)).toEqual([]);
    expect(adaptSignalHistoryResp({} as SignalHistoryResp)).toEqual([]);
    const resp: SignalHistoryResp = {
      vehicle_id: 1,
      signal: 'Soc',
      count: 2,
      data: [pt(1), pt(2)],
    };
    const rows = adaptSignalHistoryResp(resp);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.signal === 'Soc')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Constant maps + typed shapes
// ────────────────────────────────────────────────────────────────────────────

describe('exported constants', () => {
  it('TYPE_BADGE_COLOR maps every value-type to a REAL Badge variant (the color→variant fix)', () => {
    // Guards against the regression where these were cyan/green/amber and got
    // passed to Badge as an inert `color` DOM attribute (always neutral).
    expect(TYPE_BADGE_COLOR).toEqual({
      num: 'info',
      str: 'success',
      bool: 'warning',
      null: 'neutral',
    });
  });

  it('TYPE_VALUE_COLOR uses toned-down 300-shade classes and a theme var for null', () => {
    expect(TYPE_VALUE_COLOR.num).toBe('text-cyan-300');
    expect(TYPE_VALUE_COLOR.str).toBe('text-emerald-300');
    expect(TYPE_VALUE_COLOR.null).toContain('var(--text-muted)');
  });

  it('PAGE_SIZES exposes the 25/50/100 pagination ladder', () => {
    expect(PAGE_SIZES).toEqual([25, 50, 100]);
  });
});

describe('exported types (compile-time shapes exercised at runtime)', () => {
  it('SignalHistoryResponse composes SignalLogEntry rows with SignalHistoryPagination', () => {
    const pagination: SignalHistoryPagination = {
      page: 1,
      per_page: 50,
      total: 120,
      total_pages: 3,
    };
    const resp: SignalHistoryResponse = { data: [entry({ value_num: 1 })], pagination };
    expect(resp.pagination.total_pages).toBe(3);
    expect(resp.data[0].value_num).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// SignalMultiSelect
// ────────────────────────────────────────────────────────────────────────────

describe('SignalMultiSelect', () => {
  it('renders the plain / max-annotated label and an accessible combobox', () => {
    const { rerender } = renderWithClient(
      <SignalMultiSelect vehicleId={7} selected={[]} onChange={vi.fn()} />,
    );
    expect(screen.getByText('Signals')).toBeInTheDocument();
    const combo = screen.getByRole('combobox');
    expect(combo).toHaveAccessibleName('Search signals');
    expect(combo).toHaveAttribute('aria-expanded', 'false');

    rerender(<SignalMultiSelect vehicleId={7} selected={[]} onChange={vi.fn()} maxSignals={3} />);
    expect(screen.getByText('Signals (max 3)')).toBeInTheDocument();
  });

  it('shows a loading state in the open dropdown while the catalog query is in flight', () => {
    mockRequest.mockReturnValue(new Promise<string[]>(() => {})); // never resolves
    renderWithClient(<SignalMultiSelect vehicleId={7} selected={[]} onChange={vi.fn()} />);

    const combo = screen.getByRole('combobox');
    fireEvent.focus(combo);
    expect(combo).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Loading signals…')).toBeInTheDocument();
  });

  it('lists the fetched catalog as options and filters them as the user types', async () => {
    mockRequest.mockResolvedValue(['speed', 'soc', 'gear']);
    renderWithClient(<SignalMultiSelect vehicleId={7} selected={[]} onChange={vi.fn()} />);

    const combo = screen.getByRole('combobox');
    fireEvent.focus(combo);
    expect(await screen.findByRole('option', { name: 'speed' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'soc' })).toBeInTheDocument();
    expect(mockRequest).toHaveBeenCalledWith('/signals/available?vehicle_id=7');

    fireEvent.change(combo, { target: { value: 'so' } });
    expect(screen.getByRole('option', { name: 'soc' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'speed' })).toBeNull();
  });

  it('excludes already-selected signals and adds a signal on option click', async () => {
    const onChange = vi.fn();
    mockRequest.mockResolvedValue(['speed', 'soc', 'gear']);
    renderWithClient(
      <SignalMultiSelect vehicleId={7} selected={['gear']} onChange={onChange} />,
    );

    fireEvent.focus(screen.getByRole('combobox'));
    // 'gear' is already selected → not offered as an option.
    expect(await screen.findByRole('option', { name: 'speed' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'gear' })).toBeNull();

    fireEvent.click(screen.getByRole('option', { name: 'soc' }));
    expect(onChange).toHaveBeenCalledWith(['gear', 'soc']);
  });

  it('removes a selected signal via its aria-labelled chip button', () => {
    const onChange = vi.fn();
    renderWithClient(
      <SignalMultiSelect vehicleId={7} selected={['speed', 'soc']} onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove speed' }));
    expect(onChange).toHaveBeenCalledWith(['soc']);
  });

  it('shows the max-reached hint and offers no options once maxSignals is hit', async () => {
    mockRequest.mockResolvedValue(['gear']);
    renderWithClient(
      <SignalMultiSelect vehicleId={7} selected={['speed', 'soc']} onChange={vi.fn()} maxSignals={2} />,
    );

    fireEvent.focus(screen.getByRole('combobox'));
    expect(await screen.findByText('Maximum of 2 signals selected')).toBeInTheDocument();
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('shows an empty state when the catalog is empty', async () => {
    mockRequest.mockResolvedValue([]);
    renderWithClient(<SignalMultiSelect vehicleId={7} selected={[]} onChange={vi.fn()} />);
    fireEvent.focus(screen.getByRole('combobox'));
    expect(await screen.findByText('No signals available')).toBeInTheDocument();
  });

  it('surfaces an error state when the catalog request fails', async () => {
    mockRequest.mockRejectedValue(new Error('boom'));
    renderWithClient(<SignalMultiSelect vehicleId={9} selected={[]} onChange={vi.fn()} />);
    fireEvent.focus(screen.getByRole('combobox'));
    expect(await screen.findByText('Failed to load signals')).toBeInTheDocument();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// DateTimeRangeControls
// ────────────────────────────────────────────────────────────────────────────

describe('DateTimeRangeControls', () => {
  it('associates the From/To labels with their inputs and reports edits', () => {
    const onFromChange = vi.fn();
    const onToChange = vi.fn();
    render(
      <DateTimeRangeControls
        fromStr=""
        toStr=""
        onFromChange={onFromChange}
        onToChange={onToChange}
        onPreset={vi.fn()}
      />,
    );

    const from = screen.getByLabelText('From');
    const to = screen.getByLabelText('To');
    expect(from).toBeInTheDocument();
    expect(to).toBeInTheDocument();

    fireEvent.change(from, { target: { value: '2026-07-01T10:30' } });
    expect(onFromChange).toHaveBeenCalledWith('2026-07-01T10:30');
    fireEvent.change(to, { target: { value: '2026-07-02T11:45' } });
    expect(onToChange).toHaveBeenCalledWith('2026-07-02T11:45');
  });

  it('marks the matching quick-range preset as pressed and fires onPreset on click', () => {
    const onPreset = vi.fn();
    // A 24h span (both local) matches the 24h preset within tolerance.
    render(
      <DateTimeRangeControls
        fromStr="2026-07-01T00:00:00"
        toStr="2026-07-02T00:00:00"
        onFromChange={vi.fn()}
        onToChange={vi.fn()}
        onPreset={onPreset}
      />,
    );

    expect(screen.getByRole('button', { name: '24h time range' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: '1h time range' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    fireEvent.click(screen.getByRole('button', { name: '6h time range' }));
    expect(onPreset).toHaveBeenCalledWith(6);
  });

  it('marks no preset active when the span matches none', () => {
    render(
      <DateTimeRangeControls
        fromStr="2026-07-01T00:00:00"
        toStr="2026-07-01T02:30:00"
        onFromChange={vi.fn()}
        onToChange={vi.fn()}
        onPreset={vi.fn()}
      />,
    );
    for (const label of ['1h', '6h', '24h', '7d', '30d']) {
      expect(
        screen.getByRole('button', { name: `${label} time range` }),
      ).toHaveAttribute('aria-pressed', 'false');
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// QueryControls
// ────────────────────────────────────────────────────────────────────────────

describe('QueryControls', () => {
  it('renders the labelled Rows select over PAGE_SIZES and reports a numeric change', () => {
    const onPerPageChange = vi.fn();
    render(
      <QueryControls perPage={50} onPerPageChange={onPerPageChange} onQuery={vi.fn()} />,
    );

    const select = screen.getByLabelText('Rows') as HTMLSelectElement;
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      '25',
      '50',
      '100',
    ]);
    expect(select.value).toBe('50');

    fireEvent.change(select, { target: { value: '100' } });
    expect(onPerPageChange).toHaveBeenCalledWith(100);
  });

  it('fires onQuery from the default-labelled button and honours a custom label', () => {
    const onQuery = vi.fn();
    const { rerender } = render(
      <QueryControls perPage={50} onPerPageChange={vi.fn()} onQuery={onQuery} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Query' }));
    expect(onQuery).toHaveBeenCalledTimes(1);

    rerender(
      <QueryControls perPage={50} onPerPageChange={vi.fn()} onQuery={onQuery} label="Run" />,
    );
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument();
  });

  it('disables the query button while disabled or loading (and flags aria-busy)', () => {
    const { rerender } = render(
      <QueryControls perPage={50} onPerPageChange={vi.fn()} onQuery={vi.fn()} disabled />,
    );
    expect(screen.getByRole('button', { name: 'Query' })).toBeDisabled();

    rerender(<QueryControls perPage={50} onPerPageChange={vi.fn()} onQuery={vi.fn()} loading />);
    const btn = screen.getByRole('button', { name: 'Query' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// SignalDataTable
// ────────────────────────────────────────────────────────────────────────────

const ROWS: SignalLogEntry[] = [
  entry({ created_at: new Date(2026, 4, 13, 1, 0, 0, 0).toISOString(), signal: 'Odometer', value_num: 42 }),
  entry({ created_at: new Date(2026, 4, 13, 1, 1, 0, 0).toISOString(), signal: 'Gear', value_str: 'Driving' }),
  entry({ created_at: new Date(2026, 4, 13, 1, 2, 0, 0).toISOString(), signal: 'Locked', value_bool: false }),
];

describe('SignalDataTable', () => {
  it('renders a skeleton (and no table) while loading', () => {
    const { container } = render(
      <SignalDataTable
        rows={[]}
        page={1}
        totalPages={1}
        total={0}
        perPage={50}
        onPageChange={vi.fn()}
        loading
      />,
    );
    expect(screen.queryByRole('table')).toBeNull();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders the five columns and each row with formatted value + colour-coded type badge', () => {
    render(
      <SignalDataTable
        rows={ROWS}
        page={1}
        totalPages={1}
        total={ROWS.length}
        perPage={50}
        onPageChange={vi.fn()}
      />,
    );

    const table = screen.getByRole('table');
    for (const header of ['#', 'Timestamp', 'Signal', 'Value', 'Type']) {
      expect(within(table).getByText(header)).toBeInTheDocument();
    }

    // Values render via formatValue; note the boolean false → "false".
    expect(within(table).getByText('42')).toBeInTheDocument();
    expect(within(table).getByText('Driving')).toBeInTheDocument();
    expect(within(table).getByText('false')).toBeInTheDocument();

    // The Badge-variant fix: the 'num' chip carries the info variant and the
    // 'str' chip the success variant (previously an inert `color` attr left
    // every chip rendering the default neutral style).
    expect(within(table).getByText('num').className).toContain('bg-blue-100');
    expect(within(table).getByText('str').className).toContain('bg-green-100');
  });

  it('shows the empty message for an empty batch and does not crash on undefined rows', () => {
    const { rerender } = render(
      <SignalDataTable
        rows={[]}
        page={1}
        totalPages={1}
        total={0}
        perPage={50}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByText('No results')).toBeInTheDocument();

    // Null-safety: an undefined rows prop must degrade to the empty state.
    rerender(
      <SignalDataTable
        rows={undefined as unknown as SignalLogEntry[]}
        page={1}
        totalPages={1}
        total={0}
        perPage={50}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByText('No results')).toBeInTheDocument();
  });

  it('renders the a11y-labelled pager only when multi-page, with correct disabled edges', () => {
    const onPageChange = vi.fn();
    render(
      <SignalDataTable
        rows={ROWS}
        page={2}
        totalPages={3}
        total={250}
        perPage={100}
        onPageChange={onPageChange}
      />,
    );

    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    expect(screen.getByText('250 records')).toBeInTheDocument();

    const first = screen.getByRole('button', { name: 'First page' });
    const prev = screen.getByRole('button', { name: 'Previous page' });
    const next = screen.getByRole('button', { name: 'Next page' });
    const last = screen.getByRole('button', { name: 'Last page' });
    // Middle page → every edge control is enabled.
    for (const b of [first, prev, next, last]) expect(b).toBeEnabled();

    fireEvent.click(next);
    expect(onPageChange).toHaveBeenLastCalledWith(3);
    fireEvent.click(prev);
    expect(onPageChange).toHaveBeenLastCalledWith(1);
    fireEvent.click(last);
    expect(onPageChange).toHaveBeenLastCalledWith(3);
    fireEvent.click(first);
    expect(onPageChange).toHaveBeenLastCalledWith(1);
  });

  it('disables the leading pager controls on page 1 and hides the pager for a single page', () => {
    const { rerender } = render(
      <SignalDataTable
        rows={ROWS}
        page={1}
        totalPages={3}
        total={250}
        perPage={100}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'First page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();

    rerender(
      <SignalDataTable
        rows={ROWS}
        page={1}
        totalPages={1}
        total={ROWS.length}
        perPage={50}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
  });
});
