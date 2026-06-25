import React from 'react';
import ReactTestRenderer, { type ReactTestInstance } from 'react-test-renderer';

import {
  ListExportMenu,
  type ExportScope,
} from '../src/web-parity/components/forms/ListExportMenu';

type Renderer = ReactTestRenderer.ReactTestRenderer;

// react-test-renderer's findByProps counts BOTH composite and host instances,
// and Pressable consumes `onPress` instead of forwarding it to the host View.
// So count existence on host nodes only, and dispatch presses on the single
// instance that actually owns the `onPress` handler.
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

function renderMenu(props: {
  selectedCount?: number;
  visibleCount?: number;
  disabled?: boolean;
}) {
  const onExportCsv = jest.fn<void, [ExportScope]>();
  const onExportJson = jest.fn<void, [ExportScope]>();
  let tree: Renderer | undefined;

  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <ListExportMenu
        disabled={props.disabled}
        onExportCsv={onExportCsv}
        onExportJson={onExportJson}
        selectedCount={props.selectedCount}
        testId="list-export"
        visibleCount={props.visibleCount}
      />,
    );
  });

  return { onExportCsv, onExportJson, tree: tree! };
}

test('opens the menu and exports the visible scope as CSV', () => {
  const { onExportCsv, tree } = renderMenu({ visibleCount: 12 });

  // Menu is closed until the trigger is pressed.
  expect(countHost(tree, 'list-export-menu')).toBe(0);

  press(tree, 'list-export-trigger');
  expect(countHost(tree, 'list-export-menu')).toBe(1);
  // No selection -> scope radios are hidden.
  expect(countHost(tree, 'list-export-scope-visible')).toBe(0);
  expect(JSON.stringify(tree.toJSON())).toContain('Download as CSV');

  press(tree, 'list-export-csv');
  expect(onExportCsv).toHaveBeenCalledWith('visible');
  // Choosing an action closes the menu again.
  expect(countHost(tree, 'list-export-menu')).toBe(0);
});

test('defaults scope to selected when rows are selected and exports JSON', () => {
  const { onExportJson, tree } = renderMenu({
    selectedCount: 3,
    visibleCount: 20,
  });

  press(tree, 'list-export-trigger');
  expect(countHost(tree, 'list-export-scope-selected')).toBe(1);
  expect(JSON.stringify(tree.toJSON())).toContain('Selected (3)');
  expect(JSON.stringify(tree.toJSON())).toContain('Visible (20)');

  press(tree, 'list-export-json');
  expect(onExportJson).toHaveBeenCalledWith('selected');
});

test('switching the scope radio changes the exported scope', () => {
  const { onExportCsv, tree } = renderMenu({
    selectedCount: 5,
    visibleCount: 40,
  });

  press(tree, 'list-export-trigger');
  press(tree, 'list-export-scope-visible');
  press(tree, 'list-export-csv');

  expect(onExportCsv).toHaveBeenCalledWith('visible');
});

test('snaps scope back to visible when the selection clears mid-menu', () => {
  const onExportCsv = jest.fn<void, [ExportScope]>();
  const onExportJson = jest.fn<void, [ExportScope]>();
  const element = (selectedCount: number) => (
    <ListExportMenu
      onExportCsv={onExportCsv}
      onExportJson={onExportJson}
      selectedCount={selectedCount}
      testId="list-export"
      visibleCount={18}
    />
  );

  let tree: Renderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(element(4));
  });

  press(tree!, 'list-export-trigger');
  expect(countHost(tree!, 'list-export-scope-selected')).toBe(1);

  // Selection clears while the menu stays open -> radios disappear and the
  // pending 'selected' scope falls back to 'visible'.
  ReactTestRenderer.act(() => {
    tree!.update(element(0));
  });
  expect(countHost(tree!, 'list-export-scope-selected')).toBe(0);

  press(tree!, 'list-export-json');
  expect(onExportJson).toHaveBeenCalledWith('visible');
});

test('does not open the menu while disabled', () => {
  const { tree } = renderMenu({ disabled: true, visibleCount: 0 });

  // Pressing the disabled trigger is a no-op; the Modal stays hidden.
  press(tree, 'list-export-trigger');
  expect(countHost(tree, 'list-export-menu')).toBe(0);
});

test('the trigger uses the disabled accessibility label and state', () => {
  const { tree } = renderMenu({ disabled: true });
  const trigger = tree.root.find(
    (node: ReactTestInstance) =>
      node.props.testID === 'list-export-trigger' &&
      typeof node.props.onPress === 'function',
  );

  expect(trigger.props.accessibilityLabel).toBe('No data to export');
  expect(trigger.props.accessibilityState).toEqual({
    disabled: true,
    expanded: false,
  });
});
