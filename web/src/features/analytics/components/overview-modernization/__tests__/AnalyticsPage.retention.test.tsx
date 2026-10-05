import type { ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageLayoutProps } from '@/components/layout/layout-reference';
import type { FleetAnalyticsQuery } from '../../analytics/constants';
import type { FleetAnalytics } from '@/api/types';
import AnalyticsPage from '../../../pages/AnalyticsPage';
import { fleetFixture } from './fleetFixture';

const h = vi.hoisted(() => ({
  source: undefined as FleetAnalyticsQuery | undefined,
  page: undefined as PageLayoutProps | undefined,
  children: {} as Record<string, FleetAnalyticsQuery>,
  fleetHook: vi.fn(),
  rangeHook: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: (options: unknown) => {
    h.rangeHook(options);
    return { start: '2026-03-07', end: '2026-03-10' };
  },
}));
vi.mock('@/api/hooks/useAnalytics', () => ({
  useFleetAnalytics: (options: unknown) => {
    h.fleetHook(options);
    return h.source;
  },
}));
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/layout/layout-reference', async () => {
  const actual = await vi.importActual<typeof import('@/components/layout/layout-reference')>(
    '@/components/layout/layout-reference',
  );
  return {
    ...actual,
    PageLayout: (props: PageLayoutProps) => {
      h.page = props;
      return <main>{props.children}</main>;
    },
  };
});
vi.mock('../../analytics', () => {
  const child = (name: string) => ({ query }: { query: FleetAnalyticsQuery }) => {
    h.children[name] = query;
    return <div data-testid={name}>{query.data?.total_drives ?? 'No measurements'}</div>;
  };
  return {
    HeroGauges: child('hero'),
    OverviewTab: child('overview'),
    DrivingTab: child('driving'),
    ChargingTab: child('charging'),
    BatteryTab: child('battery'),
  };
});

beforeEach(() => {
  h.source = undefined;
  h.page = undefined;
  h.children = {};
  h.fleetHook.mockClear();
  h.rangeHook.mockClear();
});
afterEach(() => vi.restoreAllMocks());

function source(initialData?: FleetAnalytics) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const observer = new QueryObserver<FleetAnalytics, Error>(client, {
    queryKey: ['analytics-page-retention'],
    initialData,
    queryFn: async () => { throw new Error('Fleet refresh failed'); },
    retry: false,
  });
  return { client, observer };
}

describe('analytics page retained-source orchestration', () => {
  it('keeps original error evidence in header/source metadata while all domains receive retained content', async () => {
    const fixture = fleetFixture();
    const { client, observer } = source(fixture);
    h.source = await observer.refetch();
    expect(h.source.isRefetchError).toBe(true);
    render(<AnalyticsPage />);

    expect(h.page?.query).toBe(h.source);
    expect(h.page?.dataSources).toEqual([{
      id: 'analytics-fleet', label: 'Fleet analytics', query: h.source,
    }]);
    expect(h.page?.loading).toBeUndefined();
    expect(h.page?.error).toBeUndefined();
    expect(h.page?.empty).toBeUndefined();
    expect(h.rangeHook).toHaveBeenCalledWith({ persistKey: 'analytics.range' });
    expect(h.fleetHook).toHaveBeenCalledWith({ start: '2026-03-07', end: '2026-03-10' });
    expect(h.children.hero.data).toBe(fixture);
    expect(h.children.hero.isError).toBe(false);

    const nav = screen.getByRole('navigation', { name: 'Analytics sections' });
    const domains = [
      ['overview', 'Overview'], ['driving', 'Driving'], ['charging', 'Charging'], ['battery', 'Battery'],
    ];
    domains.forEach(([key, label]) => {
      fireEvent.click(within(nav).getByRole('button', { name: label }));
      expect(h.children[key].data).toBe(fixture);
      expect(h.children[key].refetch).toBe(h.source?.refetch);
      expect(h.children[key].isError).toBe(false);
      expect(screen.getByTestId(key)).toHaveTextContent('42');
      expect(h.page?.query).toBe(h.source);
      expect(h.page?.dataSources?.[0].query).toBe(h.source);
    });
    expect(h.source.error?.message).toBe('Fleet refresh failed');
    expect(client.getQueryState(['analytics-page-retention'])?.status).toBe('error');
    client.clear();
  });

  it('does not turn an initial failure into success or remove the domain navigation/summary', async () => {
    const { client, observer } = source();
    h.source = await observer.refetch();
    render(<AnalyticsPage />);
    expect(h.source.isLoadingError).toBe(true);
    expect(h.children.hero).toBe(h.source);
    expect(h.children.overview).toBe(h.source);
    expect(h.page?.dataSources?.[0].query).toBe(h.source);
    expect(screen.getByRole('region', { name: 'Fleet summary metrics' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Analytics sections' })).toBeInTheDocument();
    client.clear();
  });
});
