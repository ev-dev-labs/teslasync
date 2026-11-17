import type { ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { FreshnessQuery } from '@/components/data-display/FreshnessDot';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { getAppDesignAttributes } from '@/components/ui/app-designs/designs';
import { PageLayout, type PageLayoutProps } from './PageLayout';
import { Section } from './Section';
import { Grid } from '../Grid';

function renderPage(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(ui, { wrapper: ({ children }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/drives']}>{children}</MemoryRouter>
    </QueryClientProvider>
  ) });
}

function query(overrides: Partial<FreshnessQuery> = {}): FreshnessQuery {
  return {
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('PageLayout production composition', () => {
  it.each(['classic', 'v4'] as const)(
    'portals actual title, freshness and copy-link help only inside the %s PageLayout header',
    async pack => {
      const user = userEvent.setup();
      const { container, unmount } = renderPage(
        <section data-app-design-preview="" {...getAppDesignAttributes(pack)} dir="rtl" lang="ar">
          <PageLayout title="Energy flow" subtitle="Power distribution and energy analysis"
            query={[query(), query()]} copyLink>
            <Tooltip content="Retained body explanation"><Button>Body control</Button></Tooltip>
          </PageLayout>
        </section>,
      );
      const heading = screen.getByRole('heading', { name: 'Energy flow', level: 1 });
      const header = heading.closest('header')!;
      const triggers = [
        within(header).getByRole('button', { name: 'More info: Energy flow', exact: true }),
        within(header).getByRole('button', { name: /^Refresh data ·/ }),
        within(header).getByRole('button', { name: 'Copy link to this view', exact: true }),
      ];
      expect(screen.getAllByRole('tooltip')).toHaveLength(4);
      for (const trigger of triggers) {
        const tooltip = document.getElementById(trigger.getAttribute('aria-describedby')!)!;
        expect(tooltip).toHaveAttribute('role', 'tooltip');
        expect(tooltip).toHaveClass('fixed', 'opacity-0');
        expect(container).not.toContainElement(tooltip);
        const boundary = tooltip.closest('[data-app-design-portal]');
        expect(boundary?.parentElement).toBe(document.body);
        expect(boundary).toHaveAttribute('dir', 'rtl');
        expect(boundary).toHaveAttribute('lang', 'ar');
        for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) {
          expect(boundary).toHaveAttribute(name, value);
        }
        expect(tooltip).toHaveAttribute('data-app-design-owner', expect.stringContaining(`pack-${pack}`));
        const fullCopy = tooltip.textContent;
        await user.hover(trigger);
        expect(tooltip).toHaveClass('opacity-100');
        await user.unhover(trigger);
        expect(tooltip).toHaveClass('opacity-0');
        await user.tab();
        expect(trigger).toHaveFocus();
        expect(tooltip).toHaveClass('opacity-100');
        expect(tooltip.textContent).toBe(fullCopy);
        await user.keyboard('{Escape}');
        expect(trigger).toHaveFocus();
        expect(tooltip).toHaveClass('!opacity-0');
      }
      const bodyTrigger = screen.getByRole('button', { name: 'Body control' });
      const bodyTooltip = document.getElementById(bodyTrigger.getAttribute('aria-describedby')!)!;
      expect(container).toContainElement(bodyTooltip);
      expect(bodyTooltip).toHaveClass('absolute');
      expect(bodyTooltip.closest('[data-app-design-portal]')).toBeNull();
      expect(bodyTooltip).toHaveTextContent('Retained body explanation');
      unmount();
      expect(document.querySelector('[data-app-design-portal]')).toBeNull();
    },
  );

  it('marks the real reference section and grid without introducing a layout around arbitrary page children', () => {
    const { container } = renderPage(
      <PageLayout title="Drive report">
        <Section id="measured" title="Measured evidence" description="Source and period">
          <Grid cols={{ default: 1, md: 2 }} className="md:grid-cols-3">
            <div>Measured chart</div><div>Retained details</div>
          </Grid>
        </Section>
        <aside aria-label="Independent workflow">Independent workflow</aside>
      </PageLayout>,
    );
    const content = container.querySelector('[data-layout-reference]')!;
    expect(content).toHaveAttribute('data-app-part', 'page-content stack');
    const section = screen.getByRole('region', { name: 'Measured evidence' });
    expect(section).toHaveAttribute('data-app-part', 'section');
    expect(section.parentElement).toBe(content);
    expect(Array.from(content.children)).toEqual([section, screen.getByRole('complementary', { name: 'Independent workflow' })]);
    const grid = section.querySelector('[data-card-layout="grid"]');
    expect(grid).toHaveAttribute('data-app-part', 'grid');
    expect(grid).toHaveClass('md:grid-cols-3');
    expect(grid).not.toHaveClass('md:grid-cols-2');
    expect(Array.from(grid?.children ?? []).map(child => child.textContent)).toEqual(['Measured chart', 'Retained details']);
  });

  it('keeps one canonical header and all ordered content inside the full-width container', () => {
    const { container } = renderPage(
      <PageLayout title="Drive report" className="w-full print:block">
        <section data-testid="summary">Summary</section>
        <section data-testid="chart">Chart</section>
        <section data-testid="records">Records and exports</section>
      </PageLayout>,
    );
    const page = container.querySelector('[data-role="page-container"]');
    const content = container.querySelector('[data-layout-reference]');
    expect(container.querySelectorAll('[data-role="page-header"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-role="page-container"]')).toHaveLength(1);
    expect(content?.parentElement).toBe(page);
    expect(page).toHaveClass('min-w-0', 'w-full', 'print:block');
    expect(content).toHaveClass('@container', 'flex', 'w-full', 'min-w-0', 'flex-col', 'gap-6');
    for (const element of [page, content]) {
      expect(element).not.toHaveClass('mx-auto');
      expect(element?.className).not.toMatch(/\bmax-w-/);
    }
    expect(Array.from(content?.children ?? []).map((child) => child.getAttribute('data-testid')))
      .toEqual(['summary', 'chart', 'records']);
    expect(screen.getByRole('heading', { name: 'Drive report' }))
      .toHaveAttribute('data-route-focus-target', 'true');
  });

  it('retains compact help and caller-requested expanded subtitle semantics', () => {
    const { container, rerender } = renderPage(
      <PageLayout title="Drive report" subtitle="Source and period details">
        <section>Retained report</section>
      </PageLayout>,
    );
    expect(container.querySelector('[data-role="page-header"]')).toHaveClass('rounded-none');
    expect(screen.getByRole('button', { name: 'More info: Drive report' }))
      .toHaveAttribute('aria-describedby');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Source and period details');
    rerender(
      <PageLayout title="Drive report" subtitle="Source and period details" compactHeader={false}>
        <section>Retained report</section>
      </PageLayout>,
    );
    expect(container.querySelector('[data-role="page-header"]')).toHaveClass('rounded-panel');
    expect(screen.getByText('Source and period details')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'More info: Drive report' })).not.toBeInTheDocument();
    expect(screen.getByText('Retained report')).toBeInTheDocument();
  });

  it('retains every action slot, legacy utility ordering and live handlers', () => {
    const handlers = Array.from({ length: 7 }, () => vi.fn());
    const labels = ['Metadata', 'Scope', 'Legacy', 'Compare', 'Delete', 'Export', 'Save'];
    const controls = labels.map((label, index) => (
      <Button key={label} onClick={handlers[index]}>{label}</Button>
    ));
    const { container } = renderPage(
      <PageLayout title="Drive report" actionLayout="scope-first"
        metadataActions={controls[0]} contextActions={controls[1]}
        actions={controls[2]} secondaryActions={controls[3]}
        destructiveActions={controls[4]} overflowActions={controls[5]}
        primaryAction={controls[6]}>
        <section>Retained report</section>
      </PageLayout>,
    );
    const actions = screen.getByRole('group', { name: 'Actions' });
    // Scope selectors first; then one cluster: freshness/metadata and every command.
    expect(within(actions).getAllByRole('button').map((button) => button.textContent))
      .toEqual([labels[1], labels[0], ...labels.slice(2)]);
    expect(Array.from(actions.querySelectorAll('[data-action-group]'))
      .map((group) => group.getAttribute('data-action-group')))
      .toEqual(['context', 'metadata', 'secondary', 'destructive', 'overflow', 'primary']);
    labels.forEach((label, index) => {
      fireEvent.click(within(actions).getByRole('button', { name: label }));
      expect(handlers[index]).toHaveBeenCalledOnce();
    });
    expect(container.querySelector('[data-layout-reference]')).toHaveTextContent('Retained report');
  });

  it('keeps worst-query freshness while refreshing every declared source without dropping retained children', () => {
    const fresh = query();
    const failed = query({ isError: true });
    renderPage(
      <PageLayout title="Drive report" query={[fresh, failed]} busy>
        <section>Cached report</section>
      </PageLayout>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Refresh data · error/ }));
    expect(failed.refetch).toHaveBeenCalledOnce();
    expect(fresh.refetch).toHaveBeenCalledOnce();
    expect(screen.getByText('Cached report')).toBeInTheDocument();
    expect(screen.getByText('Cached report').closest('[data-role="page-container"]'))
      .toHaveAttribute('aria-busy', 'true');
  });

  it('preserves nonfatal source status and retries only unavailable sources', () => {
    const readyRefetch = vi.fn();
    const failedRefetch = vi.fn();
    renderPage(
      <PageLayout title="Drive report" dataSources={[
        { id: 'drives', label: 'Drive records', query: { data: [1], refetch: readyRefetch } },
        { id: 'energy', label: 'Energy aggregates', query: { isError: true, refetch: failedRefetch } },
      ]}>
        <section>Retained independent section</section>
      </PageLayout>,
    );
    expect(screen.getByText('Drive records')).toBeInTheDocument();
    expect(screen.getByText('Energy aggregates')).toBeInTheDocument();
    expect(screen.getByText('Retained independent section')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources' }));
    expect(failedRefetch).toHaveBeenCalledOnce();
    expect(readyRefetch).not.toHaveBeenCalled();
  });

  it.each<{ state: string; props: Pick<PageLayoutProps, 'loading' | 'error' | 'empty' | 'emptyMessage'> }>([
    { state: 'loading', props: { loading: true } },
    { state: 'fatal error', props: { error: new Error('Report could not load') } },
    { state: 'empty', props: { empty: true, emptyMessage: 'No matching drives' } },
  ])('delegates $state replacement to PageContainer while keeping header commands', ({ props }) => {
    const retry = vi.fn();
    const { container } = renderPage(
      <PageLayout title="Drive report" {...props} secondaryActions={<Button onClick={retry}>Retry</Button>}>
        <section>Not yet available report</section>
      </PageLayout>,
    );
    expect(screen.getByRole('heading', { name: 'Drive report' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-layout-reference]')).toBeNull();
    expect(screen.queryByText('Not yet available report')).not.toBeInTheDocument();
    if (props.error) {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent("Can't reach server");
      expect(alert).toHaveTextContent('Check your internet connection and try again.');
      expect(screen.queryByText('Report could not load')).not.toBeInTheDocument();
    }
    if (props.empty) expect(screen.getByText('No matching drives')).toBeInTheDocument();
    if (props.loading) expect(container.querySelector('[data-role="page-container"]'))
      .toHaveAttribute('aria-busy', 'true');
  });
});
