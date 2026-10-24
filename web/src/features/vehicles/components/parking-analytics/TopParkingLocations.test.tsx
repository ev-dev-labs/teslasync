import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { summarizeParking } from '../../lib/parkingDwell';
import { TopParkingLocations } from './TopParkingLocations';
import { LongestParkingStints } from './LongestParkingStints';
import { ParkingCoverageMethodology } from './ParkingCoverageMethodology';
import { MemoryRouter } from 'react-router-dom';
import type { DataStatus } from '@/api/dataState';
import { OvernightParkingContext } from './OvernightParkingContext';
import { ParkingTemporalProfile } from './ParkingTemporalProfile';
import { DurationDistributionChart } from './DurationDistributionChart';
import { resolveChartPalette, type ChartPaletteId } from '@/hooks/useChartPalette';
import { downloadCSV } from '@/lib/csvExport';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

const durationPreferences = vi.hoisted(() => ({ duration: 'h' as 'h' | 'min' | 's' }));
const datePreferences = vi.hoisted(() => ({ locale: 'en-US', tz: 'UTC' }));
const chartPreferences = vi.hoisted(() => ({
  palette: 'cb_safe' as 'cb_safe' | 'neon',
  fixedSize: false,
}));
const originalFormatting = getFormatterPreferences();

vi.mock('@/api/hooks/useAnnotations', () => ({
  useChartAnnotations: () => ({
    data: [], isLoading: false, isError: false, error: null,
  }),
  useChartAnnotationsAsData: () => ({
    annotations: [], isLoading: false, isError: false, error: null,
  }),
  useCreateAnnotation: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateAnnotation: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteAnnotation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/useChartPalette', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useChartPalette')>();
  return {
    ...actual,
    useChartPalette: () => actual.resolveChartPalette(chartPreferences.palette),
  };
});

vi.mock('@/components/charts', async (importActual) => {
  const actual = await importActual<typeof import('@/components/charts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <actual.ResponsiveContainer
        width={chartPreferences.fixedSize ? 800 : '100%'}
        height={chartPreferences.fixedSize ? 320 : '100%'}
      >
        {children}
      </actual.ResponsiveContainer>
    ),
  };
});

vi.mock('@/lib/csvExport', async () => ({
  ...await vi.importActual<typeof import('@/lib/csvExport')>('@/lib/csvExport'),
  downloadCSV: vi.fn(),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatDuration: (seconds: number) => `${seconds} s`,
    unitPrefs: durationPreferences,
  }),
}));

vi.mock('@/hooks/useDateFormat', async () => {
  const { formatTime, formatWeekdayName } = await vi.importActual<typeof import('@/lib/dateFormat')>('@/lib/dateFormat');
  return {
    useDateFormat: () => ({
      ...datePreferences,
      formatTime: (value: Date, override?: import('@/lib/dateFormat').FormatOptions) =>
        formatTime(value, { ...datePreferences, ...override }),
      formatWeekdayName: (value: Date, override?: import('@/lib/dateFormat').FormatOptions) =>
        formatWeekdayName(value, { ...datePreferences, ...override }),
      formatDateTime: (date: Date | null) => date?.toISOString() ?? '—',
    }),
  };
});

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, variables?: Record<string, unknown>) =>
        (typeof fallback === 'string' ? fallback : key)
          .replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(variables?.[name] ?? '')),
      i18n: { language: 'en' },
    }),
  };
});

vi.mock('@/hooks/useOperationalMetrics', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useOperationalMetrics')>('@/hooks/useOperationalMetrics');
  return { ...actual, useOperationalMetrics: vi.fn(actual.useOperationalMetrics) };
});

/** Omitted tiles carry no value-state attribute, so the classification is pinned on the mapped hook output. */
function mappedValueState(occurrenceId: string) {
  const mapped = vi.mocked(useOperationalMetrics).mock.results.at(-1)?.value as
    readonly { key: string; valueState?: string }[] | undefined;
  return mapped?.find(metric => metric.key === occurrenceId)?.valueState;
}

function summary(possiblyCapped = false) {
  const value = summarizeParking([], {
    nowMs: Date.parse('2026-09-01T12:00:00Z'),
    rangeStart: '2026-09-01',
    rangeEnd: '2026-09-01',
    timeZone: 'UTC',
  });
  value.coverage.possiblyCapped = possiblyCapped;
  value.locations = Array.from({ length: 30 }, (_, index) => ({
    location: `Location ${index + 1}`,
    stints: index === 29 ? 7 : 1,
    totalMs: 1_000,
    share: 1 / 30,
  }));
  return value;
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  vi.mocked(downloadCSV).mockClear();
  durationPreferences.duration = 'h';
  chartPreferences.palette = 'cb_safe';
  chartPreferences.fixedSize = false;
  datePreferences.locale = 'en-US';
  datePreferences.tz = 'UTC';
  setGlobalLocale('en-US');
});

afterEach(() => {
  cleanup();
  setGlobalLocale(originalFormatting.locale);
  setGlobalPrecision(originalFormatting.precision);
});

describe('DurationDistributionChart saved palette and series identities', () => {
  it.each<ChartPaletteId>(['cb_safe', 'neon'])(
    'uses %s slots 0 and 3 and preserves populated data and legend state on palette changes',
    async paletteId => {
      chartPreferences.palette = paletteId;
      chartPreferences.fixedSize = true;
      const value = summary();
      value.stints = [{
        sourceDriveId: 1, location: 'Home',
        startMs: Date.parse('2026-09-01T00:00:00Z'),
        endMs: Date.parse('2026-09-01T02:00:00Z'),
        durationMs: 7_200_000, ongoing: false, rightCensored: false,
      }];
      value.durationBands[1].stints = 1;
      value.durationBands[1].totalMs = 7_200_000;
      const state = { isLoading: false, error: null, onRetry: vi.fn() };
      const chart = () => (
        <MemoryRouter>
          <DurationDistributionChart summary={value} state={state} />
        </MemoryRouter>
      );
      const { container, rerender } = render(chart());
      const assertPalette = () => {
        const palette = resolveChartPalette(chartPreferences.palette);
        expect(container.querySelector('.recharts-bar-rectangle path'))
          .toHaveAttribute('fill', palette[0]);
        expect(container.querySelector('.recharts-line-curve'))
          .toHaveAttribute('stroke', palette[3]);
      };
      await waitFor(assertPalette);
      expect(container.querySelector('[data-chart-key]'))
        .toHaveAttribute('data-chart-key', 'parking-duration-distribution');
      const table = screen.getByRole('table', { hidden: true });
      const originalData = table.textContent;
      expect(table).toHaveTextContent('1–4 h');
      expect(table).toHaveTextContent('Observed dwell (h)');
      const stints = screen.getByRole('button', { name: 'Stints' });
      const dwell = screen.getByRole('button', { name: 'Observed dwell (h)' });
      expect(stints).toHaveAttribute('data-series-key', 'stints');
      expect(dwell).toHaveAttribute('data-series-key', 'dwell');
      fireEvent.click(stints);
      expect(stints).toHaveAttribute('aria-pressed', 'true');

      chartPreferences.palette = paletteId === 'cb_safe' ? 'neon' : 'cb_safe';
      rerender(chart());
      expect(screen.getByRole('button', { name: 'Stints' }))
        .toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Observed dwell (h)' }))
        .toHaveAttribute('data-series-key', 'dwell');
      expect(screen.getByRole('table', { hidden: true }).textContent).toBe(originalData);
      fireEvent.click(screen.getByRole('button', { name: 'Stints' }));
      await waitFor(assertPalette);
    },
  );
});

describe('ParkingTemporalProfile locale-aware hour labels', () => {
  const state = { isLoading: false, error: null, onRetry: vi.fn() };

  it.each([
    ['de-DE', 'America/Los_Angeles'],
    ['ar-EG', 'Asia/Kolkata'],
    ['en-US', 'Pacific/Auckland'],
  ])('formats all wall-hour buckets in saved locale %s without shifting them to %s', (locale, tz) => {
    Object.assign(datePreferences, { locale, tz });
    const value = summary();
    value.stints = [{
      sourceDriveId: 1, location: 'Home',
      startMs: Date.parse('2026-09-01T00:00:00Z'),
      endMs: Date.parse('2026-09-01T01:00:00Z'),
      durationMs: 3_600_000, ongoing: false, rightCensored: false,
    }];
    value.coverage.timeZone = tz;
    value.hourly[0].stints = 1;
    const originalHours = value.hourly.map(bucket => ({ ...bucket }));
    const { rerender } = render(<ParkingTemporalProfile summary={value} state={state} />);
    const formatter = new Intl.DateTimeFormat(locale, {
      timeZone: 'UTC', hour: '2-digit', minute: '2-digit',
    });
    const tables = screen.getAllByRole('table', { hidden: true });
    for (const bucket of value.hourly) {
      const label = formatter.format(new Date(Date.UTC(2026, 0, 4, bucket.hour)));
      expect(tables[0]).toHaveTextContent(label);
    }
    expect(value.hourly).toEqual(originalHours);
    // Wall-hour buckets stay unshifted AND the zone itself is never labelled
    // on the page (single user-selected zone; see timezone spec section 3).
    expect(screen.getByTestId('parking-temporal')).not.toHaveTextContent(tz);

    datePreferences.locale = 'fr-FR';
    rerender(<ParkingTemporalProfile summary={value} state={state} />);
    expect(screen.getAllByRole('table', { hidden: true })[0]).toHaveTextContent('23:00');
    expect(value.hourly).toEqual(originalHours);
  });

  it('keeps the empty section for invalid or missing range dates', () => {
    const value = summarizeParking([], {
      nowMs: Date.parse('2026-09-01T12:00:00Z'),
      rangeStart: '', rangeEnd: 'not-a-date', timeZone: 'Asia/Kolkata',
    });
    render(<ParkingTemporalProfile summary={value} state={state} />);
    expect(screen.getByTestId('parking-temporal')).toHaveTextContent(
      'No reconstructed parking starts are available for a time profile.',
    );
    expect(screen.queryByRole('table', { hidden: true })).toBeNull();
    expect(value.hourly.every(bucket => bucket.stints === 0)).toBe(true);
  });
});

describe('OvernightParkingContext numeric fidelity', () => {
  const state = { isLoading: false, error: null, onRetry: vi.fn() };

  function overnightSummary(nightMs = 500, daytimeMs = 1_000) {
    return {
      ...summary(),
      nightMs,
      daytimeMs,
      totalParkedMs: 1_500,
      nightShare: 1 / 3,
    };
  }

  it.each(['h', 'min', 's'] as const)(
    'formats only at the boundary and exports unrounded %s and SI numerics',
    duration => {
      durationPreferences.duration = duration;
      setGlobalLocale('de-DE');
      setGlobalPrecision(6);
      const value = overnightSummary();
      const { rerender } = render(<OvernightParkingContext summary={value} state={state} />);
      const divisor = duration === 'h' ? 3_600 : duration === 'min' ? 60 : 1;
      const converted = 0.5 / divisor;
      const formatted = converted.toLocaleString('de-DE', {
        minimumFractionDigits: 6, maximumFractionDigits: 6,
      });
      const table = screen.getByRole('table', { hidden: true });
      expect(table).toHaveTextContent(formatted);
      expect(table).toHaveTextContent('33,333333%');
      fireEvent.click(screen.getByRole('button', { name: 'Export chart' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Download data as CSV' }));
      const csv = vi.mocked(downloadCSV).mock.calls[0]?.[1];
      expect(csv).toContain('kind,label,duration_s,duration,duration_unit,share');
      expect(csv).toContain(`night,22:00–06:00,0.5,${converted},${duration},${(500 / 1_500) * 100}`);
      expect(value.nightMs).toBe(500);

      setGlobalPrecision(2);
      rerender(<OvernightParkingContext summary={value} state={state} />);
      expect(table).toHaveTextContent('33,33%');
      fireEvent.click(screen.getByRole('button', { name: 'Export chart' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Download data as CSV' }));
      expect(vi.mocked(downloadCSV).mock.calls[1]?.[1]).toBe(csv);
    },
  );

  it.each([null, undefined, Number.NaN, Infinity, -Infinity, -500])(
    'does not convert a missing or invalid duration (%s) to measured zero',
    nightMs => {
      const value = overnightSummary();
      Reflect.set(value, 'nightMs', nightMs);
      Reflect.set(value, 'nightShare', nightMs);
      render(<OvernightParkingContext summary={value} state={state} />);
      const table = screen.getByRole('table', { hidden: true });
      const row = within(table).getByText('22:00–06:00').closest('tr')!;
      expect(within(row).getAllByText('—')).toHaveLength(2);
      expect(screen.getByTestId('parking-overnight')).not.toHaveTextContent('NaN');
      fireEvent.click(screen.getByRole('button', { name: 'Export chart' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Download data as CSV' }));
      expect(vi.mocked(downloadCSV).mock.calls[0]?.[1]).toContain('night,22:00–06:00,,,h,');
    },
  );

  it('retains measured zero next to nonzero dwell', () => {
    setGlobalPrecision(2);
    render(<OvernightParkingContext summary={overnightSummary(0, 1_500)} state={state} />);
    const row = within(screen.getByRole('table', { hidden: true }))
      .getByText('22:00–06:00').closest('tr')!;
    expect(row).toHaveTextContent('0.00');
    expect(row).toHaveTextContent('0.00%');
    expect(row).not.toHaveTextContent('—');
  });

  it.each([null, undefined, Number.NaN, Infinity, -Infinity, -1, 0])(
    'keeps the empty shell without invented shares for unavailable total (%s)',
    total => {
      const value = overnightSummary();
      Reflect.set(value, 'totalParkedMs', total);
      render(<OvernightParkingContext summary={value} state={state} />);
      expect(screen.getByTestId('parking-overnight')).toHaveTextContent(
        'No reconstructed dwell is available for an overnight split.',
      );
      expect(screen.queryByRole('table', { hidden: true })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Export chart' })).toBeNull();
    },
  );
});

describe('TopParkingLocations value filters', () => {
  it('filters all loaded location groups before client pagination', () => {
    render(<TopParkingLocations summary={summary()} state={{ isLoading: false, error: null, onRetry: vi.fn() }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stints filter' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '1' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.getByText('Location 30')).toBeInTheDocument();
    expect(screen.queryByText('Location 1')).toBeNull();
  });

  describe('LongestParkingStints responsive field preservation', () => {
    const address = '123 Long Destination Avenue, Building Seven, Springfield, California 90210';
    const state = { isLoading: false, error: null, onRetry: vi.fn() };

    function rankedSummary() {
      const value = summary();
      value.rankedStints = Array.from({ length: 12 }, (_, index) => ({
        sourceDriveId: 9000 + index,
        location: index === 0 ? address : `Destination ${index + 1}`,
        startMs: Date.parse('2026-09-01T10:00:00Z'),
        endMs: Date.parse('2026-09-01T12:00:00Z'),
        durationMs: 7_200_000,
        ongoing: index === 0,
        rightCensored: index === 0,
      }));
      value.stints = value.rankedStints;
      return value;
    }

    it('keeps the full address and top-ten sample searchable on desktop', async () => {
      render(<LongestParkingStints summary={rankedSummary()} state={state} />);
      expect(screen.getByText(address)).not.toHaveClass('truncate');
      expect(screen.getByText('Destination 10')).toBeInTheDocument();
      expect(screen.queryByText('Destination 11')).toBeNull();
      fireEvent.change(screen.getByRole('searchbox', { name: 'Search loaded rows' }),
        { target: { value: '90210' } });
      expect(screen.getByText(address)).toBeInTheDocument();
      // Table search is deferred; wait for the filtered render.
      await waitFor(() => expect(screen.queryByText('Destination 2')).toBeNull());
    });

    it('opens all fields, full address and IDs from the existing mobile quick view', () => {
      const observers: { element: Element; callback: ResizeObserverCallback }[] = [];
      vi.stubGlobal('ResizeObserver', class {
        constructor(private callback: ResizeObserverCallback) {}
        observe(element: Element) { observers.push({ element, callback: this.callback }); }
        unobserve() {}
        disconnect() {}
      });
      try {
        render(<LongestParkingStints summary={rankedSummary()} state={state} />);
        act(() => observers.forEach(({ element, callback }) => callback(
          [{ target: element, contentRect: { width: 375 } } as ResizeObserverEntry],
          {} as ResizeObserver,
        )));
        const mobile = document.querySelector('[data-mobile-table]') as HTMLElement;
        expect(mobile).not.toBeNull();
        const quickView = within(mobile).getAllByRole('button', { name: 'Quick view' })[0];
        expect(quickView).toHaveClass('min-h-11', 'min-w-11');
        quickView.focus();
        expect(quickView).toHaveFocus();
        fireEvent.click(quickView);
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText(address)).not.toHaveClass('truncate');
        expect(dialog).toHaveTextContent('Rank');
        expect(dialog).toHaveTextContent('Parked at');
        expect(dialog).toHaveTextContent('7200 s');
        expect(dialog).toHaveTextContent('Ongoing');
        expect(dialog).toHaveTextContent('Drive ID');
        expect(dialog).toHaveTextContent('9000');
        expect(dialog).toHaveTextContent('Ended at');
        expect(dialog).toHaveTextContent('2026-09-01T12:00:00.000Z');
        fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' })[0]);
        expect(screen.queryByRole('dialog')).toBeNull();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('ParkingCoverageMethodology source evidence', () => {
    const state = { isLoading: false, error: null, onRetry: vi.fn() };
    const range = { rangeStart: '2026-09-01T00:00:00Z', rangeEnd: '2026-09-02T00:00:00Z' };

    it.each<DataStatus>(['initial', 'initialFailure', 'unavailable'])(
      'does not infer cap or sample context without a source (%s)',
      sourceStatus => {
        render(<ParkingCoverageMethodology summary={summary(true)} state={state}
          sourceStatus={sourceStatus} hasSource={false} {...range} />, { wrapper: MemoryRouter });
        const section = screen.getByTestId('parking-coverage');
        expect(within(section).getAllByText('Pending').length).toBeGreaterThan(0);
        expect(section).not.toHaveTextContent('Within request cap');
        expect(section).not.toHaveTextContent('Potentially capped');
        expect(section).not.toHaveTextContent('No drive records were returned');
        expect(section).not.toHaveTextContent('0 located');
        expect(section).not.toHaveTextContent('This workspace uses');
        expect(section.querySelector('[data-operational-metric="returned"]')).toBeNull();
        assertOperationalMetricUnavailable(screen.getByTestId('parking-coverage-summary'), 'Records returned');
        expect(mappedValueState('returned')).toBe('missing');
        fireEvent.click(within(section).getByRole('button', { name: 'Review details' }));
        expect(screen.getByRole('dialog')).not.toHaveTextContent('0 located');
      },
    );

    it('requires explicit source evidence even when the section is idle', () => {
      render(<ParkingCoverageMethodology summary={summary()} state={state} {...range} />,
        { wrapper: MemoryRouter });
      expect(screen.getByTestId('parking-coverage')).not.toHaveTextContent('Within request cap');
      assertOperationalBriefDisclosure(screen.getByTestId('parking-coverage-summary'), 'Pending');
    });

    it.each<DataStatus>(['initial', 'initialFailure'])(
      'does not treat an unresolved status as evidence even with a source flag (%s)', sourceStatus => {
        render(<ParkingCoverageMethodology summary={summary(true)} state={state}
          hasSource sourceStatus={sourceStatus} {...range} />, { wrapper: MemoryRouter });
        const section = screen.getByTestId('parking-coverage');
        expect(section).not.toHaveTextContent('Potentially capped');
        expect(section).not.toHaveTextContent('No drive records were returned');
        expect(section.querySelector('[data-operational-metric="returned"]')).toBeNull();
        assertOperationalMetricUnavailable(screen.getByTestId('parking-coverage-summary'), 'Records returned');
        expect(mappedValueState('returned')).toBe('missing');
      },
    );

    it.each([null, undefined])('keeps a missing returned count distinct from zero (%s)', recordsReturned => {
      const value = summary();
      Reflect.set(value.coverage, 'recordsReturned', recordsReturned);
      render(<ParkingCoverageMethodology summary={value} state={state}
        hasSource sourceStatus="ok" {...range} />, { wrapper: MemoryRouter });
      const section = screen.getByTestId('parking-coverage');
      expect(section.querySelector('[data-operational-metric="returned"]')).toBeNull();
      assertOperationalMetricUnavailable(screen.getByTestId('parking-coverage-summary'), 'Records returned');
      expect(mappedValueState('returned')).toBe('missing');
      expect(section).not.toHaveTextContent('Within request cap');
      expect(section).not.toHaveTextContent('No drive records were returned');
      expect(section).not.toHaveTextContent('This workspace uses');
    });

    it.each([null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5])(
      'does not invent location sample context from invalid or missing counts (%s)', known => {
        const value = summary();
        Reflect.set(value.coverage, 'knownLocationStints', known);
        render(<ParkingCoverageMethodology summary={value} state={state}
          hasSource sourceStatus="ok" {...range} />, { wrapper: MemoryRouter });
        const section = screen.getByTestId('parking-coverage');
        expect(section.querySelector('[data-operational-metric="located"]')).toBeNull();
        assertOperationalMetricUnavailable(screen.getByTestId('parking-coverage-summary'), 'Location coverage');
        expect(mappedValueState('located')).toBe('missing');
        expect(section).not.toHaveTextContent(/located ·/);
        expect(section).not.toHaveTextContent('stints lack a destination address');
        fireEvent.click(within(section).getByRole('button', { name: 'Review details' }));
        expect(screen.getByRole('dialog')).not.toHaveTextContent(/located ·/);
      },
    );

    it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 1.5])(
      'defers cap context when the request limit is invalid (%s)', rowLimit => {
        const value = summary(true);
        value.coverage.rowLimit = rowLimit;
        render(<ParkingCoverageMethodology summary={value} state={state}
          hasSource sourceStatus="ok" {...range} />, { wrapper: MemoryRouter });
        const section = screen.getByTestId('parking-coverage');
        expect(section).not.toHaveTextContent('Within request cap');
        expect(section).not.toHaveTextContent('Potentially capped');
        expect(section).not.toHaveTextContent('The API returned');
      },
    );

    it.each<DataStatus>(['ok', 'stale'])('preserves measured zeros from a returned empty source (%s)', sourceStatus => {
      const value = summary();
      value.locations = [];
      render(<ParkingCoverageMethodology summary={value} state={state}
        hasSource sourceStatus={sourceStatus} {...range} />, { wrapper: MemoryRouter });
      const section = screen.getByTestId('parking-coverage');
      expect(section).toHaveTextContent('Within request cap');
      expect(section).toHaveTextContent('No drive records were returned for this selected window.');
      const returned = section.querySelector('[data-operational-metric="returned"]');
      expect(returned).not.toHaveAttribute('data-value-state', 'missing');
      expect(returned).toHaveTextContent('0');
      expect(section.querySelector('[data-operational-metric="located"]')).toBeNull();
      assertOperationalMetricUnavailable(screen.getByTestId('parking-coverage-summary'), 'Location coverage');
      expect(mappedValueState('located')).toBe('missing');
    });

    it('retains cap evidence and fractional location coverage from a returned sample', () => {
      const value = summary(true);
      value.coverage.recordsReturned = 1_000;
      value.coverage.knownLocationStints = 1;
      value.coverage.missingLocationStints = 2;
      value.stints = Array.from({ length: 3 }, (_, index) => ({
        sourceDriveId: index, location: index === 0 ? 'Home' : null,
        startMs: 0, endMs: 500, durationMs: 500, ongoing: false, rightCensored: false,
      }));
      render(<ParkingCoverageMethodology summary={value} state={state}
        hasSource sourceStatus="ok" {...range} />, { wrapper: MemoryRouter });
      const section = screen.getByTestId('parking-coverage');
      expect(section).toHaveTextContent('Potentially capped');
      assertOperationalBriefDisclosure(screen.getByTestId('parking-coverage-summary'), 'Partial source coverage');
      expect(section.querySelector('[data-operational-metric="located"]')).toHaveTextContent(/33/);
      fireEvent.click(within(section).getByRole('button', { name: 'Review details' }));
      expect(screen.getByRole('dialog')).toHaveTextContent('1 located · 2 missing');
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 1.5])(
      'keeps an invalid numeric measurement unknown (%s)', recordsReturned => {
        const value = summary();
        value.coverage.recordsReturned = recordsReturned;
        render(<ParkingCoverageMethodology summary={value} state={state}
          hasSource sourceStatus="ok" {...range} />, { wrapper: MemoryRouter });
        const returned = screen.getByTestId('parking-coverage')
          .querySelector('[data-operational-metric="returned"]');
        expect(returned).toBeNull();
        assertOperationalMetricUnavailable(screen.getByTestId('parking-coverage-summary'), 'Records returned');
        expect(mappedValueState('returned')).toBe('invalid');
        expect(screen.getByTestId('parking-coverage')).not.toHaveTextContent('Within request cap');
      },
    );
  });

  it('does not offer whole-window choices when the source drive list may be capped', () => {
    render(<TopParkingLocations summary={summary(true)} state={{ isLoading: false, error: null, onRetry: vi.fn() }} />);
    expect(screen.queryByRole('button', { name: 'Stints filter' })).toBeNull();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it.each([
    { location: 'Location 1', ongoing: true },
    { location: null, ongoing: true },
    { location: 'Location 1', ongoing: false },
  ])('labels a reconstructed censored location as of its snapshot ($location, ongoing=$ongoing)', ({ location, ongoing }) => {
    const value = summary();
    value.locations = [
      { location, stints: 2, totalMs: 7_200_000, share: 0.75 },
      { location: 'Completed destination', stints: 1, totalMs: 2_400_000, share: 0.25 },
    ];
    value.stints = [{
      sourceDriveId: 1,
      location,
      startMs: Date.parse('2026-09-01T10:00:00Z'),
      endMs: Date.parse('2026-09-01T12:00:00Z'),
      durationMs: 7_200_000,
      ongoing,
      rightCensored: true,
    }];

    render(<TopParkingLocations summary={value} state={{ isLoading: false, error: null, onRetry: vi.fn() }} />);

    expect(screen.getByText('Source snapshot: 2026-09-01T12:00:00.000Z')).toBeInTheDocument();
    expect(screen.getByText(/Parking is reconstructed between usable drives, not observed continuously/)).toBeInTheDocument();
    const censoredRow = screen.getByText(location ?? 'Unknown location').closest('tr');
    expect(censoredRow).not.toBeNull();
    expect(within(censoredRow!).getByText('Right-censored')).toBeInTheDocument();
    expect(within(censoredRow!).getByText('Observed minimum')).toBeInTheDocument();
    expect(within(censoredRow!).getByText('7200 s')).toBeInTheDocument();
    expect(within(censoredRow!).getByText('75.00%')).toBeInTheDocument();
    const completedRow = screen.getByText('Completed destination').closest('tr');
    expect(completedRow).not.toBeNull();
    expect(within(completedRow!).queryByText('Right-censored')).toBeNull();
    expect(within(completedRow!).queryByText('Observed minimum')).toBeNull();
    expect(within(completedRow!).getByText('2400 s')).toBeInTheDocument();
    expect(screen.queryByText('now')).toBeNull();
    expect(screen.queryByText('Ongoing')).toBeNull();
  });

  it('keeps an unavailable snapshot unknown instead of substituting the current clock', () => {
    const value = summary();
    value.coverage.observationEndMs = null;
    render(<TopParkingLocations summary={value} state={{ isLoading: false, error: null, onRetry: vi.fn() }} />);
    expect(screen.getByText('Source snapshot: —')).toBeInTheDocument();
  });
});
