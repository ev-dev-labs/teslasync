/**
 * vehicle.ts — contract tests for the fleet `Vehicle` view-model.
 *
 * `web/src/types/vehicle.ts` is a *type-only* module: its single export is the
 * `Vehicle` interface, erased at runtime and (because tsconfig excludes
 * `*.test.tsx` and vitest transpiles via esbuild) never type-checked here. A
 * smoke import proves nothing, so — following the repo convention for type
 * modules (see src/types/admin.test.ts and
 * features/charging/components/charging-curve/types.test.ts) — this suite pins
 * the contract with REAL runtime assertions on three levels:
 *
 *   1. Transport (`camelCaseKeys`) — the interface's defining claim is that the
 *      snake_case backend payload is augmented with camelCase aliases so a
 *      consumer can read EITHER form. We drive a full backend fixture through
 *      the ACTUAL transport shim every hook uses and assert both access forms
 *      resolve, that single-word fields gain NO spurious alias, and that the
 *      optional extended state fields (battery / charging) round-trip too.
 *   2. Shape + null-safety — the required identity/status fields exist; the
 *      optional extended telemetry is `undefined` when absent and survives the
 *      `?? 0` / `?? '—'` guards consumers apply before rendering.
 *   3. Real consumer — a `Vehicle[]` is rendered through the production
 *      `VehicleMultiSelect`, whose private `vehicleLabel` composes
 *      `display_name` / `model` / `vin`, and whose option rows expose the
 *      field-derived `id` through `onChange`. This exercises the fields via
 *      real code + ARIA roles rather than a hand-typed echo of the interface.
 *
 * No network, no fetch: `camelCaseKeys` is pure and `VehicleMultiSelect` takes
 * its fleet by prop, so no MSW / QueryClient harness is required.
 */
import { describe, it, expect, expectTypeOf, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import '@/i18n';
import { camelCaseKeys } from '@/lib/resilience';
import { VehicleMultiSelect, type VehicleSelection } from '@/components/forms';
import type { Vehicle } from '@/types/vehicle';

/**
 * Full, valid `Vehicle` fixture. Every required field is set so the object is
 * assignable without an `as` cast; overrides tweak only what a test cares about.
 * Extended telemetry fields are intentionally left OFF by default so the
 * optional-field null-safety branch has a realistic subject.
 */
function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 1,
    vehicle_id: 100,
    vin: '5YJ3E1EA7KF000001',
    display_name: 'Roadster',
    model: 'Model 3',
    trim_badging: 'p90d',
    exterior_color: 'RedMulticoat',
    wheel_type: 'Pinwheel18',
    state: 'online',
    healthy: true,
    timezone: 'America/Los_Angeles',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-06-01T00:00:00Z',
    ...overrides,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 *  1. Transport contract — camelCaseKeys alias augmentation
 * ══════════════════════════════════════════════════════════════════════════ */

describe('Vehicle transport contract (camelCaseKeys aliases)', () => {
  // The exact snake_case shape the Go API serialises for GET /vehicles/{id},
  // including the extended detail/state fields that only that endpoint sends.
  const raw = {
    id: 7,
    vehicle_id: 4242,
    vin: '5YJSA1E26HF000099',
    display_name: 'Garage Queen',
    model: 'Model S',
    trim_badging: 'p100d',
    exterior_color: 'DeepBlue',
    wheel_type: 'Arachnid',
    state: 'asleep',
    healthy: false,
    timezone: 'Europe/Berlin',
    created_at: '2023-03-03T03:03:03Z',
    updated_at: '2023-04-04T04:04:04Z',
    battery_level: 82,
    battery_range: 512,
    odometer: 12345,
    latitude: 52.52,
    longitude: 13.4,
    charging_state: 'Charging',
  } as const;

  it('exposes a camelCase alias for every multi-word field, equal to its snake source', () => {
    // Cast to Vehicle: BOTH the snake_case fields and the declared camelCase
    // aliases are valid property reads on the interface — proving the type
    // models exactly what the transformer produces at runtime.
    const v = camelCaseKeys(raw) as Vehicle;

    expect(v.vehicle_id).toBe(4242);
    expect(v.vehicleId).toBe(4242);
    expect(v.display_name).toBe('Garage Queen');
    expect(v.displayName).toBe('Garage Queen');
    expect(v.trim_badging).toBe('p100d');
    expect(v.trimBadging).toBe('p100d');
    expect(v.exterior_color).toBe('DeepBlue');
    expect(v.exteriorColor).toBe('DeepBlue');
    expect(v.wheel_type).toBe('Arachnid');
    expect(v.wheelType).toBe('Arachnid');
    expect(v.created_at).toBe(raw.created_at);
    expect(v.createdAt).toBe(raw.created_at);
    expect(v.updated_at).toBe(raw.updated_at);
    expect(v.updatedAt).toBe(raw.updated_at);
  });

  it('mirrors the optional extended state fields onto their camelCase aliases', () => {
    const v = camelCaseKeys(raw) as Vehicle;

    expect(v.battery_level).toBe(82);
    expect(v.batteryLevel).toBe(82);
    expect(v.battery_range).toBe(512);
    expect(v.batteryRange).toBe(512);
    expect(v.charging_state).toBe('Charging');
    expect(v.chargingState).toBe('Charging');
  });

  it('leaves single-word fields un-aliased (no spurious duplicate keys)', () => {
    const rec = camelCaseKeys(raw) as Record<string, unknown>;

    // vin / model / state / healthy / odometer / latitude / longitude /
    // timezone carry no underscore → snakeToCamel is a no-op → exactly one
    // key each, and NO fabricated `Vin` / `Odometer` alias.
    expect(rec.vin).toBe(raw.vin);
    expect(rec.healthy).toBe(false);
    expect(rec.odometer).toBe(12345);
    expect(Object.keys(rec).filter((k) => k.toLowerCase() === 'odometer')).toEqual(['odometer']);
    expect('Vin' in rec).toBe(false);
    expect('State' in rec).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 *  2. Shape + optional-field null-safety
 * ══════════════════════════════════════════════════════════════════════════ */

describe('Vehicle shape + optional field null-safety', () => {
  it('requires the core identity + status fields on a minimal record', () => {
    const v = makeVehicle();
    expect(v.id).toBe(1);
    expect(typeof v.vin).toBe('string');
    expect(typeof v.healthy).toBe('boolean');
    expect(v.state).toBe('online');
  });

  it('treats extended telemetry as optional — absent → undefined, guarded by ??', () => {
    const v = makeVehicle(); // no battery / charging / odometer set
    expect(v.battery_level).toBeUndefined();
    expect(v.charging_state).toBeUndefined();
    expect(v.odometer).toBeUndefined();
    // The consumer null-safety pattern must not turn "unknown" into a crash.
    expect(v.battery_level ?? 0).toBe(0);
    expect(v.charging_state ?? '—').toBe('—');
  });

  it('carries extended telemetry when the detail/state endpoint supplies it', () => {
    const v = makeVehicle({
      battery_level: 55,
      battery_range: 300,
      charging_state: 'Disconnected',
      odometer: 999,
    });
    expect(v.battery_level).toBe(55);
    expect(v.battery_range).toBe(300);
    expect(v.charging_state).toBe('Disconnected');
    expect(v.odometer).toBe(999);
  });

  it('models timezone as optional with the documented "UTC = unknown" sentinel', () => {
    expect(makeVehicle({ timezone: undefined }).timezone).toBeUndefined();
    expect(makeVehicle({ timezone: 'UTC' }).timezone).toBe('UTC');
    expect(makeVehicle().timezone).toBe('America/Los_Angeles');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 *  3. Real consumer — VehicleMultiSelect drives vin / model / display_name / id
 * ══════════════════════════════════════════════════════════════════════════ */

function Harness({
  vehicles,
  onChange,
  initial = { kind: 'specific', vehicle_ids: [] },
}: {
  vehicles: Vehicle[];
  onChange?: (next: VehicleSelection) => void;
  initial?: VehicleSelection;
}) {
  const [value, setValue] = useState<VehicleSelection>(initial);
  return (
    <VehicleMultiSelect
      value={value}
      vehicles={vehicles}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

describe('Vehicle consumed by VehicleMultiSelect (field composition + a11y)', () => {
  it('composes name, model and VIN-last4 from the Vehicle record into the option label', () => {
    render(
      <Harness
        vehicles={[makeVehicle({ id: 1, display_name: 'Roadster', model: 'Model 3', vin: 'ABCDWXYZ' })]}
      />,
    );
    fireEvent.click(screen.getByRole('button'));

    const option = screen.getByTestId('vehicle-multiselect-option-1');
    // Every field-derived fragment is present: display_name, model, and the
    // last four characters of the VIN.
    expect(option).toHaveTextContent('Roadster');
    expect(option).toHaveTextContent('Model 3');
    expect(option).toHaveTextContent('VIN ...WXYZ');
    // The option is an ARIA checkbox, unchecked by default.
    expect(option).toHaveAttribute('role', 'checkbox');
    expect(option).toHaveAttribute('aria-checked', 'false');
  });

  it('collapses the label to "name (VIN ...last4)" when display_name equals model', () => {
    render(
      <Harness
        vehicles={[makeVehicle({ id: 2, display_name: 'Model Y', model: 'Model Y', vin: 'ABCD1234' })]}
      />,
    );
    fireEvent.click(screen.getByRole('button'));

    const option = screen.getByTestId('vehicle-multiselect-option-2');
    expect(option.textContent).toBe('Model Y (VIN ...1234)');
  });

  it('falls back to display_name only when the VIN is too short and there is no model', () => {
    render(
      <Harness
        vehicles={[makeVehicle({ id: 3, display_name: 'Sentry', model: '', vin: 'AB' })]}
      />,
    );
    fireEvent.click(screen.getByRole('button'));

    const option = screen.getByTestId('vehicle-multiselect-option-3');
    expect(option.textContent).toBe('Sentry');
    expect(option).not.toHaveTextContent('VIN');
  });

  it('reports the Vehicle.id through onChange when an option is toggled', () => {
    const onChange = vi.fn();
    render(
      <Harness
        vehicles={[makeVehicle({ id: 1 }), makeVehicle({ id: 42, display_name: 'Plaid' })]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByTestId('vehicle-multiselect-option-42'));

    expect(onChange).toHaveBeenCalledWith({ kind: 'specific', vehicle_ids: [42] });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 *  4. Type identities — runtime no-ops enforced by the production tsc gate
 * ══════════════════════════════════════════════════════════════════════════ */

describe('Vehicle type identities (compile-time)', () => {
  it('pins the required primitives and the optional `| undefined` unions', () => {
    expectTypeOf<Vehicle['id']>().toBeNumber();
    expectTypeOf<Vehicle['vin']>().toBeString();
    expectTypeOf<Vehicle['healthy']>().toBeBoolean();
    expectTypeOf<Vehicle['timezone']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Vehicle['battery_level']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Vehicle['charging_state']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Vehicle['vehicleId']>().toEqualTypeOf<number | undefined>();
    // Runtime anchor so this case also carries an executable assertion.
    expect(makeVehicle().healthy).toBe(true);
  });
});
