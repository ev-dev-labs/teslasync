import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  DashboardSettingsModal,
  type DashboardSettings,
  type SavedDashboard,
  type VehicleOption,
} from '../src/web-parity/features/dashboard/components/DashboardSettingsModal';

const settings: DashboardSettings = {
  refreshInterval: 0,
  showWidgetBorders: false,
  compactMode: false,
};

const dashboard: SavedDashboard = {
  id: 'dash-1',
  name: 'My Dashboard',
  icon: '📊',
  widgets: [],
  layouts: {},
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  settings,
};

const vehicles: VehicleOption[] = [
  {id: 7, display_name: 'Model 3'},
  {id: 9, display_name: 'Model Y'},
];

type JsonNode =
  | string
  | number
  | null
  | undefined
  | {children?: JsonNode | JsonNode[]}
  | JsonNode[];

function flattenText(node: JsonNode): string {
  if (node == null) {
    return '';
  }
  if (typeof node === 'string') {
    return node;
  }
  if (typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(flattenText).join('');
  }
  return flattenText(node.children);
}

function serialize(
  tree: ReactTestRenderer.ReactTestRenderer | undefined,
): string {
  return flattenText(tree?.toJSON() as JsonNode);
}

function pressByTestId(
  tree: ReactTestRenderer.ReactTestRenderer | undefined,
  testID: string,
) {
  const node = tree?.root
    .findAllByProps({testID})
    .find(candidate => typeof candidate.props.onPress === 'function');
  expect(node).toBeDefined();
  node?.props.onPress();
}

function findTextInput(
  tree: ReactTestRenderer.ReactTestRenderer | undefined,
  testID: string,
) {
  return tree?.root
    .findAllByProps({testID})
    .find(candidate => typeof candidate.props.onChangeText === 'function');
}

function makeHandlers() {
  return {
    onClose: jest.fn(),
    onUpdate: jest.fn(),
    onRename: jest.fn(),
    onChangeIcon: jest.fn(),
  };
}

test('renders the open dialog with every section, the name, and the default selects', async () => {
  const handlers = makeHandlers();
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <DashboardSettingsModal
        dashboard={dashboard}
        onChangeIcon={handlers.onChangeIcon}
        onClose={handlers.onClose}
        onRename={handlers.onRename}
        onUpdate={handlers.onUpdate}
        open
        vehicles={vehicles}
      />,
    );
  });

  const serialized = serialize(tree);

  expect(serialized).toContain('Dashboard Settings');
  expect(serialized).toContain('Identity');
  expect(serialized).toContain('Name');
  expect(serialized).toContain('Icon');
  expect(serialized).toContain('Vehicle Filter');
  expect(serialized).toContain('Widget-level filters take precedence.');
  expect(serialized).toContain('Auto-Refresh');
  expect(serialized).toContain('Display');
  expect(serialized).toContain('Show widget borders');
  expect(serialized).toContain('Compact mode (smaller gaps)');
  expect(serialized).toContain('Cancel');
  expect(serialized).toContain('Save');
  // Select triggers show the currently-selected option labels.
  expect(serialized).toContain('All Vehicles');
  expect(serialized).toContain('Default (per widget)');

  // The name field is seeded from the dashboard.
  expect(findTextInput(tree, 'dashboard-settings-name')?.props.value).toBe(
    'My Dashboard',
  );

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('Save with no edits commits settings + closes, without rename/icon callbacks', async () => {
  const handlers = makeHandlers();
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <DashboardSettingsModal
        dashboard={dashboard}
        onChangeIcon={handlers.onChangeIcon}
        onClose={handlers.onClose}
        onRename={handlers.onRename}
        onUpdate={handlers.onUpdate}
        open
        vehicles={vehicles}
      />,
    );
  });

  await ReactTestRenderer.act(async () => {
    pressByTestId(tree, 'dashboard-settings-save');
  });

  expect(handlers.onUpdate).toHaveBeenCalledTimes(1);
  expect(handlers.onUpdate).toHaveBeenCalledWith({
    refreshInterval: 0,
    showWidgetBorders: false,
    compactMode: false,
  });
  expect(handlers.onRename).not.toHaveBeenCalled();
  expect(handlers.onChangeIcon).not.toHaveBeenCalled();
  expect(handlers.onClose).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('renaming then saving reports the trimmed name via onRename', async () => {
  const handlers = makeHandlers();
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <DashboardSettingsModal
        dashboard={dashboard}
        onChangeIcon={handlers.onChangeIcon}
        onClose={handlers.onClose}
        onRename={handlers.onRename}
        onUpdate={handlers.onUpdate}
        open
        vehicles={vehicles}
      />,
    );
  });

  await ReactTestRenderer.act(async () => {
    findTextInput(tree, 'dashboard-settings-name')?.props.onChangeText(
      '  Renamed Board  ',
    );
  });

  await ReactTestRenderer.act(async () => {
    pressByTestId(tree, 'dashboard-settings-save');
  });

  expect(handlers.onRename).toHaveBeenCalledTimes(1);
  expect(handlers.onRename).toHaveBeenCalledWith('Renamed Board');
  expect(handlers.onChangeIcon).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('picking an emoji then saving reports it via onChangeIcon', async () => {
  const handlers = makeHandlers();
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <DashboardSettingsModal
        dashboard={dashboard}
        onChangeIcon={handlers.onChangeIcon}
        onClose={handlers.onClose}
        onRename={handlers.onRename}
        onUpdate={handlers.onUpdate}
        open
        vehicles={vehicles}
      />,
    );
  });

  const emoji = tree?.root
    .findAllByProps({accessibilityLabel: '🎯'})
    .find(candidate => typeof candidate.props.onPress === 'function');
  expect(emoji).toBeDefined();

  await ReactTestRenderer.act(async () => {
    emoji?.props.onPress();
  });

  await ReactTestRenderer.act(async () => {
    pressByTestId(tree, 'dashboard-settings-save');
  });

  expect(handlers.onChangeIcon).toHaveBeenCalledTimes(1);
  expect(handlers.onChangeIcon).toHaveBeenCalledWith('🎯');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('choosing a vehicle from the select commits the vehicleId via onUpdate', async () => {
  const handlers = makeHandlers();
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <DashboardSettingsModal
        dashboard={dashboard}
        onChangeIcon={handlers.onChangeIcon}
        onClose={handlers.onClose}
        onRename={handlers.onRename}
        onUpdate={handlers.onUpdate}
        open
        vehicles={vehicles}
      />,
    );
  });

  // Open the vehicle-filter popover, then choose "Model 3" (id 7).
  await ReactTestRenderer.act(async () => {
    pressByTestId(tree, 'dashboard-settings-vehicle');
  });
  await ReactTestRenderer.act(async () => {
    pressByTestId(tree, 'dashboard-settings-vehicle-option-7');
  });
  await ReactTestRenderer.act(async () => {
    pressByTestId(tree, 'dashboard-settings-save');
  });

  expect(handlers.onUpdate).toHaveBeenCalledTimes(1);
  expect(handlers.onUpdate).toHaveBeenCalledWith(
    expect.objectContaining({vehicleId: 7, refreshInterval: 0}),
  );

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});
