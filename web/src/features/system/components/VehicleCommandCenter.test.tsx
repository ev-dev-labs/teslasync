import type { ReactNode } from 'react';
vi.mock('@/hooks/useSettings', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useSettings')>(),
  useSettings: () => ({ settings: { locale: 'en-US', decimal_precision: 2, currency_symbol: '$', unit_of_length: 'km', unit_of_temp: 'C' }, settingsUnavailable: false }),
}));
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback';
import { commandKeys, type CommandLogEntry } from '@/api/hooks/useCommands';
import { vehicleKeys } from '@/api/hooks/useVehicles';
import { telemetryKeys, type VehicleLiveSignalsResponse } from '@/api/hooks/useTelemetry';
import {
  assertOperationalBriefDisclosure,
  assertOperationalMetricUnavailable,
} from '@/test/operationalBriefAssertions';
import type { Vehicle, VehicleState } from '../commands';
import {
  CATEGORY_META,
  COMMANDS,
} from '../commands';

const operationalModeState = vi.hoisted(() => ({
  canWrite: true,
}));

vi.mock('@/hooks/useOperationalMode', () => ({
  useOperationalMode: () => ({
    mode: operationalModeState.canWrite ? 'live' : 'as_of',
    asOf: operationalModeState.canWrite
      ? null
      : '2026-02-19T00:00:00.000Z',
    online: true,
    isReadOnly: !operationalModeState.canWrite,
    canWrite: operationalModeState.canWrite,
    label: operationalModeState.canWrite ? 'Live' : 'As of',
    description: 'Historical state',
    writeBlockReason: operationalModeState.canWrite
      ? null
      : 'Return to live mode before making operational changes.',
  }),
}));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>(
    '@/api/client',
  );
  return { ...actual, request: vi.fn() };
});

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>(
    'react-i18next',
  );
  const interpolate = (
    template: string,
    values?: Record<string, unknown>,
  ): string =>
    values
      ? template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) =>
          String(values[key] ?? `{{${key}}}`),
        )
      : template;
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, options?: unknown) => {
        if (typeof fallback === 'string') {
          return interpolate(
            fallback,
            options && typeof options === 'object'
              ? options as Record<string, unknown>
              : undefined,
          );
        }
        if (fallback && typeof fallback === 'object') {
          const values = fallback as Record<string, unknown>;
          return typeof values.defaultValue === 'string'
            ? interpolate(values.defaultValue, values)
            : key;
        }
        return key;
      },
      i18n: { language: 'en' },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import { request } from '@/api/client';
import { VehicleCommandCenter } from './VehicleCommandCenter';

const requestMock = request as unknown as ReturnType<typeof vi.fn>;
const VEHICLE_ID = 42;

type RequestCall = [string, RequestInit?];

let stateResponse: unknown;
let stateError: Error | null;
let latestEntries: CommandLogEntry[];
let latestError: Error | null;
let commandResponse: () => Promise<unknown>;
let capabilityResponse: VehicleLiveSignalsResponse;

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: VEHICLE_ID,
    vin: '5YJ3E1EA7KF000000',
    display_name: 'My Tesla',
    model: 'Model 3',
    state: 'online',
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeState(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicle_id: VEHICLE_ID,
    state: 'online',
    battery_level: 85,
    rated_range: 400_000,
    is_locked: true,
    is_charging: false,
    is_climate_on: false,
    sentry_mode: false,
    inside_temp: 21,
    speed: 0,
    ...overrides,
  };
}

function installRequestRouter() {
  requestMock.mockImplementation((url: string, options?: RequestInit) => {
    if (url === `/vehicles/${VEHICLE_ID}/state`) {
      return stateError ? Promise.reject(stateError) : Promise.resolve(stateResponse);
    }
    if (url === `/vehicles/${VEHICLE_ID}/commands/latest`) {
      return latestError ? Promise.reject(latestError) : Promise.resolve(latestEntries);
    }
    if (url === `/signals/${VEHICLE_ID}/live`) {
      return Promise.resolve(capabilityResponse);
    }
    if (
      url === `/vehicles/${VEHICLE_ID}/command` &&
      options?.method === 'POST'
    ) {
      return commandResponse();
    }
    return Promise.reject(new Error(`Unexpected request: ${url}`));
  });
}

function renderCenter(vehicle: Vehicle = makeVehicle()) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/commands']}>
        <ToastProvider>
          <VehicleCommandCenter vehicle={vehicle} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...rendered, queryClient };
}

function searchFor(value: string) {
  fireEvent.change(screen.getByLabelText('Search commands'), {
    target: { value },
  });
}

function postCalls(): RequestCall[] {
  return (requestMock.mock.calls as RequestCall[]).filter(
    ([, options]) => options?.method === 'POST',
  );
}

function lastPostBody(): Record<string, unknown> {
  const calls = postCalls();
  const call = calls[calls.length - 1];
  return JSON.parse(String(call?.[1]?.body ?? '{}')) as Record<string, unknown>;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  requestMock.mockReset();
  operationalModeState.canWrite = true;
  stateResponse = { state: makeState(), live: true };
  stateError = null;
  latestEntries = [];
  latestError = null;
  commandResponse = () => Promise.resolve({ success: true, result: 'success' });
  capabilityResponse = { vehicle_id: VEHICLE_ID, signals: {} };
  installRequestRouter();
});

describe('VehicleCommandCenter — summary and readiness', () => {
  it('passes actual initial paused query state to the Hero without inventing empty telemetry', async () => {
    onlineManager.setOnline(false);
    try {
      renderCenter();
      const hero = screen.getByTestId('command-center-hero');
      await waitFor(() => expect(hero).toHaveAttribute('data-refresh-blocked', 'true'));
      expect(hero).toHaveAttribute('data-source-status', 'initial');
      expect(hero).toHaveAttribute('data-source-provenance', 'unknown');
      expect(within(hero).queryByText('Live state unavailable')).not.toBeInTheDocument();
      expect(within(hero).getAllByText(/Refresh paused/).length).toBeGreaterThan(0);
      expect(screen.getByTestId('command-workspace')).toBeInTheDocument();
      expect(postCalls()).toHaveLength(0);
    } finally {
      await act(async () => { onlineManager.setOnline(true); });
    }
  });

  it('keeps retained Hero readings with cached provenance and targeted retry after state refresh failure', async () => {
    const { queryClient } = renderCenter();
    const hero = screen.getByTestId('command-center-hero');
    await waitFor(() => expect(hero).toHaveAttribute('data-source-provenance', 'live'));
    stateError = new Error('state refresh failed');
    await act(async () => { await queryClient.refetchQueries({ queryKey: vehicleKeys.state(VEHICLE_ID) }); });
    await waitFor(() => expect(hero).toHaveAttribute('data-source-status', 'stale'));
    await waitFor(() => expect(hero).toHaveAttribute('data-source-provenance', 'cached'));
    expect(within(hero).getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(within(hero).getByText('85.00%', { selector: '[data-operational-value]' })).toBeInTheDocument();
    expect(within(hero).queryByRole('alert')).not.toBeInTheDocument();
    stateError = null;
    fireEvent.click(within(hero).getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(hero).toHaveAttribute('data-source-status', 'ok'));
    expect(postCalls()).toHaveLength(0);
  });

  it('keeps paused retained Hero state cached and distinguishes a resolved unavailable response', async () => {
    const { queryClient } = renderCenter();
    const hero = screen.getByTestId('command-center-hero');
    await waitFor(() => expect(hero).toHaveAttribute('data-source-provenance', 'live'));
    await act(async () => {
      queryClient.getQueryCache().find({ queryKey: vehicleKeys.state(VEHICLE_ID) })!
        .setState({ fetchStatus: 'paused' });
    });
    await waitFor(() => expect(hero).toHaveAttribute('data-source-provenance', 'cached'));
    expect(hero).toHaveAttribute('data-refresh-blocked', 'true');
    expect(within(hero).queryByText('Live state unavailable')).not.toBeInTheDocument();
    stateResponse = null;
    await act(async () => { await queryClient.refetchQueries({ queryKey: vehicleKeys.state(VEHICLE_ID) }); });
    await waitFor(() => expect(hero).toHaveAttribute('data-source-status', 'unavailable'));
    expect(within(hero).getByText('Live state unavailable')).toBeInTheDocument();
    expect(postCalls()).toHaveLength(0);
  });

  it('renders selected vehicle identity, converted telemetry, and all major sections', async () => {
    renderCenter();

    expect(within(screen.getByTestId('command-center-hero')).getByRole('heading', { name: 'My Tesla' })).toBeInTheDocument();
    expect(screen.getByText(/Model 3/)).toBeInTheDocument();
    expect(screen.getByText(/5YJ3E1EA7KF000000/)).toBeInTheDocument();
    const vehicleState = within(screen.getByRole('region', { name: 'Vehicle state' }));
    expect(await vehicleState.findByText('85.00%', { selector: '[data-operational-metric="battery"] [data-operational-value]' })).toBeInTheDocument();
    expect(vehicleState.getByText('400 km', { selector: '[data-operational-metric="range"] [data-operational-value]' })).toBeInTheDocument();
    expect(vehicleState.getByText('21°C', { selector: '[data-operational-metric="cabin"] [data-operational-value]' })).toBeInTheDocument();
    expect(screen.getByTestId('command-readiness')).toBeInTheDocument();
    expect(screen.getByTestId('command-workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('command-safety')).not.toBeInTheDocument();
    expect(screen.queryByTestId('command-activity')).not.toBeInTheDocument();
  });

  it('keeps commands usable when live state is unavailable and shows an honest error', async () => {
    stateError = new Error('state endpoint unavailable');
    installRequestRouter();

    renderCenter();

    expect(
      await screen.findByText("Can't reach server"),
    ).toBeInTheDocument();
    expect(screen.getByTestId('command-workspace')).toBeInTheDocument();
    expect(screen.getAllByText('Wake up').length).toBeGreaterThan(0);
  });

  it('does not block commands with the removed stale telemetry warning', () => {
    const veryOld = new Date(Date.now() - 2_501 * 60 * 60 * 1000).toISOString();

    renderCenter(makeVehicle({ updated_at: veryOld }));

    expect(screen.queryByTestId('command-freshness-warning')).not.toBeInTheDocument();
    expect(screen.getByTestId('command-workspace')).toBeInTheDocument();
  });

  it('does not mistake an old vehicle record for the last signal or current readiness', async () => {
    const veryOld = new Date(Date.now() - 3_653 * 60 * 60 * 1000).toISOString();
    stateResponse = { state: makeState({ state: 'Charging' }), live: true };
    installRequestRouter();

    renderCenter(makeVehicle({ state: 'charging', updated_at: veryOld }));

    const hero = screen.getByTestId('command-center-hero');
    expect(await within(hero).findByText('Last known: Charging')).toBeInTheDocument();
    // The status pill renders from props immediately, but the brief face shows
    // skeletons until the live state query resolves — wait for a real value.
    expect(await within(hero).findByText('85.00%', { selector: '[data-operational-value]' })).toBeInTheDocument();
    // Freshness moved off the brief face into the drawer header; the hero
    // caption keeps the honest unknown, never an invented signal time.
    assertOperationalBriefDisclosure(hero, 'No verified signal time');
    expect(within(hero).getByText('No verified signal time')).toBeInTheDocument();
    expect(screen.queryByText('3653h ago')).not.toBeInTheDocument();
    expect(await screen.findByText('Delivery uncertain')).toBeInTheDocument();
    const readiness = screen.getByRole('region', { name: 'Command readiness' });
    // Unknown motion is omitted from the face (never invented); the drawer counts it hidden.
    assertOperationalMetricUnavailable(readiness, 'Motion context');
    // Telemetry freshness moved off the face into the drawer header.
    assertOperationalBriefDisclosure(readiness, 'Unknown');
  });

  it('uses a verified signal observation for current status and readiness', async () => {
    stateResponse = {
      state: makeState({ state: 'Charging', is_charging: true }),
      observed_at: new Date().toISOString(),
      freshness: 'fresh',
      verified_fields: ['state', 'is_charging', 'speed'],
      live: true,
    };
    installRequestRouter();

    renderCenter(makeVehicle({ state: 'offline', updated_at: '2020-01-01T00:00:00Z' }));

    expect(await screen.findByText('Last signal:')).toBeInTheDocument();
    expect(screen.queryByText('Last known: Offline')).not.toBeInTheDocument();
    expect(screen.getByTestId('command-readiness')).toHaveTextContent('Current');
    expect(screen.getByTestId('command-readiness')).toHaveTextContent('Ready');
  });

  it('labels unverified asleep-state guidance as last reported', () => {
    const stale = new Date(Date.now() - 30 * 60_000).toISOString();
    stateResponse = { state: makeState({ state: 'asleep' }), live: false };
    installRequestRouter();

    renderCenter(makeVehicle({ state: 'asleep', updated_at: stale }));

    expect(screen.queryByTestId('command-freshness-warning')).not.toBeInTheDocument();
    expect(
      screen.getByText(/Last reported asleep\. Commands remain selectable/i),
    ).toBeInTheDocument();
    searchFor('flash_lights');
    expect(
      screen.getByRole('button', { name: 'Flash lights' }),
    ).not.toHaveAttribute('aria-disabled');
  });
});

describe('VehicleCommandCenter — complete command catalogue', () => {
  it('keeps every domain, category, and configured action reachable', () => {
    renderCenter();

    for (const domain of ['Access & security', 'Climate & comfort', 'Charging & schedules', 'Vehicle controls']) {
      expect(screen.getByRole('button', { name: domain })).toBeInTheDocument();
    }

    const domainCategories = [
      ['Access & security', ['security', 'doors', 'drive', 'windows', 'sunroof']],
      ['Climate & comfort', ['climate', 'climate_protection']],
      ['Charging & schedules', ['charging', 'schedules']],
      ['Vehicle controls', ['alerts', 'navigation', 'software', 'vehicle', 'media']],
    ] as const;

    for (const [domain, categories] of domainCategories) {
      fireEvent.click(screen.getByRole('button', { name: domain }));
      for (const category of categories) {
        const escaped = CATEGORY_META[category].fallback.replace(
          /[.*+?^${}()|[\]\\]/g,
          '\\$&',
        );
        expect(
          screen.getByRole('button', {
            name: new RegExp(`^${escaped}\\s*\\(`, 'i'),
          }),
        ).toBeInTheDocument();
      }
    }

    for (const command of COMMANDS) {
      searchFor(command.command);
      expect(screen.getAllByText(command.labelFallback).length).toBeGreaterThan(0);
    }
  });
});

describe('VehicleCommandCenter — command execution', () => {
  it('uses the actual selected-vehicle charging capability through the mounted input dialog and unchanged POST body', async () => {
    capabilityResponse = {
      vehicle_id: VEHICLE_ID,
      signals: { ChargeCurrentRequestMax: {
        kind: 'ValueKindFloat', value: 32, ts: new Date().toISOString(), source: 'l1', age_ms: 0,
      } },
    };
    const { queryClient } = renderCenter();
    searchFor('set_charging_amps');
    fireEvent.click(screen.getByRole('button', { name: 'Set amps' }));
    const dialog = screen.getByRole('dialog');
    await within(dialog).findByText('Maximum: 32');
    const input = within(dialog).getByLabelText('Amperage');
    fireEvent.change(input, { target: { value: '33' } });
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Send' }).closest('form') as HTMLFormElement);
    expect(postCalls()).toHaveLength(0);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    capabilityResponse = {
      ...capabilityResponse,
      signals: { ChargeCurrentRequestMax: {
        kind: 'ValueKindFloat', value: 16, ts: new Date().toISOString(), source: 'l1', age_ms: 0,
      } },
    };
    await act(async () => { await queryClient.refetchQueries({ queryKey: telemetryKeys.liveSignals(VEHICLE_ID) }); });
    expect(input).toHaveValue('33');
    expect(within(dialog).getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.change(input, { target: { value: '016' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(lastPostBody()).toEqual({ command: 'set_charging_amps', params: { charging_amps: '16' } });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps unknown amp capability blocked without hiding other commands or defaulting to 48 amps', async () => {
    renderCenter();
    searchFor('set_charging_amps');
    fireEvent.click(screen.getByRole('button', { name: 'Set amps' }));
    const dialog = screen.getByRole('dialog');
    await within(dialog).findByText('Unknown');
    fireEvent.change(within(dialog).getByLabelText('Amperage'), { target: { value: '0' } });
    expect(within(dialog).getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.submit(within(dialog).getByRole('button', { name: 'Send' }).closest('form') as HTMLFormElement);
    expect(postCalls()).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    searchFor('flash_lights');
    fireEvent.click(screen.getByRole('button', { name: 'Flash lights' }));
    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(lastPostBody()).toEqual({ command: 'flash_lights' });
  });

  it('disables command execution in historical mode', () => {
    operationalModeState.canWrite = false;
    renderCenter();
    searchFor('flash_lights');

    const command = screen.getByRole('button', { name: 'Flash lights' });
    expect(command).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(command);
    expect(postCalls()).toHaveLength(0);
    expect(
      screen.getByText('Vehicle commands are read-only'),
    ).toBeInTheDocument();
  });

  describe('VehicleCommandCenter — physical truth and request lifecycle', () => {
    it('keeps guest physical truth unknown before and after accepted intent and preserves explicit OFF', async () => {
      let resolve: ((value: unknown) => void) | undefined;
      commandResponse = () => new Promise(done => { resolve = done; });
      renderCenter();
      searchFor('guest_mode_on');
      fireEvent.click(screen.getByRole('button', { name: 'ON' }));
      await waitFor(() => expect(postCalls()).toHaveLength(1));
      expect(lastPostBody()).toEqual({ command: 'guest_mode_on' });
      expect(screen.getByTestId('command-toggle-reading')).toHaveTextContent('State unknown');
      expect(screen.getByRole('button', { name: 'OFF' })).toBeDisabled();
      await act(async () => { resolve?.({ success: true }); });
      await screen.findByText('Guest Mode request sent to My Tesla.');
      expect(screen.getByTestId('command-toggle-reading')).toHaveTextContent('State unknown');
      commandResponse = () => Promise.resolve({ success: true });
      fireEvent.click(screen.getByRole('button', { name: 'OFF' }));
      await waitFor(() => expect(postCalls()).toHaveLength(2));
      expect(lastPostBody()).toEqual({ command: 'guest_mode_off' });
    });

    it.each(['soft', 'hard', 'empty'])('does not invent guest OFF or ON after %s failure', async (kind) => {
      commandResponse = () => kind === 'hard'
        ? Promise.reject(new Error('request rejected'))
        : Promise.resolve(kind === 'soft' ? { success: false, error: 'not accepted' } : undefined);
      renderCenter();
      searchFor('guest_mode_on');
      fireEvent.click(screen.getByRole('button', { name: 'ON' }));
      expect(await screen.findByTestId('command-result-feedback')).not.toHaveTextContent('request sent');
      expect(screen.getByTestId('command-toggle-reading')).toHaveTextContent('State unknown');
      expect(screen.getByRole('button', { name: 'Guest Mode' })).not.toHaveAttribute('aria-pressed');
      expect(screen.getByRole('button', { name: 'OFF' })).not.toBeDisabled();
    });

    it('reaches valet OFF after actual PIN acceptance without retaining or resending the PIN', async () => {
      renderCenter();
      searchFor('set_valet_mode');
      fireEvent.click(screen.getByRole('button', { name: 'ON' }));
      const dialog = screen.getByRole('dialog');
      const pin = within(dialog).getByDisplayValue('');
      expect(pin).toHaveAttribute('type', 'password');
      fireEvent.change(pin, { target: { value: '9182' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));
      await waitFor(() => expect(postCalls()).toHaveLength(1));
      expect(lastPostBody()).toEqual({ command: 'set_valet_mode', params: { on: 'true', password: '9182' } });
      await screen.findByText('Valet Mode request sent to My Tesla.');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByTestId('vehicle-command-center')).not.toHaveTextContent('9182');
      expect(screen.getByTestId('command-toggle-reading')).toHaveTextContent('State unknown');
      fireEvent.click(screen.getByRole('button', { name: 'OFF' }));
      await waitFor(() => expect(postCalls()).toHaveLength(2));
      expect(lastPostBody()).toEqual({ command: 'valet_off' });
    });

    it('cancels PIN intent without sending and rechecks readiness before explicit OFF', () => {
      renderCenter();
      searchFor('set_valet_mode');
      fireEvent.click(screen.getByRole('button', { name: 'ON' }));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
      expect(postCalls()).toHaveLength(0);
      operationalModeState.canWrite = false;
      searchFor('guest_mode_on');
      fireEvent.click(screen.getByRole('button', { name: 'OFF' }));
      expect(postCalls()).toHaveLength(0);
    });

    it('propagates exact current field trust without converting a missing boolean to OFF', async () => {
      stateResponse = {
        state: makeState({ is_locked: true }),
        observed_at: new Date().toISOString(),
        freshness: 'fresh',
        verified_fields: ['is_locked'],
        live: true,
      };
      renderCenter();
      searchFor('lock');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Lock' })).toHaveAttribute('aria-pressed', 'true'));
      searchFor('climate_on');
      expect(screen.getByRole('button', { name: 'Climate' })).not.toHaveAttribute('aria-pressed');
      expect(screen.getByTestId('command-toggle-reading')).toHaveTextContent('Last known: OFF');
    });

    it('exposes initial latest-command failure and targeted retry without hiding action controls', async () => {
      latestError = new Error('latest source unavailable');
      renderCenter();
      const source = await screen.findByTestId('command-outcome-source');
      await within(source).findByText("Can't reach server");
      expect(screen.getByTestId('command-workspace')).toBeInTheDocument();
      latestError = null;
      fireEvent.click(within(source).getByRole('button', { name: /retry/i }));
      expect(await within(source).findByText('No commands sent yet')).toBeInTheDocument();
      expect(postCalls()).toHaveLength(0);
    });

    it('retains latest outcomes with refresh warning and age rather than erasing them', async () => {
      latestEntries = [{ id: 1, command: 'lock', status: 'success', created_at: '2026-10-14T05:00:00Z' } as CommandLogEntry];
      const { queryClient } = renderCenter();
      await screen.findByTestId('command-outcome-source');
      await waitFor(() => expect(screen.getAllByText(/^✓/).length).toBeGreaterThan(0));
      latestError = new Error('latest refresh failed');
      await act(async () => { await queryClient.refetchQueries({ queryKey: commandKeys.latest(VEHICLE_ID) }); });
      const source = screen.getByTestId('command-outcome-source');
      expect(await within(source).findByTestId('stale-refresh-warning')).toBeInTheDocument();
      expect(screen.getAllByText(/^✓/).length).toBeGreaterThan(0);
      expect(within(source).getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
      expect(postCalls()).toHaveLength(0);
    });
  });

  it('preserves wake-up as a reachable command on the supported endpoint', async () => {
    renderCenter();

    fireEvent.click(screen.getAllByRole('button', { name: 'Wake up' })[0]);

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(postCalls()[0][0]).toBe('/vehicles/42/command');
    expect(lastPostBody()).toEqual({ command: 'wake_up' });
  });

  it('sends a direct command through the supported endpoint and payload', async () => {
    renderCenter();
    searchFor('flash_lights');

    fireEvent.click(screen.getByRole('button', { name: 'Flash lights' }));

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(postCalls()[0][0]).toBe('/vehicles/42/command');
    expect(lastPostBody()).toEqual({ command: 'flash_lights' });
    expect(
      await screen.findByText('Flash lights request sent to My Tesla.'),
    ).toBeInTheDocument();
  });

  it('requires confirmation before sending a dangerous command', async () => {
    renderCenter();
    searchFor('speed_limit_clear_pin_admin');

    fireEvent.click(screen.getByRole('button', { name: 'Clear speed PIN' }));

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(/without authentication/i),
    ).toBeInTheDocument();
    expect(postCalls()).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(lastPostBody()).toEqual({
      command: 'speed_limit_clear_pin_admin',
    });
  });

  it('preserves input and select command payloads', async () => {
    renderCenter();
    searchFor('set_charge_limit');
    fireEvent.click(screen.getByRole('button', { name: 'Set limit' }));

    const inputDialog = screen.getByRole('dialog');
    fireEvent.change(within(inputDialog).getByDisplayValue('80'), {
      target: { value: '90' },
    });
    fireEvent.click(within(inputDialog).getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(lastPostBody()).toEqual({
      command: 'set_charge_limit',
      params: { percent: '90' },
    });

    searchFor('set_cop_temp');
    fireEvent.click(screen.getByRole('button', { name: 'COP temp' }));
    const selectDialog = screen.getByRole('dialog');
    fireEvent.click(within(selectDialog).getByRole('button', { name: /Low/ }));

    await waitFor(() => expect(postCalls()).toHaveLength(2));
    expect(lastPostBody()).toEqual({
      command: 'set_cop_temp',
      params: { cop_temp: '0' },
    });
  });

  it('shows pending progress and disables command activation until settled', async () => {
    let resolveCommand: ((value: unknown) => void) | undefined;
    commandResponse = () =>
      new Promise((resolve) => {
        resolveCommand = resolve;
      });
    installRequestRouter();
    renderCenter();
    searchFor('flash_lights');

    const tile = screen.getByRole('button', { name: 'Flash lights' });
    fireEvent.click(tile);

    expect(await screen.findByTestId('command-pending-feedback')).toHaveTextContent(
      'Sending Flash lights…',
    );
    expect(tile).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(tile);
    expect(postCalls()).toHaveLength(1);

    await act(async () => {
      resolveCommand?.({ success: true, result: 'success' });
    });
    expect(
      await screen.findByText('Flash lights request sent to My Tesla.'),
    ).toBeInTheDocument();
  });

  it('surfaces the backend reason for a soft failure', async () => {
    commandResponse = () =>
      Promise.resolve({ success: false, error: 'vehicle is offline' });
    installRequestRouter();
    renderCenter();
    searchFor('flash_lights');

    fireEvent.click(screen.getByRole('button', { name: 'Flash lights' }));

    expect(await screen.findByTestId('command-result-feedback')).toHaveTextContent(
      'vehicle is offline',
    );
  });

  it('surfaces a hard request error without claiming success', async () => {
    commandResponse = () => Promise.reject(new Error('network down'));
    installRequestRouter();
    renderCenter();
    searchFor('flash_lights');

    fireEvent.click(screen.getByRole('button', { name: 'Flash lights' }));

    expect(await screen.findByTestId('command-result-feedback')).toHaveTextContent(
      'Flash lights failed: network down',
    );
    expect(
      screen.queryByText('Flash lights request sent to My Tesla.'),
    ).not.toBeInTheDocument();
  });
});
