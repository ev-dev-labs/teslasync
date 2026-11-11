/**
 * DeparturePanel — behaviour coverage.
 *
 * The data hook (`useDeparture`) is mocked and driven per test; shared
 * UI (Badge, Button, ListSkeleton, QueryError) is REAL so the
 * render-boundary wiring is genuinely exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { formatTime } from '@/lib/dateFormat';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';

const datePreferences = vi.hoisted(() => ({ locale: 'en-US', tz: 'UTC' }));
vi.mock('@/hooks/useSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useSettings')>();
  return { ...actual, useSettings: () => ({ ...actual.useSettings(), locale: datePreferences.locale }) };
});
vi.mock('@/lib/timezone', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/timezone')>();
  return { ...actual, useTimezone: () => datePreferences.tz };
});

// ── i18n stub ──
vi.mock('react-i18next', () => {
  const interpolate = (str: string, vars?: Record<string, unknown> | null): string => {
    if (!vars) return str;
    let s = str;
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
    }
    return s;
  };
  const t = (key: string, second?: unknown, third?: unknown): string => {
    if (typeof second === 'string') return interpolate(second, third as Record<string, unknown> | undefined);
    if (second && typeof second === 'object') {
      const bag = second as Record<string, unknown>;
      const tpl = typeof bag.defaultValue === 'string' ? bag.defaultValue : key;
      return interpolate(tpl, bag);
    }
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// ── data hook, driven per test ──
vi.mock('@/api/hooks/useJourney', () => ({
  useDeparture: vi.fn(),
}));

import { useDeparture, type JourneySession } from '@/api/hooks/useJourney';
import { DeparturePanel } from './DeparturePanel';

const mockDeparture = useDeparture as unknown as ReturnType<typeof vi.fn>;

const session: JourneySession = {
  id: 1, vehicle_id: 7, name: 'Tahoe ski trip',
  origin_name: 'Home', origin_lat: 37.4, origin_lng: -122.1,
  dest_name: 'Tahoe', dest_lat: 39.1, dest_lng: -120.0,
  status: 'planned', plan_version: 0,
  created_at: '2026-09-10T10:00:00Z', updated_at: '2026-09-10T10:00:00Z',
  started_at: null, ended_at: null,
};

const advice = {
  session_id: 1,
  recommended_at: '2026-09-14T10:00:00Z',
  charge: { soc_pct: 82, limit_pct: 90 },
  evidence: ['6 slots scored, 2 warning, 1 watch'],
  slots: [
    { depart_at: '2026-09-14T10:00:00Z', level: 'none', score: 100 },
    { depart_at: '2026-09-14T11:00:00Z', level: 'warning', score: 0 },
    { depart_at: '2026-09-14T12:00:00Z', level: 'watch', score: 50 },
  ],
};

function idle(extra = {}) {
  return {
    data: undefined, isLoading: false, isFetching: false, isError: false,
    isPending: false, fetchStatus: 'idle', dataUpdatedAt: Date.now(),
    error: null, refetch: vi.fn(), ...extra,
  };
}

function renderPanel(s: JourneySession = session) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DeparturePanel session={s} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.assign(datePreferences, { locale: 'en-US', tz: 'UTC' });
  vi.clearAllMocks();
  mockDeparture.mockReturnValue(idle({ data: advice }));
});

describe('DeparturePanel', () => {
  it('activates each native slot surface for all profiles without ranking, reordering or losing warning semantics', () => {
    const { container } = renderPanel();
    const list = screen.getByRole('list', { name: 'Departure hours' });
    const rows = [...list.children];
    const contents = rows.map(row => row.textContent);
    expect(rows.every(row => !row.hasAttribute('data-app-design-owner'))).toBe(true);
    container.setAttribute('data-app-design-preview', '');
    for (const pack of PACK_IDS) {
      for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) container.setAttribute(name, value);
      const release = observeAppDesignScopes(container);
      try {
        const sheet = postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'packs', `${pack}.css`), 'utf8'));
        for (const row of rows) {
          let consumed = false;
          sheet.walkRules(rule => {
            if (rule.selector.includes('[data-app-part~="card"]') &&
              rule.nodes.some(node => node.type === 'decl' && node.prop.startsWith('border')) &&
              row.matches(rule.selector)) consumed = true;
          });
          expect(consumed, pack).toBe(true);
          expect(row).toHaveAttribute('data-app-design-owner', expect.stringContaining(`pack-${pack}`));
        }
        expect(list).not.toHaveAttribute('data-app-list', 'ranked');
        expect(rows.map(row => row.textContent)).toEqual(contents);
        expect(rows[0]).toHaveClass('!border-emerald-500/40', '!bg-emerald-500/10');
        expect(rows[1].querySelector('[data-app-part~="badge"]')).toHaveAttribute('data-app-variant', 'danger');
        expect(rows[2].querySelector('[data-app-part~="badge"]')).toHaveAttribute('data-app-variant', 'warning');
      } finally {
        release();
      }
    }
    expect(rows.every(row => !row.hasAttribute('data-app-design-owner'))).toBe(true);
  });

  it('formats the recommendation and every slot in the selected locale and timezone', () => {
    Object.assign(datePreferences, { locale: 'de-DE', tz: 'America/Los_Angeles' });
    renderPanel();
    expect(screen.getByText(`Leave ${formatTime(advice.recommended_at, datePreferences)}`)).toBeInTheDocument();
    for (const slot of advice.slots) {
      expect(screen.getByText(formatTime(slot.depart_at, datePreferences))).toBeInTheDocument();
    }
  });

  it('asks for an origin when the session has none', () => {
    renderPanel({ ...session, origin_lat: null });
    expect(screen.getByText(/Add an origin to advise/)).toBeInTheDocument();
    expect(mockDeparture.mock.calls[0][3]).toEqual({ enabled: false });
  });

  it('recommends the calm slot with charge context and evidence', () => {
    renderPanel();
    expect(screen.getByText(/Leave /)).toBeInTheDocument();
    expect(screen.getByText('Battery 82.00% now')).toBeInTheDocument();
    expect(screen.getByText(/6 slots scored, 2 warning, 1 watch/)).toBeInTheDocument();
    const rows = [...screen.getByRole('list', { name: 'Departure hours' }).children];
    expect(rows.map(row => row.getAttribute('title'))).toEqual(advice.slots.map(slot => slot.level));
    expect(rows.map(row => row.textContent)).toEqual(advice.slots.map(slot => formatTime(slot.depart_at, datePreferences)));
    for (const row of rows) {
      expect(row).toHaveAttribute('data-app-part', 'list-row card');
      expect(row).toHaveAttribute('data-surface-variant', 'standalone');
    }
    expect(rows[0]).toHaveClass('!border-emerald-500/40', '!bg-emerald-500/10');
    expect(rows[1]).not.toHaveClass('!border-emerald-500/40');
    expect(rows[1].querySelector('[data-app-part~="badge"]')).toHaveAttribute('data-app-variant', 'danger');
    expect(rows[2].querySelector('[data-app-part~="badge"]')).toHaveAttribute('data-app-variant', 'warning');
  });

  it('re-queries when the window changes', () => {
    renderPanel();
    fireEvent.click(screen.getByText('24h'));
    const [, from, to] = mockDeparture.mock.lastCall as [number, string, string, { enabled?: boolean }];
    expect(new Date(to).getTime() - new Date(from).getTime()).toBe(24 * 3600_000);
  });

  it('warns when every hour warns', () => {
    mockDeparture.mockReturnValue(idle({
      data: { ...advice, recommended_at: null },
    }));
    renderPanel();
    expect(screen.getByText('Every hour warns — delay if you can')).toBeInTheDocument();
    for (const row of screen.getByRole('list', { name: 'Departure hours' }).children) {
      expect(row).not.toHaveClass('!bg-emerald-500/10');
    }
  });

  it('surfaces failures with a retry path', () => {
    const refetch = vi.fn();
    mockDeparture.mockReturnValue(idle({ error: new Error('meteo down'), isError: true, refetch }));
    renderPanel();
    fireEvent.click(screen.getByText('Retry'));
    expect(refetch).toHaveBeenCalled();
  });

  it('retains every hourly slot, charge context and evidence after a failed refresh', () => {
    mockDeparture.mockReturnValue(idle({
      data: advice, error: new Error('forecast refresh failed'), isError: true, isFetching: true,
    }));
    renderPanel();
    expect(screen.getByRole('heading', { name: 'When to leave' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Departure hours' }).children).toHaveLength(advice.slots.length);
    expect(screen.getByText('Battery 82.00% now')).toBeInTheDocument();
    expect(screen.getByText(/6 slots scored, 2 warning, 1 watch/)).toBeInTheDocument();
    expect(screen.getByText(/Previously loaded data remains visible/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '12h' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '48h' }));
    expect(screen.getByRole('button', { name: '48h' })).toHaveAttribute('aria-pressed', 'true');
    const [, from, to] = mockDeparture.mock.lastCall as [number, string, string];
    expect(new Date(to).getTime() - new Date(from).getTime()).toBe(48 * 3600_000);
  });

  it('preserves the forecast shell and all business horizon controls when coverage is empty', () => {
    mockDeparture.mockReturnValue(idle({ data: { ...advice, slots: [] } }));
    renderPanel();
    expect(screen.getByRole('heading', { name: 'When to leave' })).toBeInTheDocument();
    expect(screen.getByText('The forecast covers none of this window.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '24h' })).toBeEnabled();
  });
});
