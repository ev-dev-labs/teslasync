/**
 * SignalSparklinePreview — behaviour + hardening coverage.
 *
 * Exercises the lazy last-hour trend preview and locks in the fixes made while
 * elevating it:
 *   - GATING REGRESSION: the fetch used to fire on mount regardless of
 *     `enabled` (the hook was called above the `if (!enabled) return null`
 *     guard). The query now lives in a child that is only MOUNTED when the leaf
 *     is enabled AND numeric, so `useSignalHistory` is never called otherwise —
 *     we assert the mock records zero calls in those cases;
 *   - non-numeric kinds (string / time / unknown) short-circuit to a `(kind)`
 *     chip and never fetch; numeric kinds (int / float / bool) fetch with the
 *     last-hour window and plot;
 *   - every data state is handled: loading skeleton, a DISTINCT labelled error
 *     state (previously indistinguishable from empty), the "—" empty
 *     placeholder below two samples, and an accessible plotted sparkline;
 *   - `envelopesToNumbers` coerces booleans to 1/0, drops non-finite numbers +
 *     strings, and is null-safe on a missing series.
 *
 * The component owns its `useSignalHistory` query, so we mock the hook module
 * and drive each render off a fully-controlled query result — no network, no
 * QueryClientProvider needed. Mirrors the sibling *.test.tsx mocking
 * convention (`@testing-library/user-event` is intentionally not a repo dep).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { SignalEnvelope, SignalHistoryResponseTyped, SignalKind, SignalValue } from '@/api/types';

// ── Hoisted mutable state shared by the module mocks below ──────────────
const h = vi.hoisted(() => ({
  query: null as unknown,
  calls: [] as Array<{ vehicleId: number; signal: string; range: unknown }>,
}));

// i18n stub: echo the English fallback and interpolate `{{var}}` from the
// options bag so the count/kind/signal captions resolve to real values.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: unknown, vars?: Record<string, unknown>) => {
      let out = typeof fallback === 'string' ? fallback : _key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
      }
      return out;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// The component owns this query — record every call so we can prove the fetch
// is gated, and return a fully-controlled result per test.
vi.mock('@/api/hooks/useSignals', () => ({
  useSignalHistory: (vehicleId: number, signal: string, range: unknown) => {
    h.calls.push({ vehicleId, signal, range });
    return h.query;
  },
}));

import { SignalSparklinePreview, envelopesToNumbers } from './SignalSparklinePreview';
import type { SignalSparklinePreviewProps } from './SignalSparklinePreview';

// ── Builders ────────────────────────────────────────────────────────────
function envelope(value: SignalValue, kind: SignalKind = 'float'): SignalEnvelope {
  return { kind, value, ts: '2026-07-04T12:00:00Z' };
}

function historyData(data: SignalEnvelope[]): SignalHistoryResponseTyped {
  return {
    vehicle_id: 7,
    signal: 'battery_level',
    expected_kind: 'float',
    from: '2026-07-04T11:00:00Z',
    to: '2026-07-04T12:00:00Z',
    count: data.length,
    data,
  };
}

function makeQuery(over: Record<string, unknown> = {}) {
  return { data: undefined, isLoading: false, isError: false, error: null, ...over };
}

function renderPreview(over: Partial<SignalSparklinePreviewProps> = {}) {
  const props: SignalSparklinePreviewProps = {
    vehicleId: 7,
    signal: 'battery_level',
    valueKind: 'float',
    enabled: true,
    ...over,
  };
  return render(<SignalSparklinePreview {...props} />);
}

beforeEach(() => {
  h.query = makeQuery();
  h.calls = [];
});

describe('envelopesToNumbers', () => {
  it('passes finite numbers, collapses booleans to 1/0, and drops strings / null / non-finite', () => {
    const series: SignalEnvelope[] = [
      envelope(42),
      envelope(Number.NaN),
      envelope(Number.POSITIVE_INFINITY),
      envelope(true, 'bool'),
      envelope(false, 'bool'),
      envelope('nope', 'string'),
      envelope(null),
      envelope(7),
    ];
    // NaN + Infinity + string + null are dropped; order is preserved.
    expect(envelopesToNumbers(series)).toEqual([42, 1, 0, 7]);
  });

  it('is null-safe for a missing or empty series (never throws on iteration)', () => {
    expect(envelopesToNumbers(undefined)).toEqual([]);
    expect(envelopesToNumbers(null)).toEqual([]);
    expect(envelopesToNumbers([])).toEqual([]);
  });
});

describe('SignalSparklinePreview', () => {
  it('renders nothing and does NOT fetch when disabled (gating regression)', () => {
    h.query = makeQuery({ isLoading: true });
    const { container } = renderPreview({ enabled: false, valueKind: 'float' });

    expect(container.firstChild).toBeNull();
    // The whole point of the refactor: a disabled leaf must never hit the hook.
    expect(h.calls).toHaveLength(0);
  });

  it('shows a non-numeric chip and skips the fetch for string / time / unknown kinds', () => {
    renderPreview({ enabled: true, valueKind: 'string' });

    const chip = screen.getByTitle('Non-numeric signal (string)');
    expect(chip).toHaveTextContent('string');
    // A non-numeric leaf has no trend line, so it must not fetch history.
    expect(h.calls).toHaveLength(0);
    // No skeleton / chart / placeholder is drawn for the chip branch.
    expect(document.querySelector('svg')).toBeNull();
  });

  it('interpolates the kind into the chip title for a time-kind signal', () => {
    renderPreview({ enabled: true, valueKind: 'time' });
    expect(screen.getByTitle('Non-numeric signal (time)')).toHaveTextContent('time');
    expect(h.calls).toHaveLength(0);
  });

  it('fetches the last-hour window and shows a hidden skeleton while loading', () => {
    h.query = makeQuery({ isLoading: true });
    const { container } = renderPreview({
      vehicleId: 7,
      signal: 'battery_level',
      valueKind: 'float',
      enabled: true,
    });

    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toEqual({
      vehicleId: 7,
      signal: 'battery_level',
      range: { hours: 1, limit: 30 },
    });

    const pulse = container.querySelector('.animate-pulse');
    expect(pulse).not.toBeNull();
    // A dense tree renders hundreds of these — the skeleton must be silent to AT.
    expect(pulse?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows a DISTINCT, labelled error state (not the empty placeholder) when the fetch fails', () => {
    h.query = makeQuery({ isError: true, error: new Error('boom') });
    renderPreview({ valueKind: 'float', enabled: true });

    // The error affordance is announced with its own accessible name...
    expect(screen.getByRole('img', { name: 'Failed to load trend' })).toBeInTheDocument();
    // ...and it is NOT the "no samples" empty placeholder, and no chart drew.
    expect(screen.queryByTitle('No samples in last hour')).toBeNull();
    expect(document.querySelector('svg')).toBeNull();
  });

  it('shows the "—" empty placeholder when fewer than two samples are available', () => {
    h.query = makeQuery({ data: historyData([envelope(42)]) });
    renderPreview({ valueKind: 'float', enabled: true });

    const empty = screen.getByTitle('No samples in last hour');
    expect(empty).toHaveTextContent('—');
    // A single point can't plot a polyline (and would divide by zero).
    expect(document.querySelector('svg')).toBeNull();
  });

  it('treats an empty history series as the empty placeholder, not a crash', () => {
    h.query = makeQuery({ data: historyData([]) });
    renderPreview({ valueKind: 'float', enabled: true });

    expect(screen.getByTitle('No samples in last hour')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders an accessible sparkline once there are at least two numeric samples', () => {
    h.query = makeQuery({ data: historyData([envelope(10), envelope(20), envelope(15)]) });
    renderPreview({ vehicleId: 7, signal: 'battery_level', valueKind: 'float', enabled: true });

    // The chart wraps the SVG with role="img" + a descriptive, counted label.
    const chart = screen.getByRole('img', {
      name: 'battery_level trend, 3 samples in the last hour',
    });
    expect(chart).toBeInTheDocument();
    expect(chart.querySelector('svg')).not.toBeNull();
    // The loading / empty states are gone.
    expect(screen.queryByTitle('No samples in last hour')).toBeNull();
  });

  it('coerces boolean history samples into a plottable 1/0 series', () => {
    // bool is numeric-eligible: two boolean samples collapse to [1, 0] and plot.
    h.query = makeQuery({
      data: historyData([envelope(true, 'bool'), envelope(false, 'bool')]),
    });
    renderPreview({ valueKind: 'bool', enabled: true });

    expect(
      screen.getByRole('img', { name: /trend, 2 samples in the last hour/ }),
    ).toBeInTheDocument();
    expect(document.querySelector('svg')).not.toBeNull();
  });

  it('forwards width / height / className onto the loading skeleton', () => {
    h.query = makeQuery({ isLoading: true });
    const { container } = renderPreview({
      valueKind: 'float',
      enabled: true,
      width: 120,
      height: 24,
      className: 'test-marker',
    });

    const pulse = container.querySelector('.animate-pulse') as HTMLElement | null;
    expect(pulse).not.toBeNull();
    expect(pulse?.style.width).toBe('120px');
    expect(pulse?.style.height).toBe('24px');
    expect(pulse?.className).toContain('test-marker');
  });
});
