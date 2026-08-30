import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { OnboardingStatus } from '@/api/hooks/useOnboarding';
import type { RuntimeStatusSnapshot } from '@/types/admin';
import { RuntimeHealthBanner } from './RuntimeHealthBanner';

let runtimeData: RuntimeStatusSnapshot | undefined;
let onboardingData: OnboardingStatus | undefined;
const navigate = vi.fn();

vi.mock('@/api/hooks/useAdmin', () => ({
  useRuntimeStatus: () => ({ data: runtimeData }),
}));

vi.mock('@/api/hooks/useOnboarding', () => ({
  useOnboardingStatus: () => ({ data: onboardingData }),
}));

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatDateTime: (value: string) => `formatted:${value}` }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
      Object.entries(vars ?? {}).reduce(
        (text, [name, value]) => text.replace(`{{${name}}}`, String(value)),
        fallback,
      ),
  }),
}));

function runtime(
  components: RuntimeStatusSnapshot['components'],
  status: RuntimeStatusSnapshot['status'] = 'operational',
): RuntimeStatusSnapshot {
  return {
    status,
    generated_at: '2026-01-01T01:00:00Z',
    components,
    counts: {
      components_total: components.length,
      components_healthy: components.filter((item) => item.status === 'healthy').length,
      components_degraded: components.filter((item) => item.status === 'degraded').length,
      components_unhealthy: components.filter((item) => item.status === 'unhealthy').length,
    },
  };
}

function onboarding(overrides: Partial<OnboardingStatus> = {}): OnboardingStatus {
  return {
    tesla_connected: true,
    vehicle_count: 1,
    data_flowing: true,
    last_telemetry_at: '2026-01-01T00:00:00Z',
    telemetry_health: 'healthy',
    setup_required: false,
    setup_complete: true,
    is_complete: true,
    ...overrides,
  };
}

function renderBanner() {
  return render(
    <MemoryRouter>
      <RuntimeHealthBanner />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  navigate.mockReset();
  onboardingData = onboarding();
  runtimeData = runtime([
    { name: 'database', status: 'healthy', consecutive_failures: 0 },
    { name: 'telemetry', status: 'healthy', consecutive_failures: 0 },
  ]);
});

describe('RuntimeHealthBanner', () => {
  it('stays hidden while every checked component is healthy or unknown', () => {
    runtimeData = runtime([
      { name: 'database', status: 'healthy', consecutive_failures: 0 },
      { name: 'redis', status: 'unknown', consecutive_failures: 0 },
    ]);
    renderBanner();
    expect(screen.queryByTestId('runtime-health-banner')).toBeNull();
  });

  it('shows affected components and the last telemetry timestamp without blocking access', () => {
    runtimeData = runtime([
      { name: 'mqtt', status: 'degraded', consecutive_failures: 3 },
      { name: 'telemetry', status: 'degraded', consecutive_failures: 3 },
    ], 'degraded');
    onboardingData = onboarding({
      data_flowing: false,
      telemetry_health: 'stale',
    });

    renderBanner();

    expect(screen.getByTestId('runtime-health-banner')).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('runtime-health-banner')).toHaveAttribute('data-data-state', 'partial');
    expect(screen.getByText(/Affected components: MQTT, Fleet Telemetry/i)).toBeInTheDocument();
    expect(screen.getByText(/formatted:2026-01-01T00:00:00Z/i)).toBeInTheDocument();
    expect(screen.getByText(/Stored history remains available/i)).toBeInTheDocument();
  });

  it('links to system status and per-channel health alert settings', () => {
    runtimeData = runtime([
      { name: 'database', status: 'unhealthy', consecutive_failures: 10 },
    ], 'down');
    renderBanner();

    fireEvent.click(screen.getByRole('button', { name: 'System status' }));
    expect(navigate).toHaveBeenCalledWith('/system-status');
    fireEvent.click(screen.getByRole('button', { name: 'Health alerts' }));
    expect(navigate).toHaveBeenCalledWith('/notifications/channels');
    expect(screen.getByTestId('runtime-health-banner')).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('runtime-health-banner')).toHaveAttribute('data-data-state', 'unavailable');
  });

  it('does not show runtime degradation as an onboarding error for a fresh install', () => {
    onboardingData = onboarding({ setup_required: true, setup_complete: false, is_complete: false });
    runtimeData = runtime([
      { name: 'tesla_api', status: 'degraded', consecutive_failures: 3 },
    ], 'degraded');
    renderBanner();
    expect(screen.queryByTestId('runtime-health-banner')).toBeNull();
  });

  it('clears automatically when the component snapshot recovers', () => {
    runtimeData = runtime([
      { name: 'mqtt', status: 'degraded', consecutive_failures: 3 },
    ], 'degraded');
    const { rerender } = renderBanner();
    expect(screen.getByTestId('runtime-health-banner')).toBeInTheDocument();

    runtimeData = runtime([
      { name: 'mqtt', status: 'healthy', consecutive_failures: 0 },
    ]);
    rerender(
      <MemoryRouter>
        <RuntimeHealthBanner />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('runtime-health-banner')).toBeNull();
  });
});
