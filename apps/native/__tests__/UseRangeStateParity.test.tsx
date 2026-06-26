import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import {
  useRangeState,
  type UseRangeStateOptions,
  type UseRangeStateReturn,
} from '../src/web-parity/hooks/useRangeState';

function Probe({
  opts,
  sink,
}: {
  opts?: UseRangeStateOptions;
  sink: (r: UseRangeStateReturn) => void;
}) {
  const r = useRangeState(opts);
  sink(r);
  return <Text>{`${r.start}|${r.end}`}</Text>;
}

async function render(
  opts: UseRangeStateOptions | undefined,
  capture: { current: UseRangeStateReturn | undefined },
): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <Probe
        opts={opts}
        sink={r => {
          capture.current = r;
        }}
      />,
    );
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

function spanDays(start: string, end: string): number {
  return (
    Math.round(
      (new Date(`${end}T00:00:00`).getTime() -
        new Date(`${start}T00:00:00`).getTime()) /
        86_400_000,
    ) + 1
  );
}

function localIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

test('falls back to the default preset span when no range is set (7d)', async () => {
  const cap: { current: UseRangeStateReturn | undefined } = {
    current: undefined,
  };
  const tree = await render({ defaultPresetId: '7d' }, cap);
  expect(cap.current?.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(cap.current?.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(spanDays(cap.current!.start, cap.current!.end)).toBe(7);
  await ReactTestRenderer.act(async () => tree.unmount());
});

test('defaults to a 30-day window when no options are supplied', async () => {
  const cap: { current: UseRangeStateReturn | undefined } = {
    current: undefined,
  };
  const tree = await render(undefined, cap);
  expect(spanDays(cap.current!.start, cap.current!.end)).toBe(30);
  await ReactTestRenderer.act(async () => tree.unmount());
});

test('setRange writes both start and end atomically', async () => {
  const cap: { current: UseRangeStateReturn | undefined } = {
    current: undefined,
  };
  const tree = await render({ timezone: 'UTC' }, cap);
  await ReactTestRenderer.act(async () => {
    cap.current!.setRange({ start: '2025-02-01', end: '2025-02-28' });
  });
  expect(cap.current!.start).toBe('2025-02-01');
  expect(cap.current!.end).toBe('2025-02-28');
  await ReactTestRenderer.act(async () => tree.unmount());
});

test('computes half-open API instants in the configured timezone', async () => {
  const cap: { current: UseRangeStateReturn | undefined } = {
    current: undefined,
  };
  const tree = await render({ timezone: 'UTC' }, cap);
  await ReactTestRenderer.act(async () => {
    cap.current!.setRange({ start: '2025-02-01', end: '2025-02-28' });
  });
  expect(cap.current!.timezone).toBe('UTC');
  expect(cap.current!.startInstant).toBe('2025-02-01T00:00:00.000Z');
  // End is exclusive: the day AFTER 2025-02-28 local midnight.
  expect(cap.current!.endInstantExclusive).toBe('2025-03-01T00:00:00.000Z');
  await ReactTestRenderer.act(async () => tree.unmount());
});

test('clamps a user-supplied range below minDate', async () => {
  const cap: { current: UseRangeStateReturn | undefined } = {
    current: undefined,
  };
  const tree = await render({ minDate: '2024-01-01', timezone: 'UTC' }, cap);
  await ReactTestRenderer.act(async () => {
    cap.current!.setRange({ start: '2020-06-15', end: '2025-01-01' });
  });
  expect(cap.current!.start).toBe('2024-01-01');
  expect(cap.current!.end).toBe('2025-01-01');
  await ReactTestRenderer.act(async () => tree.unmount());
});

test('clamps the "all" default preset start to minDate', async () => {
  const cap: { current: UseRangeStateReturn | undefined } = {
    current: undefined,
  };
  const tree = await render(
    { defaultPresetId: 'all', minDate: '2024-01-01' },
    cap,
  );
  expect(cap.current!.start).toBe('2024-01-01');
  await ReactTestRenderer.act(async () => tree.unmount());
});

test('setPreset("today") resolves to a single-day range and derives the preset id', async () => {
  const cap: { current: UseRangeStateReturn | undefined } = {
    current: undefined,
  };
  const tree = await render({ timezone: 'UTC' }, cap);
  await ReactTestRenderer.act(async () => {
    cap.current!.setPreset('today');
  });
  const today = localIso(new Date());
  expect(cap.current!.start).toBe(today);
  expect(cap.current!.end).toBe(today);
  expect(cap.current!.presetId).toBe('today');
  await ReactTestRenderer.act(async () => tree.unmount());
});

test('presetId is undefined for a custom (non-preset) range', async () => {
  const cap: { current: UseRangeStateReturn | undefined } = {
    current: undefined,
  };
  const tree = await render({ timezone: 'UTC' }, cap);
  await ReactTestRenderer.act(async () => {
    cap.current!.setRange({ start: '2024-03-15', end: '2024-04-22' });
  });
  expect(cap.current!.presetId).toBeUndefined();
  await ReactTestRenderer.act(async () => tree.unmount());
});

test('comparison mode is off and yields no comparePrev unless enabled', async () => {
  const cap: { current: UseRangeStateReturn | undefined } = {
    current: undefined,
  };
  const tree = await render({ enableCompare: false, timezone: 'UTC' }, cap);
  await ReactTestRenderer.act(async () => {
    cap.current!.setRange({ start: '2025-01-08', end: '2025-01-14' });
  });
  await ReactTestRenderer.act(async () => {
    cap.current!.setCompare(true);
  });
  // enableCompare is false, so the compare flag never activates.
  expect(cap.current!.compare).toBe(false);
  expect(cap.current!.comparePrev).toBeUndefined();
  await ReactTestRenderer.act(async () => tree.unmount());
});

test('enabled comparison exposes the previous equal-length window', async () => {
  const cap: { current: UseRangeStateReturn | undefined } = {
    current: undefined,
  };
  const tree = await render({ enableCompare: true, timezone: 'UTC' }, cap);
  await ReactTestRenderer.act(async () => {
    cap.current!.setRange({ start: '2025-01-08', end: '2025-01-14' });
  });
  await ReactTestRenderer.act(async () => {
    cap.current!.setCompare(true);
  });
  expect(cap.current!.compare).toBe(true);
  // 2025-01-08 -> 2025-01-14 is 7 days; previous period is 2025-01-01 -> 2025-01-07.
  expect(cap.current!.comparePrev).toEqual({
    start: '2025-01-01',
    end: '2025-01-07',
  });

  // Turning compare off clears comparePrev.
  await ReactTestRenderer.act(async () => {
    cap.current!.setCompare(false);
  });
  expect(cap.current!.compare).toBe(false);
  expect(cap.current!.comparePrev).toBeUndefined();
  await ReactTestRenderer.act(async () => tree.unmount());
});

test('reset reverts to the default preset and clears the compare flag', async () => {
  const cap: { current: UseRangeStateReturn | undefined } = {
    current: undefined,
  };
  const tree = await render(
    { enableCompare: true, defaultPresetId: '7d' },
    cap,
  );
  await ReactTestRenderer.act(async () => {
    cap.current!.setRange({ start: '2025-01-01', end: '2025-01-31' });
  });
  await ReactTestRenderer.act(async () => {
    cap.current!.setCompare(true);
  });
  expect(cap.current!.compare).toBe(true);
  await ReactTestRenderer.act(async () => {
    cap.current!.reset();
  });
  expect(cap.current!.compare).toBe(false);
  // Range reverts to the 7d default span.
  expect(spanDays(cap.current!.start, cap.current!.end)).toBe(7);
  await ReactTestRenderer.act(async () => tree.unmount());
});

test('honours custom fromKey/toKey when setting a range', async () => {
  const cap: { current: UseRangeStateReturn | undefined } = {
    current: undefined,
  };
  const tree = await render(
    { fromKey: 'dateFrom', toKey: 'dateTo', timezone: 'UTC' },
    cap,
  );
  await ReactTestRenderer.act(async () => {
    cap.current!.setRange({ start: '2025-03-01', end: '2025-03-15' });
  });
  expect(cap.current!.start).toBe('2025-03-01');
  expect(cap.current!.end).toBe('2025-03-15');
  await ReactTestRenderer.act(async () => tree.unmount());
});

describe('persistence (web localStorage parity via globalThis probe)', () => {
  const realLocalStorage = (globalThis as { localStorage?: unknown })
    .localStorage;
  let store: Map<string, string>;

  beforeEach(() => {
    store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    };
  });

  afterEach(() => {
    if (realLocalStorage === undefined) {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    } else {
      (globalThis as { localStorage?: unknown }).localStorage =
        realLocalStorage;
    }
  });

  test('persists a committed range to storage', async () => {
    const cap: { current: UseRangeStateReturn | undefined } = {
      current: undefined,
    };
    const tree = await render(
      { persistKey: 'charging.list.range', timezone: 'UTC' },
      cap,
    );
    await ReactTestRenderer.act(async () => {
      cap.current!.setRange({ start: '2025-02-01', end: '2025-02-28' });
    });
    expect(JSON.parse(store.get('charging.list.range') ?? '{}')).toEqual({
      start: '2025-02-01',
      end: '2025-02-28',
    });
    await ReactTestRenderer.act(async () => tree.unmount());
  });

  test('restores a stored range on mount when no range is set', async () => {
    store.set(
      'charging.list.range',
      JSON.stringify({ start: '2024-06-01', end: '2024-06-30' }),
    );
    const cap: { current: UseRangeStateReturn | undefined } = {
      current: undefined,
    };
    const tree = await render(
      {
        persistKey: 'charging.list.range',
        defaultPresetId: '30d',
        timezone: 'UTC',
      },
      cap,
    );
    expect(cap.current!.start).toBe('2024-06-01');
    expect(cap.current!.end).toBe('2024-06-30');
    await ReactTestRenderer.act(async () => tree.unmount());
  });

  test('ignores corrupt stored data and falls back to the default', async () => {
    store.set('charging.list.range', '{not json');
    const cap: { current: UseRangeStateReturn | undefined } = {
      current: undefined,
    };
    const tree = await render(
      {
        persistKey: 'charging.list.range',
        defaultPresetId: '7d',
        timezone: 'UTC',
      },
      cap,
    );
    expect(cap.current!.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(spanDays(cap.current!.start, cap.current!.end)).toBe(7);
    await ReactTestRenderer.act(async () => tree.unmount());
  });
});
