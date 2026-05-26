/**
 * ExplorePage tests — renders without error, filters via the search box,
 * shows the empty state on no matches, and navigates on card click.
 *
 * We do not exercise the full Layout (which renders the sidebar / banners
 * / etc.) — we mount ExplorePage directly with a MemoryRouter for speed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ExplorePage from '../pages/ExplorePage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOpts?: unknown, opts?: Record<string, unknown>) => {
      const fallback = typeof fallbackOrOpts === 'string' ? fallbackOrOpts : '';
      const params = typeof fallbackOrOpts === 'object' ? (fallbackOrOpts as Record<string, unknown>) : opts;
      if (!params) return fallback;
      return fallback.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(params[k] ?? ''));
    },
  }),
}));

// Auth + vehicle hooks default to "no special gating" so all rows show.
vi.mock('@/api/hooks/useAuthMode', () => ({
  useIsForwardAuth: () => true,
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: [{ id: 1 }, { id: 2 }] }),
}));

// usePageTitle is a no-op side effect — stub to silence.
vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: () => {},
}));

function renderPage(initial = '/explore') {
  let lastLocation = '';
  function LocationProbe() {
    lastLocation = useLocation().pathname;
    return null;
  }
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <ExplorePage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, getLastLocation: () => lastLocation };
}

afterEach(() => cleanup());

describe('ExplorePage', () => {
  beforeEach(() => {
    // jsdom doesn't lay out, so `scrollIntoView` is a no-op stub.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('renders the page title + search input', () => {
    renderPage();
    expect(screen.getByText('Explore features')).toBeInTheDocument();
    expect(screen.getByTestId('explore-search')).toBeInTheDocument();
  });

  it('renders at least one section band', () => {
    const { container } = renderPage();
    // Home is always rendered for everyone.
    expect(container.querySelector('[data-testid="explore-section-home"]')).toBeInTheDocument();
  });

  it('renders feature cards with their description text', () => {
    renderPage();
    // The Dashboard card is on every account.
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    // And its description is visible.
    expect(
      screen.getByText(/Your daily summary/i),
    ).toBeInTheDocument();
  });

  it('filters cards via the search input and reflects the query in the URL', () => {
    const { getLastLocation } = renderPage();
    const input = screen.getByTestId('explore-search') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'supercharger' } });
    // Result count subtitle reflects filter.
    expect(screen.getByText(/match "supercharger"/i)).toBeInTheDocument();
    // Charging card still visible (description mentions Supercharger).
    expect(screen.getByText('Charging Overview')).toBeInTheDocument();
    // An unrelated card is gone.
    expect(screen.queryByText('Weekly Digest')).toBeNull();
    expect(getLastLocation()).toBe('/explore');
  });

  it('shows an empty state when nothing matches and clears with the button', () => {
    renderPage('/explore?q=zzznotarealthing');
    expect(screen.getByText(/No features match/i)).toBeInTheDocument();
    const clear = screen.getByRole('button', { name: /clear filter/i });
    fireEvent.click(clear);
    // After clearing, an actual card returns.
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('navigates when a card is clicked (default-left-click, no modifier)', () => {
    const { getLastLocation } = renderPage();
    const card = screen.getByText('Dashboard').closest('a')!;
    fireEvent.click(card);
    expect(getLastLocation()).toBe('/');
  });

  it('does NOT navigate on cmd/ctrl-click (lets browser handle new tab)', () => {
    const { getLastLocation } = renderPage();
    const card = screen.getByText('Dashboard').closest('a')!;
    fireEvent.click(card, { metaKey: true });
    expect(getLastLocation()).toBe('/explore');
  });

  it('focuses the search input when "/" is pressed outside an editable element', () => {
    renderPage();
    const input = screen.getByTestId('explore-search') as HTMLInputElement;
    act(() => {
      fireEvent.keyDown(document, { key: '/' });
    });
    expect(document.activeElement).toBe(input);
  });
});
