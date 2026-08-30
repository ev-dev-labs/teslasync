/**
 * PowerTrendPanel — behaviour, branch precedence, interaction, a11y and
 * null-safety coverage for the file's sole export (`PowerTrendPanel`).
 *
 * The panel is a presentational leaf: it takes a pre-built `TrendPoint[]` plus
 * the owning query's `isLoading` / `error` / `onRetry` and renders a persistent
 * <PanelTitle> header above one state-driven body whose branch order is:
 *
 *     isLoading        → <Skeleton>          (query loading its first payload)
 *     error            → <QueryError>        (retry wired to onRetry)
 *     data.length === 0 → <EmptyState>       (query resolved but produced no rows)
 *     otherwise        → the Recharts area   (an accessible role="img" region)
 *
 * Recharts measures the SVG bounding box and jsdom reports 0 × 0, so the chart
 * body itself renders nothing — the populated-branch assertions therefore target
 * the always-present accessible chart region (the role="img" wrapper the
 * hardening pass added) rather than any SVG geometry.
 *
 * This file pins the two things the hardening pass fixed:
 *   1. NULL-SAFETY — an `undefined` `points` prop must route to the empty state
 *      instead of throwing on `points.length` (the prop is typed `TrendPoint[]`,
 *      but a transient/errored upstream query can still hand us `undefined`);
 *   2. the accessible CHART REGION — the populated branch now exposes a
 *      `role="img"` element with a localized `aria-label`, so screen readers get
 *      a text alternative for a chart that is otherwise pure (empty-in-jsdom) SVG.
 *
 * Strategy: the component takes all of its data as props, so no network is
 * touched. <QueryError> reaches for useNavigate + useOnlineStatus, so the tree
 * is wrapped in a MemoryRouter. Only `react-i18next` is mocked so
 * `t(key, fallback)` / `t(key, fallback, { vars })` render the English fallback
 * deterministically — exactly how the panel builds its title / empty copy and
 * how QueryError builds "Server error" / "Retry". `@testing-library/user-event`
 * is intentionally NOT a dependency of this repo; `fireEvent.click` is the
 * established interaction convention for the Retry CTA.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { type ComponentProps, type ReactNode } from 'react';

import { ApiError } from '@/lib/resilience';
import { PowerTrendPanel } from './PowerTrendPanel';
import { type TrendPoint } from './constants';

// jsdom lacks matchMedia; shared UI can reach framer-motion's useReducedMotion
// transitively. Install a benign stub before any shared module evaluates.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

// i18n → return the developer fallback string, interpolating {{vars}} so labels
// read as real English. Handles t(key, 'fallback'), t(key, 'fallback', {vars})
// and t(key, { defaultValue, ...vars }).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (template: string, vars?: Record<string, unknown>) =>
    vars
      ? template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        )
      : template;
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, second?: unknown, third?: unknown) => {
        if (typeof second === 'string') {
          const vars = third && typeof third === 'object' ? (third as Record<string, unknown>) : undefined;
          return interpolate(second, vars);
        }
        if (second && typeof second === 'object') {
          const opts = second as Record<string, unknown>;
          const template = typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
          return interpolate(template, opts);
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return { ...actual, ...chartTestDoubles };
});

type PanelProps = ComponentProps<typeof PowerTrendPanel>;

const TITLE = 'Output Power Trend';
const CHART_LABEL = 'Output power trend chart';
const EMPTY_COPY = /No power readings yet/;

function makePoint(over: Partial<TrendPoint> = {}): TrendPoint {
  return { ts: '2024-06-01T10:00:00Z', label: '10:00', value: 5, ...over };
}

const SAMPLE_POINTS: TrendPoint[] = [
  makePoint({ ts: '2024-06-01T10:00:00Z', label: '10:00', value: 4.2 }),
  makePoint({ ts: '2024-06-01T10:05:00Z', label: '10:05', value: 6.8 }),
  makePoint({ ts: '2024-06-01T10:10:00Z', label: '10:10', value: 3.1 }),
];

function renderPanel(overrides: Partial<PanelProps> = {}) {
  const onRetry = overrides.onRetry ?? vi.fn();
  const props: PanelProps = {
    points: SAMPLE_POINTS,
    isLoading: false,
    error: null,
    ...overrides,
    onRetry,
  };
  const utils = render(
    <MemoryRouter>
      <PowerTrendPanel {...props} />
    </MemoryRouter>,
  );
  return { ...utils, onRetry };
}

/** The persistent <h3> panel title — mounted in every branch. */
function heading(): HTMLElement {
  return screen.getByRole('heading', { level: 3, name: TITLE });
}

describe('PowerTrendPanel — persistent chrome + a11y', () => {
  it('renders the h3 title with a decorative aria-hidden icon (icon excluded from the name)', () => {
    renderPanel();

    const h = heading();
    expect(h).toBeInTheDocument();
    // The lucide <Power> glyph is decorative — it must not leak into the name.
    const icon = h.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });

  it('exposes the populated chart as an accessible role="img" region with a localized label', () => {
    renderPanel({ points: SAMPLE_POINTS });

    const chart = screen.getByRole('img', { name: CHART_LABEL });
    expect(chart).toBeInTheDocument();
    expect(chart).toHaveAttribute('data-testid', 'embedded-chart');
    // A populated chart shows neither the loading nor the empty affordance.
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
    expect(document.querySelector('.animate-pulse')).toBeNull();
  });
});

describe('PowerTrendPanel — state branches', () => {
  it('shows only the loading skeleton while isLoading (header still mounted)', () => {
    const { container } = renderPanel({ isLoading: true });

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(heading()).toBeInTheDocument();
    // No other body branch leaks through the loading gate.
    expect(screen.queryByRole('img', { name: CHART_LABEL })).toBeNull();
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
    expect(screen.queryByText('Server error')).toBeNull();
  });

  it('renders the shared empty state (role=status + copy) when there are no points', () => {
    renderPanel({ points: [] });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(EMPTY_COPY)).toBeInTheDocument();
    // Never a blank panel: the shared frame retains its accessible identity
    // while replacing the plot with the truthful empty state.
    expect(heading()).toBeInTheDocument();
    expect(screen.getByRole('img', { name: CHART_LABEL })).toContainElement(
      screen.getByRole('status'),
    );
    expect(document.querySelector('.animate-pulse')).toBeNull();
  });
});

describe('PowerTrendPanel — error branch + retry interaction', () => {
  it('surfaces the QueryError server-error card for a 5xx and hides the chart', () => {
    renderPanel({ error: new ApiError('kaboom', 500) });

    expect(screen.getByText('Server error')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // Header persists; the chart region is suppressed under the error.
    expect(heading()).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: CHART_LABEL })).toBeNull();
  });

  it('invokes onRetry exactly once when the Retry control is activated', () => {
    const { onRetry } = renderPanel({ error: new ApiError('kaboom', 500) });

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('PowerTrendPanel — branch precedence', () => {
  it('prefers the loading skeleton over a concurrent error and empty points', () => {
    const { container } = renderPanel({
      isLoading: true,
      error: new ApiError('x', 500),
      points: [],
    });

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByText('Server error')).toBeNull();
    expect(screen.queryByText(EMPTY_COPY)).toBeNull();
  });

  it('prefers the error card over a populated chart', () => {
    renderPanel({ error: new ApiError('x', 503), points: SAMPLE_POINTS });

    expect(screen.getByText('Service unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: CHART_LABEL })).toBeNull();
  });
});

describe('PowerTrendPanel — null safety (regression)', () => {
  it('treats an undefined points prop as empty without throwing', () => {
    // The pre-fix `points.length` read threw a TypeError on undefined; the
    // hardened `points ?? []` must route to the empty state instead.
    expect(() =>
      renderPanel({ points: undefined as unknown as TrendPoint[] }),
    ).not.toThrow();

    expect(screen.getByText(EMPTY_COPY)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: CHART_LABEL })).toContainElement(
      screen.getByRole('status'),
    );
  });
});
