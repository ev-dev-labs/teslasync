import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {RangeSlider} from '../src/web-parity/components/ui/RangeSlider';

test('renders the label row with a formatted low – high value', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <RangeSlider
        value={[20, 80]}
        min={0}
        max={100}
        label="Price"
        formatValue={n => `$${n}`}
        onChange={() => undefined}
      />,
    );
  });

  const serialized = JSON.stringify(tree?.toJSON());
  expect(serialized).toContain('Price');
  // displayLow + en-dash + displayHigh, formatted via formatValue.
  expect(serialized).toContain('$20 \u2013 $80');
});

test('hides the label row when showLabel is false', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <RangeSlider
        value={[10, 40]}
        min={0}
        max={100}
        label="Range"
        showLabel={false}
        onChange={() => undefined}
      />,
    );
  });

  // The thumbs still derive their a11y labels from `label`, but the visible
  // label/value row (the only place the formatted `low – high` caption renders)
  // must be absent when showLabel is false.
  expect(JSON.stringify(tree?.toJSON())).not.toContain('10 \u2013 40');
});

test('exposes per-thumb accessibility values mirroring the web aria-valuetext', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <RangeSlider
        value={[25, 75]}
        min={0}
        max={100}
        label="Speed"
        testID="speed"
        onChange={() => undefined}
      />,
    );
  });

  const lowThumb = tree!.root.findByProps({testID: 'speed-low'});
  const highThumb = tree!.root.findByProps({testID: 'speed-high'});

  expect(lowThumb.props.accessibilityRole).toBe('adjustable');
  expect(lowThumb.props.accessibilityLabel).toBe('Speed minimum');
  expect(lowThumb.props.accessibilityValue).toEqual({
    min: 0,
    max: 100,
    now: 25,
    text: '25',
  });
  expect(highThumb.props.accessibilityRole).toBe('adjustable');
  expect(highThumb.props.accessibilityLabel).toBe('Speed maximum');
  expect(highThumb.props.accessibilityValue).toEqual({
    min: 0,
    max: 100,
    now: 75,
    text: '75',
  });
});

test('increment/decrement accessibility actions step each thumb by `step`', async () => {
  const onChange = jest.fn();
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <RangeSlider
        value={[20, 80]}
        min={0}
        max={100}
        step={5}
        label="Range"
        testID="range"
        onChange={onChange}
      />,
    );
  });

  await ReactTestRenderer.act(async () => {
    tree!.root.findByProps({testID: 'range-low'}).props.onAccessibilityAction({
      nativeEvent: {actionName: 'increment'},
    });
  });
  expect(onChange).toHaveBeenLastCalledWith([25, 80]);

  await ReactTestRenderer.act(async () => {
    tree!.root.findByProps({testID: 'range-high'}).props.onAccessibilityAction({
      nativeEvent: {actionName: 'decrement'},
    });
  });
  expect(onChange).toHaveBeenLastCalledWith([20, 75]);
});

test('swaps the thumbs when the low thumb is incremented past the high thumb', async () => {
  const onChange = jest.fn();
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <RangeSlider
        value={[95, 96]}
        min={0}
        max={100}
        step={5}
        label="Range"
        testID="range"
        onChange={onChange}
      />,
    );
  });

  // low 95 + step 5 = 100, which is > high 96 -> sorted tuple [high, next].
  await ReactTestRenderer.act(async () => {
    tree!.root.findByProps({testID: 'range-low'}).props.onAccessibilityAction({
      nativeEvent: {actionName: 'increment'},
    });
  });

  expect(onChange).toHaveBeenLastCalledWith([96, 100]);
});

test('marks both thumbs disabled and non-accessible when disabled', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <RangeSlider
        value={[30, 70]}
        min={0}
        max={100}
        label="Range"
        testID="range"
        disabled
        onChange={() => undefined}
      />,
    );
  });

  for (const id of ['range-low', 'range-high']) {
    const thumb = tree!.root.findByProps({testID: id});
    expect(thumb.props.accessibilityState).toEqual({disabled: true});
    expect(thumb.props.accessible).toBe(false);
  }
});
