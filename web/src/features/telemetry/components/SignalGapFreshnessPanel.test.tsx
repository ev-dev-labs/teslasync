/**
 * SignalGapFreshnessPanel — behaviour + hardening coverage.
 *
 * The panel is a pure presenter: it receives the already-derived
 * `SignalGapAnalysis` (query state + buckets + freshness score + worst
 * offenders) and owns four mutually-exclusive states plus the freshness body:
 *   - NO VEHICLE   → a "select a vehicle" empty state (no gauge).
 *   - LOADING      → a skeleton (no gauge, no empty copy).
 *   - ERROR        → a <QueryError> whose Retry re-invokes `query.refetch()`.
 *   - EMPTY        → "no signal data" when the catalog is present but empty.
 *   - READY        → the freshness gauge (colour tracks the score), the
 *                    "N of M arriving" summary, and either the worst-offender
 *                    list, the all-clear banner, OR (regression) a
 *                    never-reported warning.
 *
 * The real shared components (GlassPanel, ProgressRing, EmptyState,
 * QueryError, Text/Caption) are kept so the accessible DOM — heading, list
 * semantics, the Retry button, the gauge stroke — is exercised end-to-end.
 * <QueryError> reaches for react-router's `useNavigate`, so renders are wrapped
 * in <MemoryRouter>. i18n is stubbed to the English fallback with
 * {{placeholder}} interpolation so visible copy is asserted directly. No
 * network is involved: the panel takes its data purely via props.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { GAP_BUCKET_COLORS } from '../signalGapUtils';
import type { GapBuckets } from '../signalGapUtils';
import type { SignalRow } from '@/types/telemetry';
import type { SignalGapAnalysis } from '../hooks/useSignalGapAnalysis';
import { SignalGapFreshnessPanel } from './SignalGapFreshnessPanel';

// i18n → English fallback with {{placeholder}} interpolation.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, arg2?: unknown, arg3?: unknown) => {
        let template = key;
        let options: Record<string, unknown> | undefined;
        if (typeof arg2 === 'string') {
          template = arg2;
          if (arg3 && typeof arg3 === 'object') options = arg3 as Record<string, unknown>;
        } else if (arg2 && typeof arg2 === 'object') {
          options = arg2 as Record<string, unknown>;
          if (typeof options.defaultValue === 'string') template = options.defaultValue;
        }
        if (options) {
          template = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) =>
            options && options[name] != null ? String(options[name]) : '',
          );
        }
        return template;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

// ── Fixtures ─────────────────────────────────────────────────────────
const mockRefetch = vi.fn();

type QueryStub = { isLoading: boolean; isError: boolean; error: unknown; refetch: () => void };

function makeQuery(overrides: Partial<QueryStub> = {}): SignalGapAnalysis['query'] {
  return {
    isLoading: false,
    isError: false,
    error: null,
    refetch: mockRefetch,
    ...overrides,
  } as unknown as SignalGapAnalysis['query'];
}

function makeBuckets(overrides: Partial<GapBuckets> = {}): GapBuckets {
  return { total: 0, active: 0, aging: 0, stale: 0, never: 0, ...overrides };
}

/** A signal that has arrived but is now stale by `staleness` seconds. */
function staleRow(name: string, staleness: number): SignalRow {
  return {
    name,
    value: '1',
    timestamp: new Date(Date.now() - staleness * 1000).toISOString(),
    staleness,
    category: 'stale',
  };
}

function makeAnalysis(overrides: Partial<SignalGapAnalysis> = {}): SignalGapAnalysis {
  return {
    query: makeQuery(),
    rows: [],
    buckets: makeBuckets(),
    freshnessPct: 0,
    topStale: [],
    ...overrides,
  };
}

function renderPanel(analysis: SignalGapAnalysis, hasVehicle = true) {
  return render(
    <MemoryRouter>
      <SignalGapFreshnessPanel analysis={analysis} hasVehicle={hasVehicle} />
    </MemoryRouter>,
  );
}

/** Stroke colour of the ProgressRing progress arc (the round-capped circle). */
function gaugeStroke(container: HTMLElement): string | null {
  return (
    container.querySelector('circle[stroke-linecap="round"]')?.getAttribute('stroke') ?? null
  );
}

beforeEach(() => {
  mockRefetch.mockReset();
});

describe('SignalGapFreshnessPanel', () => {
  it('prompts to select a vehicle and renders no gauge when none is chosen', () => {
    renderPanel(makeAnalysis(), false);

    expect(screen.getByRole('heading', { name: /Freshness/ })).toBeInTheDocument();
    expect(
      screen.getByText('Select a vehicle to inspect its signal freshness.'),
    ).toBeInTheDocument();
    // Freshness body (the ring's "fresh" sub-label) must not render.
    expect(screen.queryByText('fresh')).not.toBeInTheDocument();
  });

  it('shows a loading skeleton (and no data copy) while the query loads', () => {
    const { container } = renderPanel(makeAnalysis({ query: makeQuery({ isLoading: true }) }));

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('fresh')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Select a vehicle to inspect its signal freshness.'),
    ).not.toBeInTheDocument();
  });

  it('surfaces a query error and wires Retry to refetch', () => {
    renderPanel(makeAnalysis({ query: makeQuery({ isError: true, error: new Error('boom') }) }));

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state when the vehicle has no signal data', () => {
    renderPanel(makeAnalysis({ buckets: makeBuckets({ total: 0 }) }));

    expect(screen.getByText('No signal data available')).toBeInTheDocument();
    expect(screen.queryByText('fresh')).not.toBeInTheDocument();
  });

  it('renders a healthy green gauge and the all-clear banner when everything is on time', () => {
    const { container } = renderPanel(
      makeAnalysis({
        buckets: makeBuckets({ total: 5, active: 5 }),
        freshnessPct: 100,
        topStale: [],
      }),
    );

    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('5 of 5 signals arriving')).toBeInTheDocument();
    expect(screen.getByText('All signals are arriving on time.')).toBeInTheDocument();
    // freshnessColor: >= 80 → active/green.
    expect(gaugeStroke(container)).toBe(GAP_BUCKET_COLORS.active);
  });

  it('lists the worst offenders with human staleness and hides the all-clear banner', () => {
    const { container } = renderPanel(
      makeAnalysis({
        buckets: makeBuckets({ total: 4, active: 2, stale: 2 }),
        freshnessPct: 50,
        // Order is owner-sorted (worst first); the panel must preserve it.
        topStale: [staleRow('DriveState', 3600), staleRow('ChargeState', 600)],
      }),
    );

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('DriveState')).toBeInTheDocument();
    expect(within(items[0]).getByText('1h 0m ago')).toBeInTheDocument();
    expect(within(items[1]).getByText('ChargeState')).toBeInTheDocument();
    expect(within(items[1]).getByText('10m ago')).toBeInTheDocument();
    expect(screen.queryByText('All signals are arriving on time.')).not.toBeInTheDocument();
    // freshnessColor: 50–79 → aging/amber.
    expect(gaugeStroke(container)).toBe(GAP_BUCKET_COLORS.aging);
  });

  it('warns about never-reported signals instead of falsely claiming all-clear', () => {
    // Regression: a signal with no timestamp is excluded from `topStale`
    // (it has no staleness to rank), so with zero *stale* offenders the panel
    // used to render the green "all signals arriving on time" banner — a
    // dangerous reassurance while the gauge itself reads 50%. It must warn.
    renderPanel(
      makeAnalysis({
        buckets: makeBuckets({ total: 4, active: 2, never: 2 }),
        freshnessPct: 50,
        topStale: [],
      }),
    );

    expect(screen.queryByText('All signals are arriving on time.')).not.toBeInTheDocument();
    expect(screen.getByText('2 signals have never reported.')).toBeInTheDocument();
    expect(screen.getByText('2 of 4 signals arriving')).toBeInTheDocument();
  });

  it('colours the gauge red when freshness is critically low', () => {
    const { container } = renderPanel(
      makeAnalysis({
        buckets: makeBuckets({ total: 4, active: 1, stale: 3 }),
        freshnessPct: 25,
        topStale: [staleRow('Foo', 400)],
      }),
    );

    // freshnessColor: < 50 → stale/red.
    expect(gaugeStroke(container)).toBe(GAP_BUCKET_COLORS.stale);
    expect(screen.getByText('25%')).toBeInTheDocument();
  });
});
