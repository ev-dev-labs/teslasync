import type { ComponentType } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { fmtNumber } from '@/lib/numberFormat';
import ChargeStatusWidget from '../../widgets/ChargeStatusWidget';
import ChargeHistoryWidget from '../../widgets/ChargeHistoryWidget';
import DoorWindowStatusWidget from '../../widgets/DoorWindowStatusWidget';
import SafetyFeaturesWidget from '../../widgets/SafetyFeaturesWidget';
import type { WidgetProps } from '../../widgets/types';
import { queryResult, renderWidget } from './testSupport';

const hooks = vi.hoisted(() => ({
  vehicles: vi.fn(), state: vi.fn(), security: vi.fn(), safety: vi.fn(), charging: vi.fn(),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => hooks.vehicles(),
  useVehicleState: (...args: unknown[]) => hooks.state(...args),
  useSecurityLatest: (...args: unknown[]) => hooks.security(...args),
}));
vi.mock('@/api/hooks/useVehicleSystems', () => ({ useSafety: (...args: unknown[]) => hooks.safety(...args) }));
vi.mock('@tanstack/react-query', async (original) => {
  const actual = await original<typeof import('@tanstack/react-query')>();
  return { ...actual, useQuery: (...args: unknown[]) => hooks.charging(...args) };
});

const widgets: { name: string; Widget: ComponentType<WidgetProps> }[] = [
  { name: 'Charge status', Widget: ChargeStatusWidget },
  { name: 'Charge history', Widget: ChargeHistoryWidget },
  { name: 'Door and window status', Widget: DoorWindowStatusWidget },
  { name: 'Safety features', Widget: SafetyFeaturesWidget },
];

beforeEach(() => {
  vi.clearAllMocks();
  hooks.vehicles.mockReturnValue(queryResult([{ id: 7 }]));
  hooks.state.mockReturnValue(queryResult({ state: { is_charging: false, battery_level: 0, rated_range: 0 } }));
  hooks.security.mockReturnValue(queryResult({
    door_state: 'closed', fd_window: 'Closed', fp_window: 'Closed', rd_window: 'Closed', rp_window: 'Closed',
  }));
  hooks.safety.mockReturnValue(queryResult({ automatic_emergency_braking_off: false }));
  hooks.charging.mockReturnValue(queryResult([]));
});

describe.each(widgets)('$name discovery recovery', ({ Widget }) => {
  it('retries fleet discovery rather than the disabled reading when no vehicle resolved', () => {
    const discoveryRetry = vi.fn();
    hooks.vehicles.mockReturnValue(queryResult(undefined, { error: new Error('Fleet unavailable'), isError: true, refetch: discoveryRetry }));
    renderWidget(<Widget size={{ cols: 2, rows: 4 }} />);
    expect(screen.getByRole('alert')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(discoveryRetry).toHaveBeenCalledOnce();
  });

  it('does not let unrelated fleet discovery failure hide an explicitly selected vehicle', () => {
    hooks.vehicles.mockReturnValue(queryResult(undefined, { error: new Error('Fleet unavailable'), isError: true }));
    renderWidget(<Widget vehicleId={7} size={{ cols: 2, rows: 4 }} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

it('keeps measured zero battery distinct from a missing charge-status reading', () => {
  const { rerender } = renderWidget(<ChargeStatusWidget vehicleId={7} size={{ cols: 2, rows: 4 }} />);
  expect(screen.getByText(`${fmtNumber(0)}%`)).toBeVisible();
  hooks.state.mockReturnValue(queryResult({ state: { is_charging: false } }));
  rerender(<ChargeStatusWidget vehicleId={7} size={{ cols: 2, rows: 4 }} />);
  expect(screen.queryByText(`${fmtNumber(0)}%`)).not.toBeInTheDocument();
  expect(screen.getByText('Battery')).toBeVisible();
  expect(screen.getAllByText('—').length).toBeGreaterThan(0);
});
