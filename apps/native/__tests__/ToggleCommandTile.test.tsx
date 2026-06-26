import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {ToggleCommandTile} from '../src/web-parity/features/system/components/ToggleCommandTile';
import type {
  CommandDef,
  VehicleState,
} from '../src/web-parity/features/system/commands';

const LOCK_DEF: CommandDef = {
  id: 'lock',
  command: 'LOCK',
  commandOff: 'UNLOCK',
  labelKey: 'commands.doors.lock',
  labelFallback: 'Lock',
  icon: 'locked',
  iconOff: 'unlocked',
  category: 'doors',
  variant: 'default',
  type: 'toggle',
  stateField: 'is_locked',
};

// A def with no stateField -> isOn comes from the optimistic localToggle.
const HORN_DEF: CommandDef = {
  id: 'horn',
  command: 'HONK_HORN',
  labelKey: 'commands.vehicle.horn',
  labelFallback: 'Honk Horn',
  icon: 'bolt',
  category: 'vehicle',
  type: 'action',
  params: {duration: 1},
};

// A def that opens the input dialog instead of firing immediately when off.
const SPEED_DEF: CommandDef = {
  id: 'set_speed_limit',
  command: 'SET_SPEED_LIMIT',
  commandOff: 'CLEAR_SPEED_LIMIT',
  labelKey: 'commands.security.speedLimit',
  labelFallback: 'Speed Limit',
  icon: 'speed',
  category: 'security',
  variant: 'danger',
  type: 'input',
  stateField: 'speed_limit_active',
  inputConfig: {
    promptKey: 'commands.security.speedPrompt',
    promptFallback: 'Enter the speed limit',
    paramName: 'limit_mph',
    validation: 'number',
  },
};

const STATE: VehicleState = {
  battery_level: 80,
  rated_range: 300,
  is_locked: true,
  is_charging: false,
  is_climate_on: false,
  sentry_mode: false,
  inside_temp: 21,
  speed: 0,
};

function render(node: React.ReactElement): ReactTestRenderer.ReactTestRenderer {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(node);
  });
  return tree!;
}

test('renders the label, the ON state line and the favorite/tile affordances', () => {
  const tree = render(
    <ToggleCommandTile
      def={LOCK_DEF}
      isFavorite={false}
      loading={false}
      onExecute={() => undefined}
      onRequestDialog={() => undefined}
      onToggleFavorite={() => undefined}
      state={STATE}
    />,
  );

  const serialized = JSON.stringify(tree.toJSON());
  expect(serialized).toContain('Lock');
  // is_locked is true in STATE -> the tile reads ON.
  expect(serialized).toContain('ON');
  // Both press affordances exist.
  tree.root.findByProps({testID: 'toggle-command-tile'});
  tree.root.findByProps({testID: 'toggle-command-favorite'});
  // No DOM/web embedding leaked into the native tree.
  expect(serialized).not.toContain('WebView');
});

test('shows OFF when the state field is falsy', () => {
  const tree = render(
    <ToggleCommandTile
      def={LOCK_DEF}
      isFavorite={false}
      loading={false}
      onExecute={() => undefined}
      onRequestDialog={() => undefined}
      onToggleFavorite={() => undefined}
      state={{...STATE, is_locked: false}}
    />,
  );

  expect(JSON.stringify(tree.toJSON())).toContain('OFF');
});

test('executes commandOff when pressed while on', () => {
  const onExecute = jest.fn();
  const tree = render(
    <ToggleCommandTile
      def={LOCK_DEF}
      isFavorite={false}
      loading={false}
      onExecute={onExecute}
      onRequestDialog={() => undefined}
      onToggleFavorite={() => undefined}
      state={STATE}
    />,
  );

  ReactTestRenderer.act(() => {
    tree.root.findByProps({testID: 'toggle-command-tile'}).props.onPress();
  });

  expect(onExecute).toHaveBeenCalledWith('UNLOCK');
});

test('executes command with params when pressed while off (no input dialog)', () => {
  const onExecute = jest.fn();
  const onRequestDialog = jest.fn();
  const tree = render(
    <ToggleCommandTile
      def={HORN_DEF}
      isFavorite={false}
      loading={false}
      onExecute={onExecute}
      onRequestDialog={onRequestDialog}
      onToggleFavorite={() => undefined}
      state={null}
    />,
  );

  ReactTestRenderer.act(() => {
    tree.root.findByProps({testID: 'toggle-command-tile'}).props.onPress();
  });

  expect(onExecute).toHaveBeenCalledWith('HONK_HORN', {duration: 1});
  expect(onRequestDialog).not.toHaveBeenCalled();
});

test('opens the input dialog instead of executing when off + inputConfig present', () => {
  const onExecute = jest.fn();
  const onRequestDialog = jest.fn();
  const tree = render(
    <ToggleCommandTile
      def={SPEED_DEF}
      isFavorite={false}
      loading={false}
      onExecute={onExecute}
      onRequestDialog={onRequestDialog}
      onToggleFavorite={() => undefined}
      state={{...STATE, speed_limit_active: false} as unknown as VehicleState}
    />,
  );

  ReactTestRenderer.act(() => {
    tree.root.findByProps({testID: 'toggle-command-tile'}).props.onPress();
  });

  expect(onRequestDialog).toHaveBeenCalledWith(SPEED_DEF);
  expect(onExecute).not.toHaveBeenCalled();
});

test('does nothing when pressed while loading', () => {
  const onExecute = jest.fn();
  const tree = render(
    <ToggleCommandTile
      def={LOCK_DEF}
      isFavorite={false}
      loading
      onExecute={onExecute}
      onRequestDialog={() => undefined}
      onToggleFavorite={() => undefined}
      state={STATE}
    />,
  );

  ReactTestRenderer.act(() => {
    tree.root.findByProps({testID: 'toggle-command-tile'}).props.onPress();
  });

  expect(onExecute).not.toHaveBeenCalled();
});

test('fires onToggleFavorite from the star button without executing the command', () => {
  const onExecute = jest.fn();
  const onToggleFavorite = jest.fn();
  const tree = render(
    <ToggleCommandTile
      def={LOCK_DEF}
      isFavorite={false}
      loading={false}
      onExecute={onExecute}
      onRequestDialog={() => undefined}
      onToggleFavorite={onToggleFavorite}
      state={STATE}
    />,
  );

  ReactTestRenderer.act(() => {
    tree.root.findByProps({testID: 'toggle-command-favorite'}).props.onPress();
  });

  expect(onToggleFavorite).toHaveBeenCalledTimes(1);
  expect(onExecute).not.toHaveBeenCalled();
});

test('renders the last-status line when provided', () => {
  const tree = render(
    <ToggleCommandTile
      def={LOCK_DEF}
      isFavorite
      lastStatus={'\u2713 Sent'}
      loading={false}
      onExecute={() => undefined}
      onRequestDialog={() => undefined}
      onToggleFavorite={() => undefined}
      state={STATE}
    />,
  );

  expect(JSON.stringify(tree.toJSON())).toContain('Sent');
});
