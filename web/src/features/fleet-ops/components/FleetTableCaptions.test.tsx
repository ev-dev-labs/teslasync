import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FleetAssignment, FleetChargingPolicy, FleetDriver, FleetReservation } from '@/api/hooks/useFleetOps';
import { AssignmentRoster } from './AssignmentRoster';
import { ChargingPolicyMatrix } from './ChargingPolicyMatrix';
import { DriverRoster } from './DriverRoster';
import { ReservationPanel } from './ReservationPanel';

vi.mock('react-i18next', async () => ({
  ...await vi.importActual<typeof import('react-i18next')>('react-i18next'),
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string, fallback: string, values?: Record<string, string>) => {
      const titles: Record<string, string> = {
        'fleetOps.drivers.title': 'Translated drivers',
        'fleetOps.assignments.title': 'Translated assignments',
        'fleetOps.reservations.title': 'Translated reservations',
        'fleetOps.policies.title': 'Translated policies',
      };
      return titles[key] ?? Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replace(`{{${name}}}`, value), fallback,
      );
    },
  }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatPower: (value: number | null) => value == null ? '—' : `${value / 1000} kW`,
  }),
}));

const metadata = {
  id: 1, version: 1,
  created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z',
};
const vehicle = { vehicle_id: 7, vehicle_display_name: 'Pool vehicle' };
const driver: FleetDriver = {
  ...metadata, display_name: 'Roster driver', reference_code: 'DRV-A', status: 'active',
};
const assignment: FleetAssignment = {
  ...metadata, ...vehicle, driver_id: 2, driver_display_name: 'Assigned driver',
  starts_at: metadata.created_at, ends_at: null, notes: null,
};
const reservation: FleetReservation = {
  ...assignment, title: 'Airport run', purpose: null, status: 'confirmed',
  cost_center_id: null, cost_center_name: null, ends_at: '2026-10-01T14:00:00Z',
};
const policy: FleetChargingPolicy = {
  ...metadata, ...vehicle, name: 'Depot nights', target_soc_pct: 80, max_power_w: 11000,
  priority: 10, effective_from: metadata.created_at, effective_to: null, enabled: true,
  windows: [{ day_of_week: 1, start_local_time: '00:00', end_local_time: '06:00' }],
};
const callbacks = {
  onRetry: vi.fn(), onAdd: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onCancel: vi.fn(),
};
const props = { loading: false, error: null, ...callbacks };
const cases = [
  {
    name: 'Translated drivers', tableId: 'fleet-ops:drivers', item: driver,
    content: 'Roster driver', action: 'Edit Roster driver',
    render: () => <DriverRoster {...props} items={[driver]} />,
  },
  {
    name: 'Translated assignments', tableId: 'fleet-ops:assignments', item: assignment,
    content: 'Assigned driver', action: 'Edit assignment for Assigned driver',
    render: () => <AssignmentRoster {...props} items={[assignment]} />,
  },
  {
    name: 'Translated reservations', tableId: 'fleet-ops:reservations', item: reservation,
    content: 'Airport run', action: 'Edit Airport run',
    render: () => <ReservationPanel {...props} items={[reservation]} />,
  },
  {
    name: 'Translated policies', tableId: 'fleet-ops:charging-policies', item: policy,
    content: 'Depot nights', action: 'Edit Depot nights',
    render: () => <ChargingPolicyMatrix {...props} items={[policy]} />,
  },
];

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe('fleet operation table captions', () => {
  it.each(cases)('names $tableId with its translated section title and preserves populated rows/actions', (testCase) => {
    render(testCase.render());
    const table = screen.getByRole('table', { name: testCase.name });
    expect(table.querySelector('caption')).toHaveTextContent(testCase.name);
    expect(screen.getByRole('heading', { name: testCase.name })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: testCase.tableId })).not.toBeInTheDocument();
    expect(within(table).getByText(testCase.content)).toBeInTheDocument();
    fireEvent.click(within(table).getByRole('button', { name: testCase.action }));
    expect(callbacks.onEdit).toHaveBeenCalledWith(testCase.item);
    fireEvent.click(screen.getByRole('radio', { name: 'Compact' }));
    expect(localStorage.getItem(`teslasync.table.${testCase.tableId}.density`)).toBe(JSON.stringify('compact'));
  });
});
