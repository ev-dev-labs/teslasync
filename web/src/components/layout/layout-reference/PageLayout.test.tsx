import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PageLayout, type PageLayoutProps } from './PageLayout';

const { forwardedProps } = vi.hoisted(() => ({ forwardedProps: vi.fn() }));

vi.mock('../PageContainer', () => ({
  PageContainer: (props: PageLayoutProps) => {
    forwardedProps(props);
    const { children, className, title } = props;
    return (
      <main className={className}>
        <header>{title}</header>
        {children}
      </main>
    );
  },
}));

beforeEach(() => forwardedProps.mockClear());

describe('shared page content width', () => {
  it('uses the header content boundary without capping or recentering the report', () => {
    const { container } = render(
      <PageLayout title="Drive report">
        <section data-testid="report-card">Retained report content</section>
      </PageLayout>,
    );
    const content = container.querySelector('[data-layout-reference]');
    expect(content).toHaveClass('w-full', 'min-w-0', '@container');
    expect(content).not.toHaveClass('mx-auto');
    expect(content?.className).not.toMatch(/\bmax-w-/);
    expect(content?.parentElement).toBe(screen.getByText('Drive report').parentElement);
    expect(content).toContainElement(screen.getByTestId('report-card'));
  });

  it('forwards every PageContainer option without replacing references or defaults', () => {
    const props = {
      title: 'Drive report',
      subtitle: <span>Source description</span>,
      compactHeader: false,
      actionLayout: 'scope-first',
      actions: <span>Legacy utility</span>,
      contextActions: <span>Scope</span>,
      metadataActions: <span>Period</span>,
      secondaryActions: <span>Compare</span>,
      destructiveActions: <span>Delete</span>,
      overflowActions: <span>Export</span>,
      primaryAction: <span>Save</span>,
      loading: false,
      busy: true,
      error: new Error('Refresh failed'),
      empty: false,
      emptyMessage: 'No matching results',
      breadcrumbLabels: { '/drives/:id': 'Retained trip label' },
      copyLink: true,
      query: [],
      dataSources: [],
      announce: false,
      className: 'w-full print:block',
      children: <section data-testid="retained-section">Retained section</section>,
    } satisfies Required<PageLayoutProps>;

    render(<PageLayout {...props} />);
    const received = forwardedProps.mock.lastCall?.[0] as PageLayoutProps;
    for (const key of Object.keys(props) as (keyof PageLayoutProps)[]) {
      if (key !== 'children' && key !== 'className') {
        expect(received[key], key).toBe(props[key]);
      }
    }
    expect(received.className).toBe('min-w-0 w-full print:block');
    expect(screen.getByTestId('retained-section')).toBeInTheDocument();
  });

  it('does not inject state, header or action defaults when callers omit them', () => {
    render(<PageLayout title="Drive report"><section>Retained body</section></PageLayout>);
    const received = forwardedProps.mock.lastCall?.[0] as PageLayoutProps;
    expect(Object.keys(received).sort()).toEqual(['children', 'className', 'title']);
    expect(received.className).toBe('min-w-0');
  });
});
