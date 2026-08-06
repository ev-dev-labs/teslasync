/**
 * FeatureConfigDistribution — the enabled-ratio overview panel of the Tesla
 * feature-flags page.
 *
 * This panel is a pure, prop-driven view over a `FeatureFlagSummary` that owns
 * its own loading / error / empty / populated states so it can be dropped into
 * the page's bento grid independently. The facets pinned here exercise every
 * branch of the component:
 *
 *   • populated: renders the enabled-rate <RadialGauge> (labelled "Enabled
 *     Rate", value at 0 decimals + a "%" unit) plus success/neutral count chips
 *     that locale-format the enabled/disabled totals;
 *   • a fractional rate rounds to a whole percent (the gauge is passed
 *     decimals={0});
 *   • empty: `total === 0` swaps the gauge for a role="status" <EmptyState>
 *     rather than a blank panel;
 *   • the four self-sufficient states have a strict precedence — loading beats
 *     everything, error beats the empty/populated branches — and every branch
 *     keeps the panel's <PanelTitle> heading so the section is never headless;
 *   • the error branch surfaces a <QueryError> whose Retry invokes `onRetry`;
 *   • the footer echoes the last-synced timestamp (forwarding `fetchedAt`
 *     verbatim to the formatter) or a "Not synced yet" placeholder when null;
 *   • null-safety: a partial summary (missing count fields) degrades to zeros
 *     and a wholly-undefined summary degrades to the empty state — neither
 *     throws mid-render;
 *   • a11y: the decorative title icon is aria-hidden.
 *
 * react-i18next is mocked to echo each call's English fallback and interpolate
 * `{{token}}` placeholders so copy is deterministic. `formatDateTime` is stubbed
 * to a deterministic token so the "last synced" assertion is timezone-stable and
 * proves `fetchedAt` is forwarded unmodified. framer-motion is mocked to a
 * passthrough because the `@/components/ui` barrel this file pulls in ships
 * motion-driven components; the mock keeps module load hermetic even though this
 * panel renders no motion itself. Renders are wrapped in <MemoryRouter> because
 * the error branch's <QueryError> uses `useNavigate`. `@testing-library/user-event`
 * is not a dependency in this worktree, so the Retry interaction uses `fireEvent`.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { type ComponentProps, type ReactNode } from 'react';

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () => (props: Record<string, unknown>) => {
        const Component = (props.as as string) ?? 'div';
        const { children, ...rest } = props as { children?: unknown } & Record<string, unknown>;
        return <Component {...(rest as Record<string, unknown>)}>{children as ReactNode}</Component>;
      },
    },
  ),
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useReducedMotion: () => true,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, opts?: Record<string, unknown>) => {
      let out = fallback ?? _key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
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

// Deterministic, timezone-stable timestamp rendering. The real formatDateTime
// is locale/timezone dependent; stubbing it pins that `fetchedAt` is forwarded
// to the formatter verbatim (and lets us assert an exact caption string).
vi.mock('@/lib/dateFormat', async () => {
  const actual = await vi.importActual<typeof import('@/lib/dateFormat')>('@/lib/dateFormat');
  return { ...actual, formatDateTime: (v: unknown) => `fmt:${String(v)}` };
});

import { FeatureConfigDistribution } from './FeatureConfigDistribution';
import type { FeatureFlagSummary } from './parseFeatureFlags';
import { BADGE_VARIANTS } from '@/components/ui';

type Props = ComponentProps<typeof FeatureConfigDistribution>;

/** Build a well-formed summary; `enabledRate` is derived unless overridden. */
function makeSummary(over: Partial<FeatureFlagSummary> = {}): FeatureFlagSummary {
  const enabled = over.enabled ?? 3;
  const disabled = over.disabled ?? 1;
  const total = over.total ?? enabled + disabled;
  const enabledRate = over.enabledRate ?? (total > 0 ? (enabled / total) * 100 : 0);
  return { total, enabled, disabled, enabledRate };
}

function renderPanel(over: Partial<Props> = {}) {
  const props: Props = {
    summary: makeSummary(),
    fetchedAt: null,
    isLoading: false,
    error: null,
    onRetry: vi.fn(),
    ...over,
  };
  const utils = render(
    <MemoryRouter>
      <FeatureConfigDistribution {...props} />
    </MemoryRouter>,
  );
  return { ...utils, props };
}

/** The always-present panel heading, regardless of section state. */
function heading(): HTMLElement {
  return screen.getByRole('heading', { name: /Distribution/ });
}

describe('FeatureConfigDistribution', () => {
  it('renders the enabled-rate gauge and enabled/disabled count chips when data is present', () => {
    renderPanel({ summary: makeSummary({ total: 4, enabled: 3, disabled: 1, enabledRate: 75 }) });

    expect(heading()).toBeInTheDocument();
    // Gauge — labelled, whole-percent value, and its unit.
    expect(screen.getByText('Enabled Rate')).toBeInTheDocument();
    expect(screen.getByText('75')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();
    // Count chips.
    expect(screen.getByText('Enabled: 3')).toBeInTheDocument();
    expect(screen.getByText('Disabled: 1')).toBeInTheDocument();
  });

  it('wires the enabled chip to the success tone and the disabled chip to the neutral tone', () => {
    renderPanel({ summary: makeSummary({ total: 4, enabled: 3, disabled: 1, enabledRate: 75 }) });

    expect(screen.getByText('Enabled: 3').className).toContain('bg-green-100');
    expect(screen.getByText('Disabled: 1').className).toContain(BADGE_VARIANTS.neutral);
  });

  it('formats large enabled/disabled counts with locale thousands separators', () => {
    renderPanel({
      summary: makeSummary({ total: 2468, enabled: 1234, disabled: 1234, enabledRate: 50 }),
    });

    expect(screen.getByText('Enabled: 1,234')).toBeInTheDocument();
    expect(screen.getByText('Disabled: 1,234')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
  });

  it('rounds a fractional enabled rate to a whole percent in the gauge (decimals=0)', () => {
    // total = 3, enabled = 2 → 66.66…% → rounds to "67".
    renderPanel({ summary: makeSummary({ total: 3, enabled: 2, disabled: 1 }) });

    expect(screen.getByText('67')).toBeInTheDocument();
    expect(screen.queryByText('66.67')).toBeNull();
  });

  it('renders a role="status" empty state (and no gauge) when there are no features', () => {
    renderPanel({ summary: makeSummary({ total: 0, enabled: 0, disabled: 0, enabledRate: 0 }) });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No feature data to summarise yet.')).toBeInTheDocument();
    // The gauge and chips must not leak behind the empty state.
    expect(screen.queryByText('Enabled Rate')).toBeNull();
    expect(screen.queryByText(/^Enabled:/)).toBeNull();
    // …but the panel is never headless.
    expect(heading()).toBeInTheDocument();
  });

  it('shows a loading skeleton that takes precedence over populated data, keeping the panel title', () => {
    const { container } = renderPanel({
      isLoading: true,
      summary: makeSummary({ total: 5, enabled: 5, disabled: 0, enabledRate: 100 }),
    });

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    // Loading wins even though there is data and no error.
    expect(screen.queryByText('Enabled Rate')).toBeNull();
    expect(screen.queryByText('No feature data to summarise yet.')).toBeNull();
    expect(heading()).toBeInTheDocument();
  });

  it('surfaces a QueryError with a working Retry when the load fails (error beats the empty branch)', () => {
    const onRetry = vi.fn();
    // total === 0 would otherwise render the empty state; the error must win.
    renderPanel({
      error: new Error('boom'),
      onRetry,
      summary: makeSummary({ total: 0, enabled: 0, disabled: 0, enabledRate: 0 }),
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);

    // Neither the gauge nor the empty-state copy renders behind the error.
    expect(screen.queryByText('Enabled Rate')).toBeNull();
    expect(screen.queryByText('No feature data to summarise yet.')).toBeNull();
    expect(heading()).toBeInTheDocument();
  });

  it('renders the last-synced timestamp, forwarding fetchedAt verbatim to the formatter', () => {
    renderPanel({
      fetchedAt: '2026-01-02T03:04:05Z',
      summary: makeSummary({ total: 4 }),
    });

    expect(screen.getByText('Synced fmt:2026-01-02T03:04:05Z')).toBeInTheDocument();
    expect(screen.queryByText('Not synced yet')).toBeNull();
  });

  it('shows a not-synced placeholder when fetchedAt is null', () => {
    renderPanel({ fetchedAt: null, summary: makeSummary({ total: 4 }) });

    expect(screen.getByText('Not synced yet')).toBeInTheDocument();
    expect(screen.queryByText(/^Synced\b/)).toBeNull();
  });

  it('is null-safe: a partial summary missing count fields degrades to zeros without throwing', () => {
    // A malformed payload — only `total` present. enabled/disabled/enabledRate
    // are undefined and must degrade to 0 rather than crash the render.
    const partial = { total: 3 } as unknown as FeatureFlagSummary;

    expect(() => renderPanel({ summary: partial })).not.toThrow();
    // total > 0 → gauge branch; the missing counts read as 0.
    expect(screen.getByText('Enabled Rate')).toBeInTheDocument();
    expect(screen.getByText('Enabled: 0')).toBeInTheDocument();
    expect(screen.getByText('Disabled: 0')).toBeInTheDocument();
  });

  it('is null-safe: a wholly-undefined summary degrades to the empty state without throwing', () => {
    const missing = undefined as unknown as FeatureFlagSummary;

    expect(() => renderPanel({ summary: missing })).not.toThrow();
    expect(screen.getByText('No feature data to summarise yet.')).toBeInTheDocument();
    expect(heading()).toBeInTheDocument();
  });

  it('marks the decorative title icon as aria-hidden (a11y)', () => {
    renderPanel({ summary: makeSummary({ total: 4 }) });

    const title = heading();
    expect(title.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});
