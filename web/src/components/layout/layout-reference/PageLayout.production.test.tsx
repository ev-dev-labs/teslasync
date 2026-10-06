import type { ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { FreshnessQuery } from '@/components/data-display/DataFreshness';
import { Button } from '@/components/ui/Button';
import { PageLayout, type PageLayoutProps } from './PageLayout';

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
    expect(actions).toHaveClass('grid');
    expect(within(actions).getAllByRole('button').map((button) => button.textContent)).toEqual(labels);
    expect(Array.from(actions.querySelectorAll('[data-action-group]'))
      .map((group) => group.getAttribute('data-action-group')))
      .toEqual(['metadata', 'context', 'secondary', 'destructive', 'overflow', 'primary']);
    labels.forEach((label, index) => {
      fireEvent.click(within(actions).getByRole('button', { name: label }));
      expect(handlers[index]).toHaveBeenCalledOnce();
    });
    expect(container.querySelector('[data-layout-reference]')).toHaveTextContent('Retained report');
  });

  it('keeps worst-query freshness and refresh behavior without dropping retained children', () => {
    const fresh = query();
    const failed = query({ isError: true });
    renderPage(
      <PageLayout title="Drive report" query={[fresh, failed]} busy>
        <section>Cached report</section>
      </PageLayout>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Refresh data · Error/ }));
    expect(failed.refetch).toHaveBeenCalledOnce();
    expect(fresh.refetch).not.toHaveBeenCalled();
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
