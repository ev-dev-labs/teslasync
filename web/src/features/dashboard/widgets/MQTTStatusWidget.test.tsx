/**
 * MQTTStatusWidget — behaviour + hardening coverage.
 *
 * The widget summarises the Fleet-Telemetry → MQTT ingest health for the whole
 * fleet inside a WidgetShell: a compact status-badge + messages/sec hero at
 * 1×N, and a status row + stat grid (Messages/sec, Total Messages) + a
 * last-message / broker footer at 2×N. The single data hook (`useMQTTStatus`)
 * is mocked so the network is never touched.
 *
 * It exposes a default component plus one pure helper (`deriveMqttStats`).
 *
 * Facets covered:
 *   - deriveMqttStats: fleet-wide count/rate summation, camelCase-over-
 *     snake_case field precedence, `safeNumber` coercion of junk counts, the
 *     null/empty null-safety, and the latest-timestamp ranking regression
 *     (parsed instant, NOT lexical order — a differing fractional-second
 *     precision used to mis-rank the "latest" reading; unparseable timestamps
 *     are skipped rather than winning).
 *   - standard (2×N): title, online status, both stat cards with formatted
 *     values, the latest message rendered via formatRelative, and the broker.
 *   - offline branch: the badge flips to "offline".
 *   - empty fleet: 0-valued rates + the em-dash placeholder for last message
 *     AND a blank broker (the `|| '—'` hardening, not `??`).
 *   - compact (1×N): the status badge + messages/sec hero + unit label, with
 *     the title and stat grid withheld.
 *   - empty / loading / error states (EmptyState role="status", Skeleton,
 *     QueryError role="alert").
 *   - refresh wiring: the accessible freshness control refetches.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { VehicleTelemetry } from '@/types/telemetry';

// ── i18n stub: return the English fallback (2nd arg) or the key. ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, def?: string | Record<string, unknown>) =>
      typeof def === 'string' ? def : _key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── The one data hook, driven per test. ──
vi.mock('@/api/hooks/useTelemetry', () => ({ useMQTTStatus: vi.fn() }));

import { useMQTTStatus } from '@/api/hooks/useTelemetry';
import MQTTStatusWidget, { deriveMqttStats } from './MQTTStatusWidget';

const mockMqtt = useMQTTStatus as unknown as ReturnType<typeof vi.fn>;

 
function makeQuery(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function makeVehicle(over: Partial<VehicleTelemetry> = {}): VehicleTelemetry {
  return { vin: 'VIN0', signalCount: 0, batchCount: 0, ...over } as VehicleTelemetry;
}

// ISO string `mins` minutes in the past. The extra 5s buffer keeps the
// relative-time bucket ("3m ago") stable even across a slow test run.
function minutesAgoIso(mins: number): string {
  return new Date(Date.now() - mins * 60_000 - 5_000).toISOString();
}

 
function makeStatus(over: Record<string, unknown> = {}): any {
  return {
    connected: true,
    broker: 'mqtt://broker:1883',
    vehicles: [
      makeVehicle({ vin: 'A', signalCount: 1000, signalsPerSecond: 8.5, lastReceived: minutesAgoIso(3) }),
      makeVehicle({ vin: 'B', signalCount: 500, signalsPerSecond: 4, lastReceived: minutesAgoIso(60) }),
    ],
    ...over,
  };
}

const COMPACT = { cols: 1, rows: 2 };
const STANDARD = { cols: 2, rows: 2 };

function renderWidget(size: { cols: number; rows: number }) {
  return render(
    <MemoryRouter>
      <MQTTStatusWidget size={size} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('deriveMqttStats', () => {
  it('sums signal counts + rates and returns the most-recent lastReceived', () => {
    const out = deriveMqttStats([
      makeVehicle({ vin: 'A', signalCount: 1000, signalsPerSecond: 8.5, lastReceived: '2026-06-01T10:00:00Z' }),
      makeVehicle({ vin: 'B', signalCount: 500, signalsPerSecond: 4, lastReceived: '2026-06-01T12:00:00Z' }),
    ]);

    expect(out.totalMessages).toBe(1500);
    expect(out.messagesPerSec).toBe(12.5);
    expect(out.lastMessage).toBe('2026-06-01T12:00:00Z');
  });

  it('is null-safe for undefined, null, and empty vehicle lists', () => {
    const zero = { totalMessages: 0, messagesPerSec: 0, lastMessage: null };
    expect(deriveMqttStats(undefined)).toEqual(zero);
    expect(deriveMqttStats(null)).toEqual(zero);
    expect(deriveMqttStats([])).toEqual(zero);
  });

  it('prefers camelCase fields, falls back to snake_case, and coerces junk counts to 0', () => {
    const out = deriveMqttStats([
      // camelCase present → wins over the snake_case alias.
      makeVehicle({ signalCount: 10, signal_count: 999, signalsPerSecond: 2, signals_per_second: 999 }),
      // camelCase absent → the snake_case alias is used.
      { vin: 'B', signal_count: 5, signals_per_second: 3 } as unknown as VehicleTelemetry,
      // non-numeric / nullish → safeNumber collapses to 0 (no NaN poisoning).
      { vin: 'C', signalCount: 'oops', signalsPerSecond: null } as unknown as VehicleTelemetry,
    ]);

    expect(out.totalMessages).toBe(15);
    expect(out.messagesPerSec).toBe(5);
    expect(out.lastMessage).toBeNull();
  });

  it('ranks lastReceived by parsed instant (not lexically) and skips unparseable timestamps', () => {
    // '…01.500Z' is 0.5s LATER than '…01Z' but sorts EARLIER as a raw string;
    // parsed-instant ranking must still return the fractional-second value,
    // and the malformed timestamp must never win.
    const out = deriveMqttStats([
      makeVehicle({ vin: 'A', lastReceived: '2026-06-01T10:00:01Z' }),
      makeVehicle({ vin: 'B', lastReceived: '2026-06-01T10:00:01.500Z' }),
      makeVehicle({ vin: 'C', lastReceived: 'not-a-timestamp' }),
    ]);

    expect(out.lastMessage).toBe('2026-06-01T10:00:01.500Z');
  });
});

describe('MQTTStatusWidget — standard layout (2×2)', () => {
  it('renders the title, online status, both stat cards, latest message, and broker', () => {
    mockMqtt.mockReturnValue(makeQuery({ data: makeStatus() }));
    renderWidget(STANDARD);

    expect(screen.getByText('MQTT Status')).toBeInTheDocument();
    expect(screen.getByText('online')).toBeInTheDocument();

    // 8.5 + 4 = 12.5 signals/sec; 1000 + 500 = 1,500 total.
    expect(screen.getByText('Messages/sec')).toBeInTheDocument();
    expect(screen.getByText('12.5')).toBeInTheDocument();
    expect(screen.getByText('Total Messages')).toBeInTheDocument();
    expect(screen.getByText('1,500')).toBeInTheDocument();

    // The latest of the two readings (3m ago) drives the footer.
    expect(screen.getByText('Last Message')).toBeInTheDocument();
    expect(screen.getByText('3m ago')).toBeInTheDocument();
    expect(screen.getByText('Broker')).toBeInTheDocument();
    expect(screen.getByText('mqtt://broker:1883')).toBeInTheDocument();
  });

  it('shows the offline badge when the broker connection is down', () => {
    mockMqtt.mockReturnValue(makeQuery({ data: makeStatus({ connected: false }) }));
    renderWidget(STANDARD);

    expect(screen.getByText('offline')).toBeInTheDocument();
    expect(screen.queryByText('online')).not.toBeInTheDocument();
  });

  it('renders placeholders for an empty fleet: zero rates and "—" for last message + blank broker', () => {
    mockMqtt.mockReturnValue(makeQuery({ data: makeStatus({ broker: '', vehicles: [] }) }));
    renderWidget(STANDARD);

    expect(screen.getByText('0.0')).toBeInTheDocument(); // messages/sec
    expect(screen.getByText('0')).toBeInTheDocument(); // total messages
    // Last-message (no vehicles) AND the blank broker both collapse to the
    // em-dash — the `|| '—'` broker guard is what turns '' into a placeholder.
    expect(screen.getAllByText('—')).toHaveLength(2);
  });
});

describe('MQTTStatusWidget — compact layout (1×N)', () => {
  it('renders the status badge + messages/sec hero and withholds the title + stat grid', () => {
    mockMqtt.mockReturnValue(makeQuery({ data: makeStatus() }));
    renderWidget(COMPACT);

    expect(screen.getByText('online')).toBeInTheDocument();
    expect(screen.getByText('12.5')).toBeInTheDocument();
    expect(screen.getByText('msg/s')).toBeInTheDocument();
    // Compact is title-less and omits the standard stat cards.
    expect(screen.queryByText('MQTT Status')).not.toBeInTheDocument();
    expect(screen.queryByText('Total Messages')).not.toBeInTheDocument();
  });
});

describe('MQTTStatusWidget — states & interaction', () => {
  it('shows the empty state (role="status") when the endpoint returns no data', () => {
    mockMqtt.mockReturnValue(makeQuery({ data: null }));
    renderWidget(STANDARD);

    expect(screen.getByText('No MQTT status data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // Standard keeps its header, but the stat cards are gated behind data.
    expect(screen.getByText('MQTT Status')).toBeInTheDocument();
    expect(screen.queryByText('Messages/sec')).not.toBeInTheDocument();
  });

  it('shows a loading skeleton and withholds the header + content while loading', () => {
    mockMqtt.mockReturnValue(makeQuery({ isLoading: true, data: undefined }));
    const { container } = renderWidget(STANDARD);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('MQTT Status')).not.toBeInTheDocument();
    expect(screen.queryByText('No MQTT status data')).not.toBeInTheDocument();
  });

  it('renders the error branch (role="alert") instead of the widget body on failure', () => {
    mockMqtt.mockReturnValue(makeQuery({ data: undefined, error: new Error('boom'), isError: true }));
    renderWidget(STANDARD);

    // A non-ApiError falls through QueryError to the network/unknown branch.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('MQTT Status')).not.toBeInTheDocument();
  });

  it('refetches when the accessible Refresh control is clicked', () => {
    const refetch = vi.fn();
    mockMqtt.mockReturnValue(makeQuery({ data: makeStatus(), refetch }));
    renderWidget(STANDARD);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
