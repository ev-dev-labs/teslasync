import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PageContainer } from '../PageContainer';
import { PageHeader } from '../PageHeader';
import { Button } from '@/components/ui';
import type { FreshnessQuery } from '@/components/data-display';

// Mock react-i18next so PageContainer + DataFreshnessAuto get fallback strings
// without booting the full i18n runtime.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (out, [k, v]) => out.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// Stub framer-motion's useReducedMotion via the same pattern used in
// `useMotionPreference.test.ts` so DataFreshness can hit the motion-allowed
// path without touching window.matchMedia.
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
}));

vi.mock('@/components/motion/FadeIn', () => ({
  FadeIn: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function makeQuery(overrides: Partial<FreshnessQuery> = {}): FreshnessQuery {
  return {
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now() - 1000,
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as FreshnessQuery;
}

function renderWith(ui: React.ReactNode, route = '/drives') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PageContainer', () => {
  it('preserves product names and acronyms in the default empty message', () => {
    renderWith(<PageContainer title="Tesla API" empty />);
    expect(screen.getByText('No Tesla API found.')).toBeInTheDocument();
  });

  it('renders the page title', () => {
    const { container } = renderWith(
      <PageContainer title="Drives">
        <div>body</div>
      </PageContainer>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Drives' })).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
    expect(container.querySelector('[data-role="page-header"]')).toHaveClass(
      'rounded-none',
      'bg-transparent',
      'border-0',
      'shadow-none',
    );
    expect(container.querySelector('[data-role="page-header"] span[aria-hidden="true"]')).toHaveClass(
      'w-1',
      'bg-[var(--theme-primary)]',
    );
  });

  it('defaults all pages to a compact header while retaining accessible descriptions', () => {
    const { container } = renderWith(
      <PageContainer title="Drive history" subtitle="Measured energy intensity and route evidence">
        <div>body</div>
      </PageContainer>,
    );
    const header = container.querySelector('[data-role="page-header"]');
    expect(header).toHaveClass('py-1', 'overflow-visible', 'bg-transparent', 'border-0', 'shadow-none');
    expect(container.querySelector('[data-role="page-container"]')).toHaveClass('space-y-3');
    const trigger = screen.getByRole('button', { name: 'More info: Drive history' });
    expect(trigger).toHaveAttribute('aria-describedby');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Measured energy intensity and route evidence');
    expect(header?.querySelector('p')).toBeNull();
  });

  it('preserves an explicitly requested expanded header and visible description', () => {
    const { container } = renderWith(
      <PageContainer title="Setup" subtitle="Required setup instructions" compactHeader={false}>
        <div>body</div>
      </PageContainer>,
    );
    expect(container.querySelector('[data-role="page-header"]')).toHaveClass('rounded-panel', 'shadow-e1');
    expect(screen.getByText('Required setup instructions')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'More info: Setup' })).not.toBeInTheDocument();
  });

  it('applies the same compact defaults to standalone page headers without losing actions', () => {
    const { container } = renderWith(
      <PageHeader
        title="Telemetry"
        subtitle="Live signal readings"
        actions={<Button>Export</Button>}
      />,
    );
    expect(container.querySelector('[data-role="page-header"]')).toHaveClass(
      'bg-transparent', 'border-0', 'shadow-none', 'py-1',
    );
    expect(screen.getByRole('heading', { name: 'Telemetry' })).toHaveAttribute('data-route-focus-target', 'true');
    expect(screen.getByRole('button', { name: 'Export' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'More info: Telemetry' })).toHaveAttribute('aria-describedby');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Live signal readings');
    expect(container.querySelector('[data-role="page-actions"]')).toHaveClass('bg-transparent', 'border-0', 'p-0');
  });

  // ── page-tier DataFreshnessAuto wiring ───────

  it('mounts <DataFreshnessAuto> in the header when a query prop is provided', () => {
    const query = makeQuery();
    const { container } = renderWith(
      <PageContainer title="Drives" query={query}>
        <div>body</div>
      </PageContainer>,
    );
    // The chip's status dot uses bg-emerald-400 for the fresh state, which
    // is unique enough to confirm DataFreshnessAuto rendered. We also check
    // The shared Button keeps refresh keyboard-operable because refetchable
    // defaults to true.
    expect(container.querySelector('.bg-emerald-400')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refresh data/ })).toBeInTheDocument();
  });

  it('does not render <DataFreshnessAuto> when query is omitted', () => {
    const { container } = renderWith(
      <PageContainer title="Drives">
        <div>body</div>
      </PageContainer>,
    );
    // No DataFreshnessAuto means no freshness-tier dot colors AND no refresh
    // button hidden inside the header chrome.
    expect(container.querySelector('.bg-emerald-400')).toBeNull();
    expect(container.querySelector('.bg-sky-400')).toBeNull();
    expect(container.querySelector('.bg-amber-400')).toBeNull();
    expect(container.querySelector('.bg-red-400')).toBeNull();
  });

  it('renders custom actions alongside the freshness chip', () => {
    const { container } = renderWith(
      <PageContainer
        title="Drives"
        query={makeQuery()}
        copyLink
        actions={<button type="button">Custom action</button>}
      >
        <div>body</div>
      </PageContainer>,
    );
    const legacyAction = screen.getByRole('button', { name: 'Custom action' });
    const copyAction = screen.getByRole('button', { name: /copy link to this view/i });
    expect(legacyAction.closest('[data-action-group]')).toHaveAttribute('data-action-group', 'secondary');
    expect(copyAction.closest('[data-action-group]')).toHaveAttribute('data-action-group', 'overflow');
    expect(container.querySelector('[data-action-group="metadata"]')).toBeInTheDocument();
  });

  it('places typed controls and commands in predictable action groups', () => {
    const { container } = renderWith(
      <PageContainer
        title="Fleet"
        contextActions={<button type="button">Vehicle</button>}
        secondaryActions={<button type="button">Compare</button>}
        destructiveActions={<button type="button">Remove</button>}
        overflowActions={<button type="button">More</button>}
        primaryAction={<button type="button">Sync</button>}
      >
        <div>body</div>
      </PageContainer>,
    );

    expect(
      Array.from(container.querySelectorAll('[data-action-group]'))
        .map((group) => group.getAttribute('data-action-group')),
    ).toEqual(['context', 'secondary', 'destructive', 'overflow', 'primary']);
  });

  it('announces progressive background loading without replacing page content', () => {
    const { container } = renderWith(
      <PageContainer title="Alerts" busy>
        <div>progressive content</div>
      </PageContainer>,
    );

    expect(container.querySelector('[data-role="page-container"]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('progressive content')).toBeInTheDocument();
  });

  it('shows the most-degraded query state when an array of queries is passed', () => {
    // Mix one fresh, one stale, one fetching — the chip should reflect stale.
    const queries: FreshnessQuery[] = [
      makeQuery({ isStale: false, isFetching: false }),
      makeQuery({ isFetching: true, dataUpdatedAt: Date.now() - 30_000 }),
      makeQuery({ isStale: true }),
    ];
    const { container } = renderWith(
      <PageContainer title="Drives" query={queries}>
        <div>body</div>
      </PageContainer>,
    );
    // amber-400 is stale; takes priority over fetching (sky) and fresh (emerald).
    expect(container.querySelector('.bg-amber-400')).toBeInTheDocument();
    expect(container.querySelector('.bg-sky-400')).toBeNull();
    expect(container.querySelector('.bg-emerald-400')).toBeNull();
  });

  it('escalates to error state when any query in the array errors out', () => {
    const queries: FreshnessQuery[] = [
      makeQuery({ isStale: true }),
      makeQuery({ isError: true }),
    ];
    const { container } = renderWith(
      <PageContainer title="Drives" query={queries}>
        <div>body</div>
      </PageContainer>,
    );
    // Error wins over stale.
    expect(container.querySelector('.bg-red-400')).toBeInTheDocument();
    expect(container.querySelector('.bg-amber-400')).toBeNull();
  });

  it('keeps page content visible while identifying an unavailable named source', () => {
    const ready = {
      ...makeQuery(),
      data: [{ id: 1 }],
      isSuccess: true,
    };
    const failed = {
      ...makeQuery({ isError: true }),
      data: undefined,
      isSuccess: false,
    };

    renderWith(
      <PageContainer
        title="Energy"
        query={[ready, failed]}
        dataSources={[
          { id: 'drives', label: 'Drive history', query: ready },
          { id: 'charging', label: 'Charging history', query: failed },
        ]}
      >
        <div>Available drive content</div>
      </PageContainer>,
    );

    expect(screen.getByText('Partial data')).toBeInTheDocument();
    expect(screen.getByText('Charging history')).toBeInTheDocument();
    expect(screen.getByText('Available drive content')).toBeInTheDocument();
  });

  it('treats an empty queries array as no query', () => {
    const { container } = renderWith(
      <PageContainer title="Drives" query={[]}>
        <div>body</div>
      </PageContainer>,
    );
    expect(container.querySelector('.bg-emerald-400')).toBeNull();
    expect(container.querySelector('.bg-sky-400')).toBeNull();
  });

  it('renders a layout skeleton instead of children when loading=true', () => {
    renderWith(
      <PageContainer title="Drives" loading>
        <div data-testid="hidden-body">body</div>
      </PageContainer>,
    );
    expect(screen.queryByTestId('hidden-body')).toBeNull();
    expect(screen.getByTestId('page-load-skeleton')).toBeInTheDocument();
  });

  it('renders the error banner when error is provided', () => {
    renderWith(
      <PageContainer title="Drives" error={new Error('Boom')}>
        <div data-testid="hidden-body">body</div>
      </PageContainer>,
    );
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByTestId('hidden-body')).toBeNull();
  });
});
