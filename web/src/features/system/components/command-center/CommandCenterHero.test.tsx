import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { deriveDataState } from '@/api/dataState';
import type { VehicleStateReadings } from '@/api/types';
import { CommandCenterHero } from './CommandCenterHero';

vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, vars?: Record<string, unknown>) => {
      const options = typeof fallback === 'object' ? fallback : vars;
      const text = typeof fallback === 'string' ? fallback : String(options?.defaultValue ?? key);
      return text.replace(/{{(\w+)}}/g, (match, name: string) =>
        options && name in options ? String(options[name]) : match);
    },
    i18n: { language: 'en-US' },
  }),
}));
vi.mock('@/hooks/useSettings', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useSettings')>(),
  useSettings: () => ({ settings: {
    locale: 'en-US', decimal_precision: 2, unit_of_length: 'km', unit_of_temp: 'C',
    unit_of_pressure: 'bar', currency_symbol: '$',
  }, settingsUnavailable: false }),
}));
vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
afterEach(cleanup);

const vehicle = {
  id: 7, vin: '', display_name: 'Selected car', model: 'Model 3',
  state: '', updated_at: '2026-01-01T00:00:00Z',
};
const readings: VehicleStateReadings = {
  vehicle_id: 7, state: null, latitude: null, longitude: null, speed: null, power: null,
  battery_level: 0, rated_range: 400000, ideal_range: null, odometer: null, inside_temp: 21,
  outside_temp: null, is_climate_on: null, is_charging: null, charger_power: null,
  charge_rate: null, time_to_full_charge: null, is_locked: false, sentry_mode: null, software_version: null,
};
const onRetry = vi.fn();
function mount(overrides: Partial<ComponentProps<typeof CommandCenterHero>> = {}) {
  return render(<MemoryRouter><CommandCenterHero
    vehicle={vehicle} state={null} stateTrust={undefined} loading={false}
    error={null} onRetry={onRetry} {...overrides}
  /></MemoryRouter>);
}
function expectShell() {
  expect(screen.getByRole('heading', { name: 'Selected car' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Vehicle state' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Review details' })).toBeEnabled();
  for (const label of ['Battery', 'Estimated range', 'Cabin', 'Access state']) {
    expect(screen.getByText(label)).toBeInTheDocument();
  }
}
function expectNoEmptyOrOffline() {
  expect(screen.queryByText('Live state unavailable')).not.toBeInTheDocument();
  expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
}

describe('CommandCenterHero source truth', () => {
  it('keeps initial paused source distinct from authoritative empty and retries that source', () => {
    const refetch = vi.fn();
    mount({ dataState: deriveDataState({
      isPending: true, isLoading: false, fetchStatus: 'paused', refetch,
    }, { provenance: 'live' }) });
    expectShell();
    expectNoEmptyOrOffline();
    expect(screen.getAllByText(/Refresh paused/).length).toBeGreaterThan(0);
    expect(screen.getByText('No requested source has returned usable data yet.')).toBeInTheDocument();
    expect(screen.getByTestId('command-center-hero')).toHaveAttribute('data-source-provenance', 'unknown');
    expect(screen.getByLabelText('Unknown source')).toBeInTheDocument();
    expect(screen.getByTestId('command-center-hero')).toHaveAttribute('data-refresh-blocked', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources: Vehicle state' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('keeps omitted query metadata unresolved instead of inventing empty or offline', () => {
    mount();
    expectShell();
    expectNoEmptyOrOffline();
    expect(screen.getByText('Pending · Unknown')).toBeInTheDocument();
    expect(screen.getByTestId('command-center-hero')).toHaveAttribute('data-source-status', 'initial');
    expect(screen.getByTestId('command-center-hero')).toHaveAttribute('data-source-provenance', 'unknown');
  });

  it('preserves first-load skeletons without presenting fabricated metrics', () => {
    const { container } = mount({ loading: true });
    expectShell();
    expectNoEmptyOrOffline();
    expect(screen.getByRole('region', { name: 'Vehicle state' })).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(0);
  });

  it('shows empty telemetry only after a resolved source and preserves the review action', () => {
    mount({ dataState: deriveDataState({ data: null, isSuccess: true }, {
      provenance: 'live', unavailable: true,
    }) });
    expectShell();
    expect(screen.getByText('Live state unavailable')).toBeInTheDocument();
    expect(screen.getByText('No source data · Unknown')).toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByTestId('command-center-hero')).toHaveAttribute('data-source-status', 'unavailable');
  });

  it('keeps a genuine initial failure local with its retry and unknown readings', () => {
    const refetch = vi.fn();
    const { container } = mount({ dataState: deriveDataState({
      error: new Error('state request failed'), isError: true, refetch,
    }) });
    expectShell();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-value-state="missing"]')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledOnce();
    expectNoEmptyOrOffline();
  });

  it('retains readings and a single nonblocking retry through a refresh failure', () => {
    const refetch = vi.fn();
    const { container } = mount({
      state: readings, error: new Error('refresh failed'),
      dataState: deriveDataState({ data: readings, error: new Error('refresh failed'), refetch }, {
        provenance: 'live',
      }),
    });
    expectShell();
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByTestId('command-center-hero')).toHaveAttribute('data-source-provenance', 'cached');
    expect(screen.getByLabelText('Cached')).toBeInTheDocument();
    expect(container.querySelector('[data-operational-metric="range"] [data-operational-value]')).toHaveTextContent('400 km');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('retains paused readings without an invented error, offline state, or active loading', () => {
    mount({ state: readings, dataState: deriveDataState({
      data: readings, fetchStatus: 'paused',
    }, { provenance: 'live' }) });
    expectShell();
    expectNoEmptyOrOffline();
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Vehicle state' })).not.toHaveAttribute('aria-busy');
    expect(screen.getByTestId('command-center-hero')).toHaveAttribute('data-source-provenance', 'cached');
  });

  it('preserves measured zero, false access, SI display, and details evidence', () => {
    const { container } = mount({ state: readings });
    expectShell();
    expect(container.querySelector('[data-operational-metric="battery"] [data-operational-value]')).toHaveTextContent('0.00%');
    expect(container.querySelector('[data-operational-metric="range"] [data-operational-value]')).toHaveTextContent('400 km');
    expect(container.querySelector('[data-operational-metric="cabin"] [data-operational-value]')).toHaveTextContent('21°C');
    expect(container.querySelector('[data-operational-metric="access"] [data-operational-value]')).toHaveTextContent('Unlocked');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const dialog = screen.getByRole('dialog', { name: 'Vehicle state details' });
    expect(within(dialog).getByText('400 km')).toBeInTheDocument();
    expect(within(dialog).getAllByText(/Battery, estimated range, cabin temperature/).length).toBeGreaterThan(0);
  });

  it('keeps missing readings unknown rather than zero or OFF and never invents signal time', () => {
    const { container } = mount({ state: {
      ...readings, battery_level: null, rated_range: null, inside_temp: null, is_locked: null,
    } });
    expectShell();
    expect(container.querySelectorAll('[data-value-state="missing"]')).toHaveLength(4);
    expect(screen.queryByText('0.00%')).not.toBeInTheDocument();
    expect(screen.queryByText('Locked')).not.toBeInTheDocument();
    expect(screen.queryByText('Unlocked')).not.toBeInTheDocument();
    expect(screen.getAllByText('No verified signal time').length).toBeGreaterThan(0);
  });

  it('uses static semantic cues for genuinely verified online state without decoration or pulse', () => {
    const observedAt = Date.now();
    const { container } = mount({
      state: { ...readings, state: 'online' },
      stateTrust: { observedAt, freshness: 'fresh', verifiedFields: ['state'] },
      dataState: deriveDataState({ data: readings }, { provenance: 'live' }),
    });
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(container.querySelector('[class*="animate-pulse"]')).not.toBeInTheDocument();
    expect(container.querySelector('[class*="bg-gradient"]')).not.toBeInTheDocument();
    expect(container.querySelector('[class*="bg-[var(--semantic-success)]"]')).toBeInTheDocument();
    expect(screen.getAllByText(/Last signal/).length).toBeGreaterThan(0);
  });

  it.each(['historical', 'inferred', 'repaired', 'unknown'] as const)(
    'preserves %s provenance without promoting it to current online state',
    provenance => {
      mount({
        state: { ...readings, state: 'online' },
        stateTrust: { observedAt: Date.now(), freshness: 'fresh', verifiedFields: ['state'] },
        dataState: deriveDataState({ data: readings }, { provenance }),
      });
      expectShell();
      expect(screen.getByTestId('command-center-hero')).toHaveAttribute('data-source-provenance', provenance);
      expect(screen.getByLabelText({
        historical: 'Historical', inferred: 'Estimated', repaired: 'Repaired', unknown: 'Unknown source',
      }[provenance])).toBeInTheDocument();
      expect(screen.getByText('Last known: Online')).toBeInTheDocument();
      expect(screen.queryByText('Online')).not.toBeInTheDocument();
    },
  );
});
