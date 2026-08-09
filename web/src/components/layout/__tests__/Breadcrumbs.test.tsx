import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Breadcrumbs, type BreadcrumbItem } from '../Breadcrumbs';

const renderItems = (items: BreadcrumbItem[], homeHref?: string) =>
  render(
    <MemoryRouter>
      <Breadcrumbs items={items} homeHref={homeHref} />
    </MemoryRouter>,
  );

describe('Breadcrumbs', () => {
  it('renders Home and the current page for a single top-level item', () => {
    const { container } = renderItems([{ label: 'Drives' }]);
    expect(container.querySelector('nav')).toBeInTheDocument();
    expect(container.querySelector('a[href="/"]')).toBeInTheDocument();
    expect(screen.getByText('Drives').closest('a')).toBeNull();
  });

  it('renders nothing when items is empty', () => {
    const { container } = renderItems([]);
    expect(container.querySelector('nav')).toBeNull();
  });

  it('renders the trail with separators when given >= 2 items', () => {
    const { container } = renderItems([
      { label: 'Drives', href: '/drives' },
      { label: 'Trip to office' },
    ]);
    expect(container.querySelector('nav')).toBeInTheDocument();
    expect(screen.getByText('Drives')).toBeInTheDocument();
    expect(screen.getByText('Trip to office')).toBeInTheDocument();
    // ChevronRight is an SVG separator
    const chevrons = container.querySelectorAll('svg.lucide-chevron-right');
    expect(chevrons.length).toBeGreaterThanOrEqual(2);
  });

  it('renders the last item as plain text (not a link)', () => {
    renderItems([
      { label: 'Drives', href: '/drives' },
      { label: 'Current drive' },
    ]);
    const last = screen.getByText('Current drive');
    expect(last.tagName).not.toBe('A');
    expect(last.closest('a')).toBeNull();
  });

  it('renders intermediate items with href as links', () => {
    renderItems([
      { label: 'Drives', href: '/drives' },
      { label: 'Trip to office' },
    ]);
    const drivesLink = screen.getByText('Drives');
    expect(drivesLink.closest('a')).toHaveAttribute('href', '/drives');
  });

  it('renders an item without href as plain text even if not last', () => {
    renderItems([
      { label: 'Drives' },
      { label: 'Trip to office' },
    ]);
    const drives = screen.getByText('Drives');
    expect(drives.closest('a')).toBeNull();
  });

  it('renders a Home link defaulting to /', () => {
    const { container } = renderItems([
      { label: 'Drives', href: '/drives' },
      { label: 'Trip to office' },
    ]);
    const homeLink = container.querySelector('a[href="/"]');
    expect(homeLink).toBeInTheDocument();
  });

  it('honors the homeHref prop', () => {
    const { container } = renderItems(
      [
        { label: 'Drives', href: '/drives' },
        { label: 'Trip to office' },
      ],
      '/dashboard',
    );
    const homeLink = container.querySelector('a[href="/dashboard"]');
    expect(homeLink).toBeInTheDocument();
  });

  it('marks the breadcrumb nav landmark for assistive tech', () => {
    const { container } = renderItems([
      { label: 'Drives', href: '/drives' },
      { label: 'Trip to office' },
    ]);
    const nav = container.querySelector('nav');
    expect(nav).toHaveAttribute('aria-label', 'Breadcrumb');
  });
});
