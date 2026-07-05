/**
 * FreshnessIndicator + useIsStale — behaviour, status thresholds, null/malformed
 * safety (the NaN regression), size/label variants, accessibility, the live
 * re-render tick, and the stale/offline hook.
 *
 * A frozen clock (`vi.setSystemTime`) makes every relative age deterministic;
 * react-i18next is stubbed to echo the English fallback with `{{var}}`
 * interpolation so label assertions read real copy without booting the i18n
 * runtime.
 */
import { type ComponentProps } from 'react';
import { render, screen, act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FreshnessIndicator, useIsStale } from './FreshnessIndicator';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (acc, [k, v]) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v)),
        fallback,
      );
    },
  }),
}));

const BASE = new Date('2026-07-05T12:00:00.000Z').getTime();

/** ISO timestamp for a datum sampled `secondsAgo` seconds before the frozen clock. */
const ago = (secondsAgo: number): string => new Date(BASE - secondsAgo * 1000).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Render the indicator and return its root (role="img") + inner dot span. */
function renderIndicator(props: ComponentProps<typeof FreshnessIndicator>) {
  const utils = render(<FreshnessIndicator {...props} />);
  const root = utils.container.querySelector('[role="img"]') as HTMLElement;
  const dot = root.firstElementChild as HTMLElement;
  return { ...utils, root, dot };
}

describe('FreshnessIndicator — status + colour', () => {
  it('renders a fresh emerald pulsing dot for a just-sampled datum', () => {
    const { dot, container } = renderIndicator({ timestamp: ago(5) });
    expect(dot.className).toContain('bg-emerald-400');
    expect(dot.className).toContain('animate-pulse');
    expect(container.textContent).toContain('just now');
  });

  it('shows a seconds-granularity label while still fresh', () => {
    const { dot, container } = renderIndicator({ timestamp: ago(30) });
    expect(dot.className).toContain('bg-emerald-400');
    expect(container.textContent).toContain('30s ago');
  });

  it('turns amber (stale, no pulse) past the stale threshold', () => {
    const { dot, container } = renderIndicator({ timestamp: ago(300) });
    expect(dot.className).toContain('bg-amber-400');
    expect(dot.className).not.toContain('animate-pulse');
    expect(container.textContent).toContain('5m ago');
  });

  it('turns red (offline) past the offline threshold, with an hours label', () => {
    const { dot, container } = renderIndicator({ timestamp: ago(7200) });
    expect(dot.className).toContain('bg-red-400');
    expect(container.textContent).toContain('2h ago');
  });
});

describe('FreshnessIndicator — threshold overrides', () => {
  it('respects a custom staleThreshold', () => {
    // 30s ≥ 20s → stale even though it would be fresh under the default 120s.
    const { dot } = renderIndicator({ timestamp: ago(30), staleThreshold: 20 });
    expect(dot.className).toContain('bg-amber-400');
    expect(dot.className).not.toContain('bg-emerald-400');
  });

  it('respects a custom offlineThreshold', () => {
    // 300s ≥ 200s → offline even though it would be stale under the default 600s.
    const { dot } = renderIndicator({ timestamp: ago(300), offlineThreshold: 200 });
    expect(dot.className).toContain('bg-red-400');
    expect(dot.className).not.toContain('bg-amber-400');
  });
});

describe('FreshnessIndicator — missing / malformed timestamps', () => {
  it('renders an "unknown" grey dot and em-dash for a null timestamp', () => {
    const { dot, container } = renderIndicator({ timestamp: null });
    expect(dot.className).toContain('bg-[var(--surface-2)]');
    expect(container.textContent).toBe('—');
  });

  it('treats undefined the same as null', () => {
    const { dot, container } = renderIndicator({ timestamp: undefined });
    expect(dot.className).toContain('bg-[var(--surface-2)]');
    expect(container.textContent).toBe('—');
  });

  it('degrades a malformed timestamp to "unknown" — never NaN or a false "offline"', () => {
    // Regression: an unparseable date used to compute NaN, which slipped past
    // every `age < threshold` check to a red "offline" dot plus a literal
    // "NaNh ago" label. It must collapse to the neutral "unknown" state.
    const { dot, container } = renderIndicator({ timestamp: 'not-a-real-date' });
    expect(dot.className).toContain('bg-[var(--surface-2)]');
    expect(dot.className).not.toContain('bg-red-400');
    expect(container.textContent).toBe('—');
    expect(container.textContent).not.toContain('NaN');
  });

  it('treats an empty-string timestamp as unknown', () => {
    const { dot, container } = renderIndicator({ timestamp: '' });
    expect(dot.className).toContain('bg-[var(--surface-2)]');
    expect(container.textContent).toBe('—');
  });
});

describe('FreshnessIndicator — future timestamps', () => {
  it('clamps a future timestamp to "just now" (never a negative age)', () => {
    const { dot, container } = renderIndicator({ timestamp: ago(-100) });
    expect(dot.className).toContain('bg-emerald-400');
    expect(container.textContent).toContain('just now');
    expect(container.textContent).not.toContain('-');
  });
});

describe('FreshnessIndicator — size + label variants', () => {
  it('uses the small dot + 2xs label sizes by default (sm)', () => {
    const { root, dot } = renderIndicator({ timestamp: ago(300) });
    expect(dot.className).toContain('h-1.5');
    expect(dot.className).toContain('w-1.5');
    const label = root.children[1] as HTMLElement;
    expect(label.className).toContain('text-2xs');
  });

  it('uses the larger dot + xs label sizes for size="md"', () => {
    const { root, dot } = renderIndicator({ timestamp: ago(300), size: 'md' });
    expect(dot.className).toContain('h-2');
    expect(dot.className).toContain('w-2');
    const label = root.children[1] as HTMLElement;
    expect(label.className).toContain('text-xs');
  });

  it('hides the visible label when showLabel is false but keeps an accessible name', () => {
    const { root, dot, container } = renderIndicator({ timestamp: ago(300), showLabel: false });
    expect(container.textContent).toBe('');
    expect(root.children).toHaveLength(1); // dot only, no label span
    expect(dot.className).toContain('bg-amber-400');
    expect(root.getAttribute('aria-label')).toContain('5m ago');
  });
});

describe('FreshnessIndicator — accessibility', () => {
  it('exposes a single labelled role="img" carrying both status and age', () => {
    renderIndicator({ timestamp: ago(300) });
    const img = screen.getByRole('img');
    const name = img.getAttribute('aria-label') ?? '';
    expect(name).toContain('Stale');
    expect(name).toContain('5m ago');
  });

  it('labels an unknown datum with the status word alone (no bogus age)', () => {
    renderIndicator({ timestamp: null });
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('No recent data');
  });

  it('marks the decorative dot aria-hidden so it is not double-announced', () => {
    const { dot } = renderIndicator({ timestamp: ago(5) });
    expect(dot).toHaveAttribute('aria-hidden', 'true');
  });

  it('surfaces the exact ISO timestamp as a hover title', () => {
    const iso = ago(300);
    const { root } = renderIndicator({ timestamp: iso });
    expect(root).toHaveAttribute('title', iso);
  });

  it('omits the title attribute when there is no timestamp', () => {
    const { root } = renderIndicator({ timestamp: null });
    expect(root).not.toHaveAttribute('title');
  });
});

describe('FreshnessIndicator — live tick', () => {
  it('re-renders on its interval to keep the relative label honest', () => {
    const { container } = renderIndicator({ timestamp: ago(5) });
    expect(container.textContent).toContain('just now');

    // Advance the wall clock a minute and fire the 10s refresh interval.
    act(() => {
      vi.setSystemTime(BASE + 60_000);
      vi.advanceTimersByTime(10_000);
    });

    expect(container.textContent).toContain('1m ago');
    expect(container.textContent).not.toContain('just now');
  });
});

describe('useIsStale', () => {
  it('reports a fresh timestamp as neither stale nor offline', () => {
    const { result } = renderHook(() => useIsStale(ago(30)));
    expect(result.current.isStale).toBe(false);
    expect(result.current.isOffline).toBe(false);
    expect(result.current.ageLabel).toBe('30s ago');
  });

  it('flags a stale-but-online timestamp', () => {
    const { result } = renderHook(() => useIsStale(ago(300)));
    expect(result.current.isStale).toBe(true);
    expect(result.current.isOffline).toBe(false);
    expect(result.current.ageLabel).toBe('5m ago');
  });

  it('flags an offline timestamp as both stale and offline', () => {
    const { result } = renderHook(() => useIsStale(ago(1200)));
    expect(result.current.isStale).toBe(true);
    expect(result.current.isOffline).toBe(true);
    expect(result.current.ageLabel).toBe('20m ago');
  });

  it('honours a custom stale threshold', () => {
    const { result } = renderHook(() => useIsStale(ago(30), 20));
    expect(result.current.isStale).toBe(true);
    expect(result.current.isOffline).toBe(false);
  });

  it('honours a custom offline threshold', () => {
    const { result } = renderHook(() => useIsStale(ago(300), 120, 200));
    expect(result.current.isStale).toBe(true);
    expect(result.current.isOffline).toBe(true);
  });

  it('reports a null timestamp as unknown with an em-dash label', () => {
    const { result } = renderHook(() => useIsStale(null));
    expect(result.current.isStale).toBe(false);
    expect(result.current.isOffline).toBe(false);
    expect(result.current.ageLabel).toBe('—');
  });

  it('degrades a malformed timestamp to a safe em-dash (never NaN)', () => {
    const { result } = renderHook(() => useIsStale('nonsense'));
    expect(result.current.isStale).toBe(false);
    expect(result.current.isOffline).toBe(false);
    expect(result.current.ageLabel).toBe('—');
    expect(result.current.ageLabel).not.toContain('NaN');
  });
});
