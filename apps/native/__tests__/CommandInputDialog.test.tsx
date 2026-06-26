import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {CommandInputDialog} from '../src/web-parity/features/system/components/CommandInputDialog';
import type {CommandDef} from '../src/web-parity/features/system/commands';

const NUMBER_DEF: CommandDef = {
  id: 'set_speed_limit',
  command: 'SET_SPEED_LIMIT',
  labelKey: 'commands.security.speedLimit',
  labelFallback: 'Set Speed Limit',
  sublabelKey: 'commands.security.setMph',
  sublabelFallback: 'Speed (mph)',
  icon: 'speed',
  category: 'security',
  type: 'input',
  inputConfig: {
    promptKey: 'commands.security.speedPrompt',
    promptFallback: 'Enter the speed limit',
    paramName: 'limit_mph',
    defaultValue: '50',
    validation: 'number',
    min: 50,
    max: 90,
  },
};

const PIN_DEF: CommandDef = {
  id: 'speed_activate',
  command: 'ACTIVATE_SPEED_LIMIT',
  labelKey: 'commands.security.speedActivate',
  labelFallback: 'Activate Speed Limit',
  icon: 'locked',
  category: 'security',
  type: 'input',
  inputConfig: {
    promptKey: 'commands.security.pinPrompt',
    promptFallback: 'Enter your PIN',
    paramName: 'pin',
    validation: 'pin',
  },
};

test('renders the header, prompt, single param field and action buttons when open', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <CommandInputDialog
        def={NUMBER_DEF}
        onClose={() => undefined}
        onSubmit={() => undefined}
        open
      />,
    );
  });

  const serialized = JSON.stringify(tree?.toJSON());
  expect(serialized).toContain('Set Speed Limit');
  expect(serialized).toContain('Enter the speed limit');
  expect(serialized).toContain('Cancel');
  expect(serialized).toContain('Send');
  expect(serialized).toContain('command-input-dialog');
  // The single-param field is keyed by inputConfig.paramName.
  tree!.root.findByProps({testID: 'command-input-field-limit_mph'});
  // No DOM/web embedding leaked into the native tree.
  expect(serialized).not.toContain('WebView');
});

test('submits the current values when valid (default value passes number validation)', async () => {
  const onSubmit = jest.fn();
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <CommandInputDialog
        def={NUMBER_DEF}
        onClose={() => undefined}
        onSubmit={onSubmit}
        open
      />,
    );
  });

  const submit = tree!.root.findByProps({testID: 'command-input-submit'});
  // defaultValue '50' is within min 50 / max 90, so the Send button is enabled.
  expect(submit.props.disabled).toBe(false);

  await ReactTestRenderer.act(async () => {
    submit.props.onPress();
  });

  expect(onSubmit).toHaveBeenCalledWith({limit_mph: '50'});
});

test('renders a pin field as a masked numeric input', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <CommandInputDialog
        def={PIN_DEF}
        onClose={() => undefined}
        onSubmit={() => undefined}
        open
      />,
    );
  });

  const field = tree!.root.findByProps({testID: 'command-input-field-pin'});
  expect(field.props.secureTextEntry).toBe(true);
  expect(field.props.inputMode).toBe('numeric');
});

test('gates submit on validation and surfaces the pin error on blur', async () => {
  const onSubmit = jest.fn();
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <CommandInputDialog
        def={PIN_DEF}
        onClose={() => undefined}
        onSubmit={onSubmit}
        open
      />,
    );
  });

  // Empty pin -> invalid -> Send disabled.
  expect(
    tree!.root.findByProps({testID: 'command-input-submit'}).props.disabled,
  ).toBe(true);

  // Type an invalid (too short) pin, then blur in a SEPARATE act so the value
  // state flushes before handleBlur reads it -> validation message appears.
  await ReactTestRenderer.act(async () => {
    tree!.root
      .findByProps({testID: 'command-input-field-pin'})
      .props.onChangeText('12');
  });
  await ReactTestRenderer.act(async () => {
    tree!.root.findByProps({testID: 'command-input-field-pin'}).props.onBlur();
  });
  expect(JSON.stringify(tree?.toJSON())).toContain('Enter a 4-digit PIN');

  // Fix the pin -> Send becomes enabled and submits the value.
  await ReactTestRenderer.act(async () => {
    tree!.root
      .findByProps({testID: 'command-input-field-pin'})
      .props.onChangeText('1234');
  });
  await ReactTestRenderer.act(async () => {
    tree!.root.findByProps({testID: 'command-input-field-pin'}).props.onBlur();
  });

  const submit = tree!.root.findByProps({testID: 'command-input-submit'});
  expect(submit.props.disabled).toBe(false);

  await ReactTestRenderer.act(async () => {
    submit.props.onPress();
  });
  expect(onSubmit).toHaveBeenCalledWith({pin: '1234'});
});
