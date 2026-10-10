import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { LayoutBreadcrumbs } from '../LayoutBreadcrumbs';
import type { BreadcrumbSection } from '../sidebar/sidebarBreadcrumbs';
import type { SectionGroup } from '../sectionGroups';
import {
  BreadcrumbOverridesProvider,
  useSetBreadcrumbOverrides,
} from '../BreadcrumbOverridesContext';

// LayoutBreadcrumbs is the single canonical breadcrumb row in the global
// Layout chrome. It has no UI of its own — its whole job is wiring:
//   useBreadcrumbOverrides() (context) → useBreadcrumbs(overrides) → <Breadcrumbs>.
// So we test the real pipeline end-to-end (real provider, real hook, real
// child) driven by the router, rather than mocking the seam. i18n is left
// uninitialised in unit tests, so route labels resolve to their English
// fallbacks ('Drives', 'Drive detail') — the same convention the sibling
// Breadcrumbs.test.tsx relies on.

/** Registers a per-page override map into the surrounding provider. */
function RegisterOverride({ map }: { map: Record<string, string> }) {
  useSetBreadcrumbOverrides(map);
  return null;
}

interface RenderOpts {
  /** Concrete URL the router starts at (e.g. '/drives/4421'). */
  url: string;
  /** Route pattern so useParams() is populated (e.g. '/drives/:id'). */
  pattern: string;
  className?: string;
  /** Wrap in a BreadcrumbOverridesProvider (default true). */
  withProvider?: boolean;
  /** Optional override map to push through context before asserting. */
  register?: Record<string, string>;
  variant?: 'page' | 'workspace';
  sections?: readonly BreadcrumbSection[];
  collections?: readonly SectionGroup[];
}

function renderCrumbs({
  url,
  pattern,
  className,
  withProvider = true,
  register,
  variant,
  sections,
  collections,
}: RenderOpts) {
  const element = (
    <>
      {register ? <RegisterOverride map={register} /> : null}
      <LayoutBreadcrumbs
        className={className}
        variant={variant}
        sections={sections}
        collections={collections}
      />
    </>
  );
  const routed = (
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path={pattern} element={element} />
      </Routes>
    </MemoryRouter>
  );
  return render(
    withProvider ? <BreadcrumbOverridesProvider>{routed}</BreadcrumbOverridesProvider> : routed,
  );
}

describe('LayoutBreadcrumbs', () => {
  it('renders Home and the current page for a top-level route', () => {
    const { container } = renderCrumbs({ url: '/drives', pattern: '/drives' });
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    expect(container.querySelector('a[href="/"]')).toBeInTheDocument();
    expect(screen.getByText('Drives').closest('a')).toBeNull();
    // The Ctrl+K hint pill was removed: the shortcut is discoverable from the
    // command-palette trigger's kbd badge instead of floating over the page.
    expect(screen.queryByText('Ctrl+K to jump')).toBeNull();
  });

  it('uses compact workspace framing without duplicating the command-search hint', () => {
    const { container } = renderCrumbs({
      url: '/drives',
      pattern: '/drives',
      variant: 'workspace',
    });
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    expect(screen.queryByText('Ctrl+K to jump')).toBeNull();
    expect(container.firstElementChild).toHaveClass('min-h-5');
    expect(container.firstElementChild).not.toHaveClass('mb-5');
  });

  it('renders nothing for an unknown / chrome-less route (empty chain)', () => {
    const { container } = renderCrumbs({ url: '/does-not-exist', pattern: '/does-not-exist' });
    expect(container.querySelector('nav')).toBeNull();
    // Not even the leading Home link renders when there is no matched route.
    expect(container.querySelector('a')).toBeNull();
    expect(screen.queryByText('Ctrl+K to jump')).toBeNull();
  });

  it('resolves and renders the full parent chain for a nested route', () => {
    renderCrumbs({ url: '/drives/4421', pattern: '/drives/:id' });
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    // Intermediate crumb is a link to its route pattern's concrete href.
    expect(screen.getByText('Drives').closest('a')).toHaveAttribute('href', '/drives');
    // Trailing (current) crumb is plain text, never a link.
    const current = screen.getByText('Drive detail');
    expect(current.closest('a')).toBeNull();
  });

  it('exposes the breadcrumb landmark and a labelled home link', () => {
    renderCrumbs({ url: '/drives/4421', pattern: '/drives/:id' });
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    // The icon-only home control gets its accessible name from aria-label.
    const home = screen.getByRole('link', { name: 'Dashboard' });
    expect(home).toHaveAttribute('href', '/');
  });

  it('forwards className through to the underlying breadcrumb nav', () => {
    const { container } = renderCrumbs({
      url: '/drives/4421',
      pattern: '/drives/:id',
      className: 'custom-crumbs min-w-0',
    });
    const nav = container.querySelector('nav');
    expect(nav).not.toBeNull();
    expect(nav?.className).toContain('custom-crumbs');
  });

  it('applies per-page label overrides pushed through context', async () => {
    renderCrumbs({
      url: '/drives/4421',
      pattern: '/drives/:id',
      register: { '/drives/:id': 'Trip to office' },
    });
    // Override replaces the default 'Drive detail' label for the matched key.
    expect(await screen.findByText('Trip to office')).toBeInTheDocument();
    expect(screen.queryByText('Drive detail')).toBeNull();
    // Parent crumb is untouched by the override.
    expect(screen.getByText('Drives').closest('a')).toHaveAttribute('href', '/drives');
  });

  it('ignores overrides whose route key is not part of the chain', async () => {
    renderCrumbs({
      url: '/drives/4421',
      pattern: '/drives/:id',
      register: { '/charging/:id': 'Should not appear' },
    });
    // Non-matching key must not leak into an unrelated route's breadcrumb.
    expect(await screen.findByText('Drive detail')).toBeInTheDocument();
    expect(screen.queryByText('Should not appear')).toBeNull();
  });

  it('substitutes route params inside an override label', async () => {
    renderCrumbs({
      url: '/drives/4421',
      pattern: '/drives/:id',
      register: { '/drives/:id': 'Drive #{{id}}' },
    });
    // {{id}} is filled from useParams() (only available because the Route
    // pattern declares :id) — the raw placeholder must never render.
    expect(await screen.findByText('Drive #4421')).toBeInTheDocument();
    expect(screen.queryByText('Drive #{{id}}')).toBeNull();
  });

  it('renders the chain even without a BreadcrumbOverridesProvider (context fallback)', () => {
    renderCrumbs({ url: '/drives/4421', pattern: '/drives/:id', withProvider: false });
    // useBreadcrumbOverrides() falls back to {} with no provider, so the
    // component degrades gracefully to the un-overridden chain.
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
    expect(screen.getByText('Drive detail')).toBeInTheDocument();
  });

  it('keeps page framing shrinkable and delegates restrained presentation to Breadcrumbs', () => {
    const { container } = renderCrumbs({ url: '/drives', pattern: '/drives' });
    expect(container.firstElementChild).toHaveClass('flex', 'min-w-0', 'items-center', 'mb-5', 'min-h-8');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveClass('min-w-0', 'overflow-x-auto');
    expect(screen.getByText('Drives')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Drives')).toHaveClass('text-[var(--text-secondary)]');
  });

  it('uses the flat sidebar section trail without inserting a collection rung', () => {
    const sections: readonly BreadcrumbSection[] = [{
      title: 'Vehicles',
      titleKey: 'nav.groups.vehicles',
      items: [{ to: '/drives', label: 'Drives', labelKey: 'nav.items.drives' }],
    }];
    const collections: readonly SectionGroup[] = [{
      primary: '/drives',
      label: 'Travel collection',
      labelKey: 'test.travelCollection',
      pages: [{ to: '/drives', label: 'Drives', labelKey: 'nav.items.drives' }],
    }];
    renderCrumbs({ url: '/drives', pattern: '/drives', sections, collections });
    expect(screen.getByText('Vehicles').closest('a')).toBeNull();
    expect(screen.getByText('Drives')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('Travel collection')).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('preserves nested sidebar links, detail overrides and native keyboard order', async () => {
    const user = userEvent.setup();
    renderCrumbs({
      url: '/drives/4421?vehicle_id=7&from=2026-10-01#details',
      pattern: '/drives/:id',
      variant: 'workspace',
      register: { '/drives/:id': 'Trip #{{id}}' },
      sections: [{
        title: 'Vehicles',
        items: [{ to: '/drives', label: 'Drives', labelKey: 'nav.items.drives' }],
      }],
      collections: [],
    });
    const current = await screen.findByText('Trip #4421');
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current).toHaveAttribute('title', 'Trip #4421');
    expect(current.closest('a')).toBeNull();
    expect(screen.getByText('Vehicles').closest('a')).toBeNull();
    const home = screen.getByRole('link', { name: 'Dashboard' });
    const drives = screen.getByRole('link', { name: 'Drives' });
    expect(home).toHaveAttribute('href', '/');
    expect(drives).toHaveAttribute('href', '/drives');
    await user.tab();
    expect(home).toHaveFocus();
    await user.tab();
    expect(drives).toHaveFocus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(home).toHaveFocus();
  });

  it('omits the Home section rung while retaining the accessible dashboard link', () => {
    renderCrumbs({
      url: '/drives',
      pattern: '/drives',
      sections: [{
        title: 'Home',
        items: [{ to: '/drives', label: 'Drives', labelKey: 'nav.items.drives' }],
      }],
      collections: [],
    });
    expect(screen.queryByText('Home')).toBeNull();
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/');
    expect(screen.getByText('Drives')).toHaveAttribute('aria-current', 'page');
  });

  it('retains the route chain when only sections are provided', () => {
    renderCrumbs({
      url: '/drives/4421',
      pattern: '/drives/:id',
      sections: [{
        title: 'Vehicles',
        items: [{ to: '/drives', label: 'Drives', labelKey: 'nav.items.drives' }],
      }],
    });
    expect(screen.queryByText('Vehicles')).toBeNull();
    expect(screen.getByRole('link', { name: 'Drives' })).toHaveAttribute('href', '/drives');
    expect(screen.getByText('Drive detail')).toHaveAttribute('aria-current', 'page');
  });

  it('retains the route chain when only collections are provided', () => {
    renderCrumbs({
      url: '/drives/4421',
      pattern: '/drives/:id',
      collections: [{
        primary: '/drives',
        label: 'Travel collection',
        labelKey: 'test.travelCollection',
        pages: [{ to: '/drives', label: 'Drives', labelKey: 'nav.items.drives' }],
      }],
    });
    expect(screen.queryByText('Travel collection')).toBeNull();
    expect(screen.getByRole('link', { name: 'Drives' })).toHaveAttribute('href', '/drives');
    expect(screen.getByText('Drive detail')).toHaveAttribute('aria-current', 'page');
  });

  it('preserves the complete long RTL override through truncation and title access', async () => {
    const label = 'رحلة طويلة إلى المكتب — '.repeat(20);
    const { container } = renderCrumbs({
      url: '/drives/4421',
      pattern: '/drives/:id',
      register: { '/drives/:id': label },
      className: 'custom-crumbs',
    });
    container.setAttribute('dir', 'rtl');
    const current = await screen.findByText(label.trim());
    expect(current.textContent).toBe(label);
    expect(current).toHaveAttribute('title', label);
    expect(current).toHaveClass('truncate', 'max-w-breadcrumb-label');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveClass('custom-crumbs');
    expect(container.querySelector('.rtl\\:rotate-180')).toBeInTheDocument();
  });
});
