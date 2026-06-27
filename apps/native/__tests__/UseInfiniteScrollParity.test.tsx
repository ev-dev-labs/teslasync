import React from 'react';
import { View, Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import {
  useInfiniteScroll,
  useInfiniteScrollHandlers,
  type InfiniteScrollHandlers,
} from '../src/web-parity/hooks/useInfiniteScroll';

/* ── Fake IntersectionObserver (react-native-web / browser path) ───────────── */

type ObserverEntry = { isIntersecting: boolean };

class FakeIntersectionObserver {
  static lastCallback: ((entries: ObserverEntry[]) => void) | null = null;
  static lastThreshold: number | undefined = undefined;
  static observeCount = 0;
  static disconnectCount = 0;

  private readonly callback: (entries: ObserverEntry[]) => void;

  constructor(
    callback: (entries: ObserverEntry[]) => void,
    options?: { threshold?: number },
  ) {
    this.callback = callback;
    FakeIntersectionObserver.lastCallback = callback;
    FakeIntersectionObserver.lastThreshold = options?.threshold;
  }

  observe(_target: unknown): void {
    FakeIntersectionObserver.observeCount += 1;
  }

  disconnect(): void {
    FakeIntersectionObserver.disconnectCount += 1;
  }

  static reset(): void {
    FakeIntersectionObserver.lastCallback = null;
    FakeIntersectionObserver.lastThreshold = undefined;
    FakeIntersectionObserver.observeCount = 0;
    FakeIntersectionObserver.disconnectCount = 0;
  }
}

type GlobalWithIO = { IntersectionObserver?: unknown };

const realIO = (globalThis as GlobalWithIO).IntersectionObserver;

function installFakeObserver(): void {
  (globalThis as GlobalWithIO).IntersectionObserver = FakeIntersectionObserver;
}

function removeObserver(): void {
  delete (globalThis as GlobalWithIO).IntersectionObserver;
}

afterEach(() => {
  FakeIntersectionObserver.reset();
  if (realIO === undefined) {
    delete (globalThis as GlobalWithIO).IntersectionObserver;
  } else {
    (globalThis as GlobalWithIO).IntersectionObserver = realIO;
  }
});

/* ── Probes ────────────────────────────────────────────────────────────────── */

function ScrollProbe({
  onLoadMore,
  hasMore,
}: {
  onLoadMore: () => void;
  hasMore: boolean;
}) {
  const ref = useInfiniteScroll(onLoadMore, hasMore);
  return <View ref={ref as unknown as React.Ref<View>} />;
}

function HandlersProbe({
  onLoadMore,
  hasMore,
  sink,
}: {
  onLoadMore: () => void;
  hasMore: boolean;
  sink: (h: InfiniteScrollHandlers) => void;
}) {
  const handlers = useInfiniteScrollHandlers(onLoadMore, hasMore);
  sink(handlers);
  return <Text>{String(handlers.onEndReachedThreshold)}</Text>;
}

async function renderScrollProbe(
  onLoadMore: () => void,
  hasMore: boolean,
): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <ScrollProbe onLoadMore={onLoadMore} hasMore={hasMore} />,
      { createNodeMock: () => ({}) },
    );
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

/* ── IntersectionObserver (web parity) path ────────────────────────────────── */

test('observes the sentinel with threshold 0.1 and fires onLoadMore on intersect while hasMore', async () => {
  installFakeObserver();
  const onLoadMore = jest.fn();
  const tree = await renderScrollProbe(onLoadMore, true);

  expect(FakeIntersectionObserver.observeCount).toBe(1);
  expect(FakeIntersectionObserver.lastThreshold).toBe(0.1);

  await ReactTestRenderer.act(async () => {
    FakeIntersectionObserver.lastCallback?.([{ isIntersecting: true }]);
  });
  expect(onLoadMore).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
  expect(FakeIntersectionObserver.disconnectCount).toBe(1);
});

test('does not fire onLoadMore when hasMore is false', async () => {
  installFakeObserver();
  const onLoadMore = jest.fn();
  const tree = await renderScrollProbe(onLoadMore, false);

  await ReactTestRenderer.act(async () => {
    FakeIntersectionObserver.lastCallback?.([{ isIntersecting: true }]);
  });
  expect(onLoadMore).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('does not fire onLoadMore when the sentinel is not intersecting', async () => {
  installFakeObserver();
  const onLoadMore = jest.fn();
  const tree = await renderScrollProbe(onLoadMore, true);

  await ReactTestRenderer.act(async () => {
    FakeIntersectionObserver.lastCallback?.([{ isIntersecting: false }]);
  });
  expect(onLoadMore).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

/* ── Native (no IntersectionObserver) path ─────────────────────────────────── */

test('is a safe no-op when IntersectionObserver is unavailable (native)', async () => {
  removeObserver();
  const onLoadMore = jest.fn();

  // Must render and unmount without throwing; nothing observes and the
  // callback is never invoked because no observer exists.
  const tree = await renderScrollProbe(onLoadMore, true);
  expect(FakeIntersectionObserver.observeCount).toBe(0);
  expect(onLoadMore).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

/* ── Native list handlers (FlatList / ScrollView) ──────────────────────────── */

test('useInfiniteScrollHandlers fires onLoadMore on end-reach while hasMore', async () => {
  const cap: { current: InfiniteScrollHandlers | undefined } = {
    current: undefined,
  };
  const onLoadMore = jest.fn();
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <HandlersProbe
        onLoadMore={onLoadMore}
        hasMore
        sink={h => {
          cap.current = h;
        }}
      />,
    );
  });

  expect(cap.current?.onEndReachedThreshold).toBe(0.1);
  await ReactTestRenderer.act(async () => {
    cap.current?.onEndReached();
  });
  expect(onLoadMore).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('useInfiniteScrollHandlers does not fire onLoadMore when hasMore is false', async () => {
  const cap: { current: InfiniteScrollHandlers | undefined } = {
    current: undefined,
  };
  const onLoadMore = jest.fn();
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <HandlersProbe
        onLoadMore={onLoadMore}
        hasMore={false}
        sink={h => {
          cap.current = h;
        }}
      />,
    );
  });

  await ReactTestRenderer.act(async () => {
    cap.current?.onEndReached();
  });
  expect(onLoadMore).not.toHaveBeenCalled();

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});
