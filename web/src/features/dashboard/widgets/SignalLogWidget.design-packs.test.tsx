import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SignalObservation } from '@/types/signals';
import type { MqttStatusData, VehicleTelemetry } from '@/types/telemetry';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';
import SignalLogWidget from './SignalLogWidget';

interface QueryFixture<T> {
  data: T | undefined;
  error: Error | null;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: ReturnType<typeof vi.fn>;
}

type MqttFixture = Pick<MqttStatusData, 'vehicles'>;
const mocks = vi.hoisted(() => ({
  observations: vi.fn<() => QueryFixture<SignalObservation[]>>(),
  mqtt: vi.fn<() => QueryFixture<MqttFixture>>(),
  vehicles: vi.fn<() => { data: { id: number }[] }>(),
}));

vi.mock('@/api/hooks/useTelemetry', () => ({
  useSignalObservations: mocks.observations,
  useMQTTStatus: mocks.mqtt,
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: mocks.vehicles }));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatTime: (date: Date) => date.toISOString().slice(11, 19) }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : key,
    i18n: { language: 'en' },
  }),
}));

function query<T>(data: T | undefined, overrides: Partial<QueryFixture<T>> = {}): QueryFixture<T> {
  return {
    data, error: null, isLoading: false, isFetching: false, isStale: false,
    isError: false, dataUpdatedAt: Date.now(), refetch: vi.fn(), ...overrides,
  };
}

function observation(overrides: Partial<SignalObservation> = {}): SignalObservation {
  return {
    vehicle_id: 7, signal_name: 'retained_signal', ts: '2026-07-01T10:00:00Z',
    value_numeric: null, value_text: null, value_bool: null, source: 'fleet_telemetry',
    ...overrides,
  };
}

const STANDARD = { cols: 2, rows: 2 };
const COMPACT = { cols: 1, rows: 2 };

function tree(pack: PackId, size = STANDARD) {
  return <MemoryRouter><PackBoundary requestedPackId={pack}>
    <SignalLogWidget vehicleId={7} size={size} />
  </PackBoundary></MemoryRouter>;
}

async function expectPresentation(container: HTMLElement, pack: PackId) {
  expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', pack);
  if (pack === 'classic') {
    expect(container.querySelector('[data-timeline-appearance]')).toBeNull();
  } else {
    await waitFor(() => expect(container.querySelector('[data-timeline-appearance]'))
      .toHaveAttribute('data-timeline-appearance', PACK_APPEARANCES[pack]));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.observations.mockReturnValue(query<SignalObservation[]>([]));
  mocks.mqtt.mockReturnValue(query<MqttFixture>({ vehicles: [] }));
  mocks.vehicles.mockReturnValue({ data: [{ id: 1 }] });
});

describe.each(PACK_IDS)('Signal Log %s acceptance', pack => {
  it('uses the timeline family without changing signal values, chronology, provenance or row limits', async () => {
    const observations = [
      observation({ signal_name: 'signed', value_numeric: -3.5, ts: '2026-07-01T10:01:00Z' }),
      observation({ signal_name: 'zero', value_numeric: 0, ts: '2026-07-01T10:05:00Z' }),
      observation({ signal_name: 'mode', value_text: 'Charging', source: 'fleet_api', ts: '2026-07-01T10:04:00Z' }),
      observation({ signal_name: 'disabled', value_bool: false, source: 'backfill', ts: '2026-07-01T10:03:00Z' }),
      observation({ signal_name: 'invalid_value', value_numeric: Infinity, ts: '2026-07-01T10:02:00Z' }),
      observation({ signal_name: 'invalid_time', ts: 'invalid' }),
      ...Array.from({ length: 20 }, (_, index) => observation({
        signal_name: `older_${index}`, ts: `2026-06-01T10:00:${String(59 - index).padStart(2, '0')}Z`,
      })),
    ];
    mocks.observations.mockReturnValue(query(observations));
    const view = render(tree(pack));
    await expectPresentation(view.container, pack);

    const list = screen.getByRole('list', { name: 'Event feed' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(20);
    for (const [index, name] of ['zero', 'mode', 'disabled', 'invalid_value', 'signed'].entries()) {
      expect(rows[index]).toHaveTextContent(name);
    }
    expect(within(rows[0]).getByText('0')).toBeInTheDocument();
    expect(within(rows[0]).getByText('10:05:00')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Charging')).toBeInTheDocument();
    expect(within(rows[2]).getByText('false')).toBeInTheDocument();
    expect(within(rows[3]).getByText('—')).toBeInTheDocument();
    expect(within(rows[4]).getByText('-3.5')).toBeInTheDocument();
    const invalidTime = screen.getByText('invalid_time').closest('li');
    expect(invalidTime).not.toBeNull();
    expect(within(invalidTime!).getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText('older_19')).not.toBeInTheDocument();
    for (const fabricated of ['MQTT', 'API', 'Cache', 'Infinity', 'NaN']) {
      expect(within(list).queryByText(fabricated)).not.toBeInTheDocument();
    }
    expect(observations[0].signal_name).toBe('signed');
    expect(mocks.observations).toHaveBeenCalledWith(7, { limit: 20 });
  });

  it('preserves initial, fatal, empty and retained-refresh states and the refresh action', async () => {
    mocks.observations.mockReturnValue(query<SignalObservation[]>(undefined, { isLoading: true }));
    const view = render(tree(pack));
    expect(view.container.querySelector('[data-data-state="initial"]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Signal log')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();

    mocks.observations.mockReturnValue(query<SignalObservation[]>(undefined, {
      isError: true, error: new Error('initial failure'),
    }));
    view.rerender(tree(pack));
    expect(view.container.querySelector('[data-data-state="initialFailure"]')).not.toBeNull();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();

    mocks.observations.mockReturnValue(query<SignalObservation[]>([]));
    view.rerender(tree(pack));
    expect(screen.getByText('No signal updates yet')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();

    const retained = query([observation({ value_numeric: 0 })], {
      isError: true, error: new Error('refresh failure'),
    });
    mocks.observations.mockReturnValue(retained);
    view.rerender(tree(pack));
    await expectPresentation(view.container, pack);
    expect(view.container.querySelector('[data-data-state="stale"]')).not.toBeNull();
    expect(screen.getByText('retained_signal')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(retained.refetch).toHaveBeenCalledOnce();
  });

  it('preserves compact rate units, genuine zero, unknown and invalid rates and MQTT source trust', async () => {
    mocks.observations.mockReturnValue(query<SignalObservation[]>(undefined, {
      isError: true, error: new Error('irrelevant observations failure'),
    }));
    mocks.mqtt.mockReturnValue(query<MqttFixture>({
      vehicles: [{ vin: 'fixture-a', signalsPerSecond: 5 }, { vin: 'fixture-b', signals_per_second: 7 }],
    }));
    const view = render(tree(pack, COMPACT));
    await expectPresentation(view.container, pack);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('signals/sec')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();

    const cases: { vehicles: VehicleTelemetry[] | null | undefined; expected: string }[] = [
      { vehicles: [{ vin: 'fixture-a', signalsPerSecond: 0 }], expected: '0' },
      { vehicles: [], expected: '0' },
      { vehicles: undefined, expected: '—' },
      { vehicles: null, expected: '—' },
      { vehicles: [{ vin: 'fixture-a', signalsPerSecond: 5 }, { vin: 'fixture-b' }], expected: '—' },
      { vehicles: [{ vin: 'fixture-a', signalsPerSecond: NaN }], expected: '—' },
      { vehicles: [{ vin: 'fixture-a', signalsPerSecond: Infinity }], expected: '—' },
    ];
    for (const { vehicles, expected } of cases) {
      mocks.mqtt.mockReturnValue(query<MqttFixture>({ vehicles }));
      view.rerender(tree(pack, COMPACT));
      expect(screen.getByText(expected)).toBeInTheDocument();
      expect(screen.queryByText(expected === '0' ? '—' : '0')).not.toBeInTheDocument();
    }

    mocks.mqtt.mockReturnValue(query<MqttFixture>({
      vehicles: [{ vin: 'fixture-a', signalsPerSecond: 8 }],
    }, { isError: true, error: new Error('MQTT refresh failure') }));
    view.rerender(tree(pack, COMPACT));
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(view.container.querySelector('[data-data-state="stale"]')).not.toBeNull();

    mocks.mqtt.mockReturnValue(query<MqttFixture>(undefined, { isLoading: true }));
    view.rerender(tree(pack, COMPACT));
    expect(view.container.querySelector('[data-data-state="initial"]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('8')).not.toBeInTheDocument();
    mocks.mqtt.mockReturnValue(query<MqttFixture>(undefined, {
      isError: true, error: new Error('MQTT initial failure'),
    }));
    view.rerender(tree(pack, COMPACT));
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});

it('keeps the mounted pause controller, focused action and frozen rows while switching every pack', async () => {
  mocks.observations.mockReturnValue(query([observation({ signal_name: 'frozen' })]));
  const view = render(tree('classic'));
  fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
  const resume = screen.getByRole('button', { name: 'Resume' });
  resume.focus();
  mocks.observations.mockReturnValue(query([observation({ signal_name: 'latest' })]));

  for (const pack of PACK_IDS) {
    view.rerender(tree(pack));
    await expectPresentation(view.container, pack);
    expect(screen.getByText('frozen')).toBeInTheDocument();
    expect(screen.queryByText('latest')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBe(resume);
    expect(resume).toHaveFocus();
  }
  fireEvent.click(resume);
  expect(screen.getByText('latest')).toBeInTheDocument();
  expect(screen.queryByText('frozen')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
});
