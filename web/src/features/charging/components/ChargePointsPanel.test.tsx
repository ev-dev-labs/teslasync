/**
 * ChargePointsPanel — behaviour coverage.
 *
 * Data hooks (`useOcppChargePoints` / `useOcppSessions`) are mocked and
 * driven per test; shared UI (GlassPanel, Badge, QueryError, EmptyState)
 * is REAL so the render-boundary wiring is genuinely exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/api/hooks/useOcpp', () => ({
  useOcppChargePoints: vi.fn(),
  useOcppSessions: vi.fn(),
}));

import { useOcppChargePoints, useOcppSessions } from '@/api/hooks/useOcpp';
import type { OcppChargePoint, OcppSession } from '@/api/hooks/useOcpp';
import { ChargePointsPanel } from './ChargePointsPanel';

const mockPoints = useOcppChargePoints as unknown as ReturnType<typeof vi.fn>;
const mockSessions = useOcppSessions as unknown as ReturnType<typeof vi.fn>;

const chargePoint: OcppChargePoint = {
  id: 'wallbox-1',
  vendor: 'Wallbox',
  model: 'Pulsar Plus',
  serial_number: 'WB123',
  firmware_version: '5.1',
  last_boot_at: '2026-03-01T10:00:00Z',
  last_seen_at: '2026-03-01T12:00:00Z',
  connectors: [
    { connector_id: 1, status: 'Charging', error_code: 'NoError', info: '', updated_at: '2026-03-01T12:00:00Z' },
    { connector_id: 2, status: 'Available', error_code: 'NoError', info: '', updated_at: '2026-03-01T12:00:00Z' },
  ],
  active_sessions: 1,
};

const session: OcppSession = {
  transaction_id: 42,
  charge_point_id: 'wallbox-1',
  connector_id: 1,
  started_at: '2026-03-01T11:00:00Z',
  start_meter_wh: 1000,
  ended_at: '2026-03-01T12:00:00Z',
  end_meter_wh: 8500,
  stop_reason: 'EVDisconnected',
  energy_delivered_wh: 7500,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPoints.mockReturnValue({ data: [chargePoint], isLoading: false, isError: false, error: null, refetch: vi.fn() });
  mockSessions.mockReturnValue({ data: [session], isLoading: false, isError: false, error: null, refetch: vi.fn() });
});

describe('ChargePointsPanel', () => {
  it('renders charger identity with per-connector status badges', () => {
    render(<ChargePointsPanel />);
    expect(screen.getByText('OCPP Charge Points')).toBeInTheDocument();
    expect(screen.getByText('Wallbox Pulsar Plus')).toBeInTheDocument();
    expect(screen.getByText('#1 Charging')).toBeInTheDocument();
    expect(screen.getByText('#2 Available')).toBeInTheDocument();
    expect(screen.getByText('1 active')).toBeInTheDocument();
  });

  it('renders recent sessions with delivered energy', () => {
    render(<ChargePointsPanel />);
    expect(screen.getByText('Recent sessions')).toBeInTheDocument();
    expect(screen.getByText(/wallbox-1 · #42/)).toBeInTheDocument();
  });

  it('renders an empty state when no charger has reported', () => {
    mockPoints.mockReturnValue({ data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() });
    mockSessions.mockReturnValue({ data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() });
    render(<ChargePointsPanel />);
    expect(screen.getByText(/No OCPP chargers reporting yet/)).toBeInTheDocument();
    expect(screen.queryByText('Recent sessions')).not.toBeInTheDocument();
  });

  it('surfaces query errors with retry', () => {
    mockPoints.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('db down'),
      refetch: vi.fn(),
    });
    render(<ChargePointsPanel />);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
