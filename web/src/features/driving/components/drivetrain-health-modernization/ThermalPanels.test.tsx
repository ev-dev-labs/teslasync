import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { deriveDataState } from '@/api/dataState';
import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { healthFixture, statsFixture, driveFixture } from './fixtures';
import { powerSummary, sensorsFor } from './model';
import { ThermalPanels } from './ThermalPanels';
import { MethodologyPanel } from './MethodologyPanel';
import { DrivetrainSummary } from '../operationalbrief-a-m/DrivetrainSummary';

const scopePreferences = vi.hoisted<{
  locale: string;
  timezone: string;
  startInstant: string | undefined;
  endInstantExclusive: string | undefined;
}>(() => ({
  locale: 'de-DE',
  timezone: 'America/Los_Angeles',
  startInstant: '2026-03-08T08:00:00.000Z',
  endInstantExclusive: '2026-03-09T07:00:00.000Z',
}));

vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => scopePreferences,
}));

vi.mock('@/hooks/useDateFormat', async () => {
  const { formatDateTime } = await import('@/lib/dateFormat');
  return {
    useDateFormat: () => ({
      formatDateTime: (value: string | undefined, override: { tz?: string }) =>
        formatDateTime(value, { locale: scopePreferences.locale, ...override }),
    }),
  };
});

type Props = ComponentProps<typeof ThermalPanels>;
const retryDrive = vi.fn();
const retryStats = vi.fn();
const timestamp = 1_790_000_000_000;
const previousPreferences = getFormatterPreferences();
let client: QueryClient;

function ready<T>(data: T, refetch?: () => void) {
  return deriveDataState({ data, isSuccess: true, dataUpdatedAt: timestamp, refetch });
}

function props(overrides: Partial<Props> = {}): Props {
  return {
    sensors: sensorsFor(healthFixture),
    power: { peakPower: 2000, avgPowerMax: 1000, minRegenPower: null },
    stats: statsFixture,
    healthState: ready(healthFixture),
    drivesState: ready([driveFixture()], retryDrive),
    statsState: ready(statsFixture, retryStats),
    loading: false,
    ...overrides,
  };
}

function Providers({ children }: { children: ReactNode }) {
  return <MemoryRouter><QueryClientProvider client={client}>{children}</QueryClientProvider></MemoryRouter>;
}

function renderPanels(overrides: Partial<Props> = {}) {
  return render(<ThermalPanels {...props(overrides)} />, { wrapper: Providers });
}

function statistic(label: string) {
  const row = screen.getByText(label, { selector: 'dt' }).parentElement;
  if (!row) throw new Error(`Missing statistic row: ${label}`);
  return within(row).getByRole('definition');
}

function powerMetric(label: string) {
  const metric = screen.getByText(label).closest<HTMLElement>('[data-operational-metric]');
  if (!metric) throw new Error(`Missing power metric: ${label}`);
  return metric;
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  scopePreferences.locale = 'de-DE';
  scopePreferences.timezone = 'America/Los_Angeles';
  scopePreferences.startInstant = '2026-03-08T08:00:00.000Z';
  scopePreferences.endInstantExclusive = '2026-03-09T07:00:00.000Z';
});

describe('Drivetrain statistics scope copy', () => {
  function renderScope() {
    const sourceProps = props();
    return render(<>
      <DrivetrainSummary {...sourceProps} health={healthFixture} healthLoading={false} statsLoading={false} />
      <MethodologyPanel />
    </>, { wrapper: Providers });
  }

  it('describes all completed-drive statistics and exact local bounds across a DST day', () => {
    renderScope();
    const scope = screen.getAllByText(/Drive start:.*inclusive.*exclusive/);
    expect(scope.length).toBeGreaterThanOrEqual(1);
    for (const copy of scope) {
      expect(copy).toHaveTextContent('8. März 2026, 00:00');
      expect(copy).toHaveTextContent('9. März 2026, 00:00');
      expect(copy).toHaveTextContent('[2026-03-08T08:00:00.000Z]');
      expect(copy).toHaveTextContent('[2026-03-09T07:00:00.000Z]');
      expect(copy).toHaveTextContent('America/Los_Angeles');
    }
    const stats = screen.getByRole('region', { name: 'Vehicle drive statistics' });
    fireEvent.click(within(stats).getByRole('button', { name: 'Review details' }));
    const statsDrawer = screen.getByRole('dialog');
    const statsHeader = statsDrawer.querySelector('[data-drawer-header]')!;
    expect(statsHeader).toHaveTextContent('8. März 2026, 00:00');
    expect(statsHeader).toHaveTextContent('9. März 2026, 00:00');
    expect(statsHeader).toHaveTextContent('[2026-03-08T08:00:00.000Z]');
    expect(statsHeader).toHaveTextContent('[2026-03-09T07:00:00.000Z]');
    expect(statsHeader).toHaveTextContent('America/Los_Angeles');
    expect(statsHeader).toHaveTextContent(/Server statistics cover all completed drives/);
    fireEvent.keyDown(statsDrawer, { key: 'Escape' });
    expect(screen.getAllByText(/Server statistics cover all completed drives/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/unbounded 200-snapshot request.*last 30 returned drives/)).toBeVisible();
    expect(screen.queryByText(/Unbounded vehicle statistics|not motor history or vehicle drive statistics/)).not.toBeInTheDocument();
  });

  it('uses a different saved locale and the range timezone rather than UTC calendar dates', () => {
    scopePreferences.locale = 'fr-FR';
    scopePreferences.timezone = 'Asia/Tokyo';
    scopePreferences.startInstant = '2026-10-01T15:00:00.123Z';
    scopePreferences.endInstantExclusive = '2026-10-02T15:00:00.456Z';
    renderScope();
    for (const copy of screen.getAllByText(/Drive start:.*inclusive.*exclusive/)) {
      expect(copy).toHaveTextContent('2 oct. 2026, 00:00');
      expect(copy).toHaveTextContent('3 oct. 2026, 00:00');
      expect(copy).toHaveTextContent('[2026-10-01T15:00:00.123Z]');
      expect(copy).toHaveTextContent('[2026-10-02T15:00:00.456Z]');
      expect(copy).toHaveTextContent('Asia/Tokyo');
    }
  });

  it.each([
    { start: 'invalid-date', end: '' },
    { start: '', end: 'invalid-date' },
    { start: undefined, end: undefined },
  ])('keeps invalid and missing bounds explicitly unknown: $start / $end', ({ start, end }) => {
    scopePreferences.startInstant = start;
    scopePreferences.endInstantExclusive = end;
    renderScope();
    for (const copy of screen.getAllByText(/Drive start:.*inclusive.*exclusive/)) {
      expect(copy).toHaveTextContent('Drive start: — (inclusive) to — (exclusive)');
      expect(copy).toHaveTextContent('America/Los_Angeles');
      expect(copy).not.toHaveTextContent('Invalid Date');
      expect(copy).not.toHaveTextContent('invalid-date');
    }
    expect(screen.getByText(/unbounded 200-snapshot request/)).toBeVisible();
  });
});

describe('MethodologyPanel layout contract', () => {
  it('uses the layout category barrel and preserves every methodology statement in its named card', () => {
    const source = readFileSync(
      'src/features/driving/components/drivetrain-health-modernization/MethodologyPanel.tsx',
      'utf8',
    );
    expect(source).toContain("import { LayoutCard } from '@/components/layout';");
    expect(source).not.toContain('@/components/layout/');

    render(<MethodologyPanel />, { wrapper: Providers });
    const heading = screen.getByRole('heading', { name: 'Health methodology and source limits' });
    const card = heading.closest<HTMLElement>('[data-card]');
    if (!card) throw new Error('Missing methodology layout card');
    expect(card).toHaveAccessibleName('Health methodology and source limits');
    expect(card).toHaveAttribute('data-card-size', 'full');
    const methodology = within(card);
    for (const statement of [
      'Health temperatures are backend battery-module proxies, not direct motor measurements.',
      'The health endpoint projects the minimum battery-module temperature into the front motor temperature field.',
      'The health endpoint projects the maximum battery-module temperature into the rear motor temperature field.',
      'The health endpoint adds a 7°C temperature difference to the maximum battery-module reading as an inverter proxy.',
      'The health endpoint averages the available minimum and maximum module readings, or uses the single available reading.',
      /The backend reports warning above .* and critical above .* based on its maximum module\/inverter proxy\. These thresholds differ from the per-component gauge ratios\./,
      'Status-to-score policy: good 95%, warning 60%, critical 25%. This is a rating, not a measured percentage.',
      /Component gauges compare Celsius readings with their original ceilings: .* for front\/rear motor, .* for inverter and .* for battery\. Warning begins at 65% and critical at 85% of the ceiling\./,
      'Existing Stator, Rear-Left and Rear-Right series map to front motor, rear motor and inverter temperature respectively. These aliases do not identify additional motors.',
      'Peak-labelled power uses average drive power from up to 30 returned drives. Per-drive regen power is not supplied; gaps are unknown, not zero.',
      'Motor history uses the existing unbounded 200-snapshot request in source order, independent of the selected range. Drive charts and power use the last 30 returned drives within the selected range; this subset is separate from the full completed-drive statistics.',
      'Server statistics cover all completed drives for the selected vehicle whose start falls within the selected bounds, not just the returned drive subset.',
      /Drive start:.*inclusive.*exclusive.*America\/Los_Angeles/,
      'Average power requires a power reading for every included drive. An incomplete set remains unknown rather than treating missing readings as zero.',
      'Without temperature evidence, no active health assessment is presented. A returned status is still recorded as source data.',
    ]) {
      expect(methodology.getByText(statement)).toBeVisible();
    }
    for (const label of ['Front Motor', 'Rear Motor', 'Inverter', 'Battery']) {
      expect(methodology.getByText(label, { selector: 'dt' })).toBeVisible();
    }
  });
});

afterEach(() => {
  client.clear();
  setGlobalLocale(previousPreferences.locale);
  setGlobalPrecision(previousPreferences.precision);
});

describe('ThermalPanels truthful thermal readings', () => {
  it.each([
    { value: null, name: 'missing' },
    { value: Number.NaN, name: 'NaN' },
    { value: Number.POSITIVE_INFINITY, name: 'positive infinity' },
    { value: Number.NEGATIVE_INFINITY, name: 'negative infinity' },
  ])('keeps $name unknown rather than measured zero', ({ value }) => {
    renderPanels({ sensors: [{ ...sensorsFor(healthFixture)[0], value }] });
    const gauges = screen.getAllByRole('group', { name: 'Front Motor' });
    expect(gauges).toHaveLength(2);
    for (const gauge of gauges) {
      expect(gauge).not.toHaveAttribute('aria-valuenow');
      expect(gauge).toHaveAccessibleDescription(/Unknown/i);
      expect(within(gauge).getByText('—')).toBeVisible();
      expect(within(gauge.parentElement!).getByText('unknown')).toBeVisible();
      expect(gauge.querySelector('[style]')).toBeNull();
    }
    expect(screen.queryByRole('meter', { name: 'Front Motor' })).not.toBeInTheDocument();
  });

  it.each([
    { value: 0, percentage: 0, display: '0.00', fill: '0%', band: 'good' },
    { value: -15, percentage: -10, display: '-10.00', fill: '0%', band: 'good' },
    { value: -0.75, percentage: -0.5, display: '-0.50', fill: '0%', band: 'good' },
    { value: 0.75, percentage: 0.5, display: '0.50', fill: '0.5%', band: 'good' },
    { value: 97.485, percentage: 64.99, display: '64.99', fill: '64.99%', band: 'good' },
    { value: 97.5, percentage: 65, display: '65.00', fill: '65%', band: 'warning' },
    { value: 127.485, percentage: 84.99, display: '84.99', fill: '84.99%', band: 'warning' },
    { value: 127.5, percentage: 85, display: '85.00', fill: '85%', band: 'critical' },
    { value: 150, percentage: 100, display: '100.00', fill: '100%', band: 'critical' },
    { value: 180.75, percentage: 120.5, display: '120.50', fill: '100%', band: 'critical' },
  ])('preserves $value Celsius and its band in both panels', ({ value, percentage, display, fill, band }) => {
    renderPanels({ sensors: [{ ...sensorsFor(healthFixture)[0], value }] });
    const inRange = percentage >= 0 && percentage <= 100;
    const gauges = screen.getAllByRole(inRange ? 'meter' : 'group', { name: 'Front Motor' });
    expect(gauges).toHaveLength(2);
    for (const gauge of gauges) {
      expect(within(gauge).getByText(display)).toBeVisible();
      // The band text sits beside the gauge in the same sensor cell.
      expect(within(gauge.parentElement!).getByText(band)).toBeVisible();
      expect(gauge).toHaveAccessibleDescription(expect.stringContaining(`${display}%`));
      const bar = gauge.querySelector<HTMLElement>('[style]');
      expect(bar).not.toBeNull();
      expect(Number.parseFloat(bar?.style.width ?? '')).toBeCloseTo(Number.parseFloat(fill));
      if (inRange) {
        expect(Number(gauge.getAttribute('aria-valuenow'))).toBeCloseTo(percentage);
        expect(gauge).toHaveAttribute('aria-valuemin', '0');
        expect(gauge).toHaveAttribute('aria-valuemax', '100');
        expect(gauge).toHaveAttribute('aria-valuetext', `${display}%`);
      } else {
        expect(gauge).not.toHaveAttribute('aria-valuenow');
        expect(gauge).not.toHaveAttribute('aria-valuemin');
        expect(gauge).not.toHaveAttribute('aria-valuemax');
      }
    }
    expect(screen.getByText(/Gauge scale:.*150.*°C/)).toBeVisible();
    expect(screen.getByText(/Warning begins at 65% and critical at 85%/)).toBeVisible();
  });
});

describe('ThermalPanels independent source trust', () => {
  it.each(['drives', 'stats', 'health'] as const)(
    'keeps initial paused %s distinct from authoritative emptiness and recovers independently',
    source => {
      const retry = vi.fn();
      const paused = deriveDataState({ isPending: true, fetchStatus: 'paused', refetch: retry });
      const { container, rerender } = renderPanels(source === 'drives'
        ? { drivesState: paused, drivesLoading: true, drivesEmpty: true, power: powerSummary([]) }
        : source === 'stats'
          ? { statsState: paused, statsLoading: true, statsEmpty: true, stats: undefined }
          : { healthState: paused, loading: true, sensors: [] });
      expect(screen.getAllByText('Refresh paused')).toHaveLength(source === 'health' ? 2 : 1);
      expect(screen.getByRole('heading', { name: 'Temperature Gauges' })).toBeVisible();
      expect(screen.getByRole('heading', { name: 'Thermal Load Indicators' })).toBeVisible();
      expect(container.querySelectorAll('.space-y-2[aria-hidden="true"]')).toHaveLength(0);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
      expect(screen.queryByText('No data')).not.toBeInTheDocument();
      expect(screen.queryByText('No drive statistics available yet')).not.toBeInTheDocument();
      expect(screen.queryByText('No temperature sensor data available yet')).not.toBeInTheDocument();
      fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' })[0]);
      expect(retry).toHaveBeenCalledOnce();
      expect(retryDrive).not.toHaveBeenCalled();
      expect(retryStats).not.toHaveBeenCalled();
      if (source !== 'drives') expect(screen.getByText('Peak Power')).toBeVisible();
      if (source !== 'stats') expect(statistic('Drives')).toHaveTextContent('2');
      rerender(<ThermalPanels {...props()} />);
      expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();
      expect(screen.getAllByRole('meter', { name: 'Front Motor' })).toHaveLength(2);
      expect(screen.getByText('Peak Power')).toBeVisible();
      expect(statistic('Regen Ratio')).toHaveTextContent('0.00%');
    },
  );

  it('keeps selection-disabled sources pending without spinning, claiming empty or exposing a retry', () => {
    const pending = deriveDataState({ isPending: true, fetchStatus: 'idle', refetch: retryDrive });
    const { container, rerender } = renderPanels({
      drivesState: pending, drivesLoading: false, drivesEmpty: true, power: powerSummary([]),
      statsState: pending, statsLoading: false, statsEmpty: true, stats: undefined,
    });
    expect(screen.getAllByText('Pending')).toHaveLength(2);
    expect(container.querySelectorAll('.space-y-2[aria-hidden="true"]')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
    expect(screen.queryByText('No data')).not.toBeInTheDocument();
    expect(screen.queryByText('No drive statistics available yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Peak Power')).not.toBeInTheDocument();
    expect(screen.queryByText('Regen Ratio')).not.toBeInTheDocument();
    expect(screen.getAllByRole('meter', { name: 'Rear Motor' })).toHaveLength(2);
    rerender(<ThermalPanels {...props()} />);
    expect(screen.queryByText('Pending')).not.toBeInTheDocument();
    expect(screen.getByText('Peak Power')).toBeVisible();
    expect(statistic('Drives')).toHaveTextContent('2');
  });

  it('preserves all thermal sensors, ceilings, zero readings and SI power with omitted optional props', () => {
    renderPanels();
    expect(screen.getByText('Temperature Gauges')).toBeVisible();
    expect(screen.getByText('Thermal Load Indicators')).toBeVisible();
    expect(screen.getAllByRole('meter', { name: 'Front Motor' })).toHaveLength(2);
    for (const meter of screen.getAllByRole('meter', { name: 'Front Motor' })) {
      expect(meter).toHaveAttribute('aria-valuenow', '0');
    }
    expect(screen.getAllByRole('meter', { name: 'Rear Motor' })).toHaveLength(2);
    expect(screen.getAllByRole('meter', { name: 'Inverter' })).toHaveLength(2);
    expect(screen.queryByRole('meter', { name: 'Battery' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Battery')).toHaveLength(2);
    expect(screen.getAllByText(/Gauge scale:.*150.*°C/)).toHaveLength(2);
    expect(screen.getByText(/Gauge scale:.*120.*°C/)).toBeVisible();
    expect(screen.getByText(/Gauge scale:.*60.*°C/)).toBeVisible();
    expect(screen.getByText('Peak Power')).toBeVisible();
    expect(screen.getByText('Avg Power')).toBeVisible();
    expect(within(powerMetric('Peak Power')).getByText('2.00 kW')).toBeVisible();
    expect(within(powerMetric('Avg Power')).getByText('1.00 kW')).toBeVisible();
    expect(statistic('Drives')).toHaveTextContent('2');
    expect(statistic('Regen Ratio')).toHaveTextContent('0.00%');
  });

  it.each(['drives', 'stats'] as const)(
    'replaces only the initial failed %s source and retries its own query',
    source => {
      const failed = deriveDataState({
        error: new Error(`${source} source failed`),
        refetch: source === 'drives' ? retryDrive : retryStats,
      });
      renderPanels(source === 'drives'
        ? { drivesState: failed, power: powerSummary([]) }
        : { statsState: failed, stats: undefined });
      expect(screen.getByRole('alert')).toHaveTextContent("Can't reach server");
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(source === 'drives' ? retryDrive : retryStats).toHaveBeenCalledTimes(1);
      expect(source === 'drives' ? retryStats : retryDrive).not.toHaveBeenCalled();
      expect(screen.getAllByRole('meter', { name: 'Front Motor' })).toHaveLength(2);
      if (source === 'drives') {
        expect(statistic('Drives')).toHaveTextContent('2');
        expect(screen.queryByText('Peak Power')).not.toBeInTheDocument();
      } else {
        expect(screen.getByText('Peak Power')).toBeVisible();
        expect(screen.queryByText('Regen Ratio')).not.toBeInTheDocument();
      }
    },
  );

  it.each(['drives', 'stats'] as const)(
    'shows an initial %s skeleton without fabricated evidence and recovers independently',
    source => {
      const pending = deriveDataState({ isLoading: true, isPending: true });
      const { container, rerender } = renderPanels(source === 'drives'
        ? { drivesState: pending, drivesLoading: true, power: powerSummary([]) }
        : { statsState: pending, statsLoading: true, stats: undefined });
      expect(container.querySelectorAll('.space-y-2[aria-hidden="true"]')).toHaveLength(1);
      expect(screen.getAllByRole('meter', { name: 'Rear Motor' })).toHaveLength(2);
      if (source === 'drives') {
        expect(screen.queryByText('Returned evidence')).not.toBeInTheDocument();
        expect(statistic('Drives')).toHaveTextContent('2');
        expect(screen.queryByText('Peak Power')).not.toBeInTheDocument();
      } else {
        assertOperationalBriefDisclosure(screen.getByRole('region', { name: 'Power Summary' }), 'Returned evidence');
        expect(screen.getByText('Peak Power')).toBeVisible();
        expect(screen.queryByText('Regen Ratio')).not.toBeInTheDocument();
      }
      rerender(<ThermalPanels {...props()} />);
      expect(container.querySelectorAll('.space-y-2[aria-hidden="true"]')).toHaveLength(0);
      assertOperationalBriefDisclosure(screen.getByRole('region', { name: 'Power Summary' }), 'Returned evidence');
      expect(statistic('Regen Ratio')).toHaveTextContent('0.00%');
    },
  );

  it('distinguishes an empty selected drive subset from missing power readings in returned drives', () => {
    const { rerender } = renderPanels({ drivesEmpty: true, power: powerSummary([]) });
    expect(screen.getByText('No data')).toBeVisible();
    expect(screen.queryByText('Returned evidence')).not.toBeInTheDocument();
    expect(statistic('Drives')).toHaveTextContent('2');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(retryDrive).toHaveBeenCalledTimes(1);
    expect(retryStats).not.toHaveBeenCalled();
    rerender(<ThermalPanels {...props({ drivesEmpty: false, power: powerSummary([
      { date: '2026-09-01', powerMax: null, powerMin: null, outsideTemp: null, distance: null },
    ]) })} />);
    expect(screen.queryByText('No data')).not.toBeInTheDocument();
    const power = screen.getByRole('region', { name: 'Power Summary' });
    assertOperationalBriefDisclosure(power, 'Returned evidence');
    assertOperationalMetricUnavailable(power, 'Peak Power');
    assertOperationalMetricUnavailable(power, 'Avg Power');
    expect(screen.queryByText('0.00 kW')).not.toBeInTheDocument();
  });

  it('shows authoritative empty statistics without erasing power or measured zero statistics after recovery', () => {
    const { rerender } = renderPanels({ stats: undefined, statsEmpty: true });
    expect(screen.getByText('No drive statistics available yet')).toBeVisible();
    expect(screen.queryByText('Regen Ratio')).not.toBeInTheDocument();
    expect(screen.getByText('Peak Power')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(retryStats).toHaveBeenCalledTimes(1);
    expect(retryDrive).not.toHaveBeenCalled();
    const zeroStats = { ...statsFixture, totalDrives: 0, regenRatio: 0 };
    rerender(<ThermalPanels {...props({ stats: zeroStats, statsState: ready(zeroStats), statsEmpty: false })} />);
    expect(screen.queryByText('No drive statistics available yet')).not.toBeInTheDocument();
    expect(statistic('Drives')).toHaveTextContent(/^0$/);
    expect(statistic('Regen Ratio')).toHaveTextContent('0.00%');
    const unknownRatio = { ...zeroStats, regenRatio: null };
    rerender(<ThermalPanels {...props({ stats: unknownRatio, statsState: ready(unknownRatio) })} />);
    expect(statistic('Drives')).toHaveTextContent(/^0$/);
    expect(statistic('Regen Ratio')).toHaveTextContent(/^—$/);
  });

  it('uses existing source states for initial and authoritative empty defaults without new caller inputs', () => {
    const { container, rerender } = renderPanels({
      drivesState: deriveDataState({ isPending: true }),
      statsState: deriveDataState({ isPending: true }),
      stats: undefined,
      power: powerSummary([]),
    });
    expect(container.querySelectorAll('.space-y-2[aria-hidden="true"]')).toHaveLength(2);
    expect(screen.queryByText('Returned evidence')).not.toBeInTheDocument();
    rerender(<ThermalPanels {...props({
      drivesState: ready([], retryDrive),
      statsState: deriveDataState({ data: null, isSuccess: true, refetch: retryStats }, { unavailable: true }),
      stats: undefined,
      power: powerSummary([]),
    })} />);
    expect(screen.getByText('No data')).toBeVisible();
    expect(screen.getByText('No drive statistics available yet')).toBeVisible();
    expect(screen.queryByText('Peak Power')).not.toBeInTheDocument();
    expect(screen.queryByText('Regen Ratio')).not.toBeInTheDocument();
    expect(screen.getAllByRole('meter', { name: 'Inverter' })).toHaveLength(2);
  });

  it.each(['drives', 'stats'] as const)(
    'keeps retained %s readings and source retry on refresh failure until recovery',
    source => {
      const retained = deriveDataState({
        data: source === 'drives' ? [driveFixture()] : statsFixture,
        dataUpdatedAt: timestamp,
        error: new Error(`${source} refresh failed`),
        refetch: source === 'drives' ? retryDrive : retryStats,
      });
      const { rerender } = renderPanels({
        drivesState: source === 'drives' ? retained : props().drivesState,
        statsState: source === 'stats' ? retained : props().statsState,
        drivesLoading: true,
        statsLoading: true,
        power: { peakPower: 0, avgPowerMax: 0, minRegenPower: null },
      });
      const warning = screen.getByTestId('stale-refresh-warning');
      expect(warning).toHaveTextContent(source === 'drives' ? 'Power Summary may be out of date' : 'Drive Statistics may be out of date');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getAllByText('0.00 kW')).toHaveLength(2);
      expect(statistic('Regen Ratio')).toHaveTextContent('0.00%');
      assertOperationalBriefDisclosure(screen.getByRole('region', { name: 'Power Summary' }),
        source === 'drives' ? 'Retained source' : 'Returned evidence');
      fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
      expect(source === 'drives' ? retryDrive : retryStats).toHaveBeenCalledTimes(1);
      expect(source === 'drives' ? retryStats : retryDrive).not.toHaveBeenCalled();
      rerender(<ThermalPanels {...props()} />);
      expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
      assertOperationalBriefDisclosure(screen.getByRole('region', { name: 'Power Summary' }), 'Returned evidence');
    },
  );

  it('keeps paused drive readings qualified as retained without inventing an offline cause', () => {
    renderPanels({
      drivesState: deriveDataState({ data: [driveFixture()], fetchStatus: 'paused', dataUpdatedAt: timestamp }),
    });
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
    assertOperationalBriefDisclosure(screen.getByRole('region', { name: 'Power Summary' }), 'Retained source');
    expect(screen.getByText('Peak Power')).toBeVisible();
    expect(statistic('Drives')).toHaveTextContent('2');
    expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps both retained sources visible during actual background fetching without a false stale warning', () => {
    const { container } = renderPanels({
      drivesState: deriveDataState({ data: [driveFixture()], isFetching: true, dataUpdatedAt: timestamp }),
      statsState: deriveDataState({ data: statsFixture, isFetching: true, dataUpdatedAt: timestamp }),
      drivesLoading: true,
      statsLoading: true,
    });
    expect(container.querySelectorAll('.space-y-2[aria-hidden="true"]')).toHaveLength(0);
    expect(within(powerMetric('Peak Power')).getByText('2.00 kW')).toBeVisible();
    expect(statistic('Drives')).toHaveTextContent('2');
    expect(statistic('Regen Ratio')).toHaveTextContent('0.00%');
    assertOperationalBriefDisclosure(screen.getByRole('region', { name: 'Power Summary' }), 'Returned evidence');
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps independent drive and statistics measurements when only thermal health is loading or fails', () => {
    const { rerender } = renderPanels({
      healthState: deriveDataState({ isPending: true }),
      loading: true,
    });
    expect(screen.getByText('Peak Power')).toBeVisible();
    expect(statistic('Drives')).toHaveTextContent('2');
    rerender(<ThermalPanels {...props({
      healthState: deriveDataState({ error: new Error('health source failed') }),
    })} />);
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(screen.getByText('Peak Power')).toBeVisible();
    expect(statistic('Regen Ratio')).toHaveTextContent('0.00%');
  });
});
