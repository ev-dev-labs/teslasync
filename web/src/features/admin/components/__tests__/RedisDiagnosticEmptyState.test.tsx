/**
 * Phase-45 / Prompt 37 — RedisDiagnosticEmptyState tests.
 *
 * Verifies the four diagnostic branches that replace the legacy generic
 * "no signals cached" empty state on the Redis Signal Viewer page:
 *   1. mode=local → red "L2 writes disabled" banner
 *   2. mode=hybrid + L1 has data + L2 empty → orange "mirror failing" banner
 *   3. mode=hybrid + both empty + L1 stale-or-absent → amber "no telemetry" banner
 *   4. mode=hybrid + both empty + recent L1 → neutral fallthrough banner
 * Plus: meta=undefined back-compat fallback, and onSelectVehicle wiring
 * for the "other vehicles with cached signals" chips.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import '@/i18n';

// Mock the keys hook so we can drive the "other vehicles" section.
vi.mock('@/api/devtools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/devtools')>();
  return {
    ...actual,
    getRedisSignalKeys: vi.fn(),
  };
});

import { getRedisSignalKeys, type RedisSignalsMeta } from '@/api/devtools';
import { RedisDiagnosticEmptyState } from '../RedisDiagnosticEmptyState';

const mockedGetKeys = getRedisSignalKeys as unknown as ReturnType<typeof vi.fn>;

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function baseMeta(overrides: Partial<RedisSignalsMeta> = {}): RedisSignalsMeta {
  return {
    live_signal_store_mode: 'hybrid',
    redis_key: 'vehicle:7:signals',
    redis_field_count: 0,
    l1_signal_count: 0,
    l1_last_seen_at: null,
    l2_last_seen_at: null,
    vehicle_vin: 'TESLA1234567890',
    ...overrides,
  };
}

describe('RedisDiagnosticEmptyState — Phase-45 / Prompt 37', () => {
  beforeEach(() => {
    cleanup();
    mockedGetKeys.mockReset();
    mockedGetKeys.mockResolvedValue({ keys: [], total: 0 });
  });

  it('renders the legacy generic message when meta is undefined', () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RedisDiagnosticEmptyState
          vehicleId={7}
          meta={undefined}
          onSelectVehicle={() => {}}
        />
      </Wrapper>,
    );
    expect(
      screen.getByText('No signals cached for this vehicle'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('redis-diagnostic-banner')).toBeNull();
  });

  it('renders the danger banner when mode=local', () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RedisDiagnosticEmptyState
          vehicleId={7}
          meta={baseMeta({ live_signal_store_mode: 'local' })}
          onSelectVehicle={() => {}}
        />
      </Wrapper>,
    );
    const banner = screen.getByTestId('redis-diagnostic-banner');
    expect(banner).toHaveAttribute('data-tone', 'danger');
    expect(within(banner).getByText('Redis L2 writes are disabled')).toBeInTheDocument();
    // CTA link is rendered for the docs.
    expect(within(banner).getByRole('link', { name: /live-state contract docs/i })).toBeInTheDocument();
  });

  it('renders the warning banner when L1 has data but L2 is empty', () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RedisDiagnosticEmptyState
          vehicleId={7}
          meta={baseMeta({
            l1_signal_count: 42,
            redis_field_count: 0,
            l1_last_seen_at: new Date().toISOString(),
          })}
          onSelectVehicle={() => {}}
        />
      </Wrapper>,
    );
    const banner = screen.getByTestId('redis-diagnostic-banner');
    expect(banner).toHaveAttribute('data-tone', 'warning');
    expect(within(banner).getByText('L2 mirror is failing')).toBeInTheDocument();
    // The body interpolates the L1 signal count.
    expect(within(banner).getByText(/has 42 signals/i)).toBeInTheDocument();
  });

  it('renders the no-telemetry banner when both empty and L1 last-seen is absent', () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RedisDiagnosticEmptyState
          vehicleId={7}
          meta={baseMeta({ l1_signal_count: 0, redis_field_count: 0, l1_last_seen_at: null })}
          onSelectVehicle={() => {}}
        />
      </Wrapper>,
    );
    const banner = screen.getByTestId('redis-diagnostic-banner');
    expect(banner).toHaveAttribute('data-tone', 'info');
    expect(within(banner).getByText('No recent telemetry for this vehicle')).toBeInTheDocument();
    expect(within(banner).getByText(/has no L1 entries on this pod/i)).toBeInTheDocument();
  });

  it('renders the no-telemetry banner with stale-date body when L1 last-seen is older than 7 days', () => {
    const Wrapper = makeWrapper();
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    render(
      <Wrapper>
        <RedisDiagnosticEmptyState
          vehicleId={7}
          meta={baseMeta({ l1_signal_count: 0, redis_field_count: 0, l1_last_seen_at: tenDaysAgo })}
          onSelectVehicle={() => {}}
        />
      </Wrapper>,
    );
    const banner = screen.getByTestId('redis-diagnostic-banner');
    expect(banner).toHaveAttribute('data-tone', 'info');
    expect(within(banner).getByText(/7-day Redis TTL has likely expired/i)).toBeInTheDocument();
  });

  it('renders the neutral fallthrough banner when both empty but L1 has recent absence', () => {
    // Neutral branch: l1_signal_count=0 BUT l1_last_seen_at is recent (within 7 days).
    // This is the rare "vehicle stopped streaming a few minutes ago, L2 already
    // expired" shape — covers the post-TTL fall-through.
    const Wrapper = makeWrapper();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    render(
      <Wrapper>
        <RedisDiagnosticEmptyState
          vehicleId={7}
          meta={baseMeta({
            // l1_signal_count > 0 disables the no-telemetry branch but not mirror-broken
            // unless l2 raw == 0. Keep l1=1 + l2=1 for fallthrough — the simplest path
            // is to keep l1_signal_count=0 with a recent timestamp, which is exactly
            // what the component branches on.
            l1_signal_count: 0,
            redis_field_count: 0,
            l1_last_seen_at: oneHourAgo,
          })}
          onSelectVehicle={() => {}}
        />
      </Wrapper>,
    );
    const banner = screen.getByTestId('redis-diagnostic-banner');
    expect(banner).toHaveAttribute('data-tone', 'neutral');
    expect(within(banner).getByText('No signals cached for this vehicle')).toBeInTheDocument();
  });

  it('renders the "other vehicles" chips when the keys endpoint has data and invokes onSelectVehicle on click', async () => {
    mockedGetKeys.mockResolvedValue({
      keys: [
        { vehicle_id: 1, field_count: 230, vehicle_vin: 'VIN1', display_name: 'Falcon' },
        { vehicle_id: 7, field_count: 0 }, // self — must be filtered out
        { vehicle_id: 12, field_count: 142, vehicle_vin: 'VIN12', display_name: 'Phoenix' },
      ],
      total: 3,
    });
    const onSelect = vi.fn();
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RedisDiagnosticEmptyState
          vehicleId={7}
          meta={baseMeta({ l1_signal_count: 0, redis_field_count: 0, l1_last_seen_at: null })}
          onSelectVehicle={onSelect}
        />
      </Wrapper>,
    );

    const chip1 = await screen.findByTestId('redis-diagnostic-other-1');
    expect(chip1).toHaveTextContent('Falcon');
    const chip12 = screen.getByTestId('redis-diagnostic-other-12');
    expect(chip12).toHaveTextContent('Phoenix');
    // Self must NOT appear.
    expect(screen.queryByTestId('redis-diagnostic-other-7')).toBeNull();

    fireEvent.click(chip1);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('hides the "other vehicles" section when the keys endpoint returns empty', () => {
    mockedGetKeys.mockResolvedValue({ keys: [], total: 0 });
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RedisDiagnosticEmptyState
          vehicleId={7}
          meta={baseMeta({ l1_signal_count: 0, redis_field_count: 0, l1_last_seen_at: null })}
          onSelectVehicle={() => {}}
        />
      </Wrapper>,
    );
    expect(screen.queryByTestId('redis-diagnostic-other-vehicles')).toBeNull();
  });

  it('always renders the diagnostic meta list (mode + key + counts + last-seen)', () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RedisDiagnosticEmptyState
          vehicleId={7}
          meta={baseMeta({
            redis_field_count: 0,
            l1_signal_count: 0,
            l1_last_seen_at: null,
          })}
          onSelectVehicle={() => {}}
        />
      </Wrapper>,
    );
    const banner = screen.getByTestId('redis-diagnostic-banner');
    expect(within(banner).getByText('Redis key')).toBeInTheDocument();
    expect(within(banner).getByText('vehicle:7:signals')).toBeInTheDocument();
    expect(within(banner).getByText('L1 signals')).toBeInTheDocument();
    expect(within(banner).getByText('L2 fields (raw)')).toBeInTheDocument();
    expect(within(banner).getByText('VIN')).toBeInTheDocument();
    expect(within(banner).getByText('TESLA1234567890')).toBeInTheDocument();
  });
});
