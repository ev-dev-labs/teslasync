import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import { getNativeStorage } from '../src/web-parity/lib/nativeWebStorage';
import {
  __resetLocalStorageSyncForTests,
  useLocalStorageSync,
} from '../src/web-parity/lib/useLocalStorageSync';

// Native parity port coverage for web/src/lib/useLocalStorageSync.ts. The web
// hook synced a localStorage value across browser tabs via the broadcast bus +
// a `window` 'storage' listener. React Native has no tabs / DOM, so the port
// persists into the shared process-scoped 'local' store (lib/nativeWebStorage)
// and keeps sibling consumers in sync through an in-process listener channel.

const parseBool = (raw: string | null): boolean => raw === '1';
const serializeBool = (value: boolean): string | null => (value ? '1' : null);

const MSG_TYPE = 'checklist.dismissed' as const;

interface HookHandle {
  value: boolean;
  set: (next: boolean) => void;
}

function makeHandle(): HookHandle {
  return { value: false, set: () => {} };
}

// A tiny probe component that drives the hook and mirrors its current
// `[value, set]` tuple into a plain ref the test can read after each `act`.
function Probe({ storageKey, handle }: { storageKey: string; handle: HookHandle }) {
  const [value, set] = useLocalStorageSync(
    storageKey,
    parseBool,
    serializeBool,
    MSG_TYPE,
  );
  handle.value = value;
  handle.set = set;
  return null;
}

let keyCounter = 0;
function freshKey(): string {
  keyCounter += 1;
  return `teslasync:test:localStorageSync:${keyCounter}`;
}

describe('web-parity useLocalStorageSync', () => {
  beforeEach(() => {
    __resetLocalStorageSyncForTests();
  });

  it('reads the initial value from the shared native storage', () => {
    const key = freshKey();
    getNativeStorage('local').setItem(key, '1');

    const handle = makeHandle();
    let tree: ReactTestRenderer.ReactTestRenderer | undefined;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        React.createElement(Probe, { storageKey: key, handle }),
      );
    });

    expect(handle.value).toBe(true);
    ReactTestRenderer.act(() => tree?.unmount());
  });

  it('falls back to parse(null) when the key is absent', () => {
    const key = freshKey();
    const handle = makeHandle();
    let tree: ReactTestRenderer.ReactTestRenderer | undefined;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        React.createElement(Probe, { storageKey: key, handle }),
      );
    });

    expect(handle.value).toBe(false);
    ReactTestRenderer.act(() => tree?.unmount());
  });

  it('set() writes the serialized value to storage and updates state', () => {
    const key = freshKey();
    const handle = makeHandle();
    let tree: ReactTestRenderer.ReactTestRenderer | undefined;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        React.createElement(Probe, { storageKey: key, handle }),
      );
    });

    ReactTestRenderer.act(() => handle.set(true));

    expect(handle.value).toBe(true);
    expect(getNativeStorage('local').getItem(key)).toBe('1');
    ReactTestRenderer.act(() => tree?.unmount());
  });

  it('set() removes the key when serialize returns null', () => {
    const key = freshKey();
    getNativeStorage('local').setItem(key, '1');
    const handle = makeHandle();
    let tree: ReactTestRenderer.ReactTestRenderer | undefined;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        React.createElement(Probe, { storageKey: key, handle }),
      );
    });

    expect(handle.value).toBe(true);
    ReactTestRenderer.act(() => handle.set(false));

    expect(handle.value).toBe(false);
    expect(getNativeStorage('local').getItem(key)).toBeNull();
    ReactTestRenderer.act(() => tree?.unmount());
  });

  it('keeps sibling consumers of the same signal in sync', () => {
    const key = freshKey();
    const a = makeHandle();
    const b = makeHandle();
    let tree: ReactTestRenderer.ReactTestRenderer | undefined;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(Probe, { storageKey: key, handle: a }),
          React.createElement(Probe, { storageKey: key, handle: b }),
        ),
      );
    });

    expect(a.value).toBe(false);
    expect(b.value).toBe(false);

    // One consumer writes; the sibling re-reads via the in-process channel.
    ReactTestRenderer.act(() => a.set(true));

    expect(a.value).toBe(true);
    expect(b.value).toBe(true);
    ReactTestRenderer.act(() => tree?.unmount());
  });

  it('stops notifying siblings after the registry is reset', () => {
    const key = freshKey();
    const a = makeHandle();
    const b = makeHandle();
    let tree: ReactTestRenderer.ReactTestRenderer | undefined;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(Probe, { storageKey: key, handle: a }),
          React.createElement(Probe, { storageKey: key, handle: b }),
        ),
      );
    });

    __resetLocalStorageSyncForTests();

    // After the registry is cleared, a writer no longer wakes its sibling.
    ReactTestRenderer.act(() => a.set(true));

    expect(a.value).toBe(true);
    expect(b.value).toBe(false);
    ReactTestRenderer.act(() => tree?.unmount());
  });
});
