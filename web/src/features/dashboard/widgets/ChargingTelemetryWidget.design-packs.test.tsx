import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChargingTelemetry } from '@/api/types';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import ChargingTelemetryWidget from './ChargingTelemetryWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, type PackId } from './designPacks/types';
import type { WidgetSize } from './types';

interface TelemetryQuery {
  data: ChargingTelemetry | null | undefined;
  error: Error | null;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  fetchStatus: 'fetching' | 'paused' | 'idle';
  refetch: ReturnType<typeof vi.fn<() => void>>;
}

const mocks = vi.hoisted(() => ({
  vehicles: vi.fn<() => { data: { id: number }[] }>(),
  telemetry: vi.fn<(vehicleId: number, interval?: number) => TelemetryQuery>(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: mocks.vehicles,
  useChargingTelemetryLatest: mocks.telemetry,
}));
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: { unit_of_length: 'km', locale: 'en-US' } }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: false, durationMs: 250 }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateTime: (value: unknown) => String(value),
    formatTime: (value: unknown) => String(value),
    tz: 'UTC',
  }),
}));
vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      return text.replace(/\{\{(\w+)\}\}/g, (match, name: string) => String(options?.[name] ?? match));
    },
    i18n: { language: 'en', dir: () => 'ltr' },
  }),
}));

function telemetry(overrides: Partial<ChargingTelemetry> = {}): ChargingTelemetry {
  return {
    vehicle_id: 7, ts: new Date().toISOString(), session_id: 3,
    battery_level: 72, battery_range_mi: null, charging_state: 'Charging',
    charger_voltage: 230, charger_actual_current: 16, charger_power_w: 11_000,
    charger_phases: 3, charger_pilot_current: 32, charge_limit_soc_pct: 80,
    charge_energy_added_wh: null, range_added_meters: null,
    range_added_meters_per_hour: null, scheduled_charging_at: null,
    source: 'test', ...overrides,
  };
}

function query(
  data: TelemetryQuery['data'] = telemetry(),
  overrides: Partial<TelemetryQuery> = {},
): TelemetryQuery {
  return {
    data, error: null, isLoading: false, isFetching: false, isStale: false,
    isError: false, dataUpdatedAt: Date.now(), fetchStatus: 'idle',
    refetch: vi.fn<() => void>(), ...overrides,
  };
}

function mount(packId: unknown = 'classic', size: WidgetSize = { cols: 2, rows: 4 }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (requestedPackId: unknown) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={requestedPackId}>
          <ChargingTelemetryWidget vehicleId={7} size={size} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(packId));
  return { ...view, selectPack: (next: unknown) => view.rerender(tree(next)) };
}

function headline(container: HTMLElement) {
  const element = container.querySelector<HTMLElement>('.widget-big-number');
  expect(element).toBeInTheDocument();
  return within(element!);
}

function flow() {
  return screen.getByRole('img', { name: 'Charging flow schematic' });
}

beforeEach(() => {
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  mocks.vehicles.mockReset().mockReturnValue({ data: [{ id: 1 }] });
  mocks.telemetry.mockReset().mockReturnValue(query());
});

describe.each(Object.entries(PACK_APPEARANCES) as [Exclude<PackId, 'classic'>, string][])(
  'Charging telemetry — %s / %s',
  (packId, appearance) => {
    async function expectAppearance(container: HTMLElement) {
      await waitFor(() => expect(container.querySelector(
        `[data-widget-family="charge-flow"][data-widget-appearance="${appearance}"]`,
      )).toBeInTheDocument());
    }

    it('recomposes real electrical readings and battery artwork, retains refresh and returns to Classic', async () => {
      const source = telemetry();
      const live = query(source);
      mocks.telemetry.mockReturnValue(live);
      const view = mount();
      const classicLabels = ['Voltage', 'Current', 'Power', 'Phases', 'Charger', 'Pilot'];
      for (const label of classicLabels) expect(screen.getByText(label)).toBeInTheDocument();
      expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
      expect(view.container.querySelector('[data-charge-level="72"]')).toBeInTheDocument();

      view.selectPack(packId);
      await expectAppearance(view.container);
      expect(screen.getByRole('heading', { name: 'Charging telemetry' })).toBeVisible();
      expect(headline(view.container).getByText('Charging power')).toBeInTheDocument();
      expect(headline(view.container).getByText('11.0')).toBeInTheDocument();
      expect(headline(view.container).getByText('kW')).toBeInTheDocument();
      for (const label of ['Voltage', 'Current', 'Phases', 'Charger', 'Pilot']) {
        expect(screen.getAllByText(label).length).toBeGreaterThan(0);
      }
      for (const value of ['230', '16', '3', 'AC', '32']) {
        expect(screen.getByText(value)).toBeInTheDocument();
      }
      expect(screen.getByText('Charge limit', { exact: false })).toHaveTextContent('80%');
      expect(screen.getByText(`Telemetry sample: ${source.ts}`)).toBeInTheDocument();
      expect(screen.getByText('Individual signal freshness is unavailable.')).toBeInTheDocument();
      expect(flow().querySelectorAll('[data-flow-node]')).toHaveLength(3);
      expect(flow().querySelectorAll('[data-flow-edge].flow-active')).toHaveLength(2);
      for (const value of ['230 V', '11.0 kW', '72%']) {
        expect(within(flow()).getByText(value)).toBeInTheDocument();
      }
      expect(view.container.querySelector('[data-charge-pack="measured"][data-charge-level="72"]')).toBeInTheDocument();
      expect(view.container.querySelector('.widget-cell-stream')).toBeInTheDocument();
      expect(view.container.querySelector('[data-widget-family="charge-flow"] .lucide-plug')).toBeInTheDocument();
      expect(screen.queryByRole('meter')).not.toBeInTheDocument();
      expect(screen.queryByText(/11,000|11000/)).not.toBeInTheDocument();
      expect(mocks.telemetry).toHaveBeenLastCalledWith(7, 5_000);
      fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
      expect(live.refetch).toHaveBeenCalledOnce();

      view.selectPack('classic');
      expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
      expect(screen.queryByText('Charging power')).not.toBeInTheDocument();
      expect(screen.queryByRole('img', { name: 'Charging flow schematic' })).not.toBeInTheDocument();
      for (const label of classicLabels) expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByText('11.0')).toBeInTheDocument();
    });

    it.each([{ cols: 1, rows: 1 }, { cols: 1, rows: 4 }, { cols: 4, rows: 2 }])(
      'keeps the compact/short $cols × $rows source branches and all pack measurements',
      async size => {
        const view = mount('classic', size);
        expect(view.container.querySelector('[data-charge-level="72"]')).toBeInTheDocument();
        if (size.cols === 1) {
          expect(screen.queryByText('Pilot')).not.toBeInTheDocument();
          expect(screen.queryByText('Charger')).not.toBeInTheDocument();
        }
        view.selectPack(packId);
        await expectAppearance(view.container);
        expect(headline(view.container).getByText('11.0')).toBeInTheDocument();
        expect(screen.getByText('Pilot')).toBeInTheDocument();
        expect(screen.getByText('32')).toBeInTheDocument();
        expect(screen.getByText('AC')).toBeInTheDocument();
        expect(flow().querySelectorAll('[data-flow-node]')).toHaveLength(3);
        expect(view.container.querySelector('[data-charge-level="72"]')).toBeInTheDocument();
      },
    );

    it('keeps empty telemetry and every pack section unknown instead of reporting zero or charging', async () => {
      mocks.telemetry.mockReturnValue(query(null));
      const { container } = mount(packId);
      await expectAppearance(container);
      expect(screen.getByText('No charge data')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Unknown' })).toBeInTheDocument();
      expect(headline(container).getByText('—')).toBeInTheDocument();
      expect(headline(container).queryByText('kW')).not.toBeInTheDocument();
      for (const label of ['Voltage', 'Current', 'Phases', 'Pilot']) {
        expect(screen.getByText(label)).toBeInTheDocument();
      }
      expect(container.querySelector('[data-charge-pack="unknown"]')).toBeInTheDocument();
      expect(flow().querySelectorAll('[data-flow-node]')).toHaveLength(3);
      expect(flow().querySelectorAll('.flow-active')).toHaveLength(0);
      expect(container.querySelector('.widget-state-motion')).toBeNull();
      expect(screen.queryByText(/^0(?:\.0)?$/)).not.toBeInTheDocument();
      expect(screen.queryByText('AC')).not.toBeInTheDocument();
      expect(screen.queryByText('DC')).not.toBeInTheDocument();
    });

    it('preserves reported measurements and source time on stale samples and a background failure', async () => {
      const source = telemetry({ ts: new Date(Date.now() - 180_000).toISOString() });
      mocks.telemetry.mockReturnValue(query(source, { isError: true, error: new Error('refresh failed') }));
      const { container } = mount(packId);
      await expectAppearance(container);
      expect(headline(container).getByText('11.0')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Charging · Last reported' })).toBeInTheDocument();
      expect(screen.getByText(`Telemetry sample: ${source.ts}`)).toBeInTheDocument();
      expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
      expect(flow().querySelectorAll('.flow-active')).toHaveLength(0);
      expect(container.querySelector('.widget-state-motion')).toBeNull();
      expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    });

    it('preserves a measured zero without fabricating a flow or dropping its units', async () => {
      mocks.telemetry.mockReturnValue(query(telemetry({
        charger_power_w: 0, charger_voltage: 0, charger_actual_current: 0,
        charger_pilot_current: 0, battery_level: 0,
      })));
      const { container } = mount(packId);
      await expectAppearance(container);
      expect(headline(container).getByText('0.0')).toBeInTheDocument();
      expect(headline(container).getByText('kW')).toBeInTheDocument();
      expect(within(flow()).getByText('0.0 kW')).toBeInTheDocument();
      expect(within(flow()).getByText('0%')).toBeInTheDocument();
      expect(flow().querySelectorAll('.flow-active')).toHaveLength(0);
      expect(container.querySelector('[data-charge-level="0"]')).toBeInTheDocument();
    });

    it('retains reported electrical readings after charging completes without inventing charging activity', async () => {
      mocks.telemetry.mockReturnValue(query(telemetry({ charging_state: 'Complete' })));
      const { container } = mount(packId);
      await expectAppearance(container);
      expect(screen.getByRole('button', { name: 'Not charging' })).toBeInTheDocument();
      expect(screen.getByText('Not currently charging')).toBeInTheDocument();
      expect(headline(container).getByText('11.0')).toBeInTheDocument();
      expect(headline(container).getByText('kW')).toBeInTheDocument();
      expect(screen.getByText('230')).toBeInTheDocument();
      expect(screen.getByText('16')).toBeInTheDocument();
      expect(screen.getByText('32')).toBeInTheDocument();
      expect(container.querySelector('[data-charge-level="72"]')).toBeInTheDocument();
      expect(flow().querySelectorAll('.flow-active')).toHaveLength(0);
      expect(container.querySelector('.widget-state-motion')).toBeNull();
      expect(screen.queryByText('AC')).not.toBeInTheDocument();
      expect(screen.queryByText('DC')).not.toBeInTheDocument();
    });

    it('preserves loading and fatal-error recovery in the shell rather than manufacturing a presentation', () => {
      mocks.telemetry.mockReturnValue(query(undefined, { data: undefined, isLoading: true }));
      const view = mount(packId);
      expect(screen.getByRole('heading', { name: 'Charging telemetry' })).toBeInTheDocument();
      expect(view.container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
      expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();

      const failed = query(undefined, { data: undefined, isError: true, error: new Error('network failed') });
      mocks.telemetry.mockReturnValue(failed);
      view.selectPack(packId);
      expect(screen.getByText("Can't reach server")).toBeInTheDocument();
      expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^Retry/i }));
      expect(failed.refetch).toHaveBeenCalledOnce();
    });

    it('rejects invalid measurements and unknown charging evidence without zero substitution', async () => {
      mocks.telemetry.mockReturnValue(query(telemetry({
        charging_state: null, charger_voltage: Number.NaN, charger_power_w: Number.POSITIVE_INFINITY,
        charger_actual_current: null, charger_phases: null, charger_pilot_current: null,
        battery_level: 101, ts: 'invalid',
      })));
      const { container } = mount(packId);
      await expectAppearance(container);
      expect(headline(container).getByText('—')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Unknown' })).toBeInTheDocument();
      expect(screen.getByText('Telemetry sample: —')).toBeInTheDocument();
      expect(container.querySelector('[data-charge-pack="unknown"]')).toBeInTheDocument();
      expect(container.querySelector('.widget-state-motion')).toBeNull();
      expect(screen.queryByText(/NaN|Infinity|101%/)).not.toBeInTheDocument();
      expect(screen.queryByText(/^0(?:\.0)?$/)).not.toBeInTheDocument();
    });
  },
);

it('retains Classic recovery for an unknown stored pack ID and idle readings', () => {
  mocks.telemetry.mockReturnValue(query(telemetry({ charging_state: 'Complete' })));
  const { container } = mount('retired-pack');
  expect(container.querySelector('[data-widget-pack="classic"]')).toBeInTheDocument();
  expect(container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
  expect(screen.getByText('Not currently charging')).toBeInTheDocument();
  expect(screen.queryByText('Voltage')).not.toBeInTheDocument();
  expect(container.querySelector('.widget-state-motion')).toBeNull();
});
