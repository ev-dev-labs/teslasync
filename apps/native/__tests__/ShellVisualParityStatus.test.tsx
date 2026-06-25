import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import { ShellVisualParityFrame } from '../src/visual-parity/ShellVisualParityFrame';
import {
  isVisualParityShellEnabled,
  VISUAL_PARITY_STORAGE_KEY,
} from '../src/visual-parity/visualParityMode';

let activeTree: ReactTestRenderer.ReactTestRenderer | undefined;

async function render(element: React.ReactElement) {
  if (activeTree) {
    await ReactTestRenderer.act(async () => {
      activeTree?.unmount();
    });
    activeTree = undefined;
  }

  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(element);
  });

  if (!tree) {
    throw new Error('React test renderer did not create a tree.');
  }

  activeTree = tree;
  return tree;
}

afterEach(async () => {
  if (activeTree) {
    await ReactTestRenderer.act(async () => {
      activeTree?.unmount();
    });
    activeTree = undefined;
  }
});

test('enables the V0002 visual parity shell from the capture storage flag', () => {
  const enabledStorage = {
    getItem: jest.fn((key: string) =>
      key === VISUAL_PARITY_STORAGE_KEY ? '1' : null,
    ),
  };
  const disabledStorage = {
    getItem: jest.fn(() => null),
  };

  expect(isVisualParityShellEnabled(enabledStorage)).toBe(true);
  expect(isVisualParityShellEnabled(disabledStorage)).toBe(false);
  expect(enabledStorage.getItem).toHaveBeenCalledWith(VISUAL_PARITY_STORAGE_KEY);
});

test('renders the shell/dashboard parity frame without browser embedding', async () => {
  const tree = await render(<ShellVisualParityFrame visualPathname="/" />);
  const serialized = JSON.stringify(tree.toJSON());

  expect(
    tree.root.findByProps({ testID: 'visual-parity-shell-v0002' }),
  ).toBeTruthy();
  expect(serialized).toContain('TeslaSync');
  expect(serialized).toContain('Ctrl+K to jump');
  expect(serialized).toContain('Command Center');
  expect(serialized).toContain('Print snapshot');
  expect(serialized).toContain('API · 8ms');
  expect(serialized).not.toContain('WebView');
  expect(serialized).not.toContain('Electron');
});

test('renders route-specific visual status surfaces for shell comparison', async () => {
  const vehicleTree = await render(
    <ShellVisualParityFrame visualPathname="/vehicles" />,
  );
  const vehicleJson = JSON.stringify(vehicleTree.toJSON());

  expect(vehicleJson).toContain('Fleet');
  expect(vehicleJson).toContain('My Vehicles');
  expect(vehicleJson).toContain('VEHICLES');

  const systemTree = await render(
    <ShellVisualParityFrame visualPathname="/system-status" />,
  );
  const systemJson = JSON.stringify(systemTree.toJSON());

  expect(systemJson).toContain('System Status');
  expect(systemJson).toContain('At-a-glance health for your TeslaSync instance');
  expect(systemJson).toContain('DIAGNOSTICS');
  expect(systemJson).toContain('Refresh');
});
