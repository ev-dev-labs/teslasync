import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PhysicsInvestigationNav } from './PhysicsInvestigationNav';
import { features } from './PhysicsPageShell';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key }),
}));

function Navigation() {
  const { pathname } = useLocation();
  const activeSlug = features.find(feature => pathname.endsWith(`/${feature.slug}`))?.slug;
  return <PhysicsInvestigationNav activeSlug={activeSlug} t={(_key, fallback) => fallback} />;
}

describe('PhysicsInvestigationNav native link controls', () => {
  it('activates deliberate control and selected navigation consumers across profiles without taking ownership when off', () => {
    const controls: string[] = [];
    postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'controls.css'), 'utf8'))
      .walkRules(rule => {
        controls.push(...rule.selectors.filter(selector =>
          selector.includes('[data-app-part~="button"]') && selector.includes('[data-app-controls=') &&
          selector.includes('data-app-design-owner')));
      });
    const activeNavigation: string[] = [];
    postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'base.css'), 'utf8'))
      .walkRules(rule => {
        activeNavigation.push(...rule.selectors.filter(selector =>
          selector.includes('[data-app-part~="nav-item"][aria-current="page"]') && selector.includes('data-app-design-owner')));
      });
    const view = render(<MemoryRouter initialEntries={['/tesla-physics/meters']}>
      <section data-app-design-preview><Navigation /></section>
    </MemoryRouter>);
    const host = view.container.querySelector('[data-app-design-preview]')!;
    const links = [...host.querySelectorAll('a[data-app-variant="outline"]')];
    const content = host.textContent;
    const release = observeAppDesignScopes(host);
    try {
      expect(links.every(link => !link.hasAttribute('data-app-design-owner'))).toBe(true);
      for (const pack of Object.keys(APPLICATION_DESIGNS) as Array<keyof typeof APPLICATION_DESIGNS>) {
        for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) host.setAttribute(name, value);
        const refresh = observeAppDesignScopes(host);
        try {
          const selectors = controls.filter(selector => selector.includes(`[data-app-controls="${APPLICATION_DESIGNS[pack].controls}"]`));
          expect(links.every(link => selectors.some(selector => link.matches(selector)))).toBe(true);
          expect(activeNavigation.some(selector => screen.getByRole('link', { name: 'Trip-meter genealogy' }).matches(selector))).toBe(true);
          expect(host.textContent).toBe(content);
        } finally { refresh(); }
      }
      for (const name of Object.keys(getAppDesignAttributes('classic'))) host.removeAttribute(name);
      const refresh = observeAppDesignScopes(host);
      try {
        expect(links.every(link => controls.every(selector => !link.matches(selector)))).toBe(true);
      } finally { refresh(); }
    } finally { release(); }
  });

  it('keeps all fifteen desktop destinations, active state and hub action on actual anchors', () => {
    const view = render(<MemoryRouter initialEntries={['/tesla-physics/meters']}>
      <Routes><Route path="/tesla-physics/*" element={<Navigation />} /></Routes>
    </MemoryRouter>);
    for (const feature of features) {
      const link = screen.getByRole('link', { name: feature.title });
      expect(link).toHaveAttribute('href', `/tesla-physics/${feature.slug}`);
      expect(link).toHaveAttribute('data-app-part', 'button nav-item');
      expect(link).toHaveAttribute('data-app-variant', 'outline');
    }
    expect(screen.getByRole('link', { name: 'Trip-meter genealogy' })).toHaveAttribute('aria-current', 'page');
    const next = screen.getByRole('link', { name: 'Range disagreement' });
    next.focus();
    expect(next).toHaveFocus();
    fireEvent.click(next);
    expect(next).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Trip-meter genealogy' })).not.toHaveAttribute('aria-current');
    fireEvent.click(screen.getByRole('link', { name: 'Start here' }));
    expect(screen.getByRole('link', { name: 'Start here' })).toHaveAttribute('aria-current', 'page');
    expect(view.container.querySelector('[data-app-part="navigation"]')).toHaveClass('hidden', 'sm:grid');
    expect(screen.getByRole('link', { name: /Physics ledger/ })).not.toHaveAttribute('data-app-part');
    expect(screen.getByRole('link', { name: /Science lab/ })).not.toHaveAttribute('data-app-part');
  });

  it('keeps the existing mobile chooser navigation instead of replacing its engine', () => {
    render(<MemoryRouter initialEntries={['/tesla-physics']}><Navigation /></MemoryRouter>);
    fireEvent.change(screen.getByRole('combobox', { name: 'Choose investigation' }), { target: { value: 'unknown' } });
    expect(screen.getByRole('link', { name: 'Unknown OS' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('Unknown OS', { selector: 'p' })).toBeVisible();
  });
});
