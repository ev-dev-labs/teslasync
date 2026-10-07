/**
 * QuickNavWidget — behaviour + hardening coverage.
 *
 * QuickNavWidget is the dashboard-registry wrapper (its single default export)
 * that mounts the prop-less <QuickNav> shortcut grid inside a <WidgetShell>
 * with `noPadding`. It ignores every WidgetProps field (vehicleId / size /
 * config) by contract — the shortcut grid is static and vehicle-agnostic — so
 * this suite locks that contract plus the whole rendered navigation surface:
 *   - the four shortcut links and their real app routes (/drives, /charging,
 *     /analytics, /battery), asserted against App.tsx so a typo becomes a dead
 *     link the test catches;
 *   - real navigation via clicking a shortcut (MemoryRouter + Routes);
 *   - the single labelled <nav> landmark, decorative (aria-hidden) icons, and
 *     keyboard-focusable links;
 *   - the i18n key wiring (guards against the "hardcoded English" prohibition);
 *   - the `noPadding` shell contract (clipped content, never a scroll wrapper)
 *     and the deliberate absence of a title header.
 *
 * Network is never touched — the widget has no data hooks. react-i18next is
 * stubbed (repo convention) so fallbacks render deterministically and the
 * translation keys can be asserted through a shared spy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { WidgetProps } from './types';
import QuickNavWidget from './QuickNavWidget';

// ── i18n stub: record every call + return the provided fallback string. ──
const tSpy = vi.hoisted(() =>
  vi.fn((key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key)),
);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: tSpy,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

/** The four shortcuts, in DOM order — mirrors NAV_ITEMS in QuickNav.tsx. */
const SHORTCUTS = [
  { name: /drives/i, href: '/drives', label: 'Drives', desc: 'Trip history' },
  { name: /charging/i, href: '/charging', label: 'Charging', desc: 'Sessions & costs' },
  { name: /analytics/i, href: '/analytics', label: 'Analytics', desc: 'Fleet insights' },
  { name: /battery/i, href: '/battery', label: 'Battery', desc: 'Health & degradation' },
] as const;

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWidget(props: Partial<WidgetProps> = {}) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={newClient()}>
        <QuickNavWidget size={{ cols: 4, rows: 2 }} {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Mounts the widget at "/" alongside stub destination routes for click tests. */
function renderWithRoutes() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <QueryClientProvider client={newClient()}>
        <Routes>
          <Route path="/" element={<QuickNavWidget size={{ cols: 4, rows: 2 }} />} />
          <Route path="/charging" element={<div>Charging Destination</div>} />
          <Route path="/battery" element={<div>Battery Destination</div>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  tSpy.mockClear();
});

describe('QuickNavWidget — navigation surface', () => {
  it('renders exactly the four dashboard shortcut links', () => {
    renderWidget();
    expect(screen.getAllByRole('link')).toHaveLength(4);
  });

  it('points each shortcut at its real app route (dead-link guard)', () => {
    renderWidget();
    for (const s of SHORTCUTS) {
      expect(screen.getByRole('link', { name: s.name })).toHaveAttribute('href', s.href);
    }
  });

  it('shows every shortcut label alongside its description', () => {
    renderWidget();
    for (const s of SHORTCUTS) {
      expect(screen.getByText(s.label)).toBeInTheDocument();
      expect(screen.getByText(s.desc)).toBeInTheDocument();
    }
  });
});

describe('QuickNavWidget — navigation interaction', () => {
  it('navigates to /charging when the Charging shortcut is clicked', () => {
    renderWithRoutes();
    expect(screen.queryByText('Charging Destination')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: /charging/i }));

    expect(screen.getByText('Charging Destination')).toBeInTheDocument();
    // The dashboard widget is unmounted once we leave "/".
    expect(screen.queryByRole('navigation', { name: 'Quick navigation' })).not.toBeInTheDocument();
  });

  it('navigates to /battery when the Battery shortcut is clicked', () => {
    renderWithRoutes();
    fireEvent.click(screen.getByRole('link', { name: /battery/i }));
    expect(screen.getByText('Battery Destination')).toBeInTheDocument();
  });
});

describe('QuickNavWidget — accessibility', () => {
  it('exposes a single navigation landmark with an accessible label', () => {
    renderWidget();
    const nav = screen.getByRole('navigation', { name: 'Quick navigation' });
    expect(nav).toBeInTheDocument();
    expect(nav.tagName).toBe('NAV');
  });

  it('marks every shortcut icon decorative (aria-hidden), keeping the AT tree clean', () => {
    const { container } = renderWidget();
    // 4 leading category icons + 4 trailing chevrons, all aria-hidden.
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(8);
    // No icon should leak into the accessible tree as an img.
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('keeps the shortcut links keyboard-focusable', () => {
    renderWidget();
    const first = screen.getByRole('link', { name: /drives/i });
    first.focus();
    expect(first).toHaveFocus();
  });
});

describe('QuickNavWidget — i18n wiring (no hardcoded English)', () => {
  it('resolves the landmark label and each shortcut label through translation keys', () => {
    renderWidget();
    expect(tSpy).toHaveBeenCalledWith('quickNav.label', 'Quick navigation');
    expect(tSpy).toHaveBeenCalledWith('nav.drives', 'Drives');
    expect(tSpy).toHaveBeenCalledWith('nav.charging', 'Charging');
    expect(tSpy).toHaveBeenCalledWith('nav.analytics', 'Analytics');
    expect(tSpy).toHaveBeenCalledWith('nav.battery', 'Battery');
  });

  it('wires a translation key for every shortcut description', () => {
    renderWidget();
    expect(tSpy).toHaveBeenCalledWith('nav.drivesDesc', 'Trip history');
    expect(tSpy).toHaveBeenCalledWith('nav.chargingDesc', 'Sessions & costs');
    expect(tSpy).toHaveBeenCalledWith('nav.analyticsDesc', 'Fleet insights');
    expect(tSpy).toHaveBeenCalledWith('nav.batteryDesc', 'Health & degradation');
  });
});

describe('QuickNavWidget — shell + prop-agnostic contract', () => {
  it('mounts the grid in a noPadding shell (clipped, never a scroll wrapper)', () => {
    renderWidget();
    const wrapper = screen.getByRole('navigation').parentElement;
    expect(wrapper?.className).toContain('overflow-hidden');
    expect(wrapper?.className).not.toContain('overflow-auto');
  });

  it('renders no title header — the shortcut grid is self-describing', () => {
    renderWidget();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('renders the identical shortcut set even in a cramped 1×1 slot', () => {
    renderWidget({ size: { cols: 1, rows: 1 } });
    expect(screen.getAllByRole('link')).toHaveLength(4);
    expect(screen.getByRole('link', { name: /battery/i })).toHaveAttribute('href', '/battery');
  });

  it('ignores vehicleId + config (static, vehicle-agnostic shortcuts)', () => {
    const { unmount } = renderWidget({ vehicleId: 7, config: { vehicleId: 7, chartType: 'x' } });
    const hrefsA = screen.getAllByRole('link').map((l) => l.getAttribute('href'));
    unmount();

    renderWidget({ vehicleId: 999, config: { vehicleId: 999 } });
    const hrefsB = screen.getAllByRole('link').map((l) => l.getAttribute('href'));

    expect(hrefsA).toEqual(['/drives', '/charging', '/analytics', '/battery']);
    expect(hrefsB).toEqual(hrefsA);
  });
});
