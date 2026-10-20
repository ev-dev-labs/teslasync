import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Breadcrumbs, type BreadcrumbItem } from '../Breadcrumbs';
import { prefetchRoute } from '@/lib/routePrefetch';

vi.mock('@/lib/routePrefetch', () => ({
  prefetchRoute: vi.fn<(path: string) => void>(),
  schedulePrefetch: vi.fn<(path: string) => () => void>(() => () => {}),
}));

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

  it('preserves explicit home labels, including an empty override', () => {
    const { rerender } = render(
      <MemoryRouter>
        <Breadcrumbs items={[{ label: 'Current' }]} homeAriaLabel="Fleet home" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Fleet home' })).toHaveAttribute('href', '/');
    rerender(
      <MemoryRouter>
        <Breadcrumbs items={[{ label: 'Current' }]} homeAriaLabel="" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link')).toHaveAttribute('aria-label', '');
  });

  it('marks only the current page and hides decorative glyphs from assistive tech', () => {
    const { container } = renderItems([
      { label: 'Parent', href: '/parent' },
      { label: 'Unlinked middle' },
      { label: 'Current', href: '/ignored-current-destination' },
    ]);
    expect(screen.getByText('Current')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Current').closest('a')).toBeNull();
    expect(screen.getByText('Unlinked middle')).not.toHaveAttribute('aria-current');
    expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    container.querySelectorAll('svg').forEach((glyph) => {
      expect(glyph).toHaveAttribute('aria-hidden', 'true');
      expect(glyph).toHaveAttribute('focusable', 'false');
    });
  });

  it('keeps long labels, mobile collapse, caller classes and keyboard prefetch intent', () => {
    const longLabel = 'A very long breadcrumb destination '.repeat(12).trim();
    const items: BreadcrumbItem[] = [
      { label: 'Parent', href: '/parent' },
      { label: longLabel, href: '/middle' },
      { label: 'Current' },
    ];
    const { container } = render(
      <MemoryRouter>
        <Breadcrumbs items={items} className="gap-2" homeHref="/fleet" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('navigation')).toHaveClass('gap-2', 'overflow-x-auto');
    const middle = screen.getByRole('link', { name: longLabel });
    expect(middle).toHaveAttribute('title', longLabel);
    expect(middle).toHaveClass('hidden', 'sm:inline', 'truncate', 'max-w-breadcrumb-label');
    expect(screen.getByText('Current')).toHaveClass('truncate', 'max-w-breadcrumb-label');
    expect(screen.getByText('Current')).toHaveAttribute('title', 'Current');
    container.querySelectorAll('svg.lucide-chevron-right').forEach((chevron) => {
      expect(chevron).toHaveClass('rtl:rotate-180');
    });
    expect(container.querySelector('span[aria-hidden="true"]')).toHaveTextContent('…');
    const parent = screen.getByRole('link', { name: 'Parent' });
    expect(parent).toHaveAttribute('href', '/parent');
    parent.focus();
    expect(parent).toHaveFocus();
    expect(prefetchRoute).toHaveBeenCalledWith('/parent');
    expect(parent).toHaveClass('focus-visible:outline-2', 'motion-reduce:transition-none');
    fireEvent.mouseEnter(screen.getByRole('link', { name: 'Dashboard' }));
    expect(prefetchRoute).toHaveBeenCalledWith('/fleet');
  });
});
