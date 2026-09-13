/**
 * GhostDrivesPanel — behaviour coverage.
 *
 * The data hook (`useGhostDrives`) is mocked and driven per test; shared UI
 * (OwnershipPanel, DataTable, Badge, AlertBanner, Button) is REAL so the
 * render-boundary wiring is genuinely exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/api/hooks/useOwnership', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useOwnership')>(
    '@/api/hooks/useOwnership',
  );
  return { ...actual, useGhostDrives: vi.fn() };
});

import { useGhostDrives } from '@/api/hooks/useOwnership';
import { GhostDrivesPanel } from './GhostDrivesPanel';

const mockGhosts = useGhostDrives as unknown as ReturnType<typeof vi.fn>;

const ghosts = [
  {
    drive_id: 7,
    started_at: '2026-09-01T21:14:00Z',
    distance_m: 18200,
    duration_s: 1500,
    cluster_id: 0,
    score: 82.5,
    confidence_pct: 41,
    distance_ratio: 2.4,
    reason: 'unattributed drive, 41% confidence, 2.4× typical distance',
  },
  {
    drive_id: 9,
    started_at: '2026-09-02T08:02:00Z',
    distance_m: 9400,
    duration_s: 900,
    cluster_id: 1,
    score: 63.0,
    confidence_pct: 66,
    distance_ratio: 1.3,
    reason: 'unattributed drive, 66% confidence',
  },
];

const report = { vehicle_id: 42, scanned: 24, ghosts };

function idle(extra = {}) {
  return {
    data: undefined, isLoading: false, isFetching: false, error: null,
    refetch: vi.fn(), ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGhosts.mockReturnValue(idle());
});

describe('GhostDrivesPanel', () => {
  it('passes vehicle and window through to the scan query', () => {
    render(<GhostDrivesPanel vehicleId={42} windowDays={30} onLabel={vi.fn()} />);
    expect(mockGhosts).toHaveBeenCalledWith(42, 30);
  });

  it('reports a clear window when nothing is flagged', () => {
    mockGhosts.mockReturnValue(idle({ data: { vehicle_id: 42, scanned: 24, ghosts: [] } }));
    render(<GhostDrivesPanel vehicleId={42} windowDays={90} onLabel={vi.fn()} />);
    expect(screen.getByText('Ghost-driver alerts')).toBeInTheDocument();
    expect(screen.getByText(/No unknown-driver activity/)).toBeInTheDocument();
  });

  it('raises the alert banner and lists flagged drives with reasons', () => {
    mockGhosts.mockReturnValue(idle({ data: report }));
    render(<GhostDrivesPanel vehicleId={42} windowDays={90} onLabel={vi.fn()} />);
    expect(screen.getByText('2 of 24 drives look like someone else')).toBeInTheDocument();
    expect(screen.getByText('2 flagged')).toBeInTheDocument();
    expect(screen.getByText('#7')).toBeInTheDocument();
    expect(
      screen.getByText('unattributed drive, 41% confidence, 2.4× typical distance'),
    ).toBeInTheDocument();
  });

  it('routes the label action back to the caller with the drive id', () => {
    mockGhosts.mockReturnValue(idle({ data: report }));
    const onLabel = vi.fn();
    render(<GhostDrivesPanel vehicleId={42} windowDays={90} onLabel={onLabel} />);
    fireEvent.click(screen.getAllByText('Label')[0]);
    expect(onLabel).toHaveBeenCalledWith(7);
  });

  it('surfaces scan failures without crashing the panel', () => {
    mockGhosts.mockReturnValue(idle({ error: new Error('boom') }));
    render(<GhostDrivesPanel vehicleId={42} windowDays={90} onLabel={vi.fn()} />);
    expect(screen.getByText('Ghost scan failed')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
  });
});
