/**
 * LoadingSkeleton (charging-curve) — behaviour + hardening contract.
 *
 * A layout-shaped loading placeholder for the Charging Curve page. It takes no
 * data, so the elevation locked in by these tests is:
 *   - an accessible live region (`role="status"` + `aria-busy` + a labelled
 *     accessible name) so assistive tech announces the loading state, matching
 *     the shared `*Skeleton` primitives;
 *   - parametrised KPI + stat tile counts with safe defaults and a
 *     negative-count guard so an untyped caller can never crash the fallback
 *     via `Array.from({ length: -1 })`;
 *   - a composable `className` on the status root.
 *
 * The component is presentational — no network, router, or query context — so
 * it renders directly. `react-i18next` is mocked so the accessible name
 * resolves to its English fallback deterministically (mirrors the SummaryStats
 * test convention in this feature).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import LoadingSkeleton from './LoadingSkeleton';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

/** GlassPanel tags every panel root with `data-print-card`. */
function panels(container: HTMLElement) {
  return container.querySelectorAll('[data-print-card]');
}

describe('LoadingSkeleton — accessible loading region', () => {
  it('exposes a busy, labelled role="status" live region', () => {
    render(<LoadingSkeleton />);

    const region = screen.getByRole('status');
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('aria-busy', 'true');
    // aria-label resolves to the English fallback via the mocked t().
    expect(region).toHaveAccessibleName('Loading charging curve analysis');
  });

  it('surfaces the region under a stable data-testid (same node as the status role)', () => {
    render(<LoadingSkeleton />);
    expect(screen.getByTestId('charging-curve-skeleton')).toBe(screen.getByRole('status'));
  });
});

describe('LoadingSkeleton — default structure', () => {
  it('renders the default 6 KPI tiles and 4 stat tiles', () => {
    render(<LoadingSkeleton />);

    expect(screen.getByTestId('charging-curve-skeleton-kpis').children).toHaveLength(6);
    expect(screen.getByTestId('charging-curve-skeleton-stats').children).toHaveLength(4);
  });

  it('renders every GlassPanel in the bento (6 KPI + 4 chart + 4 stat = 14)', () => {
    const { container } = render(<LoadingSkeleton />);
    // hero curve (1) + secondary chart (1) + comparison pair (2) = 4 chart panels.
    expect(panels(container)).toHaveLength(6 + 4 + 4);
  });

  it('animates every placeholder (Skeleton adds animate-pulse)', () => {
    const { container } = render(<LoadingSkeleton />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(10);
  });
});

describe('LoadingSkeleton — parametrised tile counts', () => {
  it('renders the requested number of KPI and stat tiles', () => {
    render(<LoadingSkeleton kpiCount={3} statCount={2} />);

    expect(screen.getByTestId('charging-curve-skeleton-kpis').children).toHaveLength(3);
    expect(screen.getByTestId('charging-curve-skeleton-stats').children).toHaveLength(2);
  });

  it('clamps a negative count to 0 instead of throwing a RangeError', () => {
    // Array.from({ length: -1 }) throws — the component must guard against it.
    expect(() =>
      render(
        <LoadingSkeleton
          kpiCount={-5 as unknown as number}
          statCount={-1 as unknown as number}
        />,
      ),
    ).not.toThrow();

    // No tiles render, but the grid shells are still present (never a blank hole).
    expect(screen.getByTestId('charging-curve-skeleton-kpis').children).toHaveLength(0);
    expect(screen.getByTestId('charging-curve-skeleton-stats').children).toHaveLength(0);
    expect(screen.getByTestId('charging-curve-skeleton-kpis')).toBeInTheDocument();
    expect(screen.getByTestId('charging-curve-skeleton-stats')).toBeInTheDocument();
  });
});

describe('LoadingSkeleton — className composition', () => {
  it('composes a caller className onto the status root without dropping base layout', () => {
    render(<LoadingSkeleton className="test-custom-class" />);

    const region = screen.getByRole('status');
    expect(region).toHaveClass('test-custom-class');
    // Base vertical rhythm survives the override.
    expect(region).toHaveClass('space-y-6');
  });
});
