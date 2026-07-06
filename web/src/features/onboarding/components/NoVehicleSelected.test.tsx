/**
 * NoVehicleSelected contract.
 *
 * This defensive empty state is rendered by data pages (Battery, Drives,
 * Charging, Maps, …) whenever `useSelectedVehicle().vehicleId` is null. It
 * must:
 *   1. pass `pageTitle` straight through to the PageContainer <h1>;
 *   2. show the default localized empty-state title/message + CTA;
 *   3. let callers override the empty-state title and description
 *      independently (each guarded by its own `??` fallback);
 *   4. surface the CTA as a real navigating <a> Link to /onboarding
 *      (an accessibility win over an imperative button) — clicking it
 *      actually routes the user into the onboarding flow;
 *   5. stay screen-reader friendly: role="status" surface + an
 *      aria-hidden decorative icon.
 *
 * react-i18next is stubbed so `t(key, fallback)` returns the fallback,
 * making the asserted copy deterministic without booting the i18n runtime.
 * Navigation is exercised through a real MemoryRouter (no useNavigate mock)
 * so the <Link> is tested end-to-end via a real click.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { ComponentProps, ReactNode } from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

import { NoVehicleSelected } from './NoVehicleSelected';

type Props = ComponentProps<typeof NoVehicleSelected>;

const START_ROUTE = '/battery';

function renderPage(props: Partial<Props> = {}) {
  const merged: Props = { pageTitle: 'Battery Health', ...props };
  return render(
    <MemoryRouter initialEntries={[START_ROUTE]}>
      <Routes>
        <Route path={START_ROUTE} element={<NoVehicleSelected {...merged} />} />
        <Route
          path="/onboarding"
          element={<div data-testid="onboarding-page">Onboarding flow</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('NoVehicleSelected', () => {
  it('renders the page title, default empty-state copy, and CTA', () => {
    renderPage({ pageTitle: 'Battery Health' });

    // PageContainer renders the page title as the <h1>.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Battery Health' }),
    ).toBeInTheDocument();

    // EmptyState renders the localized default title (<h3>) + message.
    expect(
      screen.getByRole('heading', { level: 3, name: 'No vehicle selected' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Add a vehicle to your fleet to see data on this page.'),
    ).toBeInTheDocument();

    // Default CTA label.
    expect(
      screen.getByRole('link', { name: 'Set up TeslaSync' }),
    ).toBeInTheDocument();
  });

  it('passes an arbitrary pageTitle through to the page heading', () => {
    renderPage({ pageTitle: 'Drive History' });
    expect(
      screen.getByRole('heading', { level: 1, name: 'Drive History' }),
    ).toBeInTheDocument();
    // The default empty-state title still renders alongside the custom page title.
    expect(
      screen.getByRole('heading', { level: 3, name: 'No vehicle selected' }),
    ).toBeInTheDocument();
  });

  it('exposes the CTA as a Link to /onboarding (not a button)', () => {
    renderPage();
    const link = screen.getByRole('link', { name: 'Set up TeslaSync' });
    expect(link).toHaveAttribute('href', '/onboarding');
    // Pure navigation must be a link, never an imperative button.
    expect(screen.queryByRole('button', { name: 'Set up TeslaSync' })).toBeNull();
  });

  it('navigates into the onboarding flow when the CTA is activated', () => {
    renderPage();
    expect(screen.queryByTestId('onboarding-page')).toBeNull();

    fireEvent.click(screen.getByRole('link', { name: 'Set up TeslaSync' }));

    expect(screen.getByTestId('onboarding-page')).toBeInTheDocument();
    expect(screen.getByText('Onboarding flow')).toBeInTheDocument();
  });

  it('overrides the empty-state title when `title` is provided', () => {
    renderPage({ title: 'This page needs a car' });
    expect(
      screen.getByRole('heading', { level: 3, name: 'This page needs a car' }),
    ).toBeInTheDocument();
    // Default title must not leak through when overridden.
    expect(screen.queryByText('No vehicle selected')).toBeNull();
    // Description still falls back to its own default (independent `??`).
    expect(
      screen.getByText('Add a vehicle to your fleet to see data on this page.'),
    ).toBeInTheDocument();
  });

  it('overrides the empty-state description independently of the title', () => {
    renderPage({ description: 'Connect Tesla to unlock this view.' });
    expect(
      screen.getByText('Connect Tesla to unlock this view.'),
    ).toBeInTheDocument();
    // Title still uses its default when only the description is overridden.
    expect(
      screen.getByRole('heading', { level: 3, name: 'No vehicle selected' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Add a vehicle to your fleet to see data on this page.'),
    ).toBeNull();
  });

  it('applies both title and description overrides together', () => {
    renderPage({
      title: 'No motorcycle selected',
      description: 'Pick a bike first.',
    });
    expect(
      screen.getByRole('heading', { level: 3, name: 'No motorcycle selected' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Pick a bike first.')).toBeInTheDocument();
    expect(screen.queryByText('No vehicle selected')).toBeNull();
  });

  it('is screen-reader friendly: status surface + decorative aria-hidden icon', () => {
    const { container } = renderPage();
    // EmptyState marks the surface as role="status" for assistive tech.
    expect(screen.getByRole('status')).toBeInTheDocument();
    // The lucide Car glyph is purely decorative and must be hidden from AT.
    const icon = container.querySelector('svg[aria-hidden="true"]');
    expect(icon).not.toBeNull();
  });
});
