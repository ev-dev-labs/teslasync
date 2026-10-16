/**
 * WidgetShell — behaviour + hardening coverage.
 *
 * WidgetShell is the shared chrome every dashboard widget renders inside. Its
 * job is orchestration: pick the loading / error / content state, lay out the
 * header (title, icon, help tooltip, freshness chip, pin button, actions) vs.
 * the title-less overlay layout, resolve which freshness indicator to show
 * (granular `updatedAt` props vs. a whole `query`), and pulse a green glow when
 * the underlying data timestamp changes.
 *
 * The leaf children (`Skeleton`, `QueryError`, `HelpTooltip`, `PinButton`,
 * `FreshnessDot`, `FreshnessDotAuto`) are mocked with lightweight stand-ins so
 * this suite asserts WidgetShell's own contract — which child renders and with
 * which props — without dragging in their QueryClient / Router / i18n trees or
 * ever touching the network.
 *
 * Facets covered:
 *   - state machine: loading → Skeleton (content withheld); error → QueryError
 *     wrapping a real Error; otherwise children render.
 *   - titled header: title heading, decorative icon, help tooltip (only with a
 *     title), actions, and the i18n'd "More info about {{title}}" aria-label.
 *   - title-less layout: freshness moves to an absolute overlay (compact), the
 *     actions row still renders, and help/pin are suppressed.
 *   - freshness resolution: `updatedAt` wins over `query`; `updatedAt === 0`
 *     collapses to a null timestamp; a bare `query` uses FreshnessDotAuto; and
 *     neither prop renders no chip. Omitted flags default to false; `onRefresh`
 *     is forwarded and fires.
 *   - pin: rendered only when title + widgetId + dashboardId are all present.
 *   - padding: `noPadding` swaps the scroll container classes.
 *   - freshness/content state: timestamps reach the shared indicator, stale
 *     retained values are dimmed, and headings expose their full title.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { deriveDataState } from '@/api/dataState';

// ── i18n stub: resolve `t(key, defaultString, opts)` and interpolate {{vars}} ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      defOrOpts?: string | Record<string, unknown>,
      maybeOpts?: Record<string, unknown>,
    ) => {
      const template = typeof defOrOpts === 'string' ? defOrOpts : key;
      const opts = typeof defOrOpts === 'string' ? maybeOpts : defOrOpts;
      return template.replace(/\{\{(\w+)\}\}/g, (_m, k: string) =>
        String(opts?.[k] ?? ''),
      );
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── Leaf children replaced with prop-reflecting stand-ins ──
vi.mock('@/components/feedback', () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
  QueryError: ({ error, onRetry }: { error: unknown; onRetry?: () => void }) => (
    <div data-testid="query-error">
      {error instanceof Error ? error.message : String(error)}
      {onRetry && <button onClick={onRetry}>Retry query</button>}
    </div>
  ),
  StaleRefreshWarning: ({ state, hideRetry }: { state: { status: string }; hideRetry?: boolean }) =>
    state.status === 'ok' ? null : <div data-testid="trust-warning" data-hide-retry={String(hideRetry)}>{state.status}</div>,
}));

vi.mock('@/components/ui', () => ({
  HelpTooltip: (props: { ariaLabel?: string; text?: string; i18nKey?: string }) => (
    <div
      data-testid="help-tooltip"
      data-aria-label={props.ariaLabel}
      data-text={props.text}
      data-i18n-key={props.i18nKey}
    />
  ),
  PinButton: (props: {
    itemType?: string;
    itemId?: string | number;
    context?: string;
    size?: string;
  }) => (
    <div
      data-testid="pin-button"
      data-item-type={props.itemType}
      data-item-id={String(props.itemId)}
      data-context={props.context}
      data-size={props.size}
    />
  ),
}));

vi.mock('@/components/data-display', () => ({
  FreshnessDot: (props: {
    updatedAt: number | null;
    isFetching?: boolean;
    isStale?: boolean;
    isError?: boolean;
    onRefresh?: () => void;
    compact?: boolean;
  }) => (
    <div
      data-testid="data-freshness"
      data-updated-at={String(props.updatedAt)}
      data-is-fetching={String(props.isFetching)}
      data-is-stale={String(props.isStale)}
      data-is-error={String(props.isError)}
      data-compact={String(props.compact)}
    >
      {props.onRefresh ? (
        <button type="button" data-testid="freshness-refresh" onClick={props.onRefresh}>
          refresh
        </button>
      ) : null}
    </div>
  ),
  FreshnessDotAuto: (props: {
    query?: { dataUpdatedAt?: number };
    compact?: boolean;
  }) => (
    <div
      data-testid="data-freshness-auto"
      data-compact={String(props.compact)}
      data-updated-at={String(props.query?.dataUpdatedAt)}
    />
  ),
}));

import { WidgetShell } from './WidgetShell';
import type { FreshnessQuery } from '@/components/data-display';

const Child = () => <div data-testid="child">child content</div>;

function makeQuery(over: Partial<FreshnessQuery> = {}): FreshnessQuery {
  return {
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: 1_700_000_000_000,
    refetch: vi.fn(),
    ...over,
  } as FreshnessQuery;
}

function root(container: HTMLElement): HTMLElement {
  return container.firstChild as HTMLElement;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('WidgetShell — state machine', () => {
  it('retains content during a failed refresh even when the legacy error prop is supplied', () => {
    const dataState = deriveDataState({ data: [0], isError: true, error: new Error('offline') });
    render(
      <WidgetShell title="Battery" error="offline" dataState={dataState}>
        <Child />
      </WidgetShell>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByTestId('trust-warning')).toHaveTextContent('stale');
    expect(screen.queryByTestId('query-error')).not.toBeInTheDocument();
  });

  it('uses the widget freshness dot as the retained-data retry and hides the duplicate warning action', () => {
    const refetch = vi.fn();
    const state = deriveDataState({ data: [0], isError: true, error: new Error('offline'), refetch });
    render(<WidgetShell title="Battery" dataState={state} updatedAt={1_700_000_000_000}>
      <Child />
    </WidgetShell>);

    expect(screen.getByTestId('trust-warning')).toHaveAttribute('data-hide-retry', 'true');
    fireEvent.click(screen.getByTestId('freshness-refresh'));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('offers retry and preserves the header on initial failure', () => {
    const refetch = vi.fn();
    const state = deriveDataState({ isError: true, error: new Error('Network unavailable'), refetch });
    render(<WidgetShell title="Battery" dataState={state}><Child /></WidgetShell>);
    expect(screen.getByRole('heading')).toHaveTextContent('Battery');
    expect(screen.getByTestId('query-error')).toHaveTextContent('Network unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry query' }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
  });

  it('keeps contextual slots in every state and accepts a content-shaped skeleton', () => {
    const { container } = render(
      <WidgetShell
        title="Battery"
        description="Current vehicle"
        status={<span>Unknown</span>}
        footer={<span>View details</span>}
        loading
        loadingContent={<div>Reading battery</div>}
      ><Child /></WidgetShell>,
    );
    expect(screen.getByText('Current vehicle')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('View details')).toBeInTheDocument();
    expect(screen.getByText('Reading battery')).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('heading')).not.toHaveClass('uppercase');
  });

  it('renders only the skeleton (with its sizing classes) while loading', () => {
    render(
      <WidgetShell title="Battery" loading>
        <Child />
      </WidgetShell>,
    );

    const skeleton = screen.getByTestId('skeleton');
    expect(skeleton).toBeInTheDocument();
    expect(skeleton.className).toContain('h-full');
    expect(skeleton.className).toContain('rounded-xl');
    // Keep the widget identity visible while withholding unresolved content.
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
    expect(screen.getByRole('heading')).toHaveTextContent('Battery');
  });

  it('renders QueryError wrapping a real Error when error is set, hiding content', () => {
    render(
      <WidgetShell title="Battery" error="boom failed">
        <Child />
      </WidgetShell>,
    );

    expect(screen.getByTestId('query-error')).toHaveTextContent('boom failed');
    expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
  });

  it('prefers the loading branch over an error when both are set', () => {
    render(
      <WidgetShell loading error="ignored while loading">
        <Child />
      </WidgetShell>,
    );

    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('query-error')).not.toBeInTheDocument();
  });

  it('renders children in the content area when neither loading nor error', () => {
    render(
      <WidgetShell title="Battery">
        <Child />
      </WidgetShell>,
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
    expect(screen.queryByTestId('query-error')).not.toBeInTheDocument();
  });
});

describe('WidgetShell — titled header', () => {
  it('renders the title as an h3 heading alongside the decorative icon', () => {
    render(
      <WidgetShell title="Battery Health" icon={<span data-testid="icon" />}>
        <Child />
      </WidgetShell>,
    );

    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Battery Health');
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('renders the help tooltip with an interpolated, i18n aria-label', () => {
    render(
      <WidgetShell
        title="Battery Health"
        help={{ i18nKey: 'help.battery', defaultValue: 'Battery help', text: 'Battery help' }}
      >
        <Child />
      </WidgetShell>,
    );

    const tip = screen.getByTestId('help-tooltip');
    expect(tip).toBeInTheDocument();
    // Proves the hardcoded template literal was replaced with a translated,
    // interpolated aria-label ("More info about {{title}}").
    expect(tip.getAttribute('data-aria-label')).toBe('More info about Battery Health');
    expect(tip.getAttribute('data-i18n-key')).toBe('help.battery');
  });

  it('renders header actions', () => {
    render(
      <WidgetShell title="Battery" actions={<button type="button">Export</button>}>
        <Child />
      </WidgetShell>,
    );

    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
  });

  it('omits the help tooltip when no help metadata is supplied', () => {
    render(
      <WidgetShell title="Battery">
        <Child />
      </WidgetShell>,
    );

    expect(screen.queryByTestId('help-tooltip')).not.toBeInTheDocument();
  });
});

describe('WidgetShell — title-less layout', () => {
  it('moves the freshness chip into an absolute compact overlay', () => {
    const { container } = render(
      <WidgetShell updatedAt={1000}>
        <Child />
      </WidgetShell>,
    );

    // No header heading is rendered for a title-less widget.
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();

    const chip = screen.getByTestId('data-freshness');
    expect(chip.getAttribute('data-compact')).toBe('true');
    const overlay = chip.parentElement as HTMLElement;
    expect(overlay.className).toContain('absolute');
    expect(overlay.className).toContain('top-1.5');
    expect(overlay.className).toContain('right-4');
    // Content still renders under the overlay.
    expect(root(container)).toContainElement(screen.getByTestId('child'));
  });

  it('renders an actions row but suppresses help and pin without a title', () => {
    render(
      <WidgetShell
        actions={<span data-testid="actions" />}
        help={{ text: 'hidden without a title' }}
        widgetId="w1"
        dashboardId="d1"
      >
        <Child />
      </WidgetShell>,
    );

    expect(screen.getByTestId('actions')).toBeInTheDocument();
    expect(screen.queryByTestId('help-tooltip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pin-button')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('drops the decorative icon when there is no title', () => {
    render(
      <WidgetShell icon={<span data-testid="icon" />}>
        <Child />
      </WidgetShell>,
    );

    expect(screen.queryByTestId('icon')).not.toBeInTheDocument();
  });
});

describe('WidgetShell — freshness resolution', () => {
  it('uses granular FreshnessDot and forwards flags when updatedAt is set', () => {
    render(
      <WidgetShell title="Battery" updatedAt={1234} isFetching isStale isError onRefresh={vi.fn()}>
        <Child />
      </WidgetShell>,
    );

    const chip = screen.getByTestId('data-freshness');
    expect(chip.getAttribute('data-updated-at')).toBe('1234');
    expect(chip.getAttribute('data-is-fetching')).toBe('true');
    expect(chip.getAttribute('data-is-stale')).toBe('true');
    expect(chip.getAttribute('data-is-error')).toBe('true');
    expect(chip.getAttribute('data-compact')).toBe('false');
    expect(screen.queryByTestId('data-freshness-auto')).not.toBeInTheDocument();
  });

  it('defaults omitted freshness flags to false', () => {
    render(
      <WidgetShell title="Battery" updatedAt={1234}>
        <Child />
      </WidgetShell>,
    );

    const chip = screen.getByTestId('data-freshness');
    expect(chip.getAttribute('data-is-fetching')).toBe('false');
    expect(chip.getAttribute('data-is-stale')).toBe('false');
    expect(chip.getAttribute('data-is-error')).toBe('false');
  });

  it('passes a null timestamp when updatedAt is exactly 0', () => {
    render(
      <WidgetShell title="Battery" updatedAt={0}>
        <Child />
      </WidgetShell>,
    );

    expect(screen.getByTestId('data-freshness').getAttribute('data-updated-at')).toBe('null');
  });

  it('uses FreshnessDotAuto when only a query is supplied', () => {
    render(
      <WidgetShell title="Battery" query={makeQuery({ dataUpdatedAt: 999 })}>
        <Child />
      </WidgetShell>,
    );

    const auto = screen.getByTestId('data-freshness-auto');
    expect(auto.getAttribute('data-updated-at')).toBe('999');
    expect(auto.getAttribute('data-compact')).toBe('false');
    expect(screen.queryByTestId('data-freshness')).not.toBeInTheDocument();
  });

  it('lets granular updatedAt win over a supplied query', () => {
    render(
      <WidgetShell title="Battery" updatedAt={5000} query={makeQuery({ dataUpdatedAt: 999 })}>
        <Child />
      </WidgetShell>,
    );

    expect(screen.getByTestId('data-freshness').getAttribute('data-updated-at')).toBe('5000');
    expect(screen.queryByTestId('data-freshness-auto')).not.toBeInTheDocument();
  });

  it('renders no freshness chip when neither updatedAt nor query is given', () => {
    render(
      <WidgetShell title="Battery">
        <Child />
      </WidgetShell>,
    );

    expect(screen.queryByTestId('data-freshness')).not.toBeInTheDocument();
    expect(screen.queryByTestId('data-freshness-auto')).not.toBeInTheDocument();
  });

  it('forwards onRefresh so the chip can trigger a refetch', () => {
    const onRefresh = vi.fn();
    render(
      <WidgetShell title="Battery" updatedAt={1234} onRefresh={onRefresh}>
        <Child />
      </WidgetShell>,
    );

    fireEvent.click(screen.getByTestId('freshness-refresh'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('WidgetShell — pin button', () => {
  it('renders the pin button when title + widgetId + dashboardId are all present', () => {
    render(
      <WidgetShell title="Battery" widgetId="w-42" dashboardId="dash-1">
        <Child />
      </WidgetShell>,
    );

    const pin = screen.getByTestId('pin-button');
    expect(pin.getAttribute('data-item-id')).toBe('w-42');
    expect(pin.getAttribute('data-context')).toBe('dash-1');
    expect(pin.getAttribute('data-item-type')).toBe('widget');
  });

  it('does not render the pin button when dashboardId is missing', () => {
    render(
      <WidgetShell title="Battery" widgetId="w-42">
        <Child />
      </WidgetShell>,
    );

    expect(screen.queryByTestId('pin-button')).not.toBeInTheDocument();
  });
});

describe('WidgetShell — content padding', () => {
  it('uses the padded content container without a nested scroll area', () => {
    render(
      <WidgetShell title="Battery">
        <Child />
      </WidgetShell>,
    );

    const wrapper = screen.getByTestId('child').parentElement as HTMLElement;
    expect(wrapper.className).not.toContain('overflow-auto');
    expect(wrapper.className).toContain('px-4');
  });

  it('drops padding and stretches unpadded content without clipping overflow', () => {
    render(
      <WidgetShell title="Battery" noPadding>
        <Child />
      </WidgetShell>,
    );

    const wrapper = screen.getByTestId('child').parentElement as HTMLElement;
    expect(wrapper.className).not.toContain('overflow-hidden');
    expect(wrapper).toHaveClass('flex', 'flex-col');
    expect(wrapper.className).not.toContain('overflow-auto');
  });
});

describe('WidgetShell - freshness and content state', () => {
  it('keeps the widget surface still on the initial mount', () => {
    const { container } = render(
      <WidgetShell title="Battery" updatedAt={100}>
        <Child />
      </WidgetShell>,
    );

    expect(root(container).className).not.toContain('shadow-[0_0_12px');
  });

  it('forwards an advanced timestamp to the freshness indicator without pulsing the whole shell', () => {
    const { container, rerender } = render(
      <WidgetShell title="Battery" updatedAt={100}>
        <Child />
      </WidgetShell>,
    );
    expect(root(container).className).not.toContain('shadow-[0_0_12px');

    rerender(
      <WidgetShell title="Battery" updatedAt={200}>
        <Child />
      </WidgetShell>,
    );
    expect(screen.getByTestId('data-freshness')).toHaveAttribute('data-updated-at', '200');
    expect(root(container).className).not.toContain('shadow-[0_0_12px');
  });

  it('reduces retained widget content to 45 percent opacity when data is stale', () => {
    render(
      <WidgetShell title="Battery" updatedAt={100} isStale>
        <Child />
      </WidgetShell>,
    );
    const content = screen.getByTestId('child').parentElement;
    expect(content).toHaveClass('opacity-[0.45]');
    expect(content).toHaveAttribute('data-content-degraded', 'true');
  });

  it('adds a full-title tooltip and truncation to long widget headings', () => {
    render(
      <WidgetShell title="A long dashboard widget title">
        <Child />
      </WidgetShell>,
    );
    const heading = screen.getByRole('heading', { name: 'A long dashboard widget title' });
    expect(heading).toHaveClass('truncate');
    expect(heading).toHaveAttribute('title', 'A long dashboard widget title');
  });

  it('does not degrade content when the timestamp resets to zero', () => {
    const { container, rerender } = render(
      <WidgetShell title="Battery" updatedAt={100}>
        <Child />
      </WidgetShell>,
    );
    rerender(
      <WidgetShell title="Battery" updatedAt={200}>
        <Child />
      </WidgetShell>,
    );
    expect(root(container).className).not.toContain('shadow-[0_0_12px');

    // Resetting the query timestamp never makes retained values appear degraded.
    rerender(
      <WidgetShell title="Battery" updatedAt={0}>
        <Child />
      </WidgetShell>,
    );
    expect(screen.getByTestId('data-freshness')).toHaveAttribute('data-updated-at', 'null');
    expect(root(container).querySelector('[data-content-degraded="true"]')).not.toBeInTheDocument();
  });
});
