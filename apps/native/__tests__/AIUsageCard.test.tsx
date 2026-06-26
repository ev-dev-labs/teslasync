import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {AIUsageCard} from '../src/web-parity/features/settings/components/AIUsageCard';

/**
 * Native parity contract for AIUsageCard.
 *
 * The web component is the lightweight Helix "Usage today" card: it reads
 * /ai/usage/today via useAiUsageToday() and renders three top-line metrics
 * (tokens in, tokens out, estimated cost), plus a caption that switches between a
 * live "N Helix calls today." line and the placeholder copy. Empty / loading /
 * error states all degrade to the em-dash placeholder. These tests assert that
 * behaviour against the native port by mocking the usage + settings query hooks.
 */

const mockUseAiUsageToday = jest.fn();
const mockUseSettings = jest.fn();

jest.mock('../src/web-parity/api/hooks/useAiUsage', () => ({
  useAiUsageToday: (...args: unknown[]) => mockUseAiUsageToday(...args),
}));

jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: (...args: unknown[]) => mockUseSettings(...args),
}));

type Tree = ReactTestRenderer.ReactTestRenderer;

interface UsageToday {
  user_subject: string;
  call_count: number;
  input_tokens: number;
  output_tokens: number;
  cost_micro_cents: number;
  error_count: number;
  avg_latency_ms: number;
}

const EM_DASH = '\u2014';

function usageQuery(
  data: UsageToday | undefined,
  overrides: Record<string, unknown> = {},
) {
  return {data, isLoading: false, isError: false, ...overrides};
}

const LIVE: UsageToday = {
  user_subject: 'user-1',
  call_count: 7,
  input_tokens: 1234,
  output_tokens: 5678,
  cost_micro_cents: 2_500_000,
  error_count: 0,
  avg_latency_ms: 120,
};

function setSettings(overrides: Record<string, unknown> = {}) {
  mockUseSettings.mockReturnValue({
    data: {
      locale: 'en-US',
      decimal_precision: 2,
      currency_symbol: '$',
      ...overrides,
    },
  });
}

function render(node: React.ReactElement): Tree {
  let tree!: Tree;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(node);
  });
  return tree;
}

function json(tree: Tree): string {
  return JSON.stringify(tree.toJSON());
}

function valueHosts(tree: Tree) {
  return tree.root.findAll(
    n => n.props?.testID === 'ai-usage-value' && typeof n.type === 'string',
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  setSettings();
  mockUseAiUsageToday.mockReturnValue(usageQuery(LIVE));
});

test('renders the title, three metric labels, and the live values', () => {
  const tree = render(<AIUsageCard />);

  const body = json(tree);
  expect(body).toContain('Usage today');
  expect(body).toContain('Tokens in');
  expect(body).toContain('Tokens out');
  expect(body).toContain('Estimated cost');
  // fmtInt(1234) -> "1,234"; fmtInt(5678) -> "5,678".
  expect(body).toContain('1,234');
  expect(body).toContain('5,678');
  // microCentsToDollars(2_500_000) = 2.5 -> formatCurrency -> "$2.50".
  expect(body).toContain('$2.50');
  // call_count 7 -> the live caption suffix.
  expect(body).toContain('7 Helix calls today.');

  ReactTestRenderer.act(() => tree.unmount());
});

test('zero-call data renders the placeholder caption and zeroed metrics', () => {
  mockUseAiUsageToday.mockReturnValue(
    usageQuery({
      user_subject: 'user-1',
      call_count: 0,
      input_tokens: 0,
      output_tokens: 0,
      cost_micro_cents: 0,
      error_count: 0,
      avg_latency_ms: 0,
    }),
  );

  const tree = render(<AIUsageCard />);

  const body = json(tree);
  // Finite zeroes still format (not the em dash) — formatCount(0) -> "0".
  expect(body).toContain('$0.00');
  // call_count 0 -> the placeholder copy, not the live suffix.
  expect(body).toContain('Usage populates as features run');
  expect(body).not.toContain('Helix calls today.');

  ReactTestRenderer.act(() => tree.unmount());
});

test('error state degrades all three values to the em-dash placeholder', () => {
  mockUseAiUsageToday.mockReturnValue(
    usageQuery(undefined, {isError: true}),
  );

  const tree = render(<AIUsageCard />);

  const values = valueHosts(tree);
  expect(values.length).toBe(3);
  values.forEach(node => {
    expect(node.props.children).toBe(EM_DASH);
  });
  // No data -> placeholder caption.
  expect(json(tree)).toContain('Usage populates as features run');

  ReactTestRenderer.act(() => tree.unmount());
});

test('loading with no data marks the value nodes busy and shows placeholders', () => {
  mockUseAiUsageToday.mockReturnValue(
    usageQuery(undefined, {isLoading: true}),
  );

  const tree = render(<AIUsageCard />);

  const values = valueHosts(tree);
  expect(values.length).toBe(3);
  values.forEach(node => {
    expect(node.props.accessibilityState).toEqual({busy: true});
    expect(node.props.children).toBe(EM_DASH);
  });

  ReactTestRenderer.act(() => tree.unmount());
});

test('honours the settings currency symbol and decimal precision', () => {
  setSettings({currency_symbol: '€', decimal_precision: 0});

  const tree = render(<AIUsageCard />);

  // precision 0 -> "€3" (2.5 rounds to 3) with the configured symbol.
  expect(json(tree)).toContain('€3');

  ReactTestRenderer.act(() => tree.unmount());
});
