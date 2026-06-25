import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import { ShellVisualParityFrame } from '../src/visual-parity/ShellVisualParityFrame';
import {
  isVisualParityShellEnabled,
  VISUAL_PARITY_STORAGE_KEY,
} from '../src/visual-parity/visualParityMode';

const originalLocation = (
  globalThis as { location?: { pathname?: string } }
).location;

function setVisualPath(pathname: string) {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { pathname },
  });
}

async function render(element: React.ReactElement) {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(element);
  });

  if (!tree) {
    throw new Error('React test renderer did not create a tree.');
  }

  return tree;
}

afterEach(() => {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: originalLocation,
  });
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
  setVisualPath('/');
  const tree = await render(<ShellVisualParityFrame />);
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
  setVisualPath('/vehicles');
  const vehicleTree = await render(<ShellVisualParityFrame />);
  const vehicleJson = JSON.stringify(vehicleTree.toJSON());

  expect(vehicleJson).toContain('Fleet');
  expect(vehicleJson).toContain('My Vehicles');
  expect(vehicleJson).toContain('VEHICLES');

  setVisualPath('/system-status');
  const systemTree = await render(<ShellVisualParityFrame />);
  const systemJson = JSON.stringify(systemTree.toJSON());

  expect(systemJson).toContain('System Status');
  expect(systemJson).toContain('At-a-glance health for your TeslaSync instance');
  expect(systemJson).toContain('DIAGNOSTICS');
  expect(systemJson).toContain('Refresh');
});
