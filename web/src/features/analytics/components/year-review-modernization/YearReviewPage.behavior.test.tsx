/**
 * AUTHORED / NOTRUN: parent executes in the serialized validation window.
 * These tests cover page orchestration, not mobile/chart/browser acceptance.
 */
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { YearReview } from '@/api/types';
import type { StatMetric } from '@/components/data-display';
import type { OperationalBriefProps } from '@/components/data-display/OperationalBrief';
import type { MetricPreferences } from '@/lib/metric-reference';
import YearReviewPage from '../../pages/YearReviewPage';

const state = vi.hoisted(() => {
  const source: { vehicleId: number | null; data: YearReview | undefined } = { vehicleId: 7, data: undefined };
  const metrics: Record<string, OperationalBriefProps> = {};
  const panels: Record<string, Record<string, unknown>> = {};
  const bridges: { metrics: readonly StatMetric[]; preferences?: MetricPreferences }[] = [];
  return {
    year: '2024',
    ...source,
    vehicleList: [{ id: 7 }],
    vehiclesLoading: false,
    loading: false,
    isError: false,
    error: new Error('Refresh failed'),
    refetch: vi.fn(),
    navigate: vi.fn(),
    query: vi.fn(),
    metrics, panels, bridges,
  };
});

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useParams: () => ({ year: state.year }),
  useNavigate: () => state.navigate,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, values?: Record<string, unknown>) => {
      const options = typeof fallback === 'string' ? values : fallback;
      const text = typeof fallback === 'string' ? fallback : String(fallback?.defaultValue ?? key);
      return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? `{{${name}}}`));
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));
vi.mock('@/api/hooks/useAnalytics', () => ({
  useYearReview: (...args: unknown[]) => {
    state.query(...args);
    return { data: state.data, isLoading: state.loading, isError: state.isError, error: state.error, refetch: state.refetch };
  },
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => ({ isLoading: state.vehiclesLoading }) }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({
  vehicleId: state.vehicleId, vehicles: state.vehicleList,
}) }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({
  unitPrefs: { distance: 'mi', speed: 'mph', temperature: '°F', pressure: 'psi',
    energy: 'kWh', duration: 'h', power: 'kW', precision: 3, locale: 'de-DE' },
}) }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '€' }) }));
vi.mock('@/hooks/useNumberFormatting', () => ({ useNumberFormatting: () => ({
  fmtNumber: (n: number) => String(n), fmtInt: (n: number) => String(Math.round(n)),
  fmtPercent: (n: number) => `${n}%`, precision: 3, locale: 'de-DE',
}) }));
vi.mock('@/components/layout', () => ({
  PageLayout: ({ children, contextActions, secondaryActions, metadataActions }: {
    children: ReactNode; contextActions: ReactNode; secondaryActions: ReactNode; metadataActions: ReactNode;
  }) => <main>{contextActions}{secondaryActions}{metadataActions}{children}</main>,
  Section: ({ title, children }: { title: string; children: ReactNode }) => <section data-year-review-section aria-label={title}>{children}</section>,
  LayoutCard: ({ title, children }: { title: string; children: ReactNode }) => <article aria-label={title}>{children}</article>,
  CardGrid: ({ items }: { items: { id: string; content: ReactNode }[] }) => <div>{items.map(item => <div key={item.id}>{item.content}</div>)}</div>,
}));
vi.mock('@/components/data-display', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/data-display')>();
  return {
    ...actual,
    OperationalBrief: (props: OperationalBriefProps) => {
      state.metrics[props.testId ?? props.title] = props;
      return <actual.OperationalBrief {...props} />;
    },
  };
});
vi.mock('@/hooks/useOperationalMetrics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useOperationalMetrics')>();
  return {
    useOperationalMetrics: (metrics: readonly StatMetric[], preferences?: MetricPreferences) => {
      state.bridges.push({ metrics, preferences });
      return actual.useOperationalMetrics(metrics, preferences);
    },
  };
});
vi.mock('@/components/feedback', () => ({
  Skeleton: () => <div data-testid="skeleton" />,
  EmptyState: ({ message }: { message: string }) => <p>{message}</p>,
  AlertBanner: ({ children }: { children: ReactNode }) => <aside>{children}</aside>,
  QueryError: ({ onRetry }: { onRetry: () => void }) => <button onClick={onRetry}>Retry</button>,
}));
vi.mock('@/components/motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/motion')>()),
  FadeIn: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/ai/AIYearReviewNarration', () => ({
  AIYearReviewNarration: (props: Record<string, unknown>) => {
    state.panels.ai = props;
    return <div data-testid="ai" />;
  },
}));
vi.mock('../year-review-modernization', () => {
  const panel = (id: string) => (props: Record<string, unknown>) => {
    state.panels[id] = props;
    return <div data-testid={id} />;
  };
  return {
    YearMonthlyActivity: panel('monthly'), YearChargingMix: panel('charging'),
    YearFunFacts: panel('facts'), YearRecap: panel('recap'),
    YearDriveRecord: (props: Record<string, unknown>) => {
      state.panels[String(props.id)] = props;
      return <div data-testid={String(props.id)} />;
    },
  };
});
vi.mock('../operationalbrief-n-z/YearSavingsBrief', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../operationalbrief-n-z/YearSavingsBrief')>();
  return {
    YearSavingsBrief: (props: Parameters<typeof actual.YearSavingsBrief>[0]) => {
      state.panels.savings = props;
      return <actual.YearSavingsBrief {...props} />;
    },
  };
});
vi.mock('../operationalbrief-n-z/YearEnvironmentBrief', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../operationalbrief-n-z/YearEnvironmentBrief')>();
  return {
    YearEnvironmentBrief: (props: Parameters<typeof actual.YearEnvironmentBrief>[0]) => {
      state.panels.environment = props;
      return <actual.YearEnvironmentBrief {...props} />;
    },
  };
});
vi.mock('../operationalbrief-n-z/YearPatternsBrief', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../operationalbrief-n-z/YearPatternsBrief')>();
  return {
    YearPatternsBrief: (props: Parameters<typeof actual.YearPatternsBrief>[0]) => {
      state.panels.patterns = props;
      return <actual.YearPatternsBrief {...props} />;
    },
  };
});

// Intentional explicit fixture: no production data or backend writes.
const fixture: YearReview = {
  year: 2024, vehicle: { id: 7, display_name: 'Family vehicle', model: 'Model Y' },
  total_drives: 13, total_distance_km: 14.75, total_energy_kwh: 6.125, total_charge_sessions: 3,
  gas_savings: -4.5, co2_offset_kg: 81.25, fastest_speed_kmh: 108,
  total_driving_minutes: 59.6, total_charging_cost: 8,
  hottest_drive_temp_c: 32.5, coldest_drive_temp_c: -5,
  longest_drive: { drive_id: 42, distance_km: 12, duration_min: 59.6, efficiency_wh_km: 180,
    start_address: 'Long untruncated start', end_address: 'Long untruncated destination', date: '2024-06-01' },
  shortest_drive: null, most_efficient_drive: null, least_efficient_drive: null,
  monthly_stats: [{ month: 6, drives: 13, distance_km: 14.75, energy_kwh: 6.125, cost: 8 }],
  most_active_day_of_week: 'Saturday', most_active_hour: 13, avg_drives_per_week: 0.25,
  avg_distance_per_drive_km: 14.75 / 13, avg_efficiency_wh_km: 180,
  supercharger_pct: 50, dc_fast_pct: 25, ac_other_pct: 25, avg_charge_start_soc: 20,
  comparisons: [{ emoji: '🌍', label: 'Source comparison', value: 'Source value' }],
};

function show() {
  return render(<MemoryRouter><YearReviewPage /></MemoryRouter>);
}

beforeEach(() => {
  state.year = '2024'; state.vehicleId = 7; state.vehicleList = [{ id: 7 }];
  state.vehiclesLoading = false; state.data = fixture; state.loading = false; state.isError = false;
  state.metrics = {}; state.panels = {}; state.bridges = [];
  vi.clearAllMocks();
});

describe('annual orchestration preservation', () => {
  it('retains all six sections, all panels, selected vehicle and original query operands', () => {
    show();
    expect(state.query).toHaveBeenCalledWith(2024, '7');
    expect(document.querySelectorAll('[data-year-review-section]')).toHaveLength(6);
    for (const id of ['monthly', 'charging', 'savings', 'environment', 'patterns', 'recap'])
      expect(state.panels[id].data).toBe(fixture);
    expect(state.panels.facts.comparisons).toBe(fixture.comparisons);
    expect(state.panels['year-review-longest'].drive).toBe(fixture.longest_drive);
    expect(state.panels['year-review-shortest'].drive).toBeNull();
    expect(state.panels['year-review-most-efficient'].drive).toBeNull();
    expect(state.panels['year-review-least-efficient'].drive).toBeNull();
    expect(state.panels.ai).toEqual({ vehicleId: 7 });
  });

  it('keeps raw SI boundary adaptations, negative savings, settings and explicit year period', () => {
    show();
    const brief = state.metrics['year-review-highlights-stats'];
    expect(brief.metrics.map(metric => metric.rawValue))
      .toEqual([14750, 13, 6125, 3, -4.5, 81.25]);
    expect(state.panels['year-review-longest'].period).toMatchObject({ label: '2024', eventId: 'year-review:2024' });
    for (const id of ['savings', 'environment', 'patterns', 'recap'])
      expect(state.panels[id].period).toMatchObject({ label: '2024', eventId: 'year-review:2024' });
    expect(brief.scope).toBe('2024');
    expect(brief.description).toContain('Observation coverage is not reported.');
    expect(state.bridges[0].preferences).toMatchObject({ units: { distance: 'mi', precision: 3, locale: 'de-DE' },
      currency: { kind: 'symbol', value: '€' } });
    expect(state.metrics['year-review-extremes'].metrics.map(metric => metric.rawValue))
      .toEqual([30, 32.5, -5]);
    expect(state.metrics['year-review-savings-brief'].metrics.map(metric => metric.rawValue)).toEqual([-4.5, 8]);
    expect(state.metrics['year-review-environment-brief'].metrics.map(metric => metric.rawValue)).toEqual([81.25]);
    expect(state.metrics['year-review-patterns-brief'].metrics.map(metric => metric.rawValue))
      .toEqual([0.25, (14.75 / 13) * 1000, 0.18]);
    const highlights = screen.getByTestId('year-review-highlights-stats');
    expect(within(highlights).getByText('81.25 kg')).toBeInTheDocument();
    expect(highlights.querySelector('[data-operational-metric="currency:4"] [data-operational-value]')).toHaveTextContent('€-4,500');
    expect(highlights.querySelector('[data-operational-metric="distance:0"] [data-operational-value]')).toHaveTextContent('9,165 mi');
    expect(highlights.querySelector('[data-operational-metric="energy:2"] [data-operational-value]')).toHaveTextContent('6,125 kWh');
  });

  it('calendar navigation preserves vehicle_id, current-year limit and history close', () => {
    const { rerender } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Previous year' }));
    expect(state.navigate).toHaveBeenLastCalledWith('/year-review/2023?vehicle_id=7');
    fireEvent.click(screen.getByRole('button', { name: 'Next year' }));
    expect(state.navigate).toHaveBeenLastCalledWith('/year-review/2025?vehicle_id=7');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(state.navigate).toHaveBeenLastCalledWith(-1);
    state.year = String(new Date().getFullYear());
    rerender(<MemoryRouter><YearReviewPage /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Next year' })).toBeDisabled();
  });

  it.each(['fleet-loading', 'auto-select-pending', 'annual-loading'])('keeps card shells and suppresses a misleading empty prompt during %s', mode => {
    state.data = undefined;
    state.vehicleId = null;
    state.vehiclesLoading = mode === 'fleet-loading';
    state.loading = mode === 'annual-loading';
    show();
    expect(document.querySelectorAll('[data-year-review-section]')).toHaveLength(6);
    expect(document.querySelectorAll('article')).toHaveLength(9);
    expect(screen.queryByText('Select a vehicle to view its year in review')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
    expect(state.panels.monthly.loading).toBe(true);
    expect(state.panels.charging.loading).toBe(true);
    for (const id of ['year-review-highlights-stats', 'year-review-extremes']) {
      expect(screen.getByTestId(id)).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByTestId(id).querySelector('[data-operational-value]')).toBeNull();
    }
  });

  it('resolved empty fleet gets recovery, no request vehicle operand, and disabled AI inputs', () => {
    state.data = undefined; state.vehicleId = null; state.vehicleList = [];
    show();
    expect(state.query).toHaveBeenCalledWith(2024, undefined);
    expect(screen.getAllByText('Select a vehicle to view its year in review').length).toBeGreaterThan(0);
    expect(state.panels.ai).toEqual({ vehicleId: undefined });
    expect(document.querySelectorAll('article')).toHaveLength(9);
  });

  it('initial failure exposes retry in every source shell without hiding neighbors', () => {
    state.data = undefined; state.isError = true;
    show();
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    expect(state.refetch).toHaveBeenCalled();
    expect(document.querySelectorAll('[data-year-review-section]')).toHaveLength(6);
    expect(state.panels.monthly.error).toBe(state.error);
    expect(state.panels.charging.error).toBe(state.error);
    expect(screen.getByTestId('ai')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-operational-metric][data-value-state="missing"]')).toHaveLength(9);
    expect(document.querySelectorAll('[data-operational-metric][data-value-state="value"]')).toHaveLength(0);
    for (const id of ['year-review-highlights-stats', 'year-review-extremes']) {
      expect(state.metrics[id].statusLabel).toBe('Year evidence unavailable');
      expect(state.metrics[id].metrics.every(metric => metric.rawValue == null)).toBe(true);
    }
  });

  it('refresh failure retains all data/actions and signals the error rather than replacing source content', () => {
    state.isError = true;
    show();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(state.panels.monthly.data).toBe(fixture);
    expect(state.panels.monthly.error).toBeUndefined();
    expect(state.panels.charging.error).toBeUndefined();
    expect(state.panels.recap.data).toBe(fixture);
    expect(state.metrics['year-review-highlights-stats'].statusLabel).toBe('Retained year evidence');
    expect(state.metrics['year-review-highlights-stats'].statusTone).toBe('warning');
    for (const id of ['savings', 'environment', 'patterns']) expect(state.panels[id].retained).toBe(true);
  });

  it('zero activity retains every section and reports the selected year', () => {
    state.data = { ...fixture, total_drives: 0, total_charge_sessions: 0 };
    show();
    expect(screen.getByText('No drives or charges were recorded for 2024 — try another year.')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-year-review-section]')).toHaveLength(6);
    expect(state.panels.patterns.data).toBe(state.data);
  });

  it('keeps genuine numeric zero distinct from unavailable measurements in every migrated annual band', () => {
    state.data = {
      ...fixture, total_drives: 0, total_charge_sessions: 0, total_distance_km: 0,
      total_energy_kwh: 0, gas_savings: 0, co2_offset_kg: 0, total_charging_cost: 0,
      fastest_speed_kmh: 0, hottest_drive_temp_c: 0, coldest_drive_temp_c: 0,
      avg_drives_per_week: 0, avg_distance_per_drive_km: 0, avg_efficiency_wh_km: 0,
    };
    show();
    expect(document.querySelectorAll('[data-operational-metric][data-value-state="value"]')).toHaveLength(15);
    expect(document.querySelectorAll('[data-operational-metric][data-value-state="missing"]')).toHaveLength(0);
    for (const brief of Object.values(state.metrics))
      expect(brief.metrics.every(metric => metric.rawValue === 0 && metric.valueState === 'value')).toBe(true);
    expect(screen.getByText('No drives or charges were recorded for 2024 — try another year.')).toBeInTheDocument();
    expect(state.panels.patterns.data).toBe(state.data);
    expect(document.querySelectorAll('[data-year-review-section]')).toHaveLength(6);
  });

  it('rejects non-finite source numbers without inventing a measured zero or discarding neighboring evidence', () => {
    state.data = { ...fixture, total_distance_km: Number.NaN, fastest_speed_kmh: Number.POSITIVE_INFINITY };
    show();
    const highlights = screen.getByTestId('year-review-highlights-stats');
    const extremes = screen.getByTestId('year-review-extremes');
    expect(highlights.querySelector('[data-operational-metric="distance:0"]')).toHaveAttribute('data-value-state', 'invalid');
    expect(highlights.querySelector('[data-operational-metric="distance:0"] [data-operational-value]')).toHaveTextContent('—');
    expect(extremes.querySelector('[data-operational-metric="speed:0"]')).toHaveAttribute('data-value-state', 'invalid');
    expect(extremes.querySelector('[data-operational-metric="speed:0"] [data-operational-value]')).toHaveTextContent('—');
    expect(state.metrics['year-review-highlights-stats'].metrics[0].rawValue).toBeNaN();
    expect(state.metrics['year-review-extremes'].metrics[0].rawValue).toBe(Number.POSITIVE_INFINITY);
    expect(state.panels.monthly.data).toBe(state.data);
    expect(document.querySelectorAll('[data-year-review-section]')).toHaveLength(6);
  });

  it.each([
    ['year-review-highlights-stats', 'Calendar-year highlights', '81.25 kg'],
    ['year-review-extremes', 'Year extremes', 'Top speed'],
    ['year-review-savings-brief', 'You saved', 'vs. driving a gas car'],
    ['year-review-environment-brief', 'CO₂ offset', 'Like planting 4 trees'],
    ['year-review-patterns-brief', 'Your driving patterns', 'drives/week'],
  ])('keeps the real %s review drawer, retained status, captions and source provenance', (id, title, detail) => {
    state.isError = true;
    show();
    const trigger = within(screen.getByTestId(id)).getByRole('button', { name: 'Review details' });
    fireEvent.click(trigger);
    const drawer = screen.getByRole('dialog', { name: `${title} details` });
    expect(within(drawer).getByText('Retained year evidence')).toBeInTheDocument();
    expect(within(drawer).getByText('Year in review')).toBeInTheDocument();
    expect(within(drawer).getByText(detail)).toBeInTheDocument();
    expect(within(drawer).getByText('Not scored')).toBeInTheDocument();
    expect(within(drawer).getByText('No confidence basis was supplied.')).toBeInTheDocument();
    expect(within(drawer).getByText('Operational metrics')).toBeInTheDocument();
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous year' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(state.panels.recap.data).toBe(fixture);
  });
});
