import type { ReactNode } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback';
import type { CommandLogEntry } from '@/api/hooks/useCommands';
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
let historyEntries: CommandLogEntry[];
let commandResponse: () => Promise<unknown>;

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

function makeEntry(
  id: number,
  overrides: Partial<CommandLogEntry> = {},
): CommandLogEntry {
  return {
    id,
    vehicle_id: VEHICLE_ID,
    command: 'flash_lights',
    params: '{}',
    status: 'success',
    error: '',
    created_at: new Date(Date.now() - 120_000).toISOString(),
    ...overrides,
  };
}

function installRequestRouter() {
  requestMock.mockImplementation((url: string, options?: RequestInit) => {
    if (url === `/vehicles/${VEHICLE_ID}/state`) {
      return stateError ? Promise.reject(stateError) : Promise.resolve(stateResponse);
    }
    if (url === `/vehicles/${VEHICLE_ID}/commands/latest`) {
      return Promise.resolve(latestEntries);
    }
    if (url === `/vehicles/${VEHICLE_ID}/commands/history?limit=200`) {
      return Promise.resolve(historyEntries);
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
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/commands']}>
        <ToastProvider>
          <VehicleCommandCenter vehicle={vehicle} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
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
  const call = postCalls().at(-1);
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
  historyEntries = [];
  commandResponse = () => Promise.resolve({ success: true, result: 'success' });
  installRequestRouter();
});

describe('VehicleCommandCenter — summary and readiness', () => {
  it('renders selected vehicle identity, converted telemetry, and all major sections', async () => {
    renderCenter();

    expect(screen.getByText('My Tesla')).toBeInTheDocument();
    expect(screen.getByText(/Model 3/)).toBeInTheDocument();
    expect(screen.getByText(/5YJ3E1EA7KF000000/)).toBeInTheDocument();
    expect(await screen.findByText('85')).toBeInTheDocument();
    expect(screen.getByText('400')).toBeInTheDocument();
    expect(screen.getByText('21')).toBeInTheDocument();
    expect(screen.getByTestId('command-readiness')).toBeInTheDocument();
    expect(screen.getByTestId('command-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('command-safety')).toBeInTheDocument();
    expect(screen.getByTestId('command-activity')).toBeInTheDocument();
  });

  it('keeps commands usable when live state is unavailable and shows an honest error', async () => {
    stateError = new Error('state endpoint unavailable');
    installRequestRouter();

    renderCenter();

    expect(
      await screen.findByText("Can't reach server"),
    ).toBeInTheDocument();
    expect(screen.getByTestId('command-workspace')).toBeInTheDocument();
    expect(screen.getAllByText('Wake Up').length).toBeGreaterThan(0);
  });

  it('shows the stale warning exactly once for extremely old telemetry', () => {
    const veryOld = new Date(Date.now() - 2_501 * 60 * 60 * 1000).toISOString();

    renderCenter(makeVehicle({ updated_at: veryOld }));

    expect(screen.getAllByTestId('command-freshness-warning')).toHaveLength(1);
    expect(
      within(screen.getByTestId('command-freshness-warning')).getByText(
        /Last vehicle update: 2501h ago\./,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ago old/i)).not.toBeInTheDocument();
  });

  it('still renders one stale warning when the last-known vehicle state is asleep', () => {
    const stale = new Date(Date.now() - 30 * 60_000).toISOString();
    stateResponse = { state: makeState({ state: 'asleep' }), live: false };
    installRequestRouter();

    renderCenter(makeVehicle({ state: 'asleep', updated_at: stale }));

    expect(screen.getAllByTestId('command-freshness-warning')).toHaveLength(1);
    expect(
      screen.getByText(/The vehicle is asleep\. Commands remain selectable/i),
    ).toBeInTheDocument();
    searchFor('flash_lights');
    expect(
      screen.getByRole('button', { name: 'Flash Lights' }),
    ).not.toHaveAttribute('aria-disabled');
  });
});

describe('VehicleCommandCenter — complete command catalogue', () => {
  it('keeps every domain, category, and configured action reachable', () => {
    renderCenter();

    for (const domain of ['Access & Security', 'Climate & Comfort', 'Charging & Schedules', 'Vehicle Controls']) {
      expect(screen.getByRole('tab', { name: domain })).toBeInTheDocument();
    }

    const domainCategories = [
      ['Access & Security', ['security', 'doors', 'drive', 'windows', 'sunroof']],
      ['Climate & Comfort', ['climate', 'climate_protection']],
      ['Charging & Schedules', ['charging', 'schedules']],
      ['Vehicle Controls', ['alerts', 'navigation', 'software', 'vehicle', 'media']],
    ] as const;

    for (const [domain, categories] of domainCategories) {
      fireEvent.click(screen.getByRole('tab', { name: domain }));
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
  it('disables command execution in historical mode', () => {
    operationalModeState.canWrite = false;
    renderCenter();
    searchFor('flash_lights');

    const command = screen.getByRole('button', { name: 'Flash Lights' });
    expect(command).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(command);
    expect(postCalls()).toHaveLength(0);
    expect(
      screen.getByText('Vehicle commands are read-only'),
    ).toBeInTheDocument();
  });

  it('preserves wake-up as a reachable command on the supported endpoint', async () => {
    renderCenter();

    fireEvent.click(screen.getAllByRole('button', { name: 'Wake Up' })[0]);

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(postCalls()[0][0]).toBe('/vehicles/42/command');
    expect(lastPostBody()).toEqual({ command: 'wake_up' });
  });

  it('sends a direct command through the supported endpoint and payload', async () => {
    renderCenter();
    searchFor('flash_lights');

    fireEvent.click(screen.getByRole('button', { name: 'Flash Lights' }));

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(postCalls()[0][0]).toBe('/vehicles/42/command');
    expect(lastPostBody()).toEqual({ command: 'flash_lights' });
    expect(
      await screen.findByText('Flash Lights request sent to My Tesla.'),
    ).toBeInTheDocument();
  });

  it('requires confirmation before sending a dangerous command', async () => {
    renderCenter();
    searchFor('speed_limit_clear_pin_admin');

    fireEvent.click(screen.getByRole('button', { name: 'Clear Speed PIN' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'Set Limit' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'COP Temp' }));
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

    const tile = screen.getByRole('button', { name: 'Flash Lights' });
    fireEvent.click(tile);

    expect(await screen.findByTestId('command-pending-feedback')).toHaveTextContent(
      'Sending Flash Lights…',
    );
    expect(tile).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(tile);
    expect(postCalls()).toHaveLength(1);

    await act(async () => {
      resolveCommand?.({ success: true, result: 'success' });
    });
    expect(
      await screen.findByText('Flash Lights request sent to My Tesla.'),
    ).toBeInTheDocument();
  });

  it('surfaces the backend reason for a soft failure', async () => {
    commandResponse = () =>
      Promise.resolve({ success: false, error: 'vehicle is offline' });
    installRequestRouter();
    renderCenter();
    searchFor('flash_lights');

    fireEvent.click(screen.getByRole('button', { name: 'Flash Lights' }));

    expect(await screen.findByTestId('command-result-feedback')).toHaveTextContent(
      'vehicle is offline',
    );
  });

  it('surfaces a hard request error without claiming success', async () => {
    commandResponse = () => Promise.reject(new Error('network down'));
    installRequestRouter();
    renderCenter();
    searchFor('flash_lights');

    fireEvent.click(screen.getByRole('button', { name: 'Flash Lights' }));

    expect(await screen.findByTestId('command-result-feedback')).toHaveTextContent(
      'Flash Lights failed: network down',
    );
    expect(
      screen.queryByText('Flash Lights request sent to My Tesla.'),
    ).not.toBeInTheDocument();
  });
});

describe('VehicleCommandCenter — recent activity', () => {
  it('renders recent success and failure outcomes from command history', async () => {
    historyEntries = [
      makeEntry(1, { command: 'lock', status: 'success' }),
      makeEntry(2, {
        command: 'climate_on',
        status: 'failed',
        error: 'vehicle asleep',
      }),
    ];
    installRequestRouter();

    renderCenter();

    const activity = screen.getByTestId('command-activity');
    expect(await within(activity).findByText('Lock')).toBeInTheDocument();
    expect(within(activity).getByText('Climate')).toBeInTheDocument();
    expect(
      within(activity).getByText(/Failed · vehicle asleep/),
    ).toBeInTheDocument();
  });
});
