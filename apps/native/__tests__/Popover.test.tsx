import React from 'react';
import {Dimensions, Modal, StyleSheet, View} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import {
  Popover,
  type PopoverAnchorHandle,
  type PopoverProps,
} from '../src/web-parity/components/ui/Popover';

/**
 * Native parity contract for Popover.
 *
 * The web component is a portaled, bbox-anchored popover primitive: it
 * createPortal()s children to <body>, positions them relative to an anchor's
 * getBoundingClientRect (side bottom/top auto-flip, align start/center/end,
 * sideOffset gap, viewport clamping), closes on Escape / outside-pointerdown,
 * and restores focus to the trigger on close. The native port renders the
 * content in a transparent <Modal>, measures the anchor via measureInWindow and
 * the content via onLayout, and feeds the SAME flip/align/clamp arithmetic.
 * These tests assert that behaviour: the closed no-render, the computed top/left
 * for each align mode, the auto-flip, the horizontal viewport clamp, the
 * backdrop + onRequestClose close paths, and the focus restore on close.
 */

type Tree = ReactTestRenderer.ReactTestRenderer;

function render(node: React.ReactElement): Tree {
  let tree!: Tree;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(node);
  });
  return tree;
}

// React Native yields a composite + host instance for a testID; grab the first.
function byTestId(tree: Tree, id: string) {
  return tree.root.findAllByProps({testID: id})[0];
}

function presentCount(tree: Tree, id: string): number {
  return tree.root.findAllByProps({testID: id}).length > 0 ? 1 : 0;
}

function flattenContentStyle(tree: Tree): Record<string, unknown> {
  return StyleSheet.flatten(byTestId(tree, 'popover-content').props.style) as Record<
    string,
    unknown
  >;
}

/** Build an anchor ref whose measureInWindow reports a fixed window rect. */
function makeAnchor(
  x: number,
  y: number,
  width: number,
  height: number,
  focus = jest.fn(),
): {ref: React.RefObject<PopoverAnchorHandle | null>; focus: jest.Mock} {
  const handle: PopoverAnchorHandle = {
    measureInWindow: cb => cb(x, y, width, height),
    focus,
  };
  return {ref: {current: handle}, focus};
}

/** Open the popover, then drive the content onLayout so a position resolves. */
function openWith(
  anchorRect: {x: number; y: number; w: number; h: number},
  content: {w: number; h: number},
  props: Partial<PopoverProps> = {},
): {tree: Tree; onClose: jest.Mock; focus: jest.Mock} {
  const onClose = jest.fn();
  const {ref, focus} = makeAnchor(
    anchorRect.x,
    anchorRect.y,
    anchorRect.w,
    anchorRect.h,
  );
  const tree = render(
    <Popover open onClose={onClose} anchorRef={ref} {...props}>
      <View testID="popover-child" />
    </Popover>,
  );
  ReactTestRenderer.act(() => {
    byTestId(tree, 'popover-content').props.onLayout({
      nativeEvent: {layout: {x: 0, y: 0, width: content.w, height: content.h}},
    });
  });
  return {tree, onClose, focus};
}

beforeEach(() => {
  jest
    .spyOn(Dimensions, 'get')
    .mockReturnValue({width: 400, height: 800, scale: 1, fontScale: 1});
  jest
    .spyOn(Dimensions, 'addEventListener')
    .mockReturnValue({remove: jest.fn()} as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('renders nothing while closed (web `if (!open) return null`)', () => {
  const {ref} = makeAnchor(0, 0, 10, 10);
  const tree = render(
    <Popover open={false} onClose={jest.fn()} anchorRef={ref}>
      <View testID="popover-child" />
    </Popover>,
  );

  expect(tree.toJSON()).toBeNull();
  expect(presentCount(tree, 'popover-content')).toBe(0);
  expect(presentCount(tree, 'popover-child')).toBe(0);

  ReactTestRenderer.act(() => tree.unmount());
});

test('mounts the content + child in a transparent Modal once open', () => {
  const {tree} = openWith({x: 50, y: 100, w: 120, h: 40}, {w: 200, h: 150});

  const modal = tree.root.findByType(Modal);
  expect(modal.props.transparent).toBe(true);
  expect(modal.props.visible).toBe(true);
  expect(presentCount(tree, 'popover-content')).toBe(1);
  expect(presentCount(tree, 'popover-child')).toBe(1);

  ReactTestRenderer.act(() => tree.unmount());
});

test('positions below the anchor with align="start" (default)', () => {
  const {tree} = openWith({x: 50, y: 100, w: 120, h: 40}, {w: 200, h: 150});

  // bottom = 140; top = 140 + sideOffset(6) = 146; left = anchor.left = 50.
  const style = flattenContentStyle(tree);
  expect(style.top).toBe(146);
  expect(style.left).toBe(50);
  expect(style.position).toBe('absolute');
  // visibility:hidden-until-positioned -> opacity flips to 1 once resolved.
  expect(style.opacity).toBe(1);

  ReactTestRenderer.act(() => tree.unmount());
});

test('auto-flips to the top side when there is not enough space below', () => {
  // anchor near the bottom edge: bottom = 740, only 46px below for a 150px panel.
  const {tree} = openWith({x: 50, y: 700, w: 120, h: 40}, {w: 200, h: 150});

  // resolvedSide flips to top: top = anchor.top(700) - sideOffset(6) - height(150).
  expect(flattenContentStyle(tree).top).toBe(544);

  ReactTestRenderer.act(() => tree.unmount());
});

test('align="end" right-aligns the content to the anchor', () => {
  const {tree} = openWith(
    {x: 50, y: 100, w: 120, h: 40},
    {w: 100, h: 150},
    {align: 'end'},
  );

  // right = 170; left = right - contentWidth(100) = 70.
  expect(flattenContentStyle(tree).left).toBe(70);

  ReactTestRenderer.act(() => tree.unmount());
});

test('align="center" centers the content over the anchor', () => {
  const {tree} = openWith(
    {x: 50, y: 100, w: 120, h: 40},
    {w: 100, h: 150},
    {align: 'center'},
  );

  // left = anchorLeft(50) + anchorWidth/2(60) - contentWidth/2(50) = 60.
  expect(flattenContentStyle(tree).left).toBe(60);

  ReactTestRenderer.act(() => tree.unmount());
});

test('clamps horizontally so the content stays inside the viewport', () => {
  // anchor hugs the right edge; align start would overflow a 200px panel.
  const {tree} = openWith({x: 350, y: 100, w: 40, h: 40}, {w: 200, h: 150});

  // left = vw(400) - contentWidth(200) - margin(8) = 192.
  expect(flattenContentStyle(tree).left).toBe(192);

  ReactTestRenderer.act(() => tree.unmount());
});

test('honours a custom sideOffset in the vertical placement', () => {
  const {tree} = openWith(
    {x: 50, y: 100, w: 120, h: 40},
    {w: 100, h: 100},
    {sideOffset: 20},
  );

  // top = bottom(140) + sideOffset(20) = 160.
  expect(flattenContentStyle(tree).top).toBe(160);

  ReactTestRenderer.act(() => tree.unmount());
});

test('tapping the backdrop closes the popover (outside-pointerdown analog)', () => {
  const {tree, onClose} = openWith(
    {x: 50, y: 100, w: 120, h: 40},
    {w: 100, h: 100},
  );

  ReactTestRenderer.act(() => {
    byTestId(tree, 'popover-backdrop').props.onPress();
  });

  expect(onClose).toHaveBeenCalledTimes(1);

  ReactTestRenderer.act(() => tree.unmount());
});

test('Modal onRequestClose closes the popover (Esc / Android-back analog)', () => {
  const {tree, onClose} = openWith(
    {x: 50, y: 100, w: 120, h: 40},
    {w: 100, h: 100},
  );

  ReactTestRenderer.act(() => {
    tree.root.findByType(Modal).props.onRequestClose();
  });

  expect(onClose).toHaveBeenCalledTimes(1);

  ReactTestRenderer.act(() => tree.unmount());
});

test('a custom testID prefixes the backdrop and names the content', () => {
  const {ref} = makeAnchor(0, 0, 10, 10);
  const tree = render(
    <Popover open onClose={jest.fn()} anchorRef={ref} testID="filter-pop">
      <View testID="popover-child" />
    </Popover>,
  );

  expect(presentCount(tree, 'filter-pop')).toBe(1);
  expect(presentCount(tree, 'filter-pop-backdrop')).toBe(1);

  ReactTestRenderer.act(() => tree.unmount());
});

test('restores focus to the trigger when it closes', () => {
  const onClose = jest.fn();
  const {ref, focus} = makeAnchor(50, 100, 120, 40);

  const tree = render(
    <Popover open onClose={onClose} anchorRef={ref}>
      <View testID="popover-child" />
    </Popover>,
  );

  // Re-render closed: the wasOpen->!open transition restores trigger focus.
  ReactTestRenderer.act(() => {
    tree.update(
      <Popover open={false} onClose={onClose} anchorRef={ref}>
        <View testID="popover-child" />
      </Popover>,
    );
  });

  expect(focus).toHaveBeenCalledTimes(1);

  ReactTestRenderer.act(() => tree.unmount());
});

test('passes the ariaLabel through as the content accessibility label', () => {
  const {tree} = openWith(
    {x: 50, y: 100, w: 120, h: 40},
    {w: 100, h: 100},
    {ariaLabel: 'Quick filters'},
  );

  const content = byTestId(tree, 'popover-content');
  expect(content.props.accessibilityLabel).toBe('Quick filters');
  expect(content.props.accessibilityViewIsModal).toBe(true);

  ReactTestRenderer.act(() => tree.unmount());
});
