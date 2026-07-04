/**
 * AutomationStatusPanel — unit + behaviour coverage.
 *
 * The panel is a self-contained status summary with four mutually exclusive
 * render branches (loading → error → empty → populated) plus a conditional
 * auto-disabled warning banner. These tests exercise every branch, the
 * proportional-percentage derive (including the >100% clamp), the null-safety
 * hardening for partial payloads, and the error-recovery interaction.
 *
 * Network is never touched: the component takes its data purely through props,
 * so the tests drive the four states declaratively. framer-motion's animated
 * <MetricBar> fill is collapsed to a plain div (the repo's page-test
 * convention) so width animations don't leak act() warnings.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '../../../i18n';

import { AutomationStatusPanel, type AutomationStatusStats } from './AutomationStatusPanel';

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        (props: Record<string, unknown>) => {
          const { children, ...rest } = props as { children?: React.ReactNode };
          return <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children}</div>;
        },
    },
  ),
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => false,
}));

type PanelProps = React.ComponentProps<typeof AutomationStatusPanel>;

function setup(overrides: Partial<PanelProps> = {}) {
  const onRetry = overrides.onRetry ?? vi.fn();
  const props: PanelProps = {
    stats: { total: 0, active: 0, disabled: 0, autoDisabled: 0 },
    isLoading: false,
    error: null,
    onRetry,
    ...overrides,
  };
  const utils = render(
    <MemoryRouter>
      <AutomationStatusPanel {...props} />
    </MemoryRouter>,
  );
  return { ...utils, onRetry };
}

describe('AutomationStatusPanel', () => {
  // The panel header is rendered outside every conditional branch, so it is a
  // stable anchor the other branch-specific assertions can lean on.
  it('always renders the panel title regardless of state', () => {
    setup({ isLoading: true });
    expect(screen.getByText('Status breakdown')).toBeInTheDocument();
  });

  // Populated, healthy fleet — three proportional bars, no warning banner.
  it('renders one bar per status with correct value · percent sublabels', () => {
    setup({ stats: { total: 5, active: 3, disabled: 2, autoDisabled: 0 } });

    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByText('Auto-disabled')).toBeInTheDocument();

    // 3/5, 2/5, 0/5 → 60% / 40% / 0%.
    expect(screen.getByText('3 · 60%')).toBeInTheDocument();
    expect(screen.getByText('2 · 40%')).toBeInTheDocument();
    expect(screen.getByText('0 · 0%')).toBeInTheDocument();

    // No auto-disabled automations → no attention banner.
    expect(screen.queryByText('Attention needed')).not.toBeInTheDocument();
  });

  // Auto-disabled > 0 surfaces the actionable warning banner with an
  // interpolated count.
  it('shows the auto-disabled warning banner with the pluralised count', () => {
    setup({ stats: { total: 4, active: 1, disabled: 1, autoDisabled: 2 } });

    expect(screen.getByText('Attention needed')).toBeInTheDocument();
    expect(
      screen.getByText(/2 automation\(s\) were auto-disabled after repeated failures/i),
    ).toBeInTheDocument();
    // 2/4 → 50%.
    expect(screen.getByText('2 · 50%')).toBeInTheDocument();
  });

  // Empty branch — total 0 renders the empty state (role="status"), never the
  // bars or the banner.
  it('renders the empty state when there are no automations', () => {
    setup({ stats: { total: 0, active: 0, disabled: 0, autoDisabled: 0 } });

    expect(screen.getByText('No automations to summarize yet')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
    expect(screen.queryByText('Attention needed')).not.toBeInTheDocument();
  });

  // Loading takes priority over every other branch, including a concurrent
  // error — the skeleton renders and no bars/error/empty leak through.
  it('renders the skeleton while loading, even when an error is also present', () => {
    const { container } = setup({
      isLoading: true,
      error: new Error('boom'),
      stats: { total: 5, active: 3, disabled: 2, autoDisabled: 0 },
    });

    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('No automations to summarize yet')).not.toBeInTheDocument();
  });

  // Error branch — renders the shared QueryError (role="alert") and the Retry
  // CTA calls back into onRetry so the parent can refetch.
  it('renders an error alert and invokes onRetry when Retry is clicked', () => {
    const onRetry = vi.fn();
    setup({ error: new Error('network down'), onRetry });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);

    // Data bars must not render alongside the error.
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  // Null-safety hardening — a partial payload with every count missing must
  // coalesce to zero and fall through to the empty state, never render "NaN".
  it('treats an all-undefined payload as empty without rendering NaN', () => {
    setup({ stats: {} as unknown as AutomationStatusStats });

    expect(screen.getByText('No automations to summarize yet')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  // Null-safety hardening — a payload with only some counts present fills the
  // gaps with zero (bars still render; missing rows read "0 · 0%").
  it('coalesces missing counts to zero for a partial payload', () => {
    setup({ stats: { total: 2, active: 2 } as unknown as AutomationStatusStats });

    // active 2/2 → 100%.
    expect(screen.getByText('2 · 100%')).toBeInTheDocument();
    // disabled + auto-disabled both default to 0 → two "0 · 0%" readouts.
    expect(screen.getAllByText('0 · 0%')).toHaveLength(2);
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    // Coalesced auto-disabled = 0 → no warning banner.
    expect(screen.queryByText('Attention needed')).not.toBeInTheDocument();
  });

  // Percentage clamp — an inconsistent payload where a count exceeds the total
  // must cap the readout at 100% rather than surfacing a nonsensical ">100%".
  it('clamps a percentage that would exceed 100 for inconsistent data', () => {
    setup({ stats: { total: 2, active: 5, disabled: 0, autoDisabled: 0 } });

    expect(screen.getByText('5 · 100%')).toBeInTheDocument();
    // Without the clamp this would read "5 · 250%".
    expect(screen.queryByText('5 · 250%')).not.toBeInTheDocument();
    expect(screen.queryByText(/250%/)).not.toBeInTheDocument();
  });
});
