import React, {type ReactNode} from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import ReactTestRenderer from 'react-test-renderer';

import {
  RateLimitBanner,
  emitRateLimited,
  emitUpstreamDown,
  __resetRateLimitBannerForTests,
} from '../src/web-parity/components/feedback/RateLimitBanner';

/**
 * Native parity contract for RateLimitBanner.
 *
 * The web banner reacts to two document-level CustomEvents; the native port
 * replaces the document bus with the module-level emitRateLimited /
 * emitUpstreamDown emitters. These tests assert the same lifecycle as the web
 * suite: visibility on emit, the upstream copy variant, "Retry now" gating +
 * invalidateQueries side-effect, manual dismiss, listener cleanup on unmount,
 * and malformed-event rejection.
 */

type InvalidateSpy = jest.Mock<Promise<void>, []>;

function makeClient(invalidateSpy: InvalidateSpy): QueryClient {
  const qc = new QueryClient({
    defaultOptions: {queries: {retry: false, staleTime: Infinity}},
  });
  qc.invalidateQueries =
    invalidateSpy as unknown as typeof qc.invalidateQueries;
  return qc;
}

function Wrapper({
  client,
  children,
}: {
  client: QueryClient;
  children: ReactNode;
}) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderBanner(invalidateSpy: InvalidateSpy) {
  const client = makeClient(invalidateSpy);
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(
      <Wrapper client={client}>
        <RateLimitBanner />
      </Wrapper>,
    );
  });
  return tree;
}

// React Native's `View` yields two matching test instances for a testID (the
// forwardRef composite and the underlying host node), so collapse to a 0/1
// presence count rather than asserting the raw match length.
function bannerCount(tree: ReactTestRenderer.ReactTestRenderer): number {
  return tree.root.findAllByProps({testID: 'rate-limit-banner'}).length > 0
    ? 1
    : 0;
}

function retryButton(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root.findByProps({accessibilityLabel: 'Retry now'});
}

beforeEach(() => {
  __resetRateLimitBannerForTests();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('renders nothing until an event fires', () => {
  const invalidateSpy: InvalidateSpy = jest.fn().mockResolvedValue(undefined);
  const tree = renderBanner(invalidateSpy);

  expect(tree.toJSON()).toBeNull();
  expect(bannerCount(tree)).toBe(0);

  ReactTestRenderer.act(() => tree.unmount());
});

test('appears on emitRateLimited with the countdown copy', () => {
  const invalidateSpy: InvalidateSpy = jest.fn().mockResolvedValue(undefined);
  const tree = renderBanner(invalidateSpy);

  ReactTestRenderer.act(() => {
    emitRateLimited({scope: '/vehicles', retryAfterSec: 30});
  });

  expect(bannerCount(tree)).toBe(1);
  expect(JSON.stringify(tree.toJSON())).toContain('pausing for 30s');

  ReactTestRenderer.act(() => tree.unmount());
});

test('appears on emitUpstreamDown with the upstream copy variant', () => {
  const invalidateSpy: InvalidateSpy = jest.fn().mockResolvedValue(undefined);
  const tree = renderBanner(invalidateSpy);

  ReactTestRenderer.act(() => {
    emitUpstreamDown({upstream: 'tesla', retryAfterSec: 45});
  });

  const serialized = JSON.stringify(tree.toJSON());
  expect(bannerCount(tree)).toBe(1);
  expect(serialized).toContain('Tesla upstream unavailable');
  expect(serialized).toContain('retry in 45s');

  ReactTestRenderer.act(() => tree.unmount());
});

test('disables Retry now while the countdown is positive', () => {
  const invalidateSpy: InvalidateSpy = jest.fn().mockResolvedValue(undefined);
  const tree = renderBanner(invalidateSpy);

  ReactTestRenderer.act(() => {
    emitRateLimited({scope: '/vehicles', retryAfterSec: 30});
  });

  expect(retryButton(tree).props.disabled).toBe(true);
  expect(invalidateSpy).not.toHaveBeenCalled();

  ReactTestRenderer.act(() => tree.unmount());
});

test('enables Retry now at zero, and pressing it invalidates queries and hides', () => {
  jest.setSystemTime(new Date('2026-05-03T12:00:00Z'));

  const invalidateSpy: InvalidateSpy = jest.fn().mockResolvedValue(undefined);
  const tree = renderBanner(invalidateSpy);

  ReactTestRenderer.act(() => {
    emitRateLimited({scope: '/vehicles', retryAfterSec: 2});
  });

  expect(retryButton(tree).props.disabled).toBe(true);

  ReactTestRenderer.act(() => {
    jest.advanceTimersByTime(3000);
  });

  expect(retryButton(tree).props.disabled).toBe(false);

  ReactTestRenderer.act(() => {
    retryButton(tree).props.onPress();
  });

  expect(invalidateSpy).toHaveBeenCalledTimes(1);
  expect(bannerCount(tree)).toBe(0);

  ReactTestRenderer.act(() => tree.unmount());
});

test('hides on dismiss without invalidating queries, and reappears on a new event', () => {
  const invalidateSpy: InvalidateSpy = jest.fn().mockResolvedValue(undefined);
  const tree = renderBanner(invalidateSpy);

  ReactTestRenderer.act(() => {
    emitRateLimited({scope: '/vehicles', retryAfterSec: 30});
  });
  expect(bannerCount(tree)).toBe(1);

  ReactTestRenderer.act(() => {
    tree.root.findByProps({testID: 'rate-limit-banner-dismiss'}).props.onPress();
  });
  expect(bannerCount(tree)).toBe(0);
  expect(invalidateSpy).not.toHaveBeenCalled();

  ReactTestRenderer.act(() => {
    emitRateLimited({scope: '/vehicles', retryAfterSec: 20});
  });
  expect(bannerCount(tree)).toBe(1);
  expect(JSON.stringify(tree.toJSON())).toContain('pausing for 20s');

  ReactTestRenderer.act(() => tree.unmount());
});

test('stops reacting to events after unmount', () => {
  const invalidateSpy: InvalidateSpy = jest.fn().mockResolvedValue(undefined);
  const tree = renderBanner(invalidateSpy);

  ReactTestRenderer.act(() => tree.unmount());

  ReactTestRenderer.act(() => {
    emitRateLimited({scope: '/vehicles', retryAfterSec: 30});
  });

  expect(tree.toJSON()).toBeNull();
});

test('ignores malformed events with no detail or non-numeric retryAfterSec', () => {
  const invalidateSpy: InvalidateSpy = jest.fn().mockResolvedValue(undefined);
  const tree = renderBanner(invalidateSpy);

  ReactTestRenderer.act(() => {
    emitRateLimited(
      undefined as unknown as Parameters<typeof emitRateLimited>[0],
    );
  });
  expect(bannerCount(tree)).toBe(0);

  ReactTestRenderer.act(() => {
    emitRateLimited({
      scope: '/vehicles',
      retryAfterSec: 'soon' as unknown as number,
    });
  });
  expect(bannerCount(tree)).toBe(0);

  ReactTestRenderer.act(() => tree.unmount());
});
