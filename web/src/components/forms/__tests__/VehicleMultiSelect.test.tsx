/**
 * VehicleMultiSelect unit tests.
 *
 * Covers acceptance criteria and blind spots (D10 unknown IDs,
 * D13 toggle restoration).
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import '@/i18n';
import {
  VehicleMultiSelect,
  hydrateVehicleSelection,
  buildVehiclePayload,
  type VehicleSelection,
} from '../VehicleMultiSelect';
import type { Vehicle } from '@/types/vehicle';

function makeVehicle(id: number, name: string, vin = `VIN${id}AAAA`): Vehicle {
  return {
    id,
    vehicle_id: id,
    vin,
    display_name: name,
    model: 'Model 3',
    trim_badging: '',
    exterior_color: '',
    wheel_type: '',
    state: 'online',
    healthy: true,
    created_at: '',
    updated_at: '',
  };
}

const VEHICLES: Vehicle[] = [
  makeVehicle(1, 'Roadster'),
  makeVehicle(2, 'Plaid'),
  makeVehicle(3, 'Cybertruck'),
];

interface HarnessProps {
  initial?: VehicleSelection;
  vehicles?: Vehicle[];
  onChange?: (next: VehicleSelection) => void;
}

function Harness({ initial = { kind: 'all_sticky' }, vehicles = VEHICLES, onChange }: HarnessProps) {
  const [value, setValue] = useState<VehicleSelection>(initial);
  return (
    <VehicleMultiSelect
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
      vehicles={vehicles}
    />
  );
}

describe('VehicleMultiSelect', () => {
  it('renders the sticky-all summary on the trigger by default', () => {
    render(<Harness />);
    expect(screen.getByText('All vehicles')).toBeInTheDocument();
  });

  it('opens the popover on click and lists All sentinel + each vehicle as ARIA checkboxes', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: /all vehicles/i });
    fireEvent.click(trigger);
    const listbox = screen.getByRole('listbox');
    const checkboxes = within(listbox).getAllByRole('checkbox');
    // 1 sentinel + 3 vehicles
    expect(checkboxes).toHaveLength(4);
    expect(checkboxes[0]).toHaveAttribute('aria-checked', 'true');
    for (let i = 1; i < 4; i++) {
      expect(checkboxes[i]).toHaveAttribute('aria-checked', 'false');
    }
  });

  it('toggling a specific vehicle switches selection to specific and unchecks All', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /all vehicles/i }));
    const option = screen.getByTestId('vehicle-multiselect-option-2');
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith({ kind: 'specific', vehicle_ids: [2] });
  });

  it('toggling the All sentinel back ON restores empty + sticky-all selection (no auto-select all)', () => {
    const onChange = vi.fn();
    render(<Harness initial={{ kind: 'specific', vehicle_ids: [1, 3] }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button'));
    const sentinel = screen.getByTestId('vehicle-multiselect-option-all_sticky_sentinel');
    fireEvent.click(sentinel);
    expect(onChange).toHaveBeenCalledWith({ kind: 'all_sticky' });
  });

  it('toggling All OFF restores the previous specific selection (Decision D13)', () => {
    const seenChanges: VehicleSelection[] = [];
    render(
      <Harness
        initial={{ kind: 'specific', vehicle_ids: [1, 3] }}
        onChange={(next) => seenChanges.push(next)}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    // First click: specific [1,3] → all_sticky (also stores [1,3] in ref).
    fireEvent.click(screen.getByTestId('vehicle-multiselect-option-all_sticky_sentinel'));
    // Popover stays open after toggle. Second click on the same sentinel:
    // all_sticky → specific (restores [1,3] from the ref).
    fireEvent.click(screen.getByTestId('vehicle-multiselect-option-all_sticky_sentinel'));
    const last = seenChanges[seenChanges.length - 1];
    expect(last.kind).toBe('specific');
    if (last.kind === 'specific') {
      expect(last.vehicle_ids).toEqual([1, 3]);
    }
  });

  it('renders unknown selected IDs as a distinct row with Unknown badge (Decision D10)', () => {
    render(<Harness initial={{ kind: 'specific', vehicle_ids: [2, 99] }} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('vehicle-multiselect-option-unknown-99')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('clicking an unknown selected ID removes it from the selection', () => {
    const onChange = vi.fn();
    render(
      <Harness initial={{ kind: 'specific', vehicle_ids: [2, 99] }} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByTestId('vehicle-multiselect-option-unknown-99'));
    expect(onChange).toHaveBeenCalledWith({ kind: 'specific', vehicle_ids: [2] });
  });

  it('disables the trigger and shows help when fleet is empty', () => {
    render(<Harness vehicles={[]} />);
    const trigger = screen.getByRole('button');
    expect(trigger).toBeDisabled();
    expect(
      screen.getByText('Add a vehicle in Settings → Vehicles to use this rule.'),
    ).toBeInTheDocument();
  });

  it('summary shows the single vehicle name when exactly one is selected', () => {
    render(<Harness initial={{ kind: 'specific', vehicle_ids: [2] }} />);
    expect(screen.getByText('Plaid')).toBeInTheDocument();
  });

  it('summary shows partial count when some-but-not-all selected', () => {
    render(<Harness initial={{ kind: 'specific', vehicle_ids: [1, 3] }} />);
    expect(screen.getByText('2 of 3 vehicles')).toBeInTheDocument();
  });

  it('summary shows None message when specific + zero selected', () => {
    render(<Harness initial={{ kind: 'specific', vehicle_ids: [] }} />);
    expect(screen.getByText('No vehicles selected')).toBeInTheDocument();
  });
});

describe('hydrateVehicleSelection', () => {
  it('honours new shape: all_vehicles=true → all_sticky', () => {
    expect(
      hydrateVehicleSelection({ all_vehicles: true, vehicle_ids: [], vehicle_id: null }),
    ).toEqual({ kind: 'all_sticky' });
  });

  it('honours new shape: all_vehicles=false → specific with sorted dedup', () => {
    expect(
      hydrateVehicleSelection({ all_vehicles: false, vehicle_ids: [3, 1, 1, 2] }),
    ).toEqual({ kind: 'specific', vehicle_ids: [1, 2, 3] });
  });

  it('falls back to legacy: vehicle_id=5 → specific [5]', () => {
    expect(hydrateVehicleSelection({ vehicle_id: 5 })).toEqual({
      kind: 'specific',
      vehicle_ids: [5],
    });
  });

  it('falls back to legacy: vehicle_id=null → all_sticky', () => {
    expect(hydrateVehicleSelection({ vehicle_id: null })).toEqual({ kind: 'all_sticky' });
  });

  it('falls back to legacy when all_vehicles is missing entirely', () => {
    expect(hydrateVehicleSelection({})).toEqual({ kind: 'all_sticky' });
  });
});

describe('buildVehiclePayload', () => {
  it('emits all_vehicles=true + empty array for sticky-all', () => {
    expect(buildVehiclePayload({ kind: 'all_sticky' })).toEqual({
      all_vehicles: true,
      vehicle_ids: [],
    });
  });

  it('emits all_vehicles=false + sorted dedup array for specific', () => {
    expect(
      buildVehiclePayload({ kind: 'specific', vehicle_ids: [3, 1, 2, 1] }),
    ).toEqual({ all_vehicles: false, vehicle_ids: [1, 2, 3] });
  });

  it('drops zero and negative IDs from the payload', () => {
    expect(
      buildVehiclePayload({ kind: 'specific', vehicle_ids: [0, -1, 5] }),
    ).toEqual({ all_vehicles: false, vehicle_ids: [5] });
  });

  it('NEVER includes legacy vehicle_id field (Decision D11)', () => {
    const payload = buildVehiclePayload({ kind: 'specific', vehicle_ids: [7] });
    expect('vehicle_id' in payload).toBe(false);
  });
});
