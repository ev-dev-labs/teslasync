import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Drive } from '@/types/driving';
import type { ComponentProps } from 'react';
import type { ColdStartBrief } from '../components/operationalbrief-a-m/ColdStartBrief';
import type { NestedDrivingBrief } from '../components/operationalbrief-a-m/NestedDrivingBrief';

const { useDrivesMock,
sharedRange, selectedVehicleMock, pageTitleMock, rangeOptionsMock,
timezoneMock, briefPropsMock, nestedBriefPropsMock, comparisonPropsMock, chartPropsMock, formatCurrencyMock, numberFormatMock, displayPrefs, formatting } = vi.hoisted(() => ({
  useDrivesMock: vi.fn(),
  sharedRange: {
    set: (_range: {
      start: string;
      end: string;
      startInstant?: string;
      endInstantExclusive?: string;
    }) => {},
  },
  selectedVehicleMock: vi.fn(),
  pageTitleMock: vi.fn(),
  rangeOptionsMock: vi.fn(),
  timezoneMock: vi.fn(),
  briefPropsMock: vi.fn(),
  nestedBriefPropsMock: vi.fn(),
  comparisonPropsMock: vi.fn(),
  chartPropsMock: vi.fn(),
  formatCurrencyMock: vi.fn(),
  numberFormatMock: vi.fn(),
  displayPrefs: {
    distance: 'km' as 'km' | 'mi',
    temperature: 'C' as 'C' | 'F',
  },
  formatting: {
    costPerKwh: 0.2 as number | null | undefined,
    locale: 'en-US',
    timezoneMode: 'vehicle' as 'vehicle' | 'user' | 'utc',
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) =>
          text.replace(new RegExp(`{{${name}}}`, 'g'), String(value)),
        fallback,
      ),
  }),
}));

vi.mock('@/api/hooks/useDriving', () => ({
  useDrives: (...args: unknown[]) => useDrivesMock(...args),
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => selectedVehicleMock(),
}));

vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: (title: string) => pageTitleMock(title),
}));

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    costPerKwh: formatting.costPerKwh,
    formatCurrency: formatCurrencyMock,
  }),
}));

vi.mock('@/lib/timezone', () => ({
  useTimezone: (mode: string) => timezoneMock(mode),
}));

vi.mock('@/hooks/useSettings', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSettings')>('@/hooks/useSettings');
  return {
    ...actual,
    useSettings: () => {
      const result = actual.useSettings();
      return {
        ...result,
        locale: formatting.locale,
        settings: { ...result.settings, tz_display_default: formatting.timezoneMode },
      };
    },
  };
});

vi.mock('@/hooks/useDateFormat', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useDateFormat')>('@/hooks/useDateFormat');
  return {
    useDateFormat: (...args: Parameters<typeof actual.useDateFormat>) => ({
      ...actual.useDateFormat(...args),
      formatDateTime: (value: string) => `${value} (vehicle time)`,
    }),
  };
});

vi.mock('@/components/charts', async () => {
  const actual = await vi.importActual<typeof import('@/components/charts')>('@/components/charts');
  return {
    ...actual,
    ChartContainer: (props: ComponentProps<typeof actual.ChartContainer>) => {
      chartPropsMock(props);
      return <div>{props.title}</div>;
    },
  };
});

vi.mock('@/hooks/useRangeState', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    useRangeState: (options: unknown) => {
      rangeOptionsMock(options);
      const [range, setRange] = React.useState<{
        start: string;
        end: string;
        startInstant?: string;
        endInstantExclusive?: string;
      }>({
        start: '2026-01-01',
        end: '2026-08-07',
      });
      sharedRange.set = setRange;
      return {
        ...range,
        startInstant: range.startInstant ?? `${range.start}T08:00:00.000Z`,
        endInstantExclusive: range.endInstantExclusive ??
          new Date(Date.parse(`${range.end}T07:00:00.000Z`) + 86_400_000).toISOString(),
        setRange,
      };
    },
  };
});

vi.mock('@/components/forms', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    VehicleSelect: () => React.createElement('div', { 'data-testid': 'vehicle-select' }),
    RangePicker: (props: {
      value: { start: string; end: string };
      onChange: (range: { start: string; end: string }) => void;
      triggerTestId?: string;
    }) =>
      React.createElement(
        'button',
        {
          type: 'button',
          'data-testid': props.triggerTestId,
          'data-range': `${props.value.start}:${props.value.end}`,
          onClick: () =>
            props.onChange({ start: '2026-07-01', end: '2026-07-31' }),
        },
        'range',
      ),
  };
});

vi.mock('@/components/layout', () => ({
  PageLayout: ({
    title,
    subtitle,
    actions,
    children,
  }: {
    title: string;
    subtitle: string;
    actions: ReactNode;
    children: ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {actions}
      {children}
    </main>
  ),
  Grid: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/motion', async () => ({
  motion: (await vi.importActual<typeof import('framer-motion')>('framer-motion')).motion,
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));

vi.mock('@/hooks/useNumberFormatting', async () => ({
  useNumberFormatting: () => ({
    fmtNumber: numberFormatMock,
    fmtInt: (value: unknown) => fmtInt(value, formatting.locale),
  }),
}));

vi.mock('@/components/data-display', async () => ({
  MetricBar: (await import('@/components/data-display/MetricBar')).MetricBar,
}));

vi.mock('../components/operationalbrief-a-m/NestedDrivingBrief', () => ({
  NestedDrivingBrief: (props: ComponentProps<typeof NestedDrivingBrief>) => {
    nestedBriefPropsMock(props);
    return null;
  },
}));

vi.mock('../components/cold-start/useColdStartDisplay', () => ({
  useColdStartDisplay: () => ({
    formatEfficiency: (value: number | null | undefined) =>
      value != null && Number.isFinite(value) ? `${value} Wh/km` : '—',
    formatEnergy: (value: number | null) => value == null ? '—' : `${value} Wh`,
    formatDistance: (value: number) => `${value} m`,
    formatDuration: (value: number) => `${value} s`,
    formatTemperature: (value: number | null) => value == null ? '—' : `${value} °C`,
    convertEfficiency: (value: number) => value * (displayPrefs.distance === 'mi' ? 1.609344 : 1),
    efficiencyUnit: displayPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km',
    formatMonth: (value: string) => value,
    unitPrefs: { ...displayPrefs, locale: 'en-US' },
  }),
}));

vi.mock('@/features/onboarding/components/NoVehicleSelected', () => ({
  NoVehicleSelected: ({ pageTitle }: { pageTitle: string }) => (
    <div data-testid="no-vehicle">{pageTitle}</div>
  ),
}));

vi.mock('../components/cold-start', () => {
  const status = (state: { isLoading: boolean; error: unknown }) =>
    state.isLoading ? 'loading' : state.error ? 'error' : 'ready';
  const section = (testId: string, state: { isLoading: boolean; error: unknown }) => (
    <section data-testid={testId}>{status(state)}</section>
  );
  return {
    ColdStartKpis: (props: { isLoading: boolean; error: unknown }) =>
      section('cold-start-kpis', props),
    ColdWarmComparison: (props: ComponentProps<typeof ColdWarmComparison>) => {
      comparisonPropsMock(props);
      return section('cold-start-comparison', props.state);
    },
    ColdStartMethodology: (props: { state: { isLoading: boolean; error: unknown } }) =>
      section('cold-start-method', props.state),
    MonthlyColdStartChart: (props: { state: { isLoading: boolean; error: unknown } }) =>
      section('cold-start-monthly', props.state),
    ParkingGapDistribution: (props: { state: { isLoading: boolean; error: unknown } }) =>
      section('cold-start-gaps', props.state),
    TemperatureEfficiencyChart: (props: { state: { isLoading: boolean; error: unknown } }) =>
      section('cold-start-temperature', props.state),
    ColdStartOpportunities: (props: { state: { isLoading: boolean; error: unknown } }) =>
      section('cold-start-opportunities', props.state),
  };
});

vi.mock('../components/operationalbrief-a-m/ColdStartBrief', async () => {
  const { ColdStartKpis } = await import('../components/cold-start');
  return {
    ColdStartBrief: (props: ComponentProps<typeof ColdStartBrief>) => {
      briefPropsMock(props);
      return <ColdStartKpis {...props} />;
    },
  };
});

import ColdStartPage from './ColdStartPage';
import { ColdWarmComparison } from '../components/cold-start/ColdWarmComparison';
import { ColdStartMethodology } from '../components/cold-start/ColdStartMethodology';
import { ColdStartOpportunities } from '../components/cold-start/ColdStartOpportunities';
import { TemperatureEfficiencyChart } from '../components/cold-start/TemperatureEfficiencyChart';
import { MonthlyColdStartChart } from '../components/cold-start/MonthlyColdStartChart';
import { convertDistanceFromSI, convertTempFromSI } from '@/lib/unitConversion';
import { summarizeColdStarts } from '../lib/coldStart';
import { fmtInt } from '@/lib/numberFormat';
import { CHART_COLORS } from '@/components/charts';

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: 1,
    refetch: vi.fn(),
    ...overrides,
  };
}

const SECTION_IDS = [
  'cold-start-kpis',
  'cold-start-comparison',
  'cold-start-method',
  'cold-start-monthly',
  'cold-start-gaps',
  'cold-start-temperature',
  'cold-start-opportunities',
];

function supportedDrives(): Drive[] {
  const start = Date.parse('2026-01-01T00:00:00Z');
  return Array.from({ length: 11 }, (_, index) => {
    const startTs = new Date(start + index * 7 * 3_600_000).toISOString();
    const nextStart = start + (index + 1) * 7 * 3_600_000;
    return {
      id: index + 1,
      vehicleId: 42,
      startTs,
      endTs: new Date(nextStart - (index < 5 ? 3_600_000 : 21_600_000)).toISOString(),
      durationS: index < 5 ? 21_600 : 3_600,
      distanceM: 1_000,
      energyUsedWh: index > 5 ? 300 : 200,
      outsideTempAvgC: index > 5 ? -5 : 0,
      startAddress: null,
      endAddress: null,
      startLat: null,
      startLon: null,
      endLat: null,
      endLon: null,
      startBatteryPct: null,
      endBatteryPct: null,
      regenEnergyWh: null,
      avgSpeedMps: null,
      maxSpeedMps: null,
      avgPowerW: null,
      insideTempAvgC: null,
      score: null,
      endedStatus: null,
      createdAt: startTs,
      updatedAt: startTs,
    };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  formatting.costPerKwh = 0.2;
  formatting.locale = 'en-US';
  formatting.timezoneMode = 'vehicle';
  displayPrefs.distance = 'km';
  displayPrefs.temperature = 'C';
  numberFormatMock.mockImplementation((value: number) => String(value));
  formatCurrencyMock.mockImplementation((value: number) => `$${value.toFixed(2)}`);
  timezoneMock.mockReturnValue('America/Los_Angeles');
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  useDrivesMock.mockReturnValue(query());
});

describe('Cold-start methodology count formatting', () => {
  const state = { isLoading: false, error: null, onRetry: vi.fn() };

  it.each([
    { name: 'grouped integers', value: 1234, expected: '1,234', classified: '2,468' },
    { name: 'measured zero', value: 0, expected: '0', classified: '0' },
    { name: 'signed values', value: -1234, expected: '-1,234', classified: '-2,468' },
    { name: 'fractional values', value: 1234.6, expected: '1,235', classified: '2,469' },
    { name: 'signed fractional values', value: -1234.6, expected: '-1,235', classified: '-2,469' },
    { name: 'missing values', value: null, expected: '—', classified: '—' },
    { name: 'absent values', value: undefined, expected: '—', classified: '—' },
    { name: 'NaN values', value: Number.NaN, expected: '—', classified: '—' },
    { name: 'positive infinity', value: Number.POSITIVE_INFINITY, expected: '—', classified: '—' },
    { name: 'negative infinity', value: Number.NEGATIVE_INFINITY, expected: '—', classified: '—' },
  ])('formats $name without changing evidence', ({ value, expected, classified }) => {
    const summary = summarizeColdStarts(supportedDrives());
    for (const target of [summary.cold, summary.warm]) Reflect.set(target, 'drives', value);
    Reflect.set(summary, 'ambiguous', value);
    Reflect.set(summary, 'unclassified', value);
    const original = structuredClone(summary);
    const { rerender } = render(
      <ColdStartMethodology summary={summary} observedDrives={2000} windowLimit={3000} state={state} />,
    );
    const panel = screen.getByTestId('cold-start-method');
    expect(panel.textContent?.match(new RegExp(`${expected}/5`, 'g'))).toHaveLength(2);
    expect(screen.getByText(classified, { exact: true })).toBeInTheDocument();
    expect(panel).toHaveTextContent(`${expected} observations between them remain ambiguous`);
    expect(panel).toHaveTextContent(`${expected} usable drives could not be classified`);
    expect(panel).toHaveTextContent('uses 2,000 drives');
    expect(panel).toHaveTextContent('up to 3,000');
    expect(summary).toEqual(original);

    const props: ComponentProps<typeof ColdStartMethodology> = {
      summary, observedDrives: 2000, windowLimit: 3000, state,
    };
    Reflect.set(props, 'observedDrives', value);
    Reflect.set(props, 'windowLimit', value);
    rerender(<ColdStartMethodology {...props} />);
    if (value === 0) {
      expect(panel).toHaveTextContent('Method confidence will appear when drives are returned');
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      expect(panel).toHaveTextContent(`reached the ${expected}-drive API cap`);
    } else {
      expect(panel).toHaveTextContent(`uses ${expected} drives`);
      expect(panel).toHaveTextContent(`up to ${expected}`);
    }
  });

  it('follows the selected locale for counts and denominators', () => {
    formatting.locale = 'ar-EG';
    const summary = summarizeColdStarts(supportedDrives());
    render(<ColdStartMethodology summary={summary} observedDrives={1234} windowLimit={2000} state={state} />);
    const panel = screen.getByTestId('cold-start-method');
    expect(panel).toHaveTextContent(`${fmtInt(5, 'ar-EG')}/${fmtInt(5, 'ar-EG')}`);
    expect(panel).toHaveTextContent(`uses ${fmtInt(1234, 'ar-EG')} drives`);
    expect(panel).toHaveTextContent(`up to ${fmtInt(2000, 'ar-EG')}`);
  });

  it('does not turn a missing cohort into zero when the other cohort is measured', () => {
    const summary = summarizeColdStarts(supportedDrives());
    Reflect.set(summary.cold, 'drives', null);
    render(<ColdStartMethodology summary={summary} observedDrives={11} windowLimit={1000} state={state} />);
    const panel = screen.getByTestId('cold-start-method');
    expect(panel).toHaveTextContent('—/5');
    expect(panel).toHaveTextContent('5/5');
    expect(screen.getByText('—', { exact: true })).toBeInTheDocument();
    expect(panel).toHaveTextContent('uses 11 drives');
    expect(panel).toHaveTextContent('up to 1,000');
  });
});

describe('Cold-start chart precision', () => {
  const state = { isLoading: false, error: null, onRetry: vi.fn() };

  it.each([
    { distance: 'km' as const, temperature: 'C' as const },
    { distance: 'mi' as const, temperature: 'F' as const },
  ])('retains converted rows and formats only display values in $distance/$temperature', (prefs) => {
    Object.assign(displayPrefs, prefs);
    numberFormatMock.mockImplementation((value: number) => value.toFixed(3));
    const drives = supportedDrives().map(drive => ({
      ...drive,
      distanceM: 1_234.56,
      energyUsedWh: drive.energyUsedWh! + 0.789,
      outsideTempAvgC: -5.1234,
    }));
    const summary = summarizeColdStarts(drives);
    const original = structuredClone(summary);
    const factor = prefs.distance === 'mi' ? 1.609344 : 1;
    // Model consumption remains rounded to tenths; display conversion must not round again.
    expect(summary.temperature[0]!.whPerKm).toBe(
      Math.round(drives[1]!.energyUsedWh! / (drives[1]!.distanceM / 1_000) * 10) / 10,
    );

    const monthly = render(<MonthlyColdStartChart months={summary.monthly} state={state} />);
    const monthlyProps = chartPropsMock.mock.lastCall![0];
    expect(monthlyProps.data[0]).toMatchObject({
      cold: summary.monthly[0]!.cold.whPerKm! * factor,
      warm: summary.monthly[0]!.warm.whPerKm! * factor,
      coldSamples: 5,
      warmSamples: 5,
    });
    for (const key of ['cold', 'warm']) {
      const column = monthlyProps.dataColumns.find((item: { key: string }) => item.key === key);
      expect(column.format(monthlyProps.data[0][key])).toBe(monthlyProps.data[0][key].toFixed(3));
      expect(column.format(null)).toBe('—');
    }
    numberFormatMock.mockImplementation((value: number) => value.toFixed(1));
    monthly.rerender(<MonthlyColdStartChart months={summary.monthly} state={state} />);
    expect(chartPropsMock.mock.lastCall![0].data).toEqual(monthlyProps.data);
    expect(chartPropsMock.mock.lastCall![0].dataColumns[1].format(monthlyProps.data[0].cold))
      .toBe(monthlyProps.data[0].cold.toFixed(1));

    render(<TemperatureEfficiencyChart points={summary.temperature} state={state} />);
    const temperatureProps = chartPropsMock.mock.lastCall![0];
    expect(temperatureProps.data).toHaveLength(10);
    expect(temperatureProps.data[0]).toMatchObject({
      temperature: convertTempFromSI(-5.1234, prefs.temperature),
      consumption: summary.temperature[0]!.whPerKm * factor,
      distance: convertDistanceFromSI(1_234.56, prefs.distance),
    });
    for (const key of ['temperature', 'consumption', 'distance']) {
      const column = temperatureProps.dataColumns.find((item: { key: string }) => item.key === key);
      expect(column.format(temperatureProps.data[0][key])).toBe(temperatureProps.data[0][key].toFixed(1));
    }
    expect(summary).toEqual(original);
  });
});

describe('Cold-start date display', () => {
  const state = { isLoading: false, error: null, onRetry: vi.fn() };

  it.each([
    { locale: 'de-DE', mode: 'user' as const, zone: 'America/Los_Angeles', date: '2026-02-01T00:30:00Z', label: '31. Jan. 2026' },
    { locale: 'fr-FR', mode: 'vehicle' as const, zone: 'Asia/Tokyo', date: '2026-01-31T23:30:00Z', label: '1 févr. 2026' },
    { locale: 'de-DE', mode: 'utc' as const, zone: 'UTC', date: '2026-02-01T00:30:00Z', label: '1. Feb. 2026' },
    { locale: 'de-DE', mode: 'user' as const, zone: 'America/Los_Angeles', date: 'invalid', label: '—' },
    { locale: 'de-DE', mode: 'user' as const, zone: 'America/Los_Angeles', date: '', label: '—' },
    { locale: 'de-DE', mode: 'user' as const, zone: 'America/Los_Angeles', date: null, label: '—' },
    { locale: 'de-DE', mode: 'user' as const, zone: 'America/Los_Angeles', date: undefined, label: '—' },
  ])('uses saved $locale/$mode dates for $date in $zone', ({ locale, mode, zone, date, label }) => {
    formatting.locale = locale;
    formatting.timezoneMode = mode;
    timezoneMock.mockReturnValue(zone);
    const summary = summarizeColdStarts(supportedDrives());
    // @ts-expect-error Exercise missing dates from malformed runtime payloads.
    summary.opportunities = [{ ...summary.opportunities[0]!, startTs: date }];
    const points = [{ ...summary.temperature[0]!, startTs: date }];
    const original = structuredClone({ summary, points });

    render(<ColdStartOpportunities summary={summary} state={state} />);
    // @ts-expect-error Exercise missing dates from malformed runtime payloads.
    render(<TemperatureEfficiencyChart points={points} state={state} />);

    expect(screen.getByTestId('cold-start-opportunities')).toHaveTextContent(label);
    expect(chartPropsMock.mock.lastCall?.[0]).toMatchObject({
      exportable: true,
      data: [expect.objectContaining({ date: label })],
    });
    expect(timezoneMock).toHaveBeenCalledWith(mode);
    expect({ summary, points }).toEqual(original);
  });

  it('reformats memoized chart rows when the saved locale and timezone change', () => {
    const summary = summarizeColdStarts(supportedDrives());
    const points = [{ ...summary.temperature[0]!, startTs: '2026-02-01T00:30:00Z' }];
    const view = render(<TemperatureEfficiencyChart points={points} state={state} />);
    expect(chartPropsMock.mock.lastCall?.[0].data[0].date).toBe('Jan 31, 2026');

    formatting.locale = 'fr-FR';
    formatting.timezoneMode = 'user';
    timezoneMock.mockReturnValue('Asia/Tokyo');
    view.rerender(<TemperatureEfficiencyChart points={points} state={state} />);
    expect(chartPropsMock.mock.lastCall?.[0].data[0].date).toBe('1 févr. 2026');
  });

  it('preserves UTC monthly grouping even when displayed dates fall in the previous month', () => {
    formatting.locale = 'de-DE';
    formatting.timezoneMode = 'user';
    timezoneMock.mockReturnValue('America/Los_Angeles');
    const drives = supportedDrives().slice(0, 2).map((drive, index) => ({
      ...drive,
      startTs: index === 0 ? '2026-01-31T22:30:00Z' : '2026-02-01T00:30:00Z',
      endTs: index === 0 ? '2026-01-31T23:30:00Z' : '2026-02-01T01:30:00Z',
    }));
    const summary = summarizeColdStarts(drives);
    render(<TemperatureEfficiencyChart points={summary.temperature} state={state} />);

    expect(summary.monthly.map(row => row.month)).toEqual(['2026-02']);
    expect(chartPropsMock.mock.lastCall?.[0].data[0].date).toBe('31. Jan. 2026');
  });
});

describe('ColdStartPage', () => {
  it('mounts every analysis section and requests the selected server window', () => {
    render(<ColdStartPage />);

    expect(screen.getByRole('heading', { name: 'Cold Start Cost' })).toBeInTheDocument();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    expect(useDrivesMock).toHaveBeenCalledWith('42', {
      start: '2026-01-01T08:00:00.000Z',
      end: '2026-08-08T07:00:00.000Z',
      limit: 1000,
    });
  });

    describe('ColdStartMethodology confidence', () => {
      it.each([
        { name: 'initial loading', isLoading: true, error: null, label: 'Loading cold-start analysis' },
        { name: 'fatal failure', isLoading: false, error: new Error('unavailable'), label: 'Unavailable' },
        { name: 'fatal failure during loading', isLoading: true, error: new Error('unavailable'), label: 'Unavailable' },
      ])('prioritizes $name over sample confidence and retains the shell', ({ isLoading, error, label }) => {
        const summary = summarizeColdStarts(supportedDrives());
        const onRetry = vi.fn();
        render(
          <ColdStartMethodology
            summary={summary}
            observedDrives={11}
            windowLimit={1000}
            state={{ isLoading, error, onRetry }}
          />,
        );

        expect(screen.getByRole('region', { name: 'Confidence and methodology' })).toBeInTheDocument();
        expect(screen.getByText('Confidence & method')).toBeInTheDocument();
        expect(screen.getByText(label)).toBeInTheDocument();
        expect(screen.queryByText('Penalty claim supported')).not.toBeInTheDocument();
        expect(screen.queryByText('More samples needed')).not.toBeInTheDocument();
        if (error) {
          fireEvent.click(screen.getByRole('button', { name: /retry/i }));
          expect(onRetry).toHaveBeenCalledTimes(1);
        } else {
          expect(screen.getByRole('status', { name: 'Loading cold-start analysis' })).toBeInTheDocument();
        }
      });

      it.each([
        { name: 'supported', count: 11, label: 'Penalty claim supported', cold: '5/5', classified: '10' },
        { name: 'insufficient', count: 10, label: 'More samples needed', cold: '4/5', classified: '9' },
      ])('preserves $name populated confidence and readings', ({ count, label, cold, classified }) => {
        render(
          <ColdStartMethodology
            summary={summarizeColdStarts(supportedDrives().slice(0, count))}
            observedDrives={count}
            windowLimit={1000}
            state={{ isLoading: false, error: null, onRetry: vi.fn() }}
          />,
        );

        expect(screen.getByText(label)).toBeInTheDocument();
        expect(screen.getAllByText(cold).length).toBeGreaterThan(0);
        expect(screen.getAllByText('5/5').length).toBeGreaterThan(0);
        expect(screen.getByText(classified)).toBeInTheDocument();
        for (const reading of ['Cold evidence', 'Warm evidence', 'Classified']) {
          expect(screen.getByText(reading)).toBeInTheDocument();
        }
        expect(screen.getByText(/1 usable drives could not be classified/)).toBeInTheDocument();
        expect(screen.getByText(`This analysis uses ${count} drives returned for the selected observed window (up to 1000). Consumption is distance-weighted; only drives of at least 1 km with measured energy qualify.`)).toBeInTheDocument();
      });
    });

    describe('ColdWarmComparison efficiency readings', () => {
      it('uses the neutral panel surface while retaining populated cohort identities and palette colors', () => {
        const summary = summarizeColdStarts(supportedDrives());
        render(
          <ColdWarmComparison
            summary={summary}
            penaltyCostLabel="$0.10"
            state={{ isLoading: false, error: null, onRetry: vi.fn() }}
            className="comparison-layout"
          />,
        );

        const panel = screen.getByRole('region', { name: 'Cold and warm aggregate comparison' });
        expect(panel).toHaveClass('bg-[var(--panel-bg)]', 'comparison-layout');
        expect(panel.className).not.toMatch(/gradient|from-|via-|to-|neon|glow/);
        expect(panel.querySelector('svg')).toHaveClass('text-[var(--text-secondary)]');
        for (const [index, cohort] of [summary.cold, summary.warm].entries()) {
          const bar = screen.getByRole('progressbar', {
            name: `${index === 0 ? 'Cold' : 'Warm'} starts (${cohort.drives} drives)`,
          });
          expect(bar).toHaveAttribute('aria-valuenow', String(cohort.whPerKm));
          expect(bar).toHaveTextContent(`${cohort.whPerKm} Wh/km`);
          expect(bar.querySelector('[data-metric-fill]')).toHaveStyle({
            background: `linear-gradient(90deg, ${CHART_COLORS[index]}99, ${CHART_COLORS[index]})`,
          });
        }
        expect(panel).toHaveTextContent('Aggregate sample ready');
        expect(panel).toHaveTextContent('about $0.10 at your electricity rate');
      });

      const readings = [
        { name: 'missing', value: null, hasReading: false },
        { name: 'NaN', value: Number.NaN, hasReading: false },
        { name: 'positive infinity', value: Number.POSITIVE_INFINITY, hasReading: false },
        { name: 'negative infinity', value: Number.NEGATIVE_INFINITY, hasReading: false },
        { name: 'measured zero', value: 0, hasReading: true },
        { name: 'negative signed fraction', value: -25.5, hasReading: true },
        { name: 'positive fraction below one', value: 0.25, hasReading: true },
        { name: 'positive signed fraction', value: 300.75, hasReading: true },
      ];

      describe.each(['cold', 'warm'] as const)('%s cohort', cohort => {
        it.each(readings)('preserves $name separately from unknown readings', ({ value, hasReading }) => {
          const summary = summarizeColdStarts([]);
          summary.cold = { drives: 5, distanceM: 5_000, whPerKm: 200 };
          summary.warm = { drives: 5, distanceM: 5_000, whPerKm: 200 };
          summary[cohort].whPerKm = value;

          render(
            <ColdWarmComparison
              summary={summary}
              penaltyCostLabel={null}
              state={{ isLoading: false, error: null, onRetry: vi.fn() }}
            />,
          );

          const bar = screen.getByRole('progressbar', {
            name: cohort === 'cold' ? 'Cold starts (5 drives)' : 'Warm starts (5 drives)',
          });
          const max = Math.max(value ?? 0, 200, 1);
          const safeMax = Number.isFinite(max) && max > 0 ? max : 0;
          expect(bar).toHaveAttribute('aria-valuemax', String(safeMax));
          expect(bar.querySelector('[data-metric-fill]') !== null).toBe(hasReading);
          if (hasReading && value != null) {
            expect(bar).toHaveAttribute('aria-valuenow', String(Math.min(Math.max(value, 0), safeMax)));
            expect(bar).not.toHaveAttribute('aria-valuetext');
            expect(bar).toHaveTextContent(`${value} Wh/km`);
          } else {
            expect(bar).not.toHaveAttribute('aria-valuenow');
            expect(bar).toHaveAttribute('aria-valuetext', 'No reading');
            expect(bar).toHaveTextContent('—');
            expect(bar).not.toHaveTextContent('0 Wh/km');
          }
        });
      });

  it.each([
      { name: 'active loading', result: query({ data: undefined, isPending: true, isFetching: true, fetchStatus: 'fetching' }), loading: true, retained: false },
      { name: 'paused without data', result: query({ data: undefined, isPending: true, fetchStatus: 'paused' }), loading: true, retained: false },
      { name: 'successful empty', result: query(), loading: false, retained: false },
      { name: 'successful zero penalty', result: query({ data: supportedDrives().map(drive => ({ ...drive, energyUsedWh: 200 })) }), loading: false, retained: false },
      { name: 'retained refresh failure', result: query({ data: supportedDrives(), isError: true, error: new Error('refresh failed') }), loading: false, retained: true },
  ])('threads existing trust into comparison section state for $name', ({ result, loading, retained }) => {
      useDrivesMock.mockReturnValue(result);
      render(<ColdStartPage />);

      expect(comparisonPropsMock.mock.lastCall?.[0].state).toMatchObject({
        isLoading: loading, retained, error: null,
      });
      expect(briefPropsMock.mock.lastCall?.[0].retained).toBe(retained);
  });

  it('preserves cohort operands and clears nested retained trust after recovery', () => {
      const retained = query({ data: supportedDrives() });
      useDrivesMock.mockReturnValue(retained);
      const page = render(<ColdStartPage />);
      const comparison = render(<ColdWarmComparison {...comparisonPropsMock.mock.lastCall?.[0]} />);
      const originalMetrics = nestedBriefPropsMock.mock.lastCall?.[0].metrics;
      expect(nestedBriefPropsMock.mock.lastCall?.[0]).toMatchObject({
        retained: false, loading: false, unavailable: false,
      });

      useDrivesMock.mockReturnValue({ ...retained, isError: true, error: new Error('refresh failed') });
      page.rerender(<ColdStartPage />);
      comparison.rerender(<ColdWarmComparison {...comparisonPropsMock.mock.lastCall?.[0]} />);
      expect(nestedBriefPropsMock.mock.lastCall?.[0]).toMatchObject({
        retained: true, loading: false, unavailable: false,
      });
      expect(nestedBriefPropsMock.mock.lastCall?.[0].metrics.map((metric: { rawValue: number | null }) => metric.rawValue))
        .toEqual(originalMetrics.map((metric: { rawValue: number | null }) => metric.rawValue));

      useDrivesMock.mockReturnValue({ ...retained, isFetching: true, fetchStatus: 'fetching', isError: true, error: new Error('refresh failed') });
      page.rerender(<ColdStartPage />);
      comparison.rerender(<ColdWarmComparison {...comparisonPropsMock.mock.lastCall?.[0]} />);
      expect(nestedBriefPropsMock.mock.lastCall?.[0].retained).toBe(true);

      useDrivesMock.mockReturnValue({ ...retained, dataUpdatedAt: 2 });
      page.rerender(<ColdStartPage />);
      comparison.rerender(<ColdWarmComparison {...comparisonPropsMock.mock.lastCall?.[0]} />);
      expect(nestedBriefPropsMock.mock.lastCall?.[0]).toMatchObject({
        retained: false, loading: false, unavailable: false,
      });
      expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
  });

  it.each([
      { name: 'active loading', state: { isLoading: true, error: null, onRetry: vi.fn(), retained: false }, empty: false },
      { name: 'paused without data', state: { isLoading: true, error: null, onRetry: vi.fn(), retained: false }, empty: false },
      { name: 'successful empty', state: { isLoading: false, error: null, onRetry: vi.fn(), retained: false }, empty: true },
  ])('does not invent nested cohort evidence for $name', ({ state, empty }) => {
      render(<ColdWarmComparison summary={summarizeColdStarts([])} penaltyCostLabel={null} state={state} />);
      expect(screen.getByTestId('cold-start-comparison')).toBeInTheDocument();
      expect(nestedBriefPropsMock).not.toHaveBeenCalled();
      if (empty) {
        expect(screen.getByText('This window has no drives in the warm or cold parking-gap groups.')).toBeInTheDocument();
      } else {
        expect(screen.getByRole('status', { name: 'Loading cold-start analysis' })).toBeInTheDocument();
      }
  });

  it('passes successful measured zero to the nested brief as returned evidence', () => {
      const summary = summarizeColdStarts(supportedDrives().map(drive => ({ ...drive, energyUsedWh: 200 })));
      render(<ColdWarmComparison summary={summary} penaltyCostLabel={null}
        state={{ isLoading: false, error: null, retained: false, onRetry: vi.fn() }} />);
      expect(nestedBriefPropsMock.mock.lastCall?.[0]).toMatchObject({
        retained: false, loading: false, unavailable: false,
        metrics: [
          expect.objectContaining({ rawValue: 0 }),
          expect.objectContaining({ rawValue: 0.2 }),
          expect.objectContaining({ rawValue: 0.2 }),
        ],
      });
  });

      it('retains the minimum max guard while distinguishing missing from measured zero', () => {
        const summary = summarizeColdStarts([]);
        summary.cold = { drives: 5, distanceM: 5_000, whPerKm: null };
        summary.warm = { drives: 5, distanceM: 5_000, whPerKm: 0 };

        render(
          <ColdWarmComparison
            summary={summary}
            penaltyCostLabel={null}
            state={{ isLoading: false, error: null, onRetry: vi.fn() }}
          />,
        );

        const cold = screen.getByRole('progressbar', { name: 'Cold starts (5 drives)' });
        const warm = screen.getByRole('progressbar', { name: 'Warm starts (5 drives)' });
        for (const bar of [cold, warm]) expect(bar).toHaveAttribute('aria-valuemax', '1');
        expect(cold).not.toHaveAttribute('aria-valuenow');
        expect(cold.querySelector('[data-metric-fill]')).toBeNull();
        expect(warm).toHaveAttribute('aria-valuenow', '0');
        expect(warm.querySelector('[data-metric-fill]')).not.toBeNull();
        expect(warm).toHaveTextContent('0 Wh/km');
      });
    });

  it('re-queries with the newly selected range', async () => {
    render(<ColdStartPage />);
    act(() => sharedRange.set({ start: '2026-07-01', end: '2026-07-31' }));
    expect(screen.queryByTestId('cold-start-range')).not.toBeInTheDocument();

    await waitFor(() =>
      expect(useDrivesMock).toHaveBeenLastCalledWith('42', {
        start: '2026-07-01T08:00:00.000Z',
        end: '2026-08-01T07:00:00.000Z',
        limit: 1000,
      }),
    );
  });

  it.each([
    ['loading', query({ data: undefined, isLoading: true })],
    ['error', query({ data: undefined, isError: true, error: new Error('unavailable') })],
  ])('threads the %s state to every mounted section', (expected, result) => {
    useDrivesMock.mockReturnValue(result);
    render(<ColdStartPage />);

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent(expected);
    }
  });

  it('keeps every returned-window section during refresh failure and offers source-owned recovery', () => {
    const retained = query();
    const view = render(<ColdStartPage />);
    useDrivesMock.mockReturnValue({ ...retained, isError: true, error: new Error('refresh failed') });
    view.rerender(<ColdStartPage />);
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('ready');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(retained.refetch).toHaveBeenCalledTimes(1);
    useDrivesMock.mockReturnValue({ ...retained, data: undefined, isError: true, error: new Error('initial failed') });
    view.rerender(<ColdStartPage />);
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('error');
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
  });

  it('preserves the no-vehicle selection state', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null });
    render(<ColdStartPage />);

    expect(screen.getByTestId('no-vehicle')).toHaveTextContent('Cold Start Cost');
    expect(screen.queryByTestId('cold-start-comparison')).not.toBeInTheDocument();
  });

  it('keeps rolling workspace instants and vehicle timezone in the query and scope', () => {
    render(<ColdStartPage />);
    act(() => sharedRange.set({
      start: '2026-10-11',
      end: '2026-10-12',
      startInstant: '2026-10-11T14:38:00.123Z',
      endInstantExclusive: '2026-10-12T14:38:00.123Z',
    }));

    expect(timezoneMock).toHaveBeenCalledWith('vehicle');
    expect(rangeOptionsMock).toHaveBeenLastCalledWith({
      persistKey: 'cold-start.range',
      defaultPresetId: 'all',
      timezone: 'America/Los_Angeles',
    });
    expect(useDrivesMock).toHaveBeenLastCalledWith('42', {
      start: '2026-10-11T14:38:00.123Z',
      end: '2026-10-12T14:38:00.123Z',
      limit: 1000,
    });
    expect(briefPropsMock.mock.lastCall?.[0].scope).toBe(
      '2026-10-11T14:38:00.123Z (vehicle time) PDT–2026-10-12T14:38:00.123Z (vehicle time) PDT; returned selected-window drives',
    );
    expect(screen.queryByTestId('vehicle-select')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cold-start-range')).not.toBeInTheDocument();
  });

  it('preserves supported SI cohort samples and prices only the display-boundary energy', () => {
    const drives = supportedDrives();
    const original = structuredClone(drives);
    useDrivesMock.mockReturnValue(query({ data: drives }));
    render(<ColdStartPage />);

    expect(formatCurrencyMock).toHaveBeenCalledWith(0.1);
    expect(briefPropsMock.mock.lastCall?.[0]).toMatchObject({
      penaltyCostLabel: '$0.10',
      retained: false,
      summary: {
        cold: { drives: 5, distanceM: 5_000, whPerKm: 300 },
        warm: { drives: 5, distanceM: 5_000, whPerKm: 200 },
        penaltyWhPerKm: 100,
        totalPenaltyWh: 500,
        analyzed: 10,
        unclassified: 1,
        sampleSufficient: true,
        temperature: expect.arrayContaining([
          expect.objectContaining({ driveId: 7, outsideTempAvgC: -5, distanceM: 1_000 }),
        ]),
        opportunities: expect.arrayContaining([
          expect.objectContaining({ driveId: 7, precedingGapS: 21_600, estimatedAvoidableWh: 100 }),
        ]),
      },
    });
    expect(drives).toEqual(original);
  });

  it.each([
    { name: 'missing rate', rate: null },
    { name: 'absent rate', rate: undefined },
    { name: 'negative rate', rate: -1 },
    { name: 'negative fractional rate', rate: -0.25 },
    { name: 'nonfinite rate', rate: Number.POSITIVE_INFINITY },
    { name: 'negative infinite rate', rate: Number.NEGATIVE_INFINITY },
    { name: 'invalid rate', rate: Number.NaN },
  ])('withholds monetary estimates for $name without hiding evidence', ({ rate }) => {
    formatting.costPerKwh = rate;
    useDrivesMock.mockReturnValue(query({ data: supportedDrives() }));
    render(<ColdStartPage />);

    expect(formatCurrencyMock).not.toHaveBeenCalled();
    expect(briefPropsMock.mock.lastCall?.[0]).toMatchObject({
      penaltyCostLabel: null,
      summary: { sampleSufficient: true, totalPenaltyWh: 500 },
    });
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('ready');
  });

  it.each([
    { name: 'zero rate', rate: 0, coldEnergyWh: 300, penaltyWhPerKm: 100, totalPenaltyWh: 500, cost: 0 },
    { name: 'fractional rate', rate: 0.125, coldEnergyWh: 300, penaltyWhPerKm: 100, totalPenaltyWh: 500, cost: 0.0625 },
    { name: 'measured zero penalty', rate: 0.2, coldEnergyWh: 200, penaltyWhPerKm: 0, totalPenaltyWh: 0, cost: 0 },
    { name: 'negative signed fractional penalty', rate: 0.2, coldEnergyWh: 174.5, penaltyWhPerKm: -25.5, totalPenaltyWh: 0, cost: 0 },
    { name: 'positive fractional penalty', rate: 0.2, coldEnergyWh: 200.5, penaltyWhPerKm: 0.5, totalPenaltyWh: 3, cost: 0.0006 },
  ])('prices $name without discarding measured evidence', ({
    rate, coldEnergyWh, penaltyWhPerKm, totalPenaltyWh, cost,
  }) => {
    formatting.costPerKwh = rate;
    const drives = supportedDrives().map((drive, index) =>
      index > 5 ? { ...drive, energyUsedWh: coldEnergyWh } : drive,
    );
    useDrivesMock.mockReturnValue(query({ data: drives }));
    render(<ColdStartPage />);

    expect(formatCurrencyMock).toHaveBeenCalledOnce();
    expect(formatCurrencyMock.mock.lastCall?.[0]).toBeCloseTo(cost, 10);
    const expected = {
      penaltyCostLabel: `$${cost.toFixed(2)}`,
      summary: { sampleSufficient: true, penaltyWhPerKm, totalPenaltyWh },
    };
    expect(briefPropsMock.mock.lastCall?.[0]).toMatchObject(expected);
    expect(comparisonPropsMock.mock.lastCall?.[0]).toMatchObject(expected);
    for (const id of SECTION_IDS) expect(screen.getByTestId(id)).toHaveTextContent('ready');
  });

  it('withholds cost when observed cohorts have insufficient samples', () => {
    useDrivesMock.mockReturnValue(query({ data: supportedDrives().slice(0, 10) }));
    render(<ColdStartPage />);

    expect(formatCurrencyMock).not.toHaveBeenCalled();
    expect(briefPropsMock.mock.lastCall?.[0]).toMatchObject({
      penaltyCostLabel: null,
      summary: { sampleSufficient: false, totalPenaltyWh: null },
    });
  });
});
