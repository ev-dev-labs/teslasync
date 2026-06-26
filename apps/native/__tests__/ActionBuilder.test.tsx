import React, {useState} from 'react';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

import {
  ActionBuilder,
  ACTION_TYPES,
  type AutomationActionStepInput,
} from '../src/web-parity/features/automations/pages/ActionBuilder';
import type {NotificationChannel} from '../src/web-parity/api/hooks/useNotificationChannels';

type Renderer = ReactTestRenderer.ReactTestRenderer;

const ISO = '2024-01-01T00:00:00Z';

const CHANNELS: NotificationChannel[] = [
  {
    id: 10,
    name: 'Ops',
    kind: 'discord',
    enabled: true,
    created_at: ISO,
    updated_at: ISO,
    webhook_url: 'https://discord.example/hook',
    username: null,
    avatar_url: null,
  },
  {
    id: 20,
    name: 'Mail',
    kind: 'email',
    enabled: false,
    created_at: ISO,
    updated_at: ISO,
    smtp_host: 'smtp.example',
    smtp_port: 587,
    smtp_username: 'user',
    smtp_password: 'secret',
    from_address: 'from@example.com',
    to_addresses: ['to@example.com'],
    use_tls: true,
  },
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

function changeText(tree: Renderer, testID: string, text: string): void {
  const target = tree.root.find(
    (node: ReactTestInstance) =>
      node.props.testID === testID &&
      typeof node.props.onChangeText === 'function',
  );
  ReactTestRenderer.act(() => {
    target.props.onChangeText(text);
  });
}

function hostProps(tree: Renderer, testID: string): Record<string, unknown> {
  const target = tree.root.find(
    (node: ReactTestInstance) =>
      typeof node.type === 'string' && node.props.testID === testID,
  );
  return target.props as Record<string, unknown>;
}

interface HarnessResult {
  onChange: jest.Mock<void, [AutomationActionStepInput[]]>;
  tree: Renderer;
}

function renderBuilder(
  initial: AutomationActionStepInput[],
  channels: NotificationChannel[] = CHANNELS,
): HarnessResult {
  const onChange = jest.fn<void, [AutomationActionStepInput[]]>();

  function Harness() {
    const [actions, setActions] = useState<AutomationActionStepInput[]>(initial);
    return (
      <ActionBuilder
        actions={actions}
        channels={channels}
        onChange={(next) => {
          onChange(next);
          setActions(next);
        }}
      />
    );
  }

  let tree: Renderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<Harness />);
  });

  return {onChange, tree: tree!};
}

function lastChange(
  onChange: jest.Mock<void, [AutomationActionStepInput[]]>,
): AutomationActionStepInput[] {
  return onChange.mock.calls[onChange.mock.calls.length - 1][0];
}

test('exports the four action-type options in order', () => {
  expect(ACTION_TYPES.map((option) => option.value)).toEqual([
    'action_command',
    'action_notify',
    'action_set_setting',
    'action_call_automation',
  ]);
});

test('renders one panel per action with stable per-index test ids', () => {
  const {tree} = renderBuilder([
    {kind: 'action_command', command_name: 'climate_on'},
    {kind: 'action_call_automation', target_automation_id: 7},
  ]);

  expect(countHost(tree, 'action-builder-row-0')).toBe(1);
  expect(countHost(tree, 'action-builder-row-1')).toBe(1);
  expect(countHost(tree, 'action-builder-row-2')).toBe(0);
  // Only the first row carries the "Action Type" select label trigger.
  expect(countHost(tree, 'action-builder-kind-0')).toBe(1);
  expect(countHost(tree, 'action-builder-kind-1')).toBe(1);
});

test('Add Action appends a default vehicle-command action', () => {
  const {onChange, tree} = renderBuilder([]);

  press(tree, 'action-builder-add');

  expect(lastChange(onChange)).toEqual([
    {kind: 'action_command', command_name: 'climate_on'},
  ]);
});

test('remove deletes the action at its index', () => {
  const {onChange, tree} = renderBuilder([
    {kind: 'action_command', command_name: 'lock'},
    {kind: 'action_command', command_name: 'unlock'},
  ]);

  press(tree, 'action-builder-remove-0');

  expect(lastChange(onChange)).toEqual([
    {kind: 'action_command', command_name: 'unlock'},
  ]);
});

test('move down swaps neighbours; boundary buttons are disabled', () => {
  const {onChange, tree} = renderBuilder([
    {kind: 'action_command', command_name: 'lock'},
    {kind: 'action_command', command_name: 'unlock'},
  ]);

  // First row cannot move up, last row cannot move down.
  expect(hostProps(tree, 'action-builder-up-0').accessibilityState).toEqual({
    disabled: true,
  });
  expect(hostProps(tree, 'action-builder-down-1').accessibilityState).toEqual({
    disabled: true,
  });

  press(tree, 'action-builder-down-0');

  expect(lastChange(onChange)).toEqual([
    {kind: 'action_command', command_name: 'unlock'},
    {kind: 'action_command', command_name: 'lock'},
  ]);
});

test('changing the action type replaces it with a default of the new kind', () => {
  const {onChange, tree} = renderBuilder([
    {kind: 'action_command', command_name: 'climate_on'},
  ]);

  // Closed until pressed.
  expect(countHost(tree, 'action-builder-kind-0-option-action_notify')).toBe(0);
  press(tree, 'action-builder-kind-0');
  press(tree, 'action-builder-kind-0-option-action_notify');

  // Default notify action seeds the first ENABLED channel (id 10).
  expect(lastChange(onChange)).toEqual([
    {kind: 'action_notify', channel_id: 10, template: ''},
  ]);
});

test('command params: a valid JSON object is stored on the action', () => {
  const {onChange, tree} = renderBuilder([
    {kind: 'action_command', command_name: 'set_temps'},
  ]);

  changeText(tree, 'action-fields-command-params', '{"temp": 21}');

  expect(lastChange(onChange)).toEqual([
    {kind: 'action_command', command_name: 'set_temps', command_params: {temp: 21}},
  ]);
});

test('command params: clearing the text removes command_params', () => {
  const {onChange, tree} = renderBuilder([
    {kind: 'action_command', command_name: 'set_temps', command_params: {temp: 21}},
  ]);

  changeText(tree, 'action-fields-command-params', '   ');

  expect(lastChange(onChange)).toEqual([
    {kind: 'action_command', command_name: 'set_temps', command_params: undefined},
  ]);
});

test('command params: invalid JSON surfaces an error and emits nothing', () => {
  const {onChange, tree} = renderBuilder([
    {kind: 'action_command', command_name: 'set_temps'},
  ]);

  changeText(tree, 'action-fields-command-params', 'not json');

  expect(countHost(tree, 'action-fields-command-params-error')).toBe(1);
  expect(onChange).not.toHaveBeenCalled();
});

test('command params: a non-object JSON value surfaces the object error', () => {
  const {onChange, tree} = renderBuilder([
    {kind: 'action_command', command_name: 'set_temps'},
  ]);

  changeText(tree, 'action-fields-command-params', '[1, 2]');

  expect(countHost(tree, 'action-fields-command-params-error')).toBe(1);
  expect(onChange).not.toHaveBeenCalled();
});

test('notify: channel selection parses the id and message edits the template', () => {
  const {onChange, tree} = renderBuilder([
    {kind: 'action_notify', channel_id: 10, template: ''},
  ]);

  changeText(tree, 'action-fields-notify-message', 'Car is warming up!');
  expect(lastChange(onChange)).toEqual([
    {kind: 'action_notify', channel_id: 10, template: 'Car is warming up!'},
  ]);
});

test('notify: a disabled channel option cannot be selected', () => {
  const {tree} = renderBuilder([
    {kind: 'action_notify', channel_id: 10, template: ''},
  ]);

  press(tree, 'action-fields-channel');
  // The disabled (email) channel renders but is non-pressable.
  expect(
    hostProps(tree, 'action-fields-channel-option-20').accessibilityState,
  ).toMatchObject({disabled: true});
});

test('set_setting: switching value type to number then editing emits value_num', () => {
  const {onChange, tree} = renderBuilder([
    {kind: 'action_set_setting', setting_key: 'charge_limit', value_text: ''},
  ]);

  press(tree, 'action-fields-value-type');
  press(tree, 'action-fields-value-type-option-number');
  expect(lastChange(onChange)).toEqual([
    {kind: 'action_set_setting', setting_key: 'charge_limit', value_num: 0},
  ]);

  // The numeric value field uses the numeric keyboard.
  expect(hostProps(tree, 'action-fields-value').keyboardType).toBe('numeric');

  changeText(tree, 'action-fields-value', '80');
  expect(lastChange(onChange)).toEqual([
    {kind: 'action_set_setting', setting_key: 'charge_limit', value_num: 80},
  ]);
});

test('set_setting: boolean value type swaps in a true/false select', () => {
  const {onChange, tree} = renderBuilder([
    {kind: 'action_set_setting', setting_key: 'sentry', value_text: ''},
  ]);

  press(tree, 'action-fields-value-type');
  press(tree, 'action-fields-value-type-option-boolean');
  expect(lastChange(onChange)).toEqual([
    {kind: 'action_set_setting', setting_key: 'sentry', value_bool: false},
  ]);

  press(tree, 'action-fields-value-bool');
  press(tree, 'action-fields-value-bool-option-true');
  expect(lastChange(onChange)).toEqual([
    {kind: 'action_set_setting', setting_key: 'sentry', value_bool: true},
  ]);
});

test('call_automation: the numeric id field parses to a number (0 when blank)', () => {
  const {onChange, tree} = renderBuilder([
    {kind: 'action_call_automation', target_automation_id: 0},
  ]);

  expect(hostProps(tree, 'action-fields-target-automation').keyboardType).toBe(
    'numeric',
  );
  // Blank id renders as an empty string, not "0".
  expect(hostProps(tree, 'action-fields-target-automation').value).toBe('');

  changeText(tree, 'action-fields-target-automation', '42');
  expect(lastChange(onChange)).toEqual([
    {kind: 'action_call_automation', target_automation_id: 42},
  ]);

  changeText(tree, 'action-fields-target-automation', 'abc');
  expect(lastChange(onChange)).toEqual([
    {kind: 'action_call_automation', target_automation_id: 0},
  ]);
});
