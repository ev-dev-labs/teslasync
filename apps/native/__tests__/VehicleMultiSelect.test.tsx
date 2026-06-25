import React, {useState} from 'react';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

import {
  VehicleMultiSelect,
  buildVehiclePayload,
  hydrateVehicleSelection,
  type VehicleSelection,
} from '../src/web-parity/components/forms/VehicleMultiSelect';
import type {Vehicle} from '../src/web-parity/api/types';

type Renderer = ReactTestRenderer.ReactTestRenderer;

function makeVehicle(partial: Partial<Vehicle> & {id: number}): Vehicle {
  return {
    created_at: '2024-01-01T00:00:00Z',
    display_name: `Car ${partial.id}`,
    exterior_color: 'PearlWhite',
    healthy: true,
    model: 'Model 3',
    state: 'online',
    trim_badging: 'p',
    updated_at: '2024-01-01T00:00:00Z',
    vehicle_id: partial.id,
    vin: `5YJ3E1EA0FF00000${partial.id}`,
    wheel_type: 'Aero18',
    ...partial,
  };
}

const VEHICLES: Vehicle[] = [
  makeVehicle({id: 1, display_name: 'Alpha'}),
  makeVehicle({id: 2, display_name: 'Bravo'}),
  makeVehicle({id: 3, display_name: 'Charlie'}),
];

function countHost(tree: Renderer, testID: string): number {
  return tree.root.findAll(
    (node: ReactTestInstance) =>
      typeof node.type === 'string' && node.props.testID === testID,
  ).length;
}

function press(tree: Renderer, testID: string): void {
  const target = tree.root.find(
    (node: ReactTestInstance) =>
      node.props.testID === testID && typeof node.props.onPress === 'function',
  );
  ReactTestRenderer.act(() => {
    target.props.onPress();
  });
}

interface HarnessResult {
  onChange: jest.Mock<void, [VehicleSelection]>;
  tree: Renderer;
}

function renderSelect(props: {
  initial: VehicleSelection;
  vehicles?: Vehicle[];
  errorKey?: string | null;
  disabled?: boolean;
}): HarnessResult {
  const onChange = jest.fn<void, [VehicleSelection]>();

  function Harness() {
    const [value, setValue] = useState<VehicleSelection>(props.initial);
    return (
      <VehicleMultiSelect
        disabled={props.disabled}
        errorKey={props.errorKey}
        id="veh"
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
        value={value}
        vehicles={props.vehicles ?? VEHICLES}
      />
    );
  }

  let tree: Renderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<Harness />);
  });

  return {onChange, tree: tree!};
}

test('opens the popover on trigger press and lists the vehicle options', () => {
  const {tree} = renderSelect({initial: {kind: 'specific', vehicle_ids: []}});

  // Closed until the trigger is pressed (Modal children absent).
  expect(countHost(tree, 'vehicle-multiselect-option-1')).toBe(0);

  press(tree, 'vehicle-multiselect-trigger');

  expect(countHost(tree, 'vehicle-multiselect-option-all_sticky_sentinel')).toBe(
    1,
  );
  expect(countHost(tree, 'vehicle-multiselect-option-1')).toBe(1);
  expect(countHost(tree, 'vehicle-multiselect-option-2')).toBe(1);
  expect(countHost(tree, 'vehicle-multiselect-option-3')).toBe(1);
});

test('toggling the All option moves a specific selection to all_sticky', () => {
  const {onChange, tree} = renderSelect({
    initial: {kind: 'specific', vehicle_ids: [2]},
  });

  press(tree, 'vehicle-multiselect-trigger');
  press(tree, 'vehicle-multiselect-option-all_sticky_sentinel');

  expect(onChange).toHaveBeenLastCalledWith({kind: 'all_sticky'});
});

test('toggling All OFF restores the remembered specific selection (D13)', () => {
  const {onChange, tree} = renderSelect({
    initial: {kind: 'specific', vehicle_ids: [2]},
  });

  press(tree, 'vehicle-multiselect-trigger');
  // ON -> all_sticky
  press(tree, 'vehicle-multiselect-option-all_sticky_sentinel');
  // OFF -> restores [2]
  press(tree, 'vehicle-multiselect-option-all_sticky_sentinel');

  expect(onChange).toHaveBeenLastCalledWith({
    kind: 'specific',
    vehicle_ids: [2],
  });
});

test('selecting a vehicle adds it (deduped + sorted) and re-pressing removes it', () => {
  const {onChange, tree} = renderSelect({
    initial: {kind: 'specific', vehicle_ids: [2]},
  });

  press(tree, 'vehicle-multiselect-trigger');
  press(tree, 'vehicle-multiselect-option-1');
  expect(onChange).toHaveBeenLastCalledWith({
    kind: 'specific',
    vehicle_ids: [1, 2],
  });

  press(tree, 'vehicle-multiselect-option-2');
  expect(onChange).toHaveBeenLastCalledWith({
    kind: 'specific',
    vehicle_ids: [1],
  });
});

test('unknown selected ids render with an Unknown row and can be removed', () => {
  const {onChange, tree} = renderSelect({
    initial: {kind: 'specific', vehicle_ids: [99]},
  });

  press(tree, 'vehicle-multiselect-trigger');
  expect(countHost(tree, 'vehicle-multiselect-option-unknown-99')).toBe(1);
  expect(JSON.stringify(tree.toJSON())).toContain('Unknown');

  press(tree, 'vehicle-multiselect-option-unknown-99');
  expect(onChange).toHaveBeenLastCalledWith({
    kind: 'specific',
    vehicle_ids: [],
  });
});

test('summary text reflects the selection shape', () => {
  const all = renderSelect({initial: {kind: 'all_sticky'}});
  expect(JSON.stringify(all.tree.toJSON())).toContain('All vehicles');

  const none = renderSelect({initial: {kind: 'specific', vehicle_ids: []}});
  expect(JSON.stringify(none.tree.toJSON())).toContain('No vehicles selected');

  const partial = renderSelect({
    initial: {kind: 'specific', vehicle_ids: [1, 2]},
  });
  expect(JSON.stringify(partial.tree.toJSON())).toContain('2 of 3 vehicles');

  const one = renderSelect({initial: {kind: 'specific', vehicle_ids: [2]}});
  expect(JSON.stringify(one.tree.toJSON())).toContain('Bravo');
});

test('an empty fleet disables the trigger and shows the help text', () => {
  const {tree} = renderSelect({
    initial: {kind: 'specific', vehicle_ids: []},
    vehicles: [],
  });

  expect(countHost(tree, 'vehicle-multiselect-empty-help')).toBe(1);

  // Pressing the disabled trigger is a no-op; the popover never opens.
  press(tree, 'vehicle-multiselect-trigger');
  expect(countHost(tree, 'vehicle-multiselect-option-all_sticky_sentinel')).toBe(
    0,
  );
});

test('an error key renders an inline assertive error message', () => {
  const {tree} = renderSelect({
    initial: {kind: 'specific', vehicle_ids: []},
    errorKey: 'notifications.alertStudio.editor.vehiclesRequired',
  });

  const error = tree.root.find(
    (node: ReactTestInstance) =>
      node.props.testID === 'vehicle-multiselect-error',
  );
  expect(error.props.accessibilityLiveRegion).toBe('assertive');
});

test('hydrateVehicleSelection honours all_vehicles and the legacy vehicle_id', () => {
  expect(hydrateVehicleSelection({all_vehicles: true})).toEqual({
    kind: 'all_sticky',
  });
  expect(
    hydrateVehicleSelection({all_vehicles: false, vehicle_ids: [3, 1, 1, 2]}),
  ).toEqual({kind: 'specific', vehicle_ids: [1, 2, 3]});
  // Legacy fallback: no all_vehicles flag.
  expect(hydrateVehicleSelection({vehicle_id: null})).toEqual({
    kind: 'all_sticky',
  });
  expect(hydrateVehicleSelection({vehicle_id: 7})).toEqual({
    kind: 'specific',
    vehicle_ids: [7],
  });
});

test('buildVehiclePayload emits both flags and never the legacy vehicle_id', () => {
  expect(buildVehiclePayload({kind: 'all_sticky'})).toEqual({
    all_vehicles: true,
    vehicle_ids: [],
  });
  expect(
    buildVehiclePayload({kind: 'specific', vehicle_ids: [3, 1, 2, 3]}),
  ).toEqual({all_vehicles: false, vehicle_ids: [1, 2, 3]});
});
