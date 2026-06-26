import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  OnboardingGate,
  __resetOnboardingSkipForTests,
  setOnboardingSkippedForParity,
} from '../src/web-parity/features/onboarding/components/OnboardingGate';

/**
 * Native parity contract for OnboardingGate.
 *
 * The web gate is a non-blocking first-run redirect guard: it renders nothing
 * and, via an effect, redirects to /onboarding while onboarding is incomplete
 * unless the request is in flight / errored, the user has skipped, or the
 * current path is allow-listed. These tests assert that behaviour against the
 * native port (react-router useLocation/useNavigate -> currentPath/onNavigate
 * props) by mocking the onboarding-status hook and driving the in-process skip
 * store.
 */

const mockUseOnboardingStatus = jest.fn();

jest.mock('../src/web-parity/api/hooks/useOnboarding', () => ({
  useOnboardingStatus: (...args: unknown[]) => mockUseOnboardingStatus(...args),
}));

type Tree = ReactTestRenderer.ReactTestRenderer;

interface OnboardingStatus {
  tesla_connected: boolean;
  vehicle_count: number;
  data_flowing: boolean;
  is_complete: boolean;
}

function statusQuery(
  data: OnboardingStatus | undefined,
  overrides: Record<string, unknown> = {},
) {
  return {
    data,
    isLoading: false,
    isError: false,
    ...overrides,
  };
}

const INCOMPLETE: OnboardingStatus = {
  tesla_connected: false,
  vehicle_count: 0,
  data_flowing: false,
  is_complete: false,
};

const COMPLETE: OnboardingStatus = {
  tesla_connected: true,
  vehicle_count: 2,
  data_flowing: true,
  is_complete: true,
};

async function render(node: React.ReactElement): Promise<Tree> {
  let tree!: Tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(node);
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetOnboardingSkipForTests();
  mockUseOnboardingStatus.mockReturnValue(statusQuery(INCOMPLETE));
});

test('redirects to /onboarding (replace) when onboarding is incomplete on a gated path', async () => {
  const onNavigate = jest.fn();

  const tree = await render(
    <OnboardingGate currentPath="/dashboard" onNavigate={onNavigate} />,
  );

  // Non-blocking: the gate renders nothing.
  expect(tree.toJSON()).toBeNull();
  expect(onNavigate).toHaveBeenCalledTimes(1);
  expect(onNavigate).toHaveBeenCalledWith('/onboarding', {replace: true});

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('does not redirect while the status request is loading', async () => {
  mockUseOnboardingStatus.mockReturnValue(
    statusQuery(undefined, {isLoading: true}),
  );
  const onNavigate = jest.fn();

  const tree = await render(
    <OnboardingGate currentPath="/dashboard" onNavigate={onNavigate} />,
  );

  expect(onNavigate).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('does not redirect when the status request errored', async () => {
  mockUseOnboardingStatus.mockReturnValue(
    statusQuery(undefined, {isError: true}),
  );
  const onNavigate = jest.fn();

  const tree = await render(
    <OnboardingGate currentPath="/dashboard" onNavigate={onNavigate} />,
  );

  expect(onNavigate).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('does not redirect when onboarding is already complete', async () => {
  mockUseOnboardingStatus.mockReturnValue(statusQuery(COMPLETE));
  const onNavigate = jest.fn();

  const tree = await render(
    <OnboardingGate currentPath="/dashboard" onNavigate={onNavigate} />,
  );

  expect(onNavigate).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('does not redirect when the user has skipped onboarding', async () => {
  setOnboardingSkippedForParity(true);
  const onNavigate = jest.fn();

  const tree = await render(
    <OnboardingGate currentPath="/dashboard" onNavigate={onNavigate} />,
  );

  expect(onNavigate).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => tree.unmount());
});

test.each([
  ['/onboarding', 'onboarding itself'],
  ['/onboarding/step-2', 'nested onboarding route'],
  ['/tesla-account', 'tesla account setup'],
  ['/settings/units', 'nested settings route'],
  ['/s/abc123', 'public share link'],
  ['/watch', 'exact watch face'],
  ['/login', 'login'],
])('does not redirect on the allow-listed path %s (%s)', async path => {
  const onNavigate = jest.fn();

  const tree = await render(
    <OnboardingGate currentPath={path} onNavigate={onNavigate} />,
  );

  expect(onNavigate).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('does not throw and renders nothing when onNavigate is unwired', async () => {
  const tree = await render(<OnboardingGate currentPath="/dashboard" />);

  expect(tree.toJSON()).toBeNull();

  await ReactTestRenderer.act(async () => tree.unmount());
});
