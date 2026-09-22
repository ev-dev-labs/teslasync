import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Vehicle } from '@/types/vehicle';
import type { PinnedItem } from '@/api/types';

// ── Controllable mock state ───────────────────────────────────────────────
// VehiclePicker is a thin orchestrator over two hooks + <Combobox>. We isolate
// it by mocking its data sources so every branch (hide guard, pin ordering,
// label fallbacks, selection dispatch) is driven deterministically without a
// QueryClient/Router or any network. This mirrors the repo convention of
// mocking hooks directly (see useSelectedVehicle.test.tsx / PageContainer.test.tsx).
let mockVehicles: Vehicle[] = [];
let mockVehicleId: number | null = null;
let mockPins: PinnedItem[] = [];
const setVehicleId = vi.fn<(id: number | null) => void>();

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: mockVehicleId,
    setVehicleId,
    vehicles: mockVehicles,
    vehicle: mockVehicles.find((v) => v.id === mockVehicleId) ?? null,
  }),
}));

vi.mock('@/api/hooks/usePinned', () => ({
  usePinned: () => ({ data: mockPins }),
}));

// Interpolating stub so `Vehicle {{id}}` resolves like the real i18next default.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) =>
      opts
        ? Object.entries(opts).reduce(
            (out, [k, v]) => out.replace(`{{${k}}}`, String(v)),
            fallback,
          )
        : fallback,
  }),
}));

// Import AFTER the mocks are registered.
import { VehiclePicker } from '../VehiclePicker';

function makeVehicle(over: Partial<Vehicle> & { id: number }): Vehicle {
  return {
    vehicle_id: over.id,
    vin: `VIN-${over.id}`,
    display_name: `Vehicle ${over.id}`,
    model: 'model3',
    trim_badging: '',
    exterior_color: '',
    wheel_type: '',
    state: 'online',
    healthy: true,
    created_at: '',
    updated_at: '',
    ...over,
  };
}

function makePin(itemId: string | number, position: number): PinnedItem {
  return {
    id: Number(itemId) * 100 + position,
    item_type: 'vehicle',
    item_id: String(itemId),
    position,
    pinned_at: '2026-01-01T00:00:00Z',
  };
}

beforeEach(() => {
  mockVehicles = [];
  mockVehicleId = null;
  mockPins = [];
  setVehicleId.mockReset();
});

describe('VehiclePicker', () => {
  it('renders nothing for an empty fleet', () => {
    mockVehicles = [];
    const { container } = render(<VehiclePicker />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('renders nothing for a single-vehicle fleet (no meaningful choice)', () => {
    mockVehicles = [makeVehicle({ id: 1, display_name: 'Solo' })];
    mockVehicleId = 1;
    const { container } = render(<VehiclePicker />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('can keep a single vehicle visible as the active shell context', () => {
    mockVehicles = [makeVehicle({ id: 1, display_name: 'Solo' })];
    mockVehicleId = 1;
    render(<VehiclePicker hideWhenSingle={false} />);
    expect(screen.getByRole('combobox', { name: 'Select vehicle' })).toHaveValue('Solo');
  });

  it('renders an accessible select with one option per vehicle for a multi-vehicle fleet', () => {
    mockVehicles = [
      makeVehicle({ id: 1, display_name: 'Roadster' }),
      makeVehicle({ id: 2, display_name: 'Cybertruck' }),
    ];
    mockVehicleId = 1;
    render(<VehiclePicker />);

    const select = screen.getByRole('combobox', { name: 'Select vehicle' });
    expect(select).toBeInTheDocument();
    fireEvent.focus(select);
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options.map((o) => o.textContent)).toEqual(['Roadster', 'Cybertruck']);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('labels fall back from display_name → vin → "Vehicle {id}"', () => {
    mockVehicles = [
      makeVehicle({ id: 1, display_name: 'Named Car' }),
      makeVehicle({ id: 2, display_name: '', vin: 'VIN-XYZ' }),
      makeVehicle({ id: 3, display_name: '', vin: '' }),
    ];
    mockVehicleId = 1;
    render(<VehiclePicker />);

    fireEvent.focus(screen.getByRole('combobox'));
    const labels = screen.getAllByRole('option').map((o) => o.textContent);
    expect(labels).toEqual(['Named Car', 'VIN-XYZ', 'Vehicle 3']);
  });

  it('floats pinned vehicles to the top in pin-position order with a 📌 prefix', () => {
    mockVehicles = [
      makeVehicle({ id: 1, display_name: 'Roadster' }),
      makeVehicle({ id: 2, display_name: 'Cybertruck' }),
      makeVehicle({ id: 3, display_name: 'Model S' }),
    ];
    // id 3 pinned first (position 0), id 1 pinned second (position 1).
    mockPins = [makePin(3, 0), makePin(1, 1)];
    mockVehicleId = 1;
    render(<VehiclePicker />);

    fireEvent.focus(screen.getByRole('combobox'));
    const labels = screen.getAllByRole('option').map((o) => o.textContent);
    expect(labels).toEqual(['📌 Model S', '📌 Roadster', 'Cybertruck']);
  });

  it('ignores pins that reference a vehicle absent from the fleet', () => {
    mockVehicles = [
      makeVehicle({ id: 1, display_name: 'Roadster' }),
      makeVehicle({ id: 2, display_name: 'Cybertruck' }),
    ];
    mockPins = [makePin(99, 0)]; // phantom pin — vehicle 99 not present
    mockVehicleId = 1;
    render(<VehiclePicker />);

    fireEvent.focus(screen.getByRole('combobox'));
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    // No phantom option, no 📌 applied to real vehicles, original order kept.
    expect(options.map((o) => o.textContent)).toEqual(['Roadster', 'Cybertruck']);
  });

  it('reflects the current vehicleId as the selected value', () => {
    mockVehicles = [
      makeVehicle({ id: 1, display_name: 'Roadster' }),
      makeVehicle({ id: 2, display_name: 'Cybertruck' }),
    ];
    mockVehicleId = 2;
    render(<VehiclePicker />);
    expect(screen.getByRole('combobox')).toHaveValue('Cybertruck');
  });

  it('dispatches the numeric id when the user picks a vehicle', () => {
    mockVehicles = [
      makeVehicle({ id: 1, display_name: 'Roadster' }),
      makeVehicle({ id: 2, display_name: 'Cybertruck' }),
    ];
    mockVehicleId = 1;
    render(<VehiclePicker />);

    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: 'Cybertruck' }));
    expect(setVehicleId).toHaveBeenCalledTimes(1);
    expect(setVehicleId).toHaveBeenCalledWith(2);
  });

  it('navigates with arrows, Home/End and typeahead, and cancels without changing selection', () => {
    mockVehicles = [
      makeVehicle({ id: 1, display_name: 'Roadster' }),
      makeVehicle({ id: 2, display_name: 'Cybertruck' }),
    ];
    mockVehicleId = 1;
    render(<VehiclePicker />);

    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    const active = () => document.getElementById(input.getAttribute('aria-activedescendant') ?? '')?.textContent;
    expect(active()).toBe('Roadster');
    fireEvent.keyDown(input, { key: 'End' });
    expect(active()).toBe('Cybertruck');
    fireEvent.keyDown(input, { key: 'Home' });
    expect(active()).toBe('Roadster');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(active()).toBe('Cybertruck');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(active()).toBe('Roadster');
    fireEvent.keyDown(input, { key: 'c' });
    expect(active()).toBe('Cybertruck');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveValue('Roadster');
    expect(setVehicleId).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'End' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(setVehicleId).toHaveBeenCalledWith(2);
  });

  it('applies a custom className to the wrapper and hides the decorative icon from a11y', () => {
    mockVehicles = [
      makeVehicle({ id: 1, display_name: 'Roadster' }),
      makeVehicle({ id: 2, display_name: 'Cybertruck' }),
    ];
    mockVehicleId = 1;
    const { container } = render(<VehiclePicker className="ring-test" />);

    expect(container.firstChild).toHaveClass('ring-test');
    // The lucide Car icon is decorative — it must not add a redundant a11y name.
    const icon = container.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    const control = container.querySelector('[data-role="vehicle-picker-control"]');
    expect(control).toContainElement(screen.getByRole('combobox'));
    expect(control?.querySelectorAll('svg')).toHaveLength(2);
    control?.querySelectorAll('svg').forEach((decoration) => {
      expect(decoration).toHaveAttribute('aria-hidden', 'true');
    });
  });
});
