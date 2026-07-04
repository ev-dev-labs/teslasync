/**
 * LiveSignalToolbar — behaviour + hardening tests.
 *
 * The toolbar is the controlled vehicle picker that drives the whole Live
 * Signal Inspector page. It is a thin, presentational wrapper over the shared
 * `<Select>`: it maps a `Vehicle[]` into `<option>`s (with a "Select vehicle…"
 * placeholder), reflects the current `vehicleId`, and translates a change back
 * into a numeric id (or `null` for the placeholder) via `onChange`.
 *
 * The suite mounts the REAL component with the REAL shared `<Select>` and
 * drives every branch through props + `fireEvent` (the repo convention —
 * `@testing-library/user-event` is not a dependency here; see the sibling
 * XRayControls test). The component is pure, so no network stubbing is needed.
 *
 * Coverage:
 *   1. Rendering — a single labelled combobox reflects the placeholder / the
 *      active id, and id `0` reflects as selected (guards the `!== null` check
 *      against a falsy-id regression).
 *   2. Options — placeholder is always present; there is one option per
 *      vehicle; label precedence is display_name → vin → "Vehicle {id}".
 *   3. Null-safety — an empty list renders only the placeholder, and an
 *      `undefined` list (a not-yet-resolved query) renders without crashing.
 *   4. Interaction — choosing a vehicle emits its numeric id, the placeholder
 *      emits `null`, and id `0` emits `0` (not `null`).
 *   5. Accessibility — the control exposes an accessible name.
 *
 * react-i18next is mocked (mirroring the sibling LiveSignalKindBreakdown /
 * XRayControls tests) so English fallbacks render deterministically without
 * locale files.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import type { ComponentProps } from 'react';

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) =>
        typeof fallback === 'string' ? fallback : key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

import { LiveSignalToolbar } from './LiveSignalToolbar';
import type { Vehicle } from '@/types/vehicle';

type Props = ComponentProps<typeof LiveSignalToolbar>;

function mkVehicle(over: Partial<Vehicle> & { id: number }): Vehicle {
  return {
    id: over.id,
    vehicle_id: over.id,
    vin: '',
    display_name: '',
    model: 'model3',
    trim_badging: '',
    exterior_color: '',
    wheel_type: '',
    state: 'online',
    healthy: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function baseProps(over: Partial<Props> = {}): Props {
  return {
    vehicles: [
      mkVehicle({ id: 1, display_name: 'Model 3 Perf' }),
      mkVehicle({ id: 2, display_name: '', vin: 'VIN0000000000002' }),
      mkVehicle({ id: 7, display_name: '', vin: '' }),
    ],
    vehicleId: null,
    onChange: vi.fn(),
    ...over,
  };
}

const picker = () =>
  screen.getByRole('combobox', { name: 'Vehicle' }) as HTMLSelectElement;

afterEach(() => {
  cleanup();
});

describe('LiveSignalToolbar — rendering', () => {
  it('renders a single labelled combobox on the placeholder when nothing is selected', () => {
    render(<LiveSignalToolbar {...baseProps({ vehicleId: null })} />);

    const combos = screen.getAllByRole('combobox');
    expect(combos).toHaveLength(1);
    expect(picker().value).toBe('');
    const first = within(picker()).getAllByRole('option')[0];
    expect(first.textContent).toContain('Select vehicle');
  });

  it('reflects the active vehicle id as the selected option', () => {
    render(<LiveSignalToolbar {...baseProps({ vehicleId: 2 })} />);
    expect(picker().value).toBe('2');
  });

  it('reflects id 0 as selected rather than falling back to the placeholder', () => {
    // Regression guard: the value is derived via `vehicleId !== null`, not a
    // truthiness check, so a valid id of 0 must not read as "no selection".
    render(
      <LiveSignalToolbar
        {...baseProps({ vehicles: [mkVehicle({ id: 0, display_name: 'Zero' })], vehicleId: 0 })}
      />,
    );
    expect(picker().value).toBe('0');
  });
});

describe('LiveSignalToolbar — options + label precedence', () => {
  it('always renders the placeholder plus one option per vehicle', () => {
    render(<LiveSignalToolbar {...baseProps()} />);
    // placeholder + 3 vehicles
    expect(within(picker()).getAllByRole('option')).toHaveLength(4);
  });

  it('labels each vehicle by display_name, then vin, then an id fallback', () => {
    render(<LiveSignalToolbar {...baseProps()} />);

    const labels = within(picker())
      .getAllByRole('option')
      .map((o) => o.textContent);

    expect(labels).toContain('Model 3 Perf'); // display_name wins
    expect(labels).toContain('VIN0000000000002'); // empty name → vin
    expect(labels).toContain('Vehicle 7'); // empty name + vin → id fallback
  });
});

describe('LiveSignalToolbar — null-safety', () => {
  it('renders only the placeholder when the vehicle list is empty', () => {
    render(<LiveSignalToolbar {...baseProps({ vehicles: [] })} />);

    const options = within(picker()).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain('Select vehicle');
  });

  it('does not crash when vehicles is undefined (a not-yet-resolved query)', () => {
    expect(() =>
      render(
        <LiveSignalToolbar
          {...baseProps({ vehicles: undefined as unknown as Vehicle[] })}
        />,
      ),
    ).not.toThrow();

    expect(within(picker()).getAllByRole('option')).toHaveLength(1);
  });
});

describe('LiveSignalToolbar — interaction', () => {
  it('emits the numeric id when a vehicle is chosen', () => {
    const props = baseProps({ vehicleId: null });
    render(<LiveSignalToolbar {...props} />);

    fireEvent.change(picker(), { target: { value: '2' } });

    expect(props.onChange).toHaveBeenCalledTimes(1);
    expect(props.onChange).toHaveBeenCalledWith(2);
  });

  it('emits null when the placeholder is re-selected', () => {
    const props = baseProps({ vehicleId: 2 });
    render(<LiveSignalToolbar {...props} />);

    fireEvent.change(picker(), { target: { value: '' } });

    expect(props.onChange).toHaveBeenCalledWith(null);
  });

  it('emits 0 (not null) when a vehicle with id 0 is chosen', () => {
    const props = baseProps({
      vehicles: [mkVehicle({ id: 0, display_name: 'Zero' })],
      vehicleId: null,
    });
    render(<LiveSignalToolbar {...props} />);

    fireEvent.change(picker(), { target: { value: '0' } });

    expect(props.onChange).toHaveBeenCalledWith(0);
    expect(props.onChange).not.toHaveBeenCalledWith(null);
  });
});

describe('LiveSignalToolbar — accessibility', () => {
  it('exposes an accessible name on the picker', () => {
    render(<LiveSignalToolbar {...baseProps()} />);
    expect(screen.getByRole('combobox', { name: 'Vehicle' })).toBeInTheDocument();
  });
});
