import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FleetAssignment, FleetDriver } from '@/api/hooks/useFleetOps';
import { AssignmentDialog } from './AssignmentDialog';

const mutations = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
}));
vi.mock('@/api/hooks/useFleetOps', () => ({
  useCreateFleetAssignment: () => ({
    mutate: mutations.create, reset: vi.fn(), isPending: false, error: null,
  }),
  useUpdateFleetAssignment: () => ({
    mutate: mutations.update, reset: vi.fn(), isPending: false, error: null,
  }),
}));

const drivers: FleetDriver[] = [
  { id: 2, display_name: 'Driver A', reference_code: 'A', status: 'active',
    version: 1, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' },
  { id: 3, display_name: 'Driver B', reference_code: 'B', status: 'active',
    version: 1, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' },
];
const vehicles = [
  { id: 7, display_name: 'Pool A', vin: 'TEST7' },
  { id: 8, display_name: 'Pool B', vin: 'TEST8' },
];
const callbacks = {
  onClose: vi.fn(), onSaved: vi.fn(), onDelete: vi.fn(), onRefresh: vi.fn(),
};

beforeEach(() => vi.clearAllMocks());

describe('actual assignment dialog member selections', () => {
  it('keeps user-selected member IDs and unsaved notes when refreshed choice labels and order change', () => {
    const original = JSON.stringify({ drivers, vehicles });
    const { rerender } = render(
      <AssignmentDialog item={null} drivers={drivers} vehicles={vehicles} {...callbacks} />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Add assignment' });
    const driverField = within(dialog).getByLabelText(/^Driver/);
    const vehicleField = within(dialog).getByLabelText(/^Vehicle/);
    fireEvent.change(driverField, { target: { value: '3' } });
    fireEvent.change(vehicleField, { target: { value: '8' } });
    fireEvent.change(within(dialog).getByLabelText(/^Notes/), { target: { value: 'Keep draft notes' } });
    rerender(
      <AssignmentDialog item={null}
        drivers={[...drivers].reverse().map(driver => ({ ...driver, display_name: `${driver.display_name} renamed` }))}
        vehicles={[...vehicles].reverse().map(vehicle => ({ ...vehicle, display_name: `${vehicle.display_name} renamed` }))}
        {...callbacks} />,
    );
    expect(screen.getByRole('dialog', { name: 'Add assignment' })).toBe(dialog);
    expect(within(dialog).getByLabelText(/^Driver/)).toBe(driverField);
    expect(within(dialog).getByLabelText(/^Vehicle/)).toBe(vehicleField);
    expect(driverField).toHaveValue('3');
    expect(vehicleField).toHaveValue('8');
    expect(within(driverField).getByRole('option', { name: 'Driver B renamed' })).toBeEnabled();
    expect(within(dialog).getByLabelText(/^Notes/)).toHaveValue('Keep draft notes');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(mutations.create).toHaveBeenCalledWith(
      expect.objectContaining({ vehicle_id: 8, driver_id: 3, notes: 'Keep draft notes', ends_at: null }),
      expect.objectContaining({ onSuccess: callbacks.onSaved }),
    );
    expect(mutations.update).not.toHaveBeenCalled();
    expect(JSON.stringify({ drivers, vehicles })).toBe(original);
  });

  it('keeps the existing inactive assignee editable while unrelated inactive choices remain disabled', () => {
    const item: FleetAssignment = {
      id: 11, vehicle_id: 7, vehicle_display_name: 'Pool A',
      driver_id: 2, driver_display_name: 'Driver A',
      starts_at: '2026-10-01T12:00:00Z', ends_at: null, notes: 'Existing note',
      version: 4, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    };
    render(<AssignmentDialog item={item}
      drivers={drivers.map(driver => ({ ...driver, status: 'inactive' as const }))}
      vehicles={vehicles} {...callbacks} />);
    const dialog = screen.getByRole('dialog', { name: 'Edit assignment' });
    const driverField = within(dialog).getByLabelText(/^Driver/);
    expect(driverField).toHaveValue('2');
    expect(within(driverField).getByRole('option', { name: 'Driver A' })).toBeEnabled();
    expect(within(driverField).getByRole('option', { name: 'Driver B' })).toBeDisabled();
    expect(within(dialog).getByLabelText(/^Vehicle/)).toHaveValue('7');
    fireEvent.change(within(dialog).getByLabelText(/^Notes/), { target: { value: 'Updated note' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(mutations.update).toHaveBeenCalledWith({
      id: 11, version: 4,
      input: expect.objectContaining({ vehicle_id: 7, driver_id: 2, notes: 'Updated note' }),
    }, expect.objectContaining({ onSuccess: callbacks.onSaved }));
    expect(mutations.create).not.toHaveBeenCalled();
  });
});
