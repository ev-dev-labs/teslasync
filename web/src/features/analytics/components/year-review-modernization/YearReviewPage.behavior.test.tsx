/**
 * AUTHORED / NOTRUN: parent executes in the serialized validation window.
 * These tests cover page orchestration, not mobile/chart/browser acceptance.
 */
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { YearReview } from '@/api/types';
import YearReviewPage from '../../pages/YearReviewPage';

const state = vi.hoisted(() => ({
  year: '2024',
  vehicleId: 7 as number | null,
  vehicleList: [{ id: 7 }],
  vehiclesLoading: false,
  data: undefined as YearReview | undefined,
  loading: false,
  isError: false,
  error: new Error('Refresh failed'),
  refetch: vi.fn(),
  navigate: vi.fn(),
  query: vi.fn(),
  metrics: {} as Record<string, Record<string, unknown>>,
  panels: {} as Record<string, Record<string, unknown>>,
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ year: state.year }),
  useNavigate: () => state.navigate,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string | Record<string, unknown>) => {
      if (typeof fallback === 'string') return fallback;
      return String(fallback?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(fallback[name]));
    },
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
  unitPrefs: { distance: 'mi', speed: 'mph', temperature: '°F', energy: 'kWh', precision: 3, locale: 'de-DE' },
}) }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '€' }) }));
vi.mock('@/hooks/useNumberFormatting', () => ({ useNumberFormatting: () => ({ fmtNumber: (n: number) => String(n) }) }));
vi.mock('@/components/ui', () => ({
  Button: ({ children, ...props }: { children: ReactNode }) => <button {...props}>{children}</button>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock('@/components/layout', () => ({
  PageLayout: ({ children, contextActions, secondaryActions, metadataActions }: {
    children: ReactNode; contextActions: ReactNode; secondaryActions: ReactNode; metadataActions: ReactNode;
  }) => <main>{contextActions}{secondaryActions}{metadataActions}{children}</main>,
  Section: ({ title, children }: { title: string; children: ReactNode }) => <section aria-label={title}>{children}</section>,
  LayoutCard: ({ title, children }: { title: string; children: ReactNode }) => <article aria-label={title}>{children}</article>,
  CardGrid: ({ items }: { items: { id: string; content: ReactNode }[] }) => <div>{items.map(item => <div key={item.id}>{item.content}</div>)}</div>,
}));
vi.mock('@/components/data-display', () => ({
  StatStrip: (props: Record<string, unknown>) => {
    state.metrics[String(props.id)] = props;
    return <div data-testid={String(props.id)}>{props.footer as ReactNode}</div>;
  },
}));
vi.mock('@/components/feedback', () => ({
  Skeleton: () => <div data-testid="skeleton" />,
  EmptyState: ({ message }: { message: string }) => <p>{message}</p>,
  AlertBanner: ({ children }: { children: ReactNode }) => <aside>{children}</aside>,
  QueryError: ({ onRetry }: { onRetry: () => void }) => <button onClick={onRetry}>Retry</button>,
}));
vi.mock('@/components/motion', () => ({ FadeIn: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
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
    YearSavings: panel('savings'), YearEnvironment: panel('environment'),
    YearPatterns: panel('patterns'), YearFunFacts: panel('facts'), YearRecap: panel('recap'),
    YearDriveRecord: (props: Record<string, unknown>) => {
      state.panels[String(props.id)] = props;
      return <div data-testid={String(props.id)} />;
    },
  };
});

// Intentional explicit fixture: no production data or backend writes.
const fixture = {
  year: 2024, vehicle: { id: 7, display_name: 'Family vehicle', model: 'Model Y' },
  total_drives: 13, total_distance_km: 14.75, total_energy_kwh: 6.125, total_charge_sessions: 3,
  gas_savings: -4.5, co2_offset_kg: 81.25, fastest_speed_kmh: 108,
  hottest_drive_temp_c: 32.5, coldest_drive_temp_c: -5,
  longest_drive: { drive_id: 42, distance_km: 12, duration_min: 59.6, efficiency_wh_km: 180,
    start_address: 'Long untruncated start', end_address: 'Long untruncated destination', date: '2024-06-01' },
  shortest_drive: null, most_efficient_drive: null, least_efficient_drive: null,
  monthly_stats: [{ month: 6, drives: 13, distance_km: 14.75, energy_kwh: 6.125 }],
  comparisons: [{ emoji: '🌍', label: 'Source comparison', value: 'Source value' }],
} as YearReview;

beforeEach(() => {
  state.year = '2024'; state.vehicleId = 7; state.vehicleList = [{ id: 7 }];
  state.vehiclesLoading = false; state.data = fixture; state.loading = false; state.isError = false;
  state.metrics = {}; state.panels = {};
  vi.clearAllMocks();
});

describe('annual orchestration preservation', () => {
  it('retains all six sections, all panels, selected vehicle and original query operands', () => {
    render(<YearReviewPage />);
    expect(state.query).toHaveBeenCalledWith(2024, '7');
    expect(document.querySelectorAll('section')).toHaveLength(6);
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
    render(<YearReviewPage />);
    const strip = state.metrics['year-review-highlights-stats'];
    expect((strip.metrics as { rawValue: unknown }[]).map(metric => metric.rawValue))
      .toEqual([14750, 13, 6125, 3, -4.5, '81.25 kg']);
    expect(strip.period).toMatchObject({ label: '2024', eventId: 'year-review:2024' });
    expect(strip.preferences).toMatchObject({ units: { distance: 'mi', precision: 3, locale: 'de-DE' },
      currency: { kind: 'symbol', value: '€' } });
    expect((state.metrics['year-review-extremes'].metrics as { rawValue: unknown }[]).map(metric => metric.rawValue))
      .toEqual([30, 32.5, -5]);
  });

  it('calendar navigation preserves vehicle_id, current-year limit and history close', () => {
    const { rerender } = render(<YearReviewPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Previous year' }));
    expect(state.navigate).toHaveBeenLastCalledWith('/year-review/2023?vehicle_id=7');
    fireEvent.click(screen.getByRole('button', { name: 'Next year' }));
    expect(state.navigate).toHaveBeenLastCalledWith('/year-review/2025?vehicle_id=7');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(state.navigate).toHaveBeenLastCalledWith(-1);
    state.year = String(new Date().getFullYear());
    rerender(<YearReviewPage />);
    expect(screen.getByRole('button', { name: 'Next year' })).toBeDisabled();
  });

  it.each(['fleet-loading', 'auto-select-pending', 'annual-loading'])('keeps card shells and suppresses a misleading empty prompt during %s', mode => {
    state.data = undefined;
    state.vehicleId = null;
    state.vehiclesLoading = mode === 'fleet-loading';
    state.loading = mode === 'annual-loading';
    render(<YearReviewPage />);
    expect(document.querySelectorAll('section')).toHaveLength(6);
    expect(document.querySelectorAll('article')).toHaveLength(9);
    expect(screen.queryByText('Select a vehicle to view its year in review')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
    expect(state.panels.monthly.loading).toBe(true);
    expect(state.panels.charging.loading).toBe(true);
  });

  it('resolved empty fleet gets recovery, no request vehicle operand, and disabled AI inputs', () => {
    state.data = undefined; state.vehicleId = null; state.vehicleList = [];
    render(<YearReviewPage />);
    expect(state.query).toHaveBeenCalledWith(2024, undefined);
    expect(screen.getAllByText('Select a vehicle to view its year in review').length).toBeGreaterThan(0);
    expect(state.panels.ai).toEqual({ vehicleId: undefined });
    expect(document.querySelectorAll('article')).toHaveLength(9);
  });

  it('initial failure exposes retry in every source shell without hiding neighbors', () => {
    state.data = undefined; state.isError = true;
    render(<YearReviewPage />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    expect(state.refetch).toHaveBeenCalled();
    expect(document.querySelectorAll('section')).toHaveLength(6);
    expect(state.panels.monthly.error).toBe(state.error);
    expect(state.panels.charging.error).toBe(state.error);
    expect(screen.getByTestId('ai')).toBeInTheDocument();
  });

  it('refresh failure retains all data/actions and signals the error rather than replacing source content', () => {
    state.isError = true;
    render(<YearReviewPage />);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(state.panels.monthly.data).toBe(fixture);
    expect(state.panels.monthly.error).toBeUndefined();
    expect(state.panels.charging.error).toBeUndefined();
    expect(state.panels.recap.data).toBe(fixture);
    expect(state.metrics['year-review-highlights-stats'].retained).toBe(true);
  });

  it('zero activity retains every section and reports the selected year', () => {
    state.data = { ...fixture, total_drives: 0, total_charge_sessions: 0 };
    render(<YearReviewPage />);
    expect(screen.getByText('No drives or charges were recorded for 2024 — try another year.')).toBeInTheDocument();
    expect(document.querySelectorAll('section')).toHaveLength(6);
    expect(state.panels.patterns.data).toBe(state.data);
  });
});
