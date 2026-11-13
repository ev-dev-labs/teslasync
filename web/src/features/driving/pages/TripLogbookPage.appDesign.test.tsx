import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createInstance } from 'i18next';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { expectAppDesignDataMode, matchesAppDesignCss } from '@/components/feedback/appDesignCss.test-utils';
import { ThemeProvider } from '@/components/ui/ThemeProvider';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import type { Drive } from '@/types/driving';
import { makeBriefDrive as drive } from '../components/operationalbrief-n-z/drivingBrief.fixtures';
import { parseLogbookStore, type CategoryMap } from '../lib/tripLogbook';
import TripLogbookPage from './TripLogbookPage';

const h = vi.hoisted(() => ({
  drives: undefined as Drive[] | undefined,
  loading: false,
  error: null as Error | null,
  refetch: vi.fn(),
}));
const translation = createInstance();
await translation.init({ lng: 'en', resources: {}, fallbackLng: 'en' });
vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: translation.t, i18n: translation }),
}));
vi.unmock('@/hooks/useSettings');
vi.mock('@/api/hooks/useDriving', () => ({
  useDrives: () => ({
    data: h.drives, isLoading: h.loading, isPending: h.loading,
    isError: h.error != null, error: h.error, isFetching: h.loading,
    fetchStatus: h.loading ? 'fetching' : 'idle',
    dataUpdatedAt: h.drives ? 1 : 0, refetch: h.refetch,
  }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({ vehicleId: 7 }) }));
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({
    start: '2026-07-01', end: '2026-07-31',
    startInstant: '2026-07-01T00:00:00Z', endInstantExclusive: '2026-08-01T00:00:00Z',
  }),
}));
vi.mock('@/components/motion', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/motion')>(),
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const storageKey = 'teslasync:trip-logbook:v1';
function renderPage({
  categories = { 1: 'business' },
  locale = 'en-US',
  currency = '$',
  precision = 2,
  distance = 'km',
}: {
  categories?: CategoryMap;
  locale?: string;
  currency?: string;
  precision?: number;
  distance?: 'km' | 'mi';
} = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, gcTime: 0 } } });
  client.setQueryData(['settings'], {
    locale, decimal_precision: precision, currency_symbol: currency,
    unit_of_length: distance, unit_of_temp: 'C', unit_of_pressure: 'bar',
    theme: 'neon-cyan', mode: 'dark', language: 'en',
  });
  const result = render(<QueryClientProvider client={client}><ThemeProvider><MemoryRouter initialEntries={['/logbook']}>
    <TripLogbookPage />
  </MemoryRouter></ThemeProvider></QueryClientProvider>);
  act(() => {
    localStorage.setItem(storageKey, JSON.stringify({
      categories, ratesPerKm: { business: 0.5, commute: 0.2, personal: 0 },
    }));
    window.dispatchEvent(new StorageEvent('storage', { key: storageKey }));
  });
  return result;
}
function reimbursement(container: HTMLElement) {
  const metric = container.querySelector('[data-app-metric="headline"]');
  if (!metric) throw new Error('Reimbursement headline is absent');
  return metric;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.drives = [drive(1), drive(2), drive(3)];
  h.loading = false;
  h.error = null;
  translation.removeResourceBundle('en', 'translation');
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});

describe('driving-05 real logbook source-to-consumer adoption', () => {
  it('activates the headline, notice content and actual apply-action consumers in every profile, without changing source values', () => {
    const { container } = renderPage();
    const metric = reimbursement(container);
    const reading = metric.querySelector(':scope > [data-app-part="metric-reading"]')!;
    const notice = container.querySelector('[data-app-feedback-kind="notice"]')!;
    const action = within(notice as HTMLElement).getByRole('button', { name: 'Apply suggestions' });
    expect(reading).toHaveTextContent('$0.50');
    expect(metric.querySelector(':scope > [data-app-part="metric-context"]')).toHaveTextContent('reimbursable in this period');
    expect(notice.querySelector(':scope > [data-app-part="feedback-content"] > [data-app-part="feedback-message"]'))
      .toHaveTextContent('2 unclassified drives match routes you have already classified.');
    expect(notice.querySelector(':scope > [data-app-part="feedback-actions"]')).toContainElement(action);
    expect(notice.querySelector(':scope > [data-app-part="feedback-icon"]')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('[data-app-design-owner]')).toBeNull();
    const initialText = container.textContent;
    const initialStorage = localStorage.getItem(storageKey);
    container.setAttribute('data-app-design-preview', '');
    for (const pack of PACK_IDS) {
      for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) container.setAttribute(name, value);
      const release = observeAppDesignScopes(container);
      try {
        const design = APPLICATION_DESIGNS[pack];
        expectAppDesignDataMode(metric, design.data, '[data-app-metric="headline"]');
        expectAppDesignDataMode(reading, design.data, '[data-app-metric="headline"]');
        expect(matchesAppDesignCss(notice, `[data-app-feedback="${design.feedback}"]`)
          .some(match => match.declarations['border-inline-start'] || match.declarations['border-block-start'])).toBe(true);
        const actions = action.parentElement!;
        expect(matchesAppDesignCss(actions, '[data-app-feedback-kind="notice"]')
          .some(match => match.declarations['grid-column'] === '2 / -1')).toBe(true);
        expect(container.textContent).toBe(initialText);
        expect(localStorage.getItem(storageKey)).toBe(initialStorage);
      } finally { release(); }
    }
    expect(container.querySelector('[data-app-design-owner]')).toBeNull();
    fireEvent.click(action);
    expect(parseLogbookStore(localStorage.getItem(storageKey)).categories)
      .toEqual({ 1: 'business', 2: 'business', 3: 'business' });
    expect(container.querySelector('[data-app-feedback-kind="notice"]')).toBeNull();
    expect(reimbursement(container)).toHaveTextContent('$1.50');
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it.each([
    ['ready empty', [], false, null, '$0.00'],
    ['loading unavailable', undefined, true, null, '—'],
    ['failed unavailable', undefined, false, new Error('offline'), '—'],
    ['retained refresh failure', [drive(1)], false, new Error('refresh failed'), '$0.50'],
  ] as const)('keeps %s distinct in the independent total', (_name, drives, loading, error, expected) => {
    h.drives = drives == null ? undefined : [...drives];
    h.loading = loading;
    h.error = error;
    const { container } = renderPage();
    const metric = reimbursement(container);
    expect(metric.querySelector('[data-app-part="metric-value"]')).toHaveTextContent(expected);
    expect(metric.querySelector('[data-app-part="metric-context"]')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Reimbursement rate for Business' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply suggestions' })).toBeNull();
  });

  it.each([1, 3])('applies %i visible suggestions, not outside-window history, and retains the category filter and table', count => {
    h.drives = [
      drive(1), ...Array.from({ length: count }, (_, index) => drive(index + 2)),
      drive(99, 1000, { startTs: '2026-08-01T00:00:00Z' }),
    ];
    const { container } = renderPage();
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by category' }), { target: { value: 'business' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply suggestions' }));
    const saved = parseLogbookStore(localStorage.getItem(storageKey));
    expect(Object.keys(saved.categories)).toHaveLength(count + 1);
    expect(saved.categories[99]).toBeUndefined();
    expect(screen.getByRole('combobox', { name: 'Filter by category' })).toHaveValue('business');
    expect(screen.getAllByRole('combobox', { name: /Category for drive/ })).toHaveLength(count + 1);
    expect(container.querySelector('[data-app-feedback-kind="notice"]')).toBeNull();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('retains full long localized context, native currency precision and per-mile rate editing', () => {
    const period = 'Remboursement disponible pour toute la période sélectionnée, sans modifier les catégories ou les taux enregistrés';
    translation.addResource('en', 'translation', 'logbook.inPeriod', period);
    h.drives = [drive(1, 2_469_000)];
    const { container } = renderPage({ locale: 'de-DE', currency: 'CHF', precision: 3, distance: 'mi' });
    const metric = reimbursement(container);
    expect(metric.querySelector('[data-app-part="metric-value"]')).toHaveTextContent('CHF1.234,500');
    expect(metric.querySelector('[data-app-part="metric-context"]')).toHaveTextContent(period);
    const rate = screen.getByRole('spinbutton', { name: 'Reimbursement rate for Business' });
    expect(rate).toHaveValue(0.8047);
    fireEvent.change(rate, { target: { value: '1.609344' } });
    expect(parseLogbookStore(localStorage.getItem(storageKey)).ratesPerKm.business).toBeCloseTo(1);
    expect(reimbursement(container).querySelector('[data-app-part="metric-value"]')).toHaveTextContent('CHF2.469,000');
  });
});
