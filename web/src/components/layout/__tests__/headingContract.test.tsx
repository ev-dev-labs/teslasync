/**
 * Heading + landmark contract (A11Y-09).
 *
 * `scripts/audit-landmarks.mjs` enforces this structurally across the
 * whole tree. This spec is the behavioural half: it renders the two
 * shared page shells and asserts what a screen reader would actually
 * find — one `<h1>`, focusable, carrying the route-focus marker — plus
 * the semantic level → tag mapping that keeps the heading outline
 * honest.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PageContainer } from '@/components/layout/PageContainer';
import { Heading } from '@/components/ui/Typography';
import { ROUTE_FOCUS_TARGET_ATTR } from '@/lib/routeFocus';

function renderPage(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('Heading semantics', () => {
  it.each([
    ['page', 'H1'],
    ['section', 'H2'],
    ['panel', 'H3'],
    ['sub', 'H4'],
  ] as const)('renders level="%s" as <%s>', (level, tag) => {
    render(<Heading level={level}>Title</Heading>);
    expect(screen.getByText('Title').tagName).toBe(tag);
  });

  it('defaults to a section heading, never a page heading', () => {
    // Defaulting to <h1> would let any panel silently claim to be the
    // page title and wreck the outline.
    render(<Heading>Untitled</Heading>);
    expect(screen.getByText('Untitled').tagName).toBe('H2');
  });

  it('allows an explicit tag override without changing the visual role', () => {
    render(
      <Heading level="page" as="h2">
        Selected vehicle
      </Heading>,
    );
    expect(screen.getByText('Selected vehicle').tagName).toBe('H2');
  });
});

describe('PageContainer heading contract', () => {
  it('renders exactly one level-1 heading', () => {
    renderPage(
      <PageContainer title="Drives">
        <p>body</p>
      </PageContainer>,
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('marks the page heading as the route-focus target', () => {
    renderPage(
      <PageContainer title="Drives">
        <p>body</p>
      </PageContainer>,
    );
    const h1 = screen.getByRole('heading', { level: 1, name: 'Drives' });
    expect(h1).toHaveAttribute(ROUTE_FOCUS_TARGET_ATTR, 'true');
  });

  it('makes the page heading programmatically focusable but not tabbable', () => {
    renderPage(
      <PageContainer title="Drives">
        <p>body</p>
      </PageContainer>,
    );
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveAttribute('tabindex', '-1');
    h1.focus();
    expect(document.activeElement).toBe(h1);
  });

  it('keeps the heading present while the page is loading', () => {
    // If the heading only appeared after data resolved, the route-focus
    // manager would find nothing on a slow route and drop the user at
    // <main> every time.
    renderPage(
      <PageContainer title="Drives" loading>
        <p>body</p>
      </PageContainer>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Drives' })).toBeInTheDocument();
  });

  it('keeps the heading present when the page errors', () => {
    renderPage(
      <PageContainer title="Drives" error={new Error('boom')}>
        <p>body</p>
      </PageContainer>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Drives' })).toBeInTheDocument();
  });

  it('marks the container busy for assistive tech while loading', () => {
    const { container } = renderPage(
      <PageContainer title="Drives" busy>
        <p>body</p>
      </PageContainer>,
    );
    expect(
      container.querySelector('[data-role="page-container"]'),
    ).toHaveAttribute('aria-busy', 'true');
  });
});
