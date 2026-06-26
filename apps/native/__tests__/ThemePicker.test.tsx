import React from 'react';
import {Alert} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import {Button} from '../src/web-parity/components/ui/Button';
import {ThemePicker} from '../src/web-parity/components/ui/ThemePicker';

function pressTileByLabel(
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
): void {
  const button = tree.root
    .findAllByType(Button)
    .find(node => node.props.accessibilityLabel === label);
  if (!button) {
    throw new Error(`tile not found: ${label}`);
  }
  button.props.onPress();
}

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('renders both sections with mode and accent tiles by default', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<ThemePicker />);
  });

  const serialized = JSON.stringify(tree?.toJSON());
  expect(serialized).toContain('Display Mode');
  expect(serialized).toContain('Accent Color');
  // A mode preview tile (mode names) and an accent tile (theme names).
  expect(serialized).toContain('Dark');
  expect(serialized).toContain('Neon Cyan');
  // The custom tile is rendered by default (showCustom defaults true).
  expect(serialized).toContain('Custom');
});

test('hides the Display Mode section when showMode is false', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<ThemePicker showMode={false} />);
  });

  const serialized = JSON.stringify(tree?.toJSON());
  expect(serialized).not.toContain('Display Mode');
  // The accent section is still present.
  expect(serialized).toContain('Accent Color');
});

test('omits the custom tile when showCustom is false', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<ThemePicker showCustom={false} />);
  });

  const customButton = tree!.root
    .findAllByType(Button)
    .find(node => node.props.accessibilityLabel === 'Custom');
  expect(customButton).toBeUndefined();
});

test('picking a mode fires onModeChange + a toast with the mode name', async () => {
  const onModeChange = jest.fn();
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <ThemePicker onModeChange={onModeChange} />,
    );
  });

  await ReactTestRenderer.act(async () => {
    pressTileByLabel(tree!, 'OLED Black');
  });

  expect(onModeChange).toHaveBeenCalledWith('oled');
  expect(Alert.alert).toHaveBeenCalledWith('Mode: OLED Black');
});

test('picking an accent theme fires onChange + a toast and selects the tile', async () => {
  const onChange = jest.fn();
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<ThemePicker onChange={onChange} />);
  });

  await ReactTestRenderer.act(async () => {
    pressTileByLabel(tree!, 'Tesla Red');
  });

  expect(onChange).toHaveBeenCalledWith('tesla-red');
  expect(Alert.alert).toHaveBeenCalledWith('Theme: Tesla Red');

  // The store update re-rendered the picker; the Tesla Red tile is now selected.
  const teslaTile = tree!.root
    .findAllByType(Button)
    .find(node => node.props.accessibilityLabel === 'Tesla Red');
  expect(teslaTile?.props.accessibilityState).toEqual({selected: true});
});

test('selecting Custom fires onChange(custom) and reveals the colour editor', async () => {
  const onChange = jest.fn();
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<ThemePicker onChange={onChange} />);
  });

  await ReactTestRenderer.act(async () => {
    pressTileByLabel(tree!, 'Custom');
  });

  expect(onChange).toHaveBeenCalledWith('custom');

  const serialized = JSON.stringify(tree?.toJSON());
  // The read-only colour editor (native analog of <input type=color>) appears.
  expect(serialized).toContain('Primary');
  expect(serialized).toContain('Accent');
  // Live hex for the default custom primary/accent.
  expect(serialized).toContain('#00b4d8');
  expect(serialized).toContain('#e63946');
});
