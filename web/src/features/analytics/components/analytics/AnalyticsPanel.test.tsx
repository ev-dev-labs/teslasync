/**
 * AnalyticsPanel — behaviour + hardening coverage.
 *
 * Single export: <AnalyticsPanel>. It is the self-sufficient section
 * surface every data-bound panel on the Analytics page renders through, so
 * each one owns its own loading / error / empty state independently instead
 * of gating the whole page behind one `{data && …}`.
 *
 * Facets covered:
 *   1. READY      — title (h3), decorative icon, and children render; no
 *                   skeleton / error / empty surfaces leak and the panel is
 *                   not marked busy.
 *   2. NO ICON    — the decorative icon wrapper is omitted when no icon
 *                   prop is passed; the title still renders.
 *   3. LOADING    — a skeleton block renders at the default height, the
 *                   panel is announced aria-busy, and children are withheld.
 *   4. SKELETON H — a custom skeletonHeight is forwarded to the skeleton.
 *   5. ERROR      — QueryError surfaces with a retryable CTA; clicking it
 *                   invokes the supplied onRetry; children are withheld.
 *   6. EMPTY      — the default "No data available" EmptyState renders
 *                   (never a blank panel) with children withheld.
 *   7. EMPTY+MSG  — a custom emptyMessage + emptyIcon are surfaced and the
 *                   default copy is suppressed.
 *   8. PRECEDENCE — loading ▸ error ▸ empty ▸ children, verified by layering
 *                   the flags on together and peeling them off.
 *   9. CLASSNAME  — the grid-item className is merged onto the panel root
 *                   without dropping the component's base padding.
 *
 * i18n is stubbed to the English fallback so visible copy is deterministic;
 * the network is never touched (QueryError reads only the in-process online
 * status, which defaults to "online" in jsdom). Router context is provided
 * because QueryError uses useNavigate for its recovery CTAs.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, def?: string) => def ?? key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import { AnalyticsPanel } from './AnalyticsPanel';

function renderPanel(ui: ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AnalyticsPanel', () => {
  it('renders the title, decorative icon, and children when idle', () => {
    const { container } = renderPanel(
      <AnalyticsPanel title="Distance by Vehicle" icon={<svg data-testid="panel-icon" />}>
        <div data-testid="panel-body">Chart content</div>
      </AnalyticsPanel>,
    );

    // Title renders as an h3 (PanelTitle → Heading level="panel").
    expect(
      screen.getByRole('heading', { level: 3, name: /Distance by Vehicle/i }),
    ).toBeInTheDocument();

    // Children render in the idle branch.
    expect(screen.getByTestId('panel-body')).toHaveTextContent('Chart content');

    // Icon is decorative — wrapped in an aria-hidden span so AT skips it.
    expect(screen.getByTestId('panel-icon').parentElement).toHaveAttribute('aria-hidden', 'true');

    // No loading / error / empty surfaces leak into the ready state, and the
    // panel is not falsely announced as busy.
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(container.querySelector('[data-print-card]')).not.toHaveAttribute('aria-busy');
  });

  it('omits the decorative icon wrapper when no icon is provided', () => {
    renderPanel(
      <AnalyticsPanel title="Energy">
        <div data-testid="panel-body">ok</div>
      </AnalyticsPanel>,
    );

    const heading = screen.getByRole('heading', { level: 3, name: /Energy/i });
    expect(heading).toBeInTheDocument();
    // The title row carries no aria-hidden icon span when icon is absent.
    expect(heading.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(screen.getByTestId('panel-body')).toBeInTheDocument();
  });

  it('shows a skeleton at the default height, marks the panel busy, and withholds children while loading', () => {
    const { container } = renderPanel(
      <AnalyticsPanel title="Battery" loading>
        <div data-testid="panel-body">should be hidden</div>
      </AnalyticsPanel>,
    );

    // Title still shows — the section is never fully hidden while loading.
    expect(screen.getByRole('heading', { level: 3, name: /Battery/i })).toBeInTheDocument();

    // Skeleton block present at the 260px default.
    const skeleton = container.querySelector('.animate-pulse');
    expect(skeleton).not.toBeNull();
    expect(skeleton).toHaveStyle({ height: '260px' });

    // Panel is announced as busy for assistive tech during the fetch.
    expect(container.querySelector('[data-print-card]')).toHaveAttribute('aria-busy', 'true');

    // Children are withheld behind the loading gate.
    expect(screen.queryByTestId('panel-body')).not.toBeInTheDocument();
  });

  it('forwards a custom skeletonHeight to the loading block', () => {
    const { container } = renderPanel(
      <AnalyticsPanel title="Battery" loading skeletonHeight={120}>
        <div>hidden</div>
      </AnalyticsPanel>,
    );

    expect(container.querySelector('.animate-pulse')).toHaveStyle({ height: '120px' });
  });

  it('surfaces a retryable QueryError and wires the CTA to onRetry, withholding children', () => {
    const onRetry = vi.fn();
    renderPanel(
      <AnalyticsPanel title="Charging" error={new Error('boom')} onRetry={onRetry}>
        <div data-testid="panel-body">should be hidden</div>
      </AnalyticsPanel>,
    );

    // Plain Error → status undefined → network "Can't reach server" branch.
    expect(screen.getByText(/Can't reach server/i)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Retry CTA present and wired to the query's refetch callback.
    fireEvent.click(screen.getByRole('button', { name: /^Retry$/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    // Children withheld behind the error gate.
    expect(screen.queryByTestId('panel-body')).not.toBeInTheDocument();
  });

  it('renders the default EmptyState (never a blank panel) and withholds children when isEmpty', () => {
    renderPanel(
      <AnalyticsPanel title="Trips" isEmpty>
        <div data-testid="panel-body">should be hidden</div>
      </AnalyticsPanel>,
    );

    expect(screen.getByText('No data available')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('panel-body')).not.toBeInTheDocument();
  });

  it('surfaces a custom emptyMessage and emptyIcon while suppressing the default copy', () => {
    renderPanel(
      <AnalyticsPanel
        title="Trips"
        isEmpty
        emptyMessage="No vehicle data"
        emptyIcon={<svg data-testid="empty-icon" />}
      >
        <div>hidden</div>
      </AnalyticsPanel>,
    );

    expect(screen.getByText('No vehicle data')).toBeInTheDocument();
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
    // The default copy must NOT appear once a custom message is supplied.
    expect(screen.queryByText('No data available')).not.toBeInTheDocument();
  });

  it('applies loading ▸ error ▸ empty ▸ children precedence', () => {
    const onRetry = vi.fn();
    const { container, rerender } = renderPanel(
      <AnalyticsPanel title="P" loading error={new Error('x')} isEmpty onRetry={onRetry}>
        <div data-testid="panel-body">body</div>
      </AnalyticsPanel>,
    );

    // loading wins over error + empty + children.
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText(/Can't reach server/i)).not.toBeInTheDocument();
    expect(screen.queryByText('No data available')).not.toBeInTheDocument();
    expect(screen.queryByTestId('panel-body')).not.toBeInTheDocument();

    // error wins over empty + children when not loading.
    rerender(
      <MemoryRouter>
        <AnalyticsPanel title="P" error={new Error('x')} isEmpty onRetry={onRetry}>
          <div data-testid="panel-body">body</div>
        </AnalyticsPanel>
      </MemoryRouter>,
    );
    expect(screen.getByText(/Can't reach server/i)).toBeInTheDocument();
    expect(screen.queryByText('No data available')).not.toBeInTheDocument();
    expect(screen.queryByTestId('panel-body')).not.toBeInTheDocument();

    // empty wins over children when neither loading nor error.
    rerender(
      <MemoryRouter>
        <AnalyticsPanel title="P" isEmpty>
          <div data-testid="panel-body">body</div>
        </AnalyticsPanel>
      </MemoryRouter>,
    );
    expect(screen.getByText('No data available')).toBeInTheDocument();
    expect(screen.queryByTestId('panel-body')).not.toBeInTheDocument();

    // children render once every gate is cleared.
    rerender(
      <MemoryRouter>
        <AnalyticsPanel title="P">
          <div data-testid="panel-body">body</div>
        </AnalyticsPanel>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('panel-body')).toHaveTextContent('body');
  });

  it('merges the grid-item className onto the panel root and keeps base padding', () => {
    const { container } = renderPanel(
      <AnalyticsPanel title="P" className="md:col-span-2 test-grid-item">
        <div>body</div>
      </AnalyticsPanel>,
    );

    const panel = container.querySelector('[data-print-card]');
    expect(panel).toHaveClass('test-grid-item');
    expect(panel).toHaveClass('md:col-span-2');
    // The component's own padding survives the tailwind-merge.
    expect(panel?.className).toContain('p-4');
  });
});
