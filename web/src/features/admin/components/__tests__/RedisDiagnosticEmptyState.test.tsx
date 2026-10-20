/**
 * RedisDiagnosticEmptyState tests.
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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import '@/i18n';
import i18n from '@/i18n';
import { getGlobalLocale, setGlobalLocale } from '@/lib/numberFormat';

vi.unmock('react-i18next');

// Mock the keys hook so we can drive the "other vehicles" section.
vi.mock('@/api/devtools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/devtools')>();
  return {
    ...actual,
    getRedisSignalKeys: vi.fn(),
  };
});

import { getRedisSignalKeys, type RedisSignalsMeta } from '@/api/devtools';
import { ApiError } from '@/lib/resilience';
import { RedisDiagnosticEmptyState } from '../RedisDiagnosticEmptyState';
import { redisSignalKeys } from '@/api/hooks/useRedisSignals';
import { BUTTON_BASE, BUTTON_VARIANTS } from '@/components/ui';

const mockedGetKeys = vi.mocked(getRedisSignalKeys);

const clients: QueryClient[] = [];
let originalLocale: string;

function makeClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return client;
}

function makeWrapper(qc = makeClient()) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter><QueryClientProvider client={qc}>{children}</QueryClientProvider></MemoryRouter>;
  };
}

/**
 * Construct an ApiError-shaped value via Object.assign so the duck-type
 * `isApiError` guard in `web/src/lib/resilience.ts` recognises it even
 * when the bundler splits ApiError across chunks. Mirrors the pattern
 * used by the test for `ApiError` consumers.
 */
function makeApiError(status: number, message: string): ApiError {
  return Object.assign(new Error(message), {
    name: 'ApiError',
    status,
  }) as ApiError;
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
    originalLocale = getGlobalLocale();
    cleanup();
    mockedGetKeys.mockReset();
    mockedGetKeys.mockResolvedValue({ keys: [], total: 0 });
  });

  afterEach(() => {
    cleanup();
    setGlobalLocale(originalLocale);
    clients.splice(0).forEach((client) => client.clear());
    onlineManager.setOnline(true);
  });

  function renderKeys(client = makeClient()) {
    const Wrapper = makeWrapper(client);
    render(
      <Wrapper>
        <RedisDiagnosticEmptyState vehicleId={7} meta={baseMeta()} onSelectVehicle={() => {}} />
      </Wrapper>,
    );
    return client;
  }

  it('shows active key loading without claiming the enumeration is empty', async () => {
    mockedGetKeys.mockReturnValue(new Promise(() => {}));
    renderKeys();
    const section = screen.getByTestId('redis-diagnostic-key-source');
    expect(within(section).getByRole('status')).toHaveAccessibleName(
      'Loading Other vehicles with cached signals',
    );
    expect(within(section).queryByText('No data available')).toBeNull();
    await waitFor(() => expect(mockedGetKeys).toHaveBeenCalledWith(50, {
      signal: expect.any(AbortSignal),
    }));
  });

  it('shows paused-without-data independently and recovers when key reads resume', async () => {
    onlineManager.setOnline(false);
    renderKeys();
    const section = screen.getByTestId('redis-diagnostic-key-source');
    expect(within(section).getByText('Refresh paused')).toBeInTheDocument();
    expect(within(section).queryByText('No data available')).toBeNull();
    expect(within(section).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(mockedGetKeys).not.toHaveBeenCalled();
    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(within(section).getByText('No data available')).toBeInTheDocument());
    expect(within(section).queryByText('Refresh paused')).toBeNull();
  });

  it.each([
    { keys: [], total: 0 },
    { keys: [{ vehicle_id: 1, field_count: 0, display_name: 'Zero' }], total: 1 },
  ])('shows authoritative empty keys without retry for $total enumerated keys', async (data) => {
    mockedGetKeys.mockResolvedValue(data);
    renderKeys();
    const section = screen.getByTestId('redis-diagnostic-key-source');
    await waitFor(() => expect(within(section).getByText('No data available')).toBeInTheDocument());
    expect(within(section).queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByTestId('redis-diagnostic-other-1')).toBeNull();
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(2);
  });

  it('retries a fatal key-source failure without replacing the vehicle diagnostic', async () => {
    mockedGetKeys.mockRejectedValueOnce(new Error('Key enumeration failed'));
    renderKeys();
    const section = screen.getByTestId('redis-diagnostic-key-source');
    const retry = await within(section).findByRole('button', { name: /retry/i });
    expect(screen.getByText('No recent telemetry for this vehicle')).toBeInTheDocument();
    fireEvent.click(retry);
    await waitFor(() => expect(within(section).getByText('No data available')).toBeInTheDocument());
    expect(mockedGetKeys).toHaveBeenCalledTimes(2);
  });

  it('retains successful keys on refresh failure and retries only their source through recovery', async () => {
    mockedGetKeys.mockResolvedValueOnce({
      keys: [{ vehicle_id: 1, field_count: 12, display_name: 'Retained vehicle' }],
      total: 1,
    });
    const client = renderKeys();
    await screen.findByTestId('redis-diagnostic-other-1');
    mockedGetKeys.mockRejectedValueOnce(new Error('Key refresh failed'));
    await act(async () => {
      await client.refetchQueries({ queryKey: redisSignalKeys.keys });
    });
    const section = screen.getByTestId('redis-diagnostic-key-source');
    await within(section).findByText('Previously loaded data remains visible while affected sources recover.');
    expect(within(section).getByText('Cached · refresh failed')).toBeInTheDocument();
    expect(screen.getByTestId('redis-diagnostic-other-1')).toHaveTextContent('Retained vehicle');
    mockedGetKeys.mockResolvedValueOnce({
      keys: [{ vehicle_id: 12, field_count: 5, display_name: 'Recovered vehicle' }],
      total: 1,
    });
    fireEvent.click(within(section).getByRole('button', { name: 'Retry' }));
    await screen.findByTestId('redis-diagnostic-other-12');
    expect(screen.queryByTestId('redis-diagnostic-other-1')).toBeNull();
    expect(within(section).queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(within(section).queryByText('Cached · refresh failed')).toBeNull();
    expect(mockedGetKeys).toHaveBeenCalledTimes(3);
    expect(client.getQueryState(redisSignalKeys.detail(7))).toBeUndefined();
  });

  it('keeps cached keys visible during a paused refresh', () => {
    const client = makeClient();
    client.setQueryData(redisSignalKeys.keys, {
      keys: [{ vehicle_id: 1, field_count: 12, display_name: 'Cached vehicle' }],
      total: 1,
    }, { updatedAt: Date.now() - 60_000 });
    onlineManager.setOnline(false);
    renderKeys(client);
    expect(screen.getByTestId('redis-diagnostic-other-1')).toHaveTextContent('Cached vehicle');
    expect(screen.getByText('Refresh paused')).toBeInTheDocument();
    expect(mockedGetKeys).not.toHaveBeenCalled();
  });

  it('retains a successful empty enumeration through failure and clears the warning on recovery', async () => {
    const client = renderKeys();
    const section = screen.getByTestId('redis-diagnostic-key-source');
    await within(section).findByText('No data available');
    mockedGetKeys.mockRejectedValueOnce(new Error('Empty key refresh failed'));
    await act(async () => {
      await client.refetchQueries({ queryKey: redisSignalKeys.keys });
    });
    await within(section).findByText('Cached · refresh failed');
    // The retained empty enumeration renders the informational empty state
    // (not the bare 'No data available' message) beside the stale warning.
    expect(within(section).getByText('No Redis signal keys are available yet.')).toBeInTheDocument();
    fireEvent.click(within(section).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(within(section).queryByText('Cached · refresh failed')).toBeNull());
    expect(within(section).getByText('No data available')).toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Retry' })).toBeNull();
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

  it.each([
    {
      key: 'redis.diagnostic.modeLocal.cta',
      label: 'See live-state contract docs',
      href: '/docs/caching',
      meta: baseMeta({ live_signal_store_mode: 'local' }),
      serverError: undefined,
    },
    {
      key: 'redis.diagnostic.cacheNotWired.cta',
      label: 'See cache configuration docs',
      href: '/docs/caching#configuration',
      meta: undefined,
      serverError: makeApiError(503, 'Redis signal cache is not available'),
    },
  ])('renders $key as one focusable navigation target with shared button chrome', ({ key, label, href, meta, serverError }) => {
    const translate = vi.spyOn(i18n, 't');
    const Wrapper = makeWrapper();
    try {
      render(
        <Wrapper>
          <RedisDiagnosticEmptyState
            vehicleId={7}
            meta={meta}
            serverError={serverError}
            onSelectVehicle={() => {}}
          />
        </Wrapper>,
      );
      const banner = screen.getByTestId('redis-diagnostic-banner');
      const link = within(banner).getByRole('link', { name: label });
      expect(within(banner).getAllByRole('link')).toHaveLength(1);
      expect(link.tagName).toBe('A');
      expect(link).toHaveAttribute('href', href);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noreferrer');
      expect(link.querySelector('button, a, input, select, textarea, [tabindex]')).toBeNull();
      expect(within(banner).queryByRole('button', { name: label })).toBeNull();
      expect(link).toHaveClass(...BUTTON_BASE.split(/\s+/), ...BUTTON_VARIANTS.secondary.split(/\s+/));
      expect(link).toHaveClass('min-h-11', 'min-w-11', 'md:min-h-9', 'px-3');
      link.focus();
      expect(link).toHaveFocus();
      // react-i18next forwards (key, fallback) as (key, { defaultValue }); pin the same key + fallback.
      expect(translate).toHaveBeenCalledWith(key, expect.objectContaining({ defaultValue: label }));
    } finally {
      translate.mockRestore();
    }
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

  it('translates unnamed vehicles and formats counts without changing raw identifiers or populated names', async () => {
    setGlobalLocale('de-DE');
    const translate = vi.spyOn(i18n, 't');
    mockedGetKeys.mockResolvedValue({
      keys: [
        { vehicle_id: 12345, field_count: 1234 },
        { vehicle_id: 23456, field_count: 2345, vehicle_vin: 'VIN23456' },
        { vehicle_id: 34567, field_count: 3456, vehicle_vin: 'VIN34567', display_name: 'Falcon' },
      ],
      total: 3,
    });
    const onSelect = vi.fn();
    const Wrapper = makeWrapper();
    try {
      render(
        <Wrapper>
          <RedisDiagnosticEmptyState
            vehicleId={7}
            meta={baseMeta({ l1_signal_count: 1234 })}
            onSelectVehicle={onSelect}
          />
        </Wrapper>,
      );
      const unnamed = await screen.findByTestId('redis-diagnostic-other-12345');
      expect(unnamed).toHaveTextContent('Vehicle 12345 · 1.234');
      // react-i18next forwards (key, fallback, opts) as (key, { defaultValue, ...opts }); pin the same key + fallback + id.
      expect(translate).toHaveBeenCalledWith('redis.vehicleFallback', expect.objectContaining({ defaultValue: 'Vehicle {{id}}', id: 12345 }));
      expect(screen.getByTestId('redis-diagnostic-other-23456')).toHaveTextContent('VIN23456 · 2.345');
      expect(screen.getByTestId('redis-diagnostic-other-34567')).toHaveTextContent('Falcon · 3.456');
      expect(screen.getByText(/has 1\.234 signals/)).toBeInTheDocument();
      expect(screen.getByText('1.234')).toBeInTheDocument();
      expect(screen.getByText('vehicle:7:signals')).toBeInTheDocument();
      expect(screen.getByText('TESLA1234567890')).toBeInTheDocument();
      fireEvent.click(unnamed);
      expect(onSelect).toHaveBeenCalledWith(12345);
      act(() => setGlobalLocale('en-US'));
      expect(unnamed).toHaveTextContent('Vehicle 12345 · 1,234');
      expect(screen.getByText(/has 1,234 signals/)).toBeInTheDocument();
    } finally {
      translate.mockRestore();
    }
  });

  it('formats both metadata counts while preserving the Redis key and mode', () => {
    setGlobalLocale('de-DE');
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RedisDiagnosticEmptyState
          vehicleId={12345}
          meta={baseMeta({
            live_signal_store_mode: 'local',
            redis_key: 'vehicle:12345:signals',
            l1_signal_count: 1234,
            redis_field_count: 5678,
          })}
          onSelectVehicle={() => {}}
        />
      </Wrapper>,
    );
    expect(screen.getByText('1.234')).toBeInTheDocument();
    expect(screen.getByText('5.678')).toBeInTheDocument();
    expect(screen.getByText('vehicle:12345:signals')).toBeInTheDocument();
    expect(screen.getByText('local')).toBeInTheDocument();
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

  // Error-aware branches: 503 / network errors should never masquerade as
  // the legacy "no signals cached" empty state.

  it('renders the cacheNotWired banner when serverError is 503 "not available"', () => {
    const Wrapper = makeWrapper();
    const err = makeApiError(503, 'Redis signal cache is not available');
    render(
      <Wrapper>
        <RedisDiagnosticEmptyState
          vehicleId={1}
          meta={undefined}
          serverError={err}
          onSelectVehicle={() => {}}
        />
      </Wrapper>,
    );
    const banner = screen.getByTestId('redis-diagnostic-banner');
    expect(banner).toHaveAttribute('data-tone', 'danger');
    expect(within(banner).getByText('Redis cache is not configured')).toBeInTheDocument();
    // The legacy fallback string MUST NOT appear when an error is present.
    expect(screen.queryByText('No signals cached for this vehicle')).toBeNull();
    // CTA link to the docs is rendered.
    expect(within(banner).getByRole('link', { name: /cache configuration docs/i })).toBeInTheDocument();
  });

  it('renders the unreachable banner when serverError is 503 "unreachable"', () => {
    const Wrapper = makeWrapper();
    const err = makeApiError(503, 'Redis is unreachable');
    render(
      <Wrapper>
        <RedisDiagnosticEmptyState
          vehicleId={1}
          meta={undefined}
          serverError={err}
          onSelectVehicle={() => {}}
        />
      </Wrapper>,
    );
    const banner = screen.getByTestId('redis-diagnostic-banner');
    expect(banner).toHaveAttribute('data-tone', 'danger');
    expect(within(banner).getByText('Redis is unreachable')).toBeInTheDocument();
    expect(screen.queryByText('No signals cached for this vehicle')).toBeNull();
  });

  it('renders the requestFailed banner when serverError is a generic 500', () => {
    const Wrapper = makeWrapper();
    const err = makeApiError(500, 'database query failed');
    render(
      <Wrapper>
        <RedisDiagnosticEmptyState
          vehicleId={1}
          meta={undefined}
          serverError={err}
          onSelectVehicle={() => {}}
        />
      </Wrapper>,
    );
    const banner = screen.getByTestId('redis-diagnostic-banner');
    expect(banner).toHaveAttribute('data-tone', 'warning');
    expect(within(banner).getByText('Could not load Redis signals')).toBeInTheDocument();
    // The body interpolates the status + raw message so an operator can
    // grep the API logs for the same string.
    expect(within(banner).getByText(/500/)).toBeInTheDocument();
    expect(within(banner).getByText(/database query failed/i)).toBeInTheDocument();
    expect(screen.queryByText('No signals cached for this vehicle')).toBeNull();
  });

  it('renders the networkError banner when networkError=true', () => {
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <RedisDiagnosticEmptyState
          vehicleId={1}
          meta={undefined}
          serverError={null}
          networkError
          onSelectVehicle={() => {}}
        />
      </Wrapper>,
    );
    const banner = screen.getByTestId('redis-diagnostic-banner');
    expect(banner).toHaveAttribute('data-tone', 'warning');
    expect(within(banner).getByText('Cannot reach the API server')).toBeInTheDocument();
    expect(screen.queryByText('No signals cached for this vehicle')).toBeNull();
  });

  it('error branches take precedence over meta-driven branches', () => {
    // Even with valid meta indicating an "L2 mirror is failing" condition,
    // a server error wins. The operator needs to fix the connection
    // before the meta-driven diagnostic could be trusted anyway.
    const Wrapper = makeWrapper();
    const err = makeApiError(503, 'Redis signal cache is not available');
    render(
      <Wrapper>
        <RedisDiagnosticEmptyState
          vehicleId={7}
          meta={baseMeta({ l1_signal_count: 99, redis_field_count: 0 })}
          serverError={err}
          onSelectVehicle={() => {}}
        />
      </Wrapper>,
    );
    const banner = screen.getByTestId('redis-diagnostic-banner');
    expect(within(banner).getByText('Redis cache is not configured')).toBeInTheDocument();
    expect(screen.queryByText('L2 mirror is failing')).toBeNull();
  });
});
