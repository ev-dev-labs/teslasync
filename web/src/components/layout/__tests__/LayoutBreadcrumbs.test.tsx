import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { LayoutBreadcrumbs } from '../LayoutBreadcrumbs';
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
// fallbacks ('Drives', 'Drive Detail') — the same convention the sibling
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
}

function renderCrumbs({
  url,
  pattern,
  className,
  withProvider = true,
  register,
}: RenderOpts) {
  const element = (
    <>
      {register ? <RegisterOverride map={register} /> : null}
      <LayoutBreadcrumbs className={className} />
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
    expect(screen.getByText('Ctrl+K to jump')).toBeInTheDocument();
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
    const current = screen.getByText('Drive Detail');
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
    // Override replaces the default 'Drive Detail' label for the matched key.
    expect(await screen.findByText('Trip to office')).toBeInTheDocument();
    expect(screen.queryByText('Drive Detail')).toBeNull();
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
    expect(await screen.findByText('Drive Detail')).toBeInTheDocument();
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
    expect(screen.getByText('Drive Detail')).toBeInTheDocument();
  });
});
