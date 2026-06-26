import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  WidgetPicker,
  WIDGET_REGISTRY,
  DASHBOARD_PRESETS,
  resetWidgetPickerRecentlyAdded,
} from '../src/web-parity/features/dashboard/components/WidgetPicker';

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

function findCard(
  tree: ReactTestRenderer.ReactTestRenderer | undefined,
  testID: string,
) {
  return tree?.root
    .findAllByProps({testID})
    .find(candidate => typeof candidate.props.onPress === 'function');
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
    onAddWidgets: jest.fn(),
    onApplyPreset: jest.fn(),
  };
}

function renderPicker(
  handlers: ReturnType<typeof makeHandlers>,
  activeWidgetIds: string[] = [],
) {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <WidgetPicker
        activeWidgetIds={activeWidgetIds}
        onAddWidgets={handlers.onAddWidgets}
        onApplyPreset={handlers.onApplyPreset}
        onClose={handlers.onClose}
        open
      />,
    );
  });
  return tree;
}

beforeEach(() => {
  // Native analogue of clearing localStorage between cases so the in-memory
  // recently-added store does not leak across tests.
  resetWidgetPickerRecentlyAdded();
});

test('mirrors the web registry: 118 widgets and 10 layout presets', () => {
  expect(WIDGET_REGISTRY).toHaveLength(118);
  expect(DASHBOARD_PRESETS).toHaveLength(10);
  expect(WIDGET_REGISTRY[0].id).toBe('vehicle-hero');
  expect(DASHBOARD_PRESETS.map(p => p.id)).toContain('commuter');
});

test('renders the open drawer with title, count, pills, presets, and groups', () => {
  const handlers = makeHandlers();
  const tree = renderPicker(handlers);
  const serialized = serialize(tree);

  expect(serialized).toContain('Add Widget');
  expect(serialized).toContain(`${WIDGET_REGISTRY.length} widgets available`);
  // Category pills + group headers.
  expect(serialized).toContain('All');
  expect(serialized).toContain('Vehicle');
  expect(serialized).toContain('Battery & Range');
  // Presets section.
  expect(serialized).toContain('Layout Presets');
  expect(serialized).toContain('Daily Commuter');
  // A grouped widget name + its grid size.
  expect(serialized).toContain('Vehicle Card');
  expect(serialized).toContain('2×9 grid');
  // The search field is present and carries the placeholder.
  expect(findTextInput(tree, 'widget-picker-search')?.props.placeholder).toContain(
    'Search widgets',
  );

  ReactTestRenderer.act(() => {
    tree?.unmount();
  });
});

test('pressing a widget card adds it via onAddWidgets without closing', () => {
  const handlers = makeHandlers();
  const tree = renderPicker(handlers);

  ReactTestRenderer.act(() => {
    pressByTestId(tree, 'widget-picker-card-vehicle-hero');
  });

  expect(handlers.onAddWidgets).toHaveBeenCalledTimes(1);
  expect(handlers.onAddWidgets).toHaveBeenCalledWith(['vehicle-hero']);
  expect(handlers.onClose).not.toHaveBeenCalled();

  ReactTestRenderer.act(() => {
    tree?.unmount();
  });
});

test('a nonsense search shows the no-results message', () => {
  const handlers = makeHandlers();
  const tree = renderPicker(handlers);

  ReactTestRenderer.act(() => {
    findTextInput(tree, 'widget-picker-search')?.props.onChangeText('zzzzzz');
  });

  expect(serialize(tree)).toContain('No widgets match "zzzzzz"');

  ReactTestRenderer.act(() => {
    tree?.unmount();
  });
});

test('pressing a preset applies it and closes the drawer', () => {
  const handlers = makeHandlers();
  const tree = renderPicker(handlers);

  ReactTestRenderer.act(() => {
    pressByTestId(tree, 'widget-picker-preset-commuter');
  });

  expect(handlers.onApplyPreset).toHaveBeenCalledTimes(1);
  expect(handlers.onApplyPreset).toHaveBeenCalledWith('commuter');
  expect(handlers.onClose).toHaveBeenCalledTimes(1);

  ReactTestRenderer.act(() => {
    tree?.unmount();
  });
});

test('an active widget renders the Added badge and is disabled', () => {
  const handlers = makeHandlers();
  const tree = renderPicker(handlers, ['vehicle-hero']);

  expect(serialize(tree)).toContain('Added');
  expect(findCard(tree, 'widget-picker-card-vehicle-hero')?.props.disabled).toBe(
    true,
  );

  ReactTestRenderer.act(() => {
    tree?.unmount();
  });
});

test('Add all for a category adds every addable widget in that category', () => {
  const handlers = makeHandlers();
  const tree = renderPicker(handlers);

  const expectedVehicleIds = WIDGET_REGISTRY.filter(
    w => w.category === 'vehicle',
  ).map(w => w.id);

  ReactTestRenderer.act(() => {
    pressByTestId(tree, 'widget-picker-add-all-vehicle');
  });

  expect(handlers.onAddWidgets).toHaveBeenCalledTimes(1);
  expect(handlers.onAddWidgets).toHaveBeenCalledWith(expectedVehicleIds);

  ReactTestRenderer.act(() => {
    tree?.unmount();
  });
});

test('after adding, the footer shows the count and Done closes the drawer', () => {
  const handlers = makeHandlers();
  const tree = renderPicker(handlers);

  ReactTestRenderer.act(() => {
    pressByTestId(tree, 'widget-picker-card-vehicle-hero');
  });

  expect(serialize(tree)).toContain('1 widget added');

  ReactTestRenderer.act(() => {
    pressByTestId(tree, 'widget-picker-done');
  });

  expect(handlers.onClose).toHaveBeenCalledTimes(1);

  ReactTestRenderer.act(() => {
    tree?.unmount();
  });
});
