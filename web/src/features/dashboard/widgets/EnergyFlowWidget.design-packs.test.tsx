import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VehicleStateReadings } from '@/api/types';
import type { useVehicleState } from '@/api/hooks/useVehicles';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, type PackId } from './designPacks/types';
import type { WidgetSize } from './types';
import EnergyFlowWidget from './EnergyFlowWidget';

const mocks = vi.hoisted(() => ({ vehicles: vi.fn(), state: vi.fn() }));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => mocks.vehicles(),
  useVehicleState: (...args: unknown[]) => mocks.state(...args),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
    },
    i18n: { language: 'en', dir: () => 'ltr' },
  }),
}));
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: { unit_of_length: 'km', locale: 'en-US' } }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: false, durationMs: 250 }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatTime: (value: unknown) => String(value),
    formatDateTime: (value: unknown) => String(value),
    tz: 'UTC',
  }),
}));

type StateEnvelope = NonNullable<ReturnType<typeof useVehicleState>['data']>;

function snapshot(
  overrides: Partial<VehicleStateReadings> = {},
  evidence: Partial<Omit<StateEnvelope, 'state'>> = {},
): StateEnvelope {
  return {
    state: {
      vehicle_id: 9, state: 'online', latitude: null, longitude: null,
      speed: null, power: 12_300, battery_level: 72, rated_range: null,
      ideal_range: null, odometer: null, inside_temp: null, outside_temp: null,
      is_climate_on: null, is_charging: false, charger_power: null,
      charge_rate: null, time_to_full_charge: null, is_locked: null,
      sentry_mode: null, software_version: null, ...overrides,
    },
    live: true,
    observedAt: Date.now(),
    freshness: 'fresh',
    verifiedFields: ['power', 'battery_level', 'is_charging', 'charger_power'],
    ...evidence,
  };
}

function query<T>(data: T, overrides: {
  isLoading?: boolean; isFetching?: boolean; isError?: boolean; isStale?: boolean;
  error?: Error; refetch?: () => void; dataUpdatedAt?: number;
} = {}) {
  return {
    data, isLoading: false, isFetching: false, isError: false, isStale: false,
    error: null, dataUpdatedAt: Date.now(), refetch: vi.fn(), ...overrides,
  };
}

function mount(pack: PackId = 'classic', size: WidgetSize = { cols: 2, rows: 3 }, vehicleId: number | undefined = 9) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (requestedPackId: PackId) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={requestedPackId}>
          <EnergyFlowWidget size={size} vehicleId={vehicleId} config={{ vehicleId: 7 }} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(pack));
  return { ...view, selectPack: (next: PackId) => view.rerender(tree(next)) };
}

function diagram() {
  return screen.getByRole('img', { name: /^Energy flow:/ });
}

function expectedPackDiagram(classic: string, appearance: string) {
  const expected = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  expected.innerHTML = classic;
  const circular = appearance === 'owner' || appearance === 'iconic';
  for (const node of expected.querySelectorAll<SVGRectElement>('[data-flow-node]')) {
    if (circular) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('data-flow-node', node.getAttribute('data-flow-node')!);
      circle.setAttribute('cx', String(Number(node.getAttribute('x')) + 48));
      circle.setAttribute('cy', String(Number(node.getAttribute('y')) + 34));
      circle.setAttribute('r', '34');
      circle.setAttribute('class', node.getAttribute('class')!);
      circle.setAttribute('stroke-width', node.getAttribute('stroke-width')!);
      node.replaceWith(circle);
    } else {
      node.setAttribute('rx', appearance === 'pixel' ? '0' : appearance === 'precision' ? '3'
        : appearance === 'elevated' ? '18' : appearance === 'expressive' ? '14' : '10');
    }
  }
  if (circular) for (const caption of expected.querySelectorAll('foreignObject')) {
    caption.setAttribute('x', String(Number(caption.getAttribute('x')) + 14));
    caption.setAttribute('width', '58');
  }
  return expected.innerHTML;
}

function headline(container: HTMLElement) {
  const node = container.querySelector<HTMLElement>('.widget-big-number');
  expect(node).toBeInTheDocument();
  return within(node!);
}

beforeEach(() => {
  mocks.vehicles.mockReset().mockReturnValue(query([{ id: 7 }, { id: 9 }]));
  mocks.state.mockReset().mockReturnValue(query(snapshot()));
});

describe.each(Object.entries(PACK_APPEARANCES) as [Exclude<PackId, 'classic'>, string][])(
  'Energy flow — %s / %s',
  (id, appearance) => {
    async function expectAppearance(container: HTMLElement) {
      await waitFor(() => expect(container.querySelector(
        `[data-widget-family="flow"][data-widget-appearance="${appearance}"]`,
      )).toBeInTheDocument());
    }

    it('recomposes the real Classic flow and reading, keeps refresh and selected vehicle, and returns to Classic', async () => {
      const refetch = vi.fn();
      mocks.state.mockReturnValue(query(snapshot(), { refetch }));
      const view = mount();
      const classicDiagram = diagram().innerHTML;
      expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
      expect(view.container.querySelector('.widget-big-number')).not.toBeInTheDocument();

      view.selectPack(id);
      await expectAppearance(view.container);
      expect(screen.getByRole('heading', { name: 'Energy flow' })).toBeInTheDocument();
      expect(diagram().innerHTML).toBe(expectedPackDiagram(classicDiagram, appearance));
      expect(diagram().querySelectorAll('[data-flow-node]')).toHaveLength(3);
      expect(diagram().querySelectorAll('[data-flow-edge].flow-active')).toHaveLength(1);
      expect(diagram()).toHaveAccessibleName(/Battery → Consuming 12\.3 kW/);
      for (const label of ['Wall connector', 'Battery', 'Consuming', '72%', '12.3 kW']) {
        expect(within(diagram()).getByText(label)).toBeInTheDocument();
      }
      expect(headline(view.container).getByText('12.3 kW')).toBeInTheDocument();
      expect(headline(view.container).getByText('Consuming')).toBeInTheDocument();
      expect(view.container.querySelector('[data-provenance="live"]')).toBeInTheDocument();
      expect(screen.queryByRole('meter')).not.toBeInTheDocument();
      if (id === 'v7') {
        expect(view.container.querySelector('[data-widget-family="flow"] .lucide-activity')).toBeInTheDocument();
      }

      fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
      expect(refetch).toHaveBeenCalledOnce();
      expect(mocks.state).toHaveBeenLastCalledWith(9, { refetchInterval: 5000 });
      view.selectPack('classic');
      expect(view.container.querySelector('[data-widget-family]')).not.toBeInTheDocument();
      expect(view.container.querySelector('.widget-big-number')).not.toBeInTheDocument();
      expect(diagram().innerHTML).toBe(classicDiagram);
    });

    it('keeps all three nodes and the measured charging link in a compact allocation', async () => {
      // The current vehicle-state endpoint reports charger_power in kW; retain
      // its original display-boundary conversion rather than changing the wire contract.
      mocks.state.mockReturnValue(query(snapshot({ power: 0, is_charging: true, charger_power: 14 })));
      const { container } = mount(id, { cols: 1, rows: 1 });
      await expectAppearance(container);
      expect(diagram().querySelectorAll('[data-flow-node]')).toHaveLength(3);
      expect(diagram().querySelectorAll('[data-flow-edge]')).toHaveLength(3);
      expect(diagram().querySelectorAll('[data-flow-edge].flow-active')).toHaveLength(1);
      expect(diagram()).toHaveAccessibleName(/Wall connector → Battery 14\.0 kW/);
      expect(within(diagram()).getByText('72%')).toBeInTheDocument();
      expect(headline(container).getByText('Wall connector')).toBeInTheDocument();
      expect(headline(container).getByText('14.0 kW')).toBeInTheDocument();
      expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    });

    it('preserves reverse regeneration and distinguishes a measured zero from unknown power', async () => {
      mocks.state.mockReturnValue(query(snapshot({ power: -8_500 })));
      const view = mount(id);
      await expectAppearance(view.container);
      expect(diagram()).toHaveAccessibleName(/Regenerating → Battery 8\.5 kW/);
      expect(diagram().querySelectorAll('[data-flow-edge].flow-active')).toHaveLength(1);
      expect(headline(view.container).getByText('Regenerating')).toBeInTheDocument();
      expect(headline(view.container).getByText('8.5 kW')).toBeInTheDocument();

      mocks.state.mockReturnValue(query(snapshot({ power: 0, battery_level: 0 })));
      view.selectPack(id);
      expect(headline(view.container).getByText('0.0 kW')).toBeInTheDocument();
      expect(within(diagram()).getByText('Car (Idle)')).toBeInTheDocument();
      expect(within(diagram()).getByText('0%')).toBeInTheDocument();
      expect(diagram().querySelectorAll('[data-flow-edge].flow-active')).toHaveLength(0);
    });

    it('keeps unverified, missing and invalid readings unknown without fabricating idle flow', async () => {
      mocks.state.mockReturnValue(query(snapshot({
        power: 0, battery_level: 0, is_charging: true, charger_power: 14,
      }, { verifiedFields: [] })));
      const view = mount(id);
      await expectAppearance(view.container);
      expect(headline(view.container).getByText('Unknown')).toBeInTheDocument();
      expect(headline(view.container).getByText('—')).toBeInTheDocument();
      expect(within(diagram()).getByText('—')).toBeInTheDocument();
      expect(within(diagram()).getByText('Unknown')).toBeInTheDocument();
      expect(screen.queryByText('0.0 kW')).not.toBeInTheDocument();
      expect(screen.queryByText('0%')).not.toBeInTheDocument();
      expect(diagram().querySelectorAll('[data-flow-edge].flow-active')).toHaveLength(0);
      expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'partial');

      for (const readings of [
        { power: null, battery_level: null, charger_power: null },
        { power: Number.NaN, battery_level: 101, charger_power: -14 },
      ]) {
        mocks.state.mockReturnValue(query(snapshot({ ...readings, is_charging: true })));
        view.selectPack(id);
        expect(headline(view.container).getByText('Wall connector')).toBeInTheDocument();
        expect(headline(view.container).getByText('—')).toBeInTheDocument();
        expect(within(diagram()).getByText('—')).toBeInTheDocument();
        expect(diagram().querySelectorAll('[data-flow-edge].flow-active')).toHaveLength(0);
        expect(screen.queryByText('0.0 kW')).not.toBeInTheDocument();
        expect(screen.queryByText('101%')).not.toBeInTheDocument();
        expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'partial');
      }
    });

    it('shows the empty source shell without a fabricated headline or flow', async () => {
      mocks.state.mockReturnValue(query(undefined));
      const { container } = mount(id);
      await expectAppearance(container);
      expect(screen.getByRole('heading', { name: 'Energy flow' })).toBeInTheDocument();
      expect(screen.getByText('No energy data available')).toBeInTheDocument();
      expect(screen.queryByRole('img', { name: /^Energy flow:/ })).not.toBeInTheDocument();
      expect(container.querySelector('.widget-big-number')).not.toBeInTheDocument();
      expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    });

    it('retains cached measurements, source warnings and motion suppression during a failed refresh', async () => {
      const refetch = vi.fn();
      mocks.state.mockReturnValue(query(snapshot({}, { live: false, freshness: 'stale' }), {
        error: new Error('Refresh failed'), isError: true, isFetching: true, refetch,
      }));
      const { container, selectPack } = mount(id);
      await expectAppearance(container);
      expect(headline(container).getByText('12.3 kW')).toBeInTheDocument();
      expect(within(diagram()).getByText('72%')).toBeInTheDocument();
      expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
      expect(container.querySelector('[data-provenance="cached"]')).toHaveAttribute('data-data-status', 'stale');
      expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', 'true');
      expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-motion-suppressed', 'true');
      expect(container.querySelector('.widget-flow-frame')).toHaveAttribute('data-motion-suppressed', 'true');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      const refresh = screen.getByRole('button', { name: /^Refresh/i });
      expect(refresh).toBeDisabled();
      fireEvent.click(refresh);
      expect(refetch).not.toHaveBeenCalled();

      mocks.state.mockReturnValue(query(snapshot({}, { live: false, freshness: 'stale' }), {
        error: new Error('Refresh failed'), isError: true, refetch,
      }));
      selectPack(id);
      expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', 'false');
      fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
      expect(refetch).toHaveBeenCalledOnce();
    });

    it('keeps initial loading and fatal retry distinct from an empty successful source', () => {
      mocks.state.mockReturnValue(query(undefined, { isLoading: true, isFetching: true, dataUpdatedAt: 0 }));
      const view = mount(id);
      expect(view.container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryByText('No energy data available')).not.toBeInTheDocument();
      expect(screen.queryByRole('img', { name: /^Energy flow:/ })).not.toBeInTheDocument();

      const refetch = vi.fn();
      mocks.state.mockReturnValue(query(undefined, {
        error: new Error('Vehicle state unavailable'), isError: true, dataUpdatedAt: 0, refetch,
      }));
      view.selectPack(id);
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.queryByText('No energy data available')).not.toBeInTheDocument();
      expect(screen.queryByRole('img', { name: /^Energy flow:/ })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^Retry$/i }));
      expect(refetch).toHaveBeenCalledOnce();
    });
  },
);
