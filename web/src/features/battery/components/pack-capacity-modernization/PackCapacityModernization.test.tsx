/**
 * AUTHORED / NOT RUN. Parent owns serialized runtime/application acceptance.
 * Real router, data-state, science, shared stats, tables, modals and chart frames.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps, ReactNode } from 'react';

import { ToastProvider } from '@/components/feedback';
import { Text } from '@/components/ui';
import { MockResizeObserver } from '@/test/setup';
import type { ChargingSession } from '@/types/charging';
import PackCapacityPage from '../../pages/PackCapacityPage';

const NOW = Date.parse('2026-08-08T12:00:00Z');
const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  query: {} as Record<string, unknown>,
  energy: 'kWh' as 'Wh' | 'kWh',
  refetch: vi.fn(),
  hook: vi.fn(),
}));

vi.mock('@/api/hooks/useCharging', async importOriginal => {
  const actual = await importOriginal<typeof import('@/api/hooks/useCharging')>();
  return {
    ...actual,
    useChargingHistory: (vehicleId?: string, limit?: number) => {
      h.hook(vehicleId, limit);
      return h.query;
    },
  };
});
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: h.vehicleId }),
}));
vi.mock('@/lib/timezone', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/timezone')>(),
  useTimezone: () => 'America/Los_Angeles',
}));
vi.mock('@/hooks/useUnits', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useUnits')>();
  const units = await vi.importActual<typeof import('@/lib/unitConversion')>('@/lib/unitConversion');
  return {
    ...actual,
    useUnits: () => {
      const base = actual.useUnits();
      const unitPrefs = {
        distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
        energy: h.energy, duration: 'h', power: 'kW', locale: 'en-US', precision: 2,
      } as const;
      return {
        ...base,
        unitPrefs,
        formatEnergy: (value: number | null | undefined, options?: { precision?: number }) =>
          units.formatEnergy(value, unitPrefs, options),
      };
    },
  };
});
vi.mock('@/components/motion', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  return {
    ...actual,
    FadeIn: ({ children }: ComponentProps<typeof actual.FadeIn>) => <>{children}</>,
  };
});

function history(): ChargingSession[] {
  return Array.from({ length: 14 }, (_, index) => {
    const end = new Date(Date.UTC(2025, 4 + index, 15, 20)).toISOString();
    const start = new Date(Date.parse(end) - 7_200_000).toISOString();
    return {
      id: String(index + 1), vehicle_id: '7', charger_type: 'AC',
      start_soc_pct: 20, end_soc_pct: 60,
      total_energy_added_wh: (76_000 - index * 120) * 0.4,
      peak_power_w: 11_000, cost_decimal: null,
      started_at: start, ended_at: end, start_ts: start, startedAt: start,
      duration_min: 120,
    };
  });
}

function setQuery(overrides: Record<string, unknown> = {}): void {
  h.query = {
    data: history(), isLoading: false, isPending: false, isFetching: false,
    isSuccess: true, isError: false, error: null, fetchStatus: 'idle',
    dataUpdatedAt: NOW, refetch: h.refetch,
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <Text data-testid="pack-capacity-location">{location.pathname}{location.search}</Text>;
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function tree(): ReactNode {
    return (
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/pack-capacity?scope=retained']}>
            <PackCapacityPage />
            <LocationProbe />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );
  }
  const view = render(tree());
  return { ...view, rerenderPage: () => view.rerender(tree()) };
}

const sectionIds = [
  'kpis', 'estimate-timeline', 'month-trend', 'soc-window-profile',
  'window-sensitivity', 'process-sensitivity', 'innovation-profile',
  'influence-timeline', 'fit-diagnostics', 'directory', 'coverage',
  'evidence-support', 'accounting', 'methodology',
] as const;
function allShells(): void {
  for (const id of sectionIds) expect(screen.getByTestId(`pack-capacity-${id}`)).toBeInTheDocument();
}

beforeEach((): void => {
  vi.clearAllMocks();
  h.vehicleId = 7;
  h.energy = 'kWh';
  localStorage.clear();
  setQuery();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach((): void => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function phoneContainer(): void {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    x: 0, y: 0, left: 0, top: 0, right: 390, bottom: 300, width: 390, height: 300,
    toJSON: () => ({}),
  }));
  class PhoneObserver extends MockResizeObserver {
    override observe(target: Element): void {
      super.observe(target);
      this.trigger(target);
    }
  }
  vi.stubGlobal('ResizeObserver', PhoneObserver);
}

describe('Pack Capacity source modernization (NOT RUN)', () => {
  it('opens the real source review drawer with posterior uncertainty and no fabricated model confidence', () => {
    const raw = history();
    const before = JSON.stringify(raw);
    setQuery({ data: raw });
    mount();
    const kpis = screen.getByTestId('pack-capacity-kpis');
    const uncertainty = within(kpis).getByText('Filter uncertainty').closest('[data-operational-metric]');
    expect(uncertainty).toHaveAttribute('data-value-state', 'value');
    expect(uncertainty?.querySelector('[data-operational-value]')).toHaveTextContent('±');
    fireEvent.click(within(kpis).getByRole('button', { name: 'Review details' }));
    const drawer = within(screen.getByRole('dialog'));
    expect(drawer.getByText('one sigma under selected assumptions')).toBeVisible();
    expect(drawer.getByText('descriptive ratio, not state of health')).toBeVisible();
    expect(drawer.getByText(/not a lifetime record or a battery-health measurement/, {
      selector: '[data-drawer-header] p',
    })).toBeVisible();
    expect(drawer.getByText('Not scored')).toBeVisible();
    expect(JSON.stringify(raw)).toBe(before);
  });

  it('retains fourteen ordered sections, capped hook, genuine business controls and shared stats', () => {
    mount();
    allShells();
    expect(h.hook).toHaveBeenLastCalledWith('7', 1_000);
    const kpis = screen.getByTestId('pack-capacity-kpis');
    expect(kpis.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(screen.getByRole('combobox', { name: 'Minimum SoC window' })).toHaveAttribute('id', 'pack-capacity-soc-window');
    expect(screen.getByRole('combobox', { name: 'Process uncertainty' })).toHaveAttribute('id', 'pack-capacity-process-noise');
    expect(within(kpis).getByText('Current estimate')).toBeInTheDocument();
    expect(within(kpis).getByText('Raw median')).toBeInTheDocument();
    expect(within(kpis).getByText('descriptive ratio, not state of health', {
      selector: '[data-battery-detail-context]',
    })).toBeInTheDocument();
  });

  it('recomputes both model assumptions without replacing the persistent router', () => {
    const view = mount();
    fireEvent.change(screen.getByRole('combobox', { name: 'Minimum SoC window' }), { target: { value: '40' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Process uncertainty' }), { target: { value: '60' } });
    setQuery({ data: [...history()] });
    vi.mocked(Date.now).mockReturnValue(NOW + 30 * 86_400_000);
    view.rerenderPage();
    const method = within(screen.getByTestId('pack-capacity-methodology'));
    expect(method.getByText(/selected 40 percentage points/i)).toBeInTheDocument();
    expect(method.getByText(/60 Wh per square-root day/i)).toBeInTheDocument();
    expect(screen.getByTestId('pack-capacity-location')).toHaveTextContent('/pack-capacity?scope=retained');
  });

  it('keeps shells for loading and never-selected scope, without assigning fake zero estimates', () => {
    setQuery({ data: undefined, isLoading: true, isPending: true, isFetching: true, isSuccess: false, fetchStatus: 'fetching' });
    const view = mount();
    allShells();
    expect(screen.getByRole('status', { name: 'Loading Pack Capacity evidence' })).toBeInTheDocument();
    h.vehicleId = null;
    view.rerenderPage();
    allShells();
    expect(h.hook).toHaveBeenLastCalledWith(undefined, 1_000);
    expect(within(screen.getByTestId('pack-capacity-kpis')).getAllByText('—')).toHaveLength(6);
    expect(screen.getByText('Select a vehicle to analyze its returned charging history.')).toBeInTheDocument();
  });

  it('uses friendly initial-failure copy and retries only charging history', () => {
    setQuery({ data: undefined, isError: true, isSuccess: false, error: new Error('private transport diagnostic') });
    mount();
    allShells();
    const error = within(screen.getByTestId('pack-capacity-initial-error'));
    expect(error.getByText('Check your internet connection and try again.')).toBeInTheDocument();
    expect(error.queryByText('private transport diagnostic')).not.toBeInTheDocument();
    fireEvent.click(error.getByRole('button', { name: 'Retry' }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it('retains estimates and directory through failed then paused refreshes', () => {
    const view = mount();
    const before = screen.getByTestId('pack-capacity-kpis').querySelector('[data-operational-value]')?.textContent;
    setQuery({ isError: true, isSuccess: false, error: new Error('refresh diagnostic') });
    view.rerenderPage();
    allShells();
    expect(screen.getByTestId('pack-capacity-kpis').querySelector('[data-operational-value]')?.textContent).toBe(before);
    expect(screen.getByText('Charging history could not refresh. Showing the most recently loaded evidence.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
    setQuery({ fetchStatus: 'paused' });
    view.rerenderPage();
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('The latest values are temporarily unavailable. Previously loaded data remains visible.');
    expect(screen.getByTestId('pack-capacity-kpis').querySelector('[data-operational-value]')?.textContent).toBe(before);
    fireEvent.click(within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Refresh' }));
    expect(h.refetch).toHaveBeenCalledTimes(2);
  });

  it('distinguishes initial offline pause from empty success and fit ineligibility', () => {
    setQuery({ data: undefined, isLoading: false, isPending: true, isSuccess: false, fetchStatus: 'paused' });
    const view = mount();
    allShells();
    expect(screen.getByText('Charging history is paused while the device is offline. No charging evidence has loaded yet.')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading Pack Capacity evidence' })).not.toBeInTheDocument();
    setQuery({ data: [] });
    view.rerenderPage();
    allShells();
    expect(screen.getByText('No charging history was returned for this vehicle.')).toBeInTheDocument();
    expect(screen.getByText('0 returned = 0 included + 0 excluded. Missing completion times are never synthesized, and missing SoC or energy is never imputed.')).toBeInTheDocument();
    const annual = within(screen.getByTestId('pack-capacity-kpis'))
      .getByText('Annualized linear change').closest('[data-operational-metric]');
    expect(annual).toHaveTextContent('Needs at least 12 measurements');
  });

  it('retains the real figure and its CSV/image menu, without inventing omitted fullscreen or annotation controls', () => {
    mount();
    const figure = within(screen.getByRole('figure', { name: 'Capacity estimate timeline' }));
    expect(figure.getByRole('group', { name: 'Timeline of raw and filtered capacity estimates' })).toBeInTheDocument();
    fireEvent.click(figure.getByRole('button', { name: 'Export chart' }));
    expect(figure.getByRole('menuitem', { name: /CSV/i })).toBeInTheDocument();
    expect(figure.getByRole('menuitem', { name: /PNG/i })).toBeInTheDocument();
    expect(figure.getByRole('menuitem', { name: /SVG/i })).toBeInTheDocument();
    expect(figure.queryByRole('button', { name: 'Enter fullscreen' })).not.toBeInTheDocument();
    expect(figure.queryByRole('button', { name: /Add annotation/i })).not.toBeInTheDocument();
  });

  it('opens real mobile directory details with all nine fields in the actual formatted unit', () => {
    phoneContainer();
    const view = mount();
    const directory = within(screen.getByTestId('pack-capacity-directory'));
    fireEvent.click(directory.getAllByRole('button', { name: 'Quick view' })[0]!);
    const modal = within(screen.getByRole('dialog'));
    for (const label of ['Completed', 'SoC gain', 'Energy added', 'Raw capacity', 'Filtered', 'Posterior sigma', 'Gain', 'Std. innovation', 'Location']) {
      expect(modal.getByText(label)).toBeInTheDocument();
    }
    const raw = modal.getByText('Raw capacity').parentElement;
    expect(raw).toHaveTextContent('74.44 kWh');
    h.energy = 'Wh';
    view.rerenderPage();
    expect(raw).toHaveTextContent('74,440.00 Wh');
    const footer = screen.getByRole('dialog').querySelector('[data-modal-footer]');
    expect(footer).not.toBeNull();
    fireEvent.click(within(footer as HTMLElement).getByRole('button', { name: 'Close', exact: true }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps all accounting categories and returned share in mobile details', () => {
    phoneContainer();
    mount();
    const accounting = within(screen.getByTestId('pack-capacity-accounting'));
    expect(accounting.getAllByRole('button', { name: 'Quick view' })).toHaveLength(14);
    fireEvent.click(accounting.getAllByRole('button', { name: 'Quick view' })[0]!);
    const modal = within(screen.getByRole('dialog'));
    expect(modal.getByText('Primary category')).toBeInTheDocument();
    expect(modal.getByText('Rows')).toBeInTheDocument();
    expect(modal.getByText('Returned share')).toBeInTheDocument();
    expect(modal.getByText('100%')).toBeInTheDocument();
    const footer = screen.getByRole('dialog').querySelector('[data-modal-footer]');
    expect(footer).not.toBeNull();
    fireEvent.click(within(footer as HTMLElement).getByRole('button', { name: 'Close', exact: true }));
  });
});
