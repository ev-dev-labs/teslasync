/**
 * ChartHiddenSeriesContext — the context bridge that lets a
 * `<ChartContainer chartKey="…">` share URL-persisted hidden-series state with
 * descendant legends without prop drilling.
 *
 * Covers every export and its meaningful branches:
 *   - `useChartHiddenSeries()` returns the nearest provider's state, or `null`
 *     when there is no provider (the `createContext(null)` default).
 *   - `<ChartHiddenSeriesProvider>` with NO `chartKey` (or an empty-string key)
 *     opts out of toggling: it hands `null` to BOTH its render-prop and the
 *     context and — crucially — does so WITHOUT a `<Router>` in scope, proving
 *     the `useSearchParams()` dependency is never touched on that branch.
 *   - `<ChartHiddenSeriesProvider chartKey="…">` resolves a live
 *     `HiddenSeriesState`, passes the SAME instance to the render-prop and the
 *     context, hydrates hidden keys from the `?hidden_<key>` URL param, and lets
 *     `toggle()` flow through to consumers.
 *   - the raw `ChartHiddenSeriesContext.Provider` forwards its `value` verbatim.
 */
import { describe, it, expect } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { type ReactNode } from 'react';
import {
  ChartHiddenSeriesContext,
  ChartHiddenSeriesProvider,
  useChartHiddenSeries,
} from './ChartHiddenSeriesContext';
import type { HiddenSeriesState } from '@/hooks/useHiddenSeries';

/**
 * Surfaces the resolved context state through `data-*` attributes so the
 * assertions read like rendered DOM rather than reaching into internals.
 */
function ContextProbe() {
  const state = useChartHiddenSeries();
  return (
    <div
      data-testid="probe"
      data-has-state={state ? 'true' : 'false'}
      data-hidden-count={state ? String(state.hidden.size) : '0'}
      data-health-hidden={state?.isHidden('health') ? 'true' : 'false'}
    />
  );
}

/** RTL `wrapper` that mounts children under a `MemoryRouter` at `initial`. */
function routerWrap(initial: string) {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  );
}

describe('useChartHiddenSeries — no provider', () => {
  it('returns null when no ChartHiddenSeriesProvider is above it', () => {
    const { result } = renderHook(() => useChartHiddenSeries());
    expect(result.current).toBeNull();
  });

  it('reads the null context default with no Router required', () => {
    render(<ContextProbe />);
    const probe = screen.getByTestId('probe');
    expect(probe.dataset.hasState).toBe('false');
    expect(probe.dataset.hiddenCount).toBe('0');
  });
});

describe('ChartHiddenSeriesProvider — opt-out (no / empty chartKey)', () => {
  it('passes null to the render-prop WITHOUT touching react-router', () => {
    // Deliberately no MemoryRouter: the opt-out branch must not call
    // useSearchParams(), which throws outside a <Router>. If this render does
    // not throw and `state` is null, the branch is correctly short-circuited.
    let received: HiddenSeriesState | null | undefined = undefined;
    render(
      <ChartHiddenSeriesProvider>
        {(state) => {
          received = state;
          return <div data-testid="rp" data-state={state === null ? 'null' : 'set'} />;
        }}
      </ChartHiddenSeriesProvider>,
    );
    expect(received).toBeNull();
    expect(screen.getByTestId('rp').dataset.state).toBe('null');
  });

  it('provides null through context to nested consumers', () => {
    render(
      <ChartHiddenSeriesProvider>{() => <ContextProbe />}</ChartHiddenSeriesProvider>,
    );
    expect(screen.getByTestId('probe').dataset.hasState).toBe('false');
  });

  it('treats an empty-string chartKey as opt-out (still no Router needed)', () => {
    let received: HiddenSeriesState | null | undefined = undefined;
    render(
      <ChartHiddenSeriesProvider chartKey="">
        {(state) => {
          received = state;
          return <span data-testid="empty" />;
        }}
      </ChartHiddenSeriesProvider>,
    );
    expect(received).toBeNull();
    expect(screen.getByTestId('empty')).toBeInTheDocument();
  });
});

describe('ChartHiddenSeriesProvider — URL-backed (with chartKey)', () => {
  it('hands the SAME live state instance to the render-prop and the context', () => {
    let renderPropState: HiddenSeriesState | null | undefined = undefined;
    let contextState: HiddenSeriesState | null | undefined = undefined;
    function CaptureContext() {
      contextState = useChartHiddenSeries();
      return null;
    }
    render(
      <ChartHiddenSeriesProvider chartKey="trend">
        {(state) => {
          renderPropState = state;
          return <CaptureContext />;
        }}
      </ChartHiddenSeriesProvider>,
      { wrapper: routerWrap('/page') },
    );
    expect(renderPropState).not.toBeNull();
    // The provider forwards one object to both `value=` and `children(state)`.
    expect(contextState).toBe(renderPropState);
    expect(typeof renderPropState?.toggle).toBe('function');
  });

  it('hydrates hidden series from the ?hidden_<key> URL param', () => {
    render(
      <ChartHiddenSeriesProvider chartKey="trend">
        {() => <ContextProbe />}
      </ChartHiddenSeriesProvider>,
      { wrapper: routerWrap('/page?hidden_trend=health,projected') },
    );
    const probe = screen.getByTestId('probe');
    expect(probe.dataset.hasState).toBe('true');
    expect(probe.dataset.hiddenCount).toBe('2');
    expect(probe.dataset.healthHidden).toBe('true');
  });

  it('propagates toggle() through the shared context to consumers', () => {
    const captured: { state: HiddenSeriesState | null } = { state: null };
    render(
      <ChartHiddenSeriesProvider chartKey="trend">
        {(state) => {
          captured.state = state;
          return <ContextProbe />;
        }}
      </ChartHiddenSeriesProvider>,
      { wrapper: routerWrap('/page') },
    );
    expect(screen.getByTestId('probe').dataset.healthHidden).toBe('false');
    act(() => captured.state?.toggle('health'));
    expect(screen.getByTestId('probe').dataset.healthHidden).toBe('true');
    expect(captured.state?.isHidden('health')).toBe(true);
  });
});

describe('ChartHiddenSeriesContext — raw context object', () => {
  it('forwards a Provider value verbatim to useChartHiddenSeries', () => {
    const fake: HiddenSeriesState = {
      hidden: new Set(['speed']),
      toggle: () => undefined,
      isHidden: (k) => k === 'speed',
      reset: () => undefined,
    };
    render(
      <ChartHiddenSeriesContext.Provider value={fake}>
        <ContextProbe />
      </ChartHiddenSeriesContext.Provider>,
    );
    const probe = screen.getByTestId('probe');
    expect(probe.dataset.hasState).toBe('true');
    expect(probe.dataset.hiddenCount).toBe('1');
    expect(probe.dataset.healthHidden).toBe('false');
  });
});
