/**
 * FeatureConfigComposition — behaviour + hardening coverage.
 *
 * The component owns four mutually-exclusive branches driven by three props
 * (`isLoading` → `error` → empty → populated chart) plus a memoised mapping
 * from `FeatureCompositionRow[]` to the grouped-bar chart series. This suite
 * drives every branch and asserts the real branch selection, the accessible
 * loading affordance (`role="status"` + `aria-busy`), the retryable
 * `QueryError`, the empty-state copy, the localized kind labels, the null-safe
 * enabled/disabled coercion, and the two series' colour/name/key bindings.
 *
 * Only the recharts barrel is doubled — `ResponsiveContainer` renders 0×0 in
 * jsdom, so the series/data would be unobservable. The shared feedback + ui
 * components (`QueryError`, `EmptyState`, `Skeleton`, `GlassPanel`,
 * `PanelTitle`) are the REAL implementations so the rendered roles/copy are
 * genuinely exercised. Network is never touched.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import type { FeatureCompositionRow, FeatureFlagKind } from './parseFeatureFlags';
import { FeatureConfigComposition } from './FeatureConfigComposition';

// ── i18n: resolve the string fallback (2nd arg) so assertions read on copy. ──
vi.mock('react-i18next', () => {
  const t = (key: string, fallback?: unknown): string =>
    typeof fallback === 'string' ? fallback : key;
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// ── keep QueryError on its online "Can't reach server" branch (enabled Retry). ──
vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));

// ── recharts barrel double: ResponsiveContainer renders its children so the
//    BarChart double can surface the component-computed `data` (as JSON) plus
//    each Bar's key/name/fill binding for direct assertion. ──
vi.mock('@/components/charts', () => {
  const Inert = () => null;
  return {
    ChartTooltip: Inert,
    CartesianGrid: Inert,
    Tooltip: Inert,
    Legend: Inert,
    XAxis: Inert,
    YAxis: Inert,
    ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    BarChart: ({
      data,
      children,
    }: {
      data?: ReadonlyArray<Record<string, unknown>>;
      children?: ReactNode;
    }) => (
      <div data-testid="bar-chart">
        <span data-testid="bar-chart-data">{JSON.stringify(data ?? [])}</span>
        {children}
      </div>
    ),
    Bar: ({ dataKey, name, fill }: { dataKey?: string; name?: string; fill?: string }) => (
      <span
        data-testid={`bar-${String(dataKey ?? '')}`}
        data-key={String(dataKey ?? '')}
        data-name={String(name ?? '')}
        data-fill={String(fill ?? '')}
      />
    ),
  };
});

interface Props {
  composition: FeatureCompositionRow[];
  isLoading?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

function renderComposition(over: Props) {
  return render(
    <MemoryRouter>
      <FeatureConfigComposition
        composition={over.composition}
        isLoading={over.isLoading ?? false}
        error={over.error ?? null}
        onRetry={over.onRetry ?? vi.fn()}
      />
    </MemoryRouter>,
  );
}

/** Parse the JSON the BarChart double received as its `data` prop. */
function readChartData(): Array<{ name: string; enabled: number; disabled: number }> {
  return JSON.parse(screen.getByTestId('bar-chart-data').textContent || '[]');
}

const COMPOSITION: FeatureCompositionRow[] = [
  { kind: 'flag', enabled: 3, disabled: 1, total: 4 },
  { kind: 'configured', enabled: 2, disabled: 5, total: 7 },
];

afterEach(() => cleanup());

describe('FeatureConfigComposition — panel chrome', () => {
  it('always renders the panel title regardless of state', () => {
    renderComposition({ composition: COMPOSITION });
    expect(screen.getByText('Enabled vs Disabled by Type')).toBeInTheDocument();
  });
});

describe('FeatureConfigComposition — loading', () => {
  it('shows an accessible loading skeleton and withholds the chart on first load', () => {
    const { container } = renderComposition({ composition: [], isLoading: true });

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveAccessibleName('Loading');
    // The pulsing Skeleton is present, but no chart is drawn yet.
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
    // The title still frames the panel while loading.
    expect(screen.getByText('Enabled vs Disabled by Type')).toBeInTheDocument();
  });

  it('prioritises loading over populated rows (skeleton wins, chart withheld)', () => {
    renderComposition({ composition: COMPOSITION, isLoading: true });
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });
});

describe('FeatureConfigComposition — error', () => {
  it('renders a retryable QueryError and hides the chart on failure', () => {
    const onRetry = vi.fn();
    renderComposition({ composition: [], error: new Error('boom'), onRetry });

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^retry$/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('prioritises the error banner over populated data', () => {
    // Even with last-good rows retained upstream, a non-loading error wins.
    renderComposition({ composition: COMPOSITION, error: new Error('stale') });
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });
});

describe('FeatureConfigComposition — empty', () => {
  it('shows the no-composition empty state when there are no rows to chart', () => {
    renderComposition({ composition: [] });
    expect(screen.getByText('No feature composition to chart yet.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });

  it('treats a null-ish composition prop as empty without crashing', () => {
    // Defensive null-safety: the required-typed array may still arrive
    // undefined from a mis-wired caller — the guard must not throw.
    renderComposition({ composition: undefined as unknown as FeatureCompositionRow[] });
    expect(screen.getByText('No feature composition to chart yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });
});

describe('FeatureConfigComposition — populated', () => {
  it('exposes the chart as an accessible image with a descriptive label', () => {
    renderComposition({ composition: COMPOSITION });
    expect(
      screen.getByRole('img', {
        name: 'Enabled versus disabled feature counts grouped by feature type',
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
  });

  it('maps rows to chart data with localized kind labels and counts', () => {
    renderComposition({ composition: COMPOSITION });
    expect(readChartData()).toEqual([
      { name: 'Boolean flags', enabled: 3, disabled: 1 },
      { name: 'Configured', enabled: 2, disabled: 5 },
    ]);
  });

  it('coerces null-ish enabled/disabled counts to 0 (null-safe mapping)', () => {
    renderComposition({
      composition: [
        {
          kind: 'flag',
          enabled: undefined as unknown as number,
          disabled: null as unknown as number,
          total: 0,
        },
      ],
    });
    const rows = readChartData();
    expect(rows[0].enabled).toBe(0);
    expect(rows[0].disabled).toBe(0);
  });

  it('falls back to the raw kind when no label is registered for it', () => {
    renderComposition({
      composition: [
        { kind: 'mystery' as FeatureFlagKind, enabled: 1, disabled: 0, total: 1 },
      ],
    });
    // kindLabel has no 'mystery' entry → the mapping falls back to the raw key.
    expect(readChartData()[0].name).toBe('mystery');
  });

  it('binds the two series to their dataKey, localized name and fixed fill', () => {
    renderComposition({ composition: COMPOSITION });

    const enabled = screen.getByTestId('bar-enabled');
    expect(enabled).toHaveAttribute('data-key', 'enabled');
    expect(enabled).toHaveAttribute('data-name', 'Enabled');
    expect(enabled).toHaveAttribute('data-fill', '#10b981');

    const disabled = screen.getByTestId('bar-disabled');
    expect(disabled).toHaveAttribute('data-key', 'disabled');
    expect(disabled).toHaveAttribute('data-name', 'Disabled');
    expect(disabled).toHaveAttribute('data-fill', '#64748b');
  });

  it('renders one grouped bar per composition row', () => {
    renderComposition({
      composition: [{ kind: 'flag', enabled: 4, disabled: 0, total: 4 }],
    });
    const rows = readChartData();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ name: 'Boolean flags', enabled: 4, disabled: 0 });
  });
});
