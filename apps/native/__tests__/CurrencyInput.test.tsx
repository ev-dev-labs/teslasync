import React from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import { CurrencyInput } from '../src/web-parity/components/forms/CurrencyInput';

type FieldBlurEvent = Parameters<NonNullable<TextInputProps['onBlur']>>[0];
type FieldFocusEvent = Parameters<NonNullable<TextInputProps['onFocus']>>[0];
type FieldSubmitEvent = Parameters<
  NonNullable<TextInputProps['onSubmitEditing']>
>[0];

const blurEvent = { nativeEvent: { target: 0 } } as unknown as FieldBlurEvent;
const focusEvent = { nativeEvent: { target: 0 } } as unknown as FieldFocusEvent;
const submitEvent = {
  nativeEvent: { target: 0, text: '', eventCount: 0 },
} as unknown as FieldSubmitEvent;

function renderField(valueMicro: number | null) {
  const onChange = jest.fn();
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <CurrencyInput
        ariaLabel="Electricity cost"
        currency="USD"
        locale="en-US"
        onChange={onChange}
        valueMicro={valueMicro}
      />,
    );
  });

  const getField = () => tree!.root.findByType(TextInput);
  return { onChange, getField, tree: tree! };
}

test('renders the formatted currency value and localized symbol', () => {
  const { getField, tree } = renderField(1_500_000);

  expect(getField().props.value).toBe('$1.50');
  expect(getField().props.accessibilityLabel).toBe('Electricity cost');
  expect(getField().props.keyboardType).toBe('decimal-pad');

  const serialized = JSON.stringify(tree.toJSON());
  expect(serialized).toContain('$1.50');
  expect(serialized).toContain('currency-input-symbol');
});

test('renders an empty buffer when valueMicro is null', () => {
  const { getField } = renderField(null);
  expect(getField().props.value).toBe('');
});

test('commits typed text to canonical micro-units on blur', () => {
  const { getField, onChange } = renderField(null);

  ReactTestRenderer.act(() => {
    getField().props.onChangeText('2.5');
  });
  ReactTestRenderer.act(() => {
    getField().props.onBlur(blurEvent);
  });

  expect(onChange).toHaveBeenCalledWith({ valueMicro: 2_500_000 });
  expect(getField().props.value).toBe('$2.50');
});

test('parses localized grouping and currency symbols', () => {
  const { getField, onChange } = renderField(null);

  ReactTestRenderer.act(() => {
    getField().props.onChangeText('$1,234.56');
  });
  ReactTestRenderer.act(() => {
    getField().props.onBlur(blurEvent);
  });

  expect(onChange).toHaveBeenCalledWith({ valueMicro: 1_234_560_000 });
});

test('treats accounting parentheses as negative and commits on submit', () => {
  const { getField, onChange } = renderField(null);

  ReactTestRenderer.act(() => {
    getField().props.onChangeText('($3.00)');
  });
  ReactTestRenderer.act(() => {
    getField().props.onSubmitEditing(submitEvent);
  });

  expect(onChange).toHaveBeenCalledWith({ valueMicro: -3_000_000 });
});

test('does not clobber in-progress text while focused, resyncs after blur', () => {
  const onChange = jest.fn();
  const element = (micro: number) => (
    <CurrencyInput
      ariaLabel="Electricity cost"
      currency="USD"
      locale="en-US"
      onChange={onChange}
      valueMicro={micro}
    />
  );

  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(element(1_000_000));
  });
  const getField = () => tree!.root.findByType(TextInput);

  expect(getField().props.value).toBe('$1.00');

  // Focus + type, then an external prop change must NOT clobber the buffer.
  ReactTestRenderer.act(() => {
    getField().props.onFocus(focusEvent);
  });
  ReactTestRenderer.act(() => {
    getField().props.onChangeText('9');
  });
  ReactTestRenderer.act(() => {
    tree!.update(element(2_000_000));
  });
  expect(getField().props.value).toBe('9');

  // After blur (not focused), an external change resyncs the display.
  ReactTestRenderer.act(() => {
    getField().props.onBlur(blurEvent);
  });
  ReactTestRenderer.act(() => {
    tree!.update(element(5_000_000));
  });
  expect(getField().props.value).toBe('$5.00');
});
