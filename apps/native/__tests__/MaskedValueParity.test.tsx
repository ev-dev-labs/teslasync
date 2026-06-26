import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  MaskedValue,
  __postRevealAuditForTests,
} from '../src/web-parity/components/ui/MaskedValue';

const BULLET = '\u2022';

function serialize(tree: ReactTestRenderer.ReactTestRenderer | undefined): string {
  return JSON.stringify(tree?.toJSON());
}

test('masks a token by default without leaking the raw value', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <MaskedValue
        ariaLabel="API key, click to reveal"
        autoHideMs={0}
        copyable
        value="sk_live_abcdef1234"
        variant="token"
      />,
    );
  });

  const serialized = serialize(tree);

  // Fixed 12-bullet run + last 4 (length never leaks) and raw stays hidden.
  expect(serialized).toContain(`${BULLET.repeat(12)}1234`);
  expect(serialized).not.toContain('sk_live_abcdef');
  expect(serialized).toContain('masked-value-toggle');
  expect(serialized).toContain('masked-value-copy');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('reveals and re-hides the raw value when the toggle is pressed', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <MaskedValue
        ariaLabel="API key, click to reveal"
        autoHideMs={0}
        value="sk_live_abcdef1234"
        variant="token"
      />,
    );
  });

  const pressToggle = () => {
    const node = tree?.root
      .findAllByProps({testID: 'masked-value-toggle'})
      .find(candidate => typeof candidate.props.onPress === 'function');
    expect(node).toBeDefined();
    node?.props.onPress();
  };

  await ReactTestRenderer.act(async () => {
    pressToggle();
  });
  expect(serialize(tree)).toContain('sk_live_abcdef1234');

  await ReactTestRenderer.act(async () => {
    pressToggle();
  });
  expect(serialize(tree)).not.toContain('sk_live_abcdef1234');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('renders an em-dash with no toggle for empty values', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <MaskedValue ariaLabel="Secret value" value={null} variant="token" />,
    );
  });

  const serialized = serialize(tree);

  expect(serialized).toContain('—');
  expect(serialized).toContain('Secret value');
  expect(serialized).not.toContain('masked-value-toggle');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('applies the correct masking strategy per variant', async () => {
  const cases: {variant: 'vin' | 'email' | 'coords' | 'generic'; value: string; expected: string}[] = [
    {variant: 'vin', value: '5YJ3E1EA7KF000316', expected: `5YJ${BULLET.repeat(10)}0316`},
    {variant: 'email', value: 'john@example.com', expected: `j${BULLET.repeat(3)}@example.com`},
    {variant: 'coords', value: '37.7749,-122.4194', expected: `${BULLET}${BULLET}.${BULLET}${BULLET}${BULLET}, ${BULLET}${BULLET}.${BULLET}${BULLET}${BULLET}`},
    {variant: 'generic', value: 'hello', expected: BULLET.repeat(5)},
  ];

  for (const testCase of cases) {
    let tree: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <MaskedValue
          ariaLabel="Sensitive value"
          autoHideMs={0}
          value={testCase.value}
          variant={testCase.variant}
        />,
      );
    });

    expect(serialize(tree)).toContain(testCase.expected);

    await ReactTestRenderer.act(async () => {
      tree?.unmount();
    });
  }
});

test('exposes the audit helper for test mocking', () => {
  expect(typeof __postRevealAuditForTests).toBe('function');
});
