import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { useMQTTStatus } from '@/api/hooks/useTelemetry';
import MQTTStatusWidget from './MQTTStatusWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import type { WidgetProps } from './types';

type MqttPayload = NonNullable<ReturnType<typeof useMQTTStatus>['data']>;
interface QueryFixture {
  data: MqttPayload | null | undefined;
  error: Error | null;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

const mocks = vi.hoisted(() => ({
  source: vi.fn<() => QueryFixture>(),
  refresh: vi.fn<() => void>(),
}));
vi.mock('@/api/hooks/useTelemetry', () => ({ useMQTTStatus: mocks.source }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''));
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

const PACKS = [
  ['v1', 'studio'], ['v2', 'elevated'], ['v3', 'precision'], ['v4', 'owner'],
  ['v5', 'iconic'], ['v6', 'expressive'], ['v7', 'pixel'],
] as const;
const STANDARD = { cols: 2, rows: 2 };
const COMPACT = { cols: 1, rows: 2 };
const HISTORY_UNAVAILABLE = 'This source provides the current message rate, not a throughput history.';
const BROKER = 'mqtts://telemetry.example.invalid:8883';

function payload(overrides: Partial<MqttPayload> = {}): MqttPayload {
  return {
    connected: true,
    broker: BROKER,
    uptimeSeconds: 600,
    vehicles: [
      { vin: 'test-vehicle-a', signalCount: 800, signalsPerSecond: 2.25,
        lastReceived: new Date(Date.now() - 185_000).toISOString() },
      { vin: 'test-vehicle-b', signal_count: 400, signals_per_second: 1.25,
        last_received: new Date(Date.now() - 365_000).toISOString() },
    ],
    ...overrides,
  };
}

function query(overrides: Partial<QueryFixture> = {}): QueryFixture {
  return {
    data: payload(), error: null, isLoading: false, isFetching: false,
    isStale: false, isError: false, dataUpdatedAt: Date.now(),
    refetch: mocks.refresh, ...overrides,
  };
}

function widget(packId: unknown = 'classic', size: WidgetProps['size'] = STANDARD) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <MQTTStatusWidget size={size} />
      </PackBoundary>
    </MemoryRouter>
  );
}

async function mount(packId: string, appearance: string, size = STANDARD) {
  const view = render(widget(packId, size));
  await waitFor(() => expect(
    view.container.querySelector(`[data-widget-family="line"][data-widget-appearance="${appearance}"]`),
  ).not.toBeNull());
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.source.mockReturnValue(query());
});
afterEach(cleanup);

describe.each(PACKS)('MQTT %s (%s)', (packId, appearance) => {
  it('retains fleet readings, metadata, semantic icon and the real refresh action', async () => {
    const { container } = await mount(packId, appearance);
    expect(screen.getByRole('heading', { name: 'MQTT status' })).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByText('Messages/sec')).toBeInTheDocument();
    expect(screen.getByText('3.50')).toBeInTheDocument();
    expect(screen.getByText('msg/s')).toBeInTheDocument();
    expect(screen.getByText('Total messages')).toBeInTheDocument();
    expect(screen.getByText('1,200')).toBeInTheDocument();
    expect(screen.getByText('Last message')).toBeInTheDocument();
    expect(screen.getByText('3m ago')).toBeInTheDocument();
    expect(screen.getByText('Broker')).toBeInTheDocument();
    expect(screen.getByText(BROKER)).toHaveAttribute('title', BROKER);
    expect(container.querySelector('[data-widget-family="line"] .lucide-radio')).not.toBeNull();
    expect(screen.getByText(HISTORY_UNAVAILABLE)).toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(mocks.source).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('keeps the compact rate and connection badge without adding full-size details', async () => {
    await mount(packId, appearance, COMPACT);
    expect(screen.getByText('3.50')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByText('msg/s')).toBeInTheDocument();
    expect(screen.queryByText('Messages/sec')).not.toBeInTheDocument();
    expect(screen.queryByText('Total messages')).not.toBeInTheDocument();
    expect(screen.queryByText('Last message')).not.toBeInTheDocument();
    expect(screen.queryByText(BROKER)).not.toBeInTheDocument();
    expect(screen.queryByText(HISTORY_UNAVAILABLE)).not.toBeInTheDocument();
  });

  it('keeps incomplete fleet counters unknown instead of reporting a partial sum or zero', async () => {
    mocks.source.mockReturnValue(query({
      data: payload({ connected: undefined, broker: '', vehicles: [
        { vin: 'measured', signalCount: 10, signalsPerSecond: 2 },
        { vin: 'missing', signalsPerSecond: Number.NaN, lastReceived: 'invalid' },
      ] }),
    }));
    await mount(packId, appearance);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText('Offline')).not.toBeInTheDocument();
    expect(screen.queryByText('Online')).not.toBeInTheDocument();
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
    expect(screen.getByText('Total messages')).toBeInTheDocument();
    expect(screen.getByText('Last message')).toBeInTheDocument();
    expect(screen.getByText('Broker')).toBeInTheDocument();
  });

  it('retains readings and source-age warnings during a failed background refresh', async () => {
    mocks.source.mockReturnValue(query({ isError: true, isStale: true, error: new Error('refresh failed') }));
    const { container } = await mount(packId, appearance);
    expect(container.querySelector('[data-data-state="stale"]')).not.toBeNull();
    expect(container.querySelector('[data-content-degraded="true"]')).not.toBeNull();
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent(
      'Previously loaded data remains visible while affected sources recover.',
    );
    expect(screen.getByText('3.50')).toBeInTheDocument();
    expect(screen.getByText('1,200')).toBeInTheDocument();
    expect(screen.getByText(BROKER)).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
});

it.each(['classic', 'unrecognized-pack', undefined])('preserves Classic default/recovery for %s', packId => {
  const { container } = render(widget(packId));
  expect(container.querySelector('[data-widget-pack="classic"]')).not.toBeNull();
  expect(container.querySelector('[data-widget-family]')).toBeNull();
  expect(screen.getByText('3.50')).toBeInTheDocument();
  expect(screen.getByText('1,200')).toBeInTheDocument();
  expect(screen.getByText('3m ago')).toBeInTheDocument();
  expect(screen.getByText(BROKER)).toBeInTheDocument();
  expect(screen.queryByText(HISTORY_UNAVAILABLE)).not.toBeInTheDocument();
});

it('preserves the mounted source and refresh action while selecting every pack and returning to Classic', async () => {
  const view = render(widget());
  for (const [packId, appearance] of PACKS) {
    mocks.source.mockClear();
    view.rerender(widget(packId));
    await waitFor(() => expect(view.container.querySelector(
      `[data-widget-appearance="${appearance}"]`,
    )).not.toBeNull());
    expect(screen.getByText('3.50')).toBeInTheDocument();
    expect(screen.getByText('1,200')).toBeInTheDocument();
    expect(mocks.source).toHaveBeenCalledTimes(1);
  }
  view.rerender(widget('classic'));
  expect(view.container.querySelector('[data-widget-family]')).toBeNull();
  expect(screen.getByText(BROKER)).toBeInTheDocument();
  expect(screen.queryByText(HISTORY_UNAVAILABLE)).not.toBeInTheDocument();
  expect(mocks.refresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it('keeps source sections visible for a missing payload without inventing success', async () => {
  mocks.source.mockReturnValue(query({ data: null }));
  await mount('v1', 'studio');
  expect(screen.getByText('No MQTT status data')).toBeInTheDocument();
  expect(screen.getByText('Unknown')).toBeInTheDocument();
  expect(screen.getByText('Total messages')).toBeInTheDocument();
  expect(screen.getByText('Last message')).toBeInTheDocument();
  expect(screen.getByText('Broker')).toBeInTheDocument();
  expect(screen.getAllByText('—')).toHaveLength(4);
});

it('distinguishes an observed empty fleet and disconnected broker from missing measurements', async () => {
  mocks.source.mockReturnValue(query({ data: payload({ connected: false, broker: '', vehicles: [] }) }));
  await mount('v7', 'pixel');
  expect(screen.getByText('Offline')).toBeInTheDocument();
  expect(screen.getByText('0.00')).toBeInTheDocument();
  expect(screen.getByText('0')).toBeInTheDocument();
  expect(screen.getAllByText('—')).toHaveLength(2);
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
});

it('retains the current readings while disabling duplicate refreshes during an in-flight request', async () => {
  mocks.source.mockReturnValue(query({ isFetching: true }));
  const { container } = await mount('v6', 'expressive');
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(screen.getByText('3.50')).toBeInTheDocument();
  expect(screen.getByText('1,200')).toBeInTheDocument();
  const refresh = screen.getByRole('button', { name: /^Refresh/i });
  expect(refresh).toBeDisabled();
  fireEvent.click(refresh);
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it.each(['classic', 'v7'])('never renders broker credentials in %s readings or tooltips', async packId => {
  mocks.source.mockReturnValue(query({
    data: payload({ broker: 'mqtts://test-user:test-password@telemetry.example.invalid:8883' }),
  }));
  const view = render(widget(packId));
  if (packId === 'v7') {
    await waitFor(() => expect(view.container.querySelector('[data-widget-appearance="pixel"]')).not.toBeNull());
  }
  expect(screen.getByText(BROKER)).toHaveAttribute('title', BROKER);
  expect(view.container.innerHTML).not.toContain('test-user');
  expect(view.container.innerHTML).not.toContain('test-password');
});

it('keeps the initial-loading shell without fabricated rate or connection readings', () => {
  mocks.source.mockReturnValue(query({ data: undefined, isLoading: true, isFetching: true }));
  const { container } = render(widget('v2'));
  expect(screen.getByRole('heading', { name: 'MQTT status' })).toBeInTheDocument();
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(screen.queryByText('3.50')).not.toBeInTheDocument();
  expect(screen.queryByText('Online')).not.toBeInTheDocument();
  expect(screen.queryByText('No MQTT status data')).not.toBeInTheDocument();
});

it('shows a fatal source error and retries the same source when nothing has been retained', () => {
  mocks.source.mockReturnValue(query({ data: undefined, error: new Error('source down'), isError: true }));
  render(widget('v3'));
  expect(screen.getByRole('heading', { name: 'MQTT status' })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent("Can't reach server");
  expect(screen.queryByText('3.50')).not.toBeInTheDocument();
  expect(screen.queryByText('Online')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
  expect(mocks.refresh).toHaveBeenCalledOnce();
});
