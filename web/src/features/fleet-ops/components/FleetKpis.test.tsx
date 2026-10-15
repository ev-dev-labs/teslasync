import { fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { deriveDataState } from '@/api/dataState';
import { formatDateTime } from '@/lib/dateFormat';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { FleetKpis } from './FleetKpis';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (_key: string, fallback: string, values?: Record<string, string | number>) =>
      Object.entries(values ?? {}).reduce(
        (text, [key, value]) => text.replace(`{{${key}}}`, String(value)),
        fallback,
      ),
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'km', energy: 'kWh', power: 'kW', speed: 'km/h',
      temperature: 'C', pressure: 'kPa', duration: 'min', precision: 1, locale: 'en-US',
    },
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));

type Props = ComponentProps<typeof FleetKpis>;
const receivedAt = Date.parse('2026-10-06T22:00:00Z');
const loaded = () => deriveDataState({ data: {}, dataUpdatedAt: receivedAt });
const listCoverage = { total: 1, limit: 100, offset: 0 };

function props(): Props {
  const forecast: Props['forecast'] = [{
    vehicle_id: 7, vehicle_display_name: 'Pool vehicle',
    forecast_date: '2026-10-07T00:00:00Z',
    available_s: 36000, reserved_s: 7200, maintenance_downtime_s: 0,
    historical_expected_s: 3600, expected_utilization_pct: 20.3,
    lower_utilization_pct: 10, upper_utilization_pct: 35,
  }];
  return {
    reservations: [{
      id: 3, vehicle_id: 7, vehicle_display_name: 'Pool vehicle',
      driver_id: null, driver_display_name: null, cost_center_id: null, cost_center_name: null,
      title: 'Airport run', purpose: null, starts_at: '2026-10-07T10:00:00Z',
      ends_at: '2026-10-07T11:00:00Z', status: 'confirmed', version: 1,
      created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    }],
    assignments: [{
      id: 1, vehicle_id: 7, vehicle_display_name: 'Pool vehicle',
      driver_id: 2, driver_display_name: 'Driver', starts_at: '2026-10-01T00:00:00Z',
      ends_at: null, notes: null, version: 1,
      created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    }],
    workOrders: [{
      id: 6, vehicle_id: 7, vehicle_display_name: 'Pool vehicle',
      cost_center_id: null, cost_center_name: null, title: 'Rotate tires', description: null,
      status: 'scheduled', severity: 'high', due_odometer_m: null, due_at: null,
      scheduled_start_at: null, scheduled_end_at: null, cost_minor: null, currency: null,
      version: 1, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    }],
    forecast,
    forecastSource: {
      from: '2026-10-06T00:00:00Z', to: '2026-10-20T00:00:00Z',
      generated_at: '2026-10-06T21:00:00Z', quality: 'fair',
      history_drive_count: 20, history_day_count: 12,
      limitations: ['Returned forecast limitation.'], points: forecast,
    },
    loading: false,
    availability: { reservations: true, assignments: true, workOrders: true, forecast: true },
    sources: { reservations: loaded(), assignments: loaded(), workOrders: loaded(), forecast: loaded() },
    coverage: { reservations: listCoverage, assignments: listCoverage, workOrders: listCoverage },
  };
}

function renderSummary(input: Props) {
  return render(<MemoryRouter><FleetKpis {...input} /></MemoryRouter>);
}

function metric(key: string): HTMLElement {
  const node = screen.getByTestId('fleet-operations-summary')
    .querySelector<HTMLElement>(`[data-operational-metric="${key}"]`);
  if (!node) throw new Error(`Missing fleet metric: ${key}`);
  return node;
}

describe('FleetKpis real OperationalBrief and raw metric bridge', () => {
  it('keeps numerical raw values, missing values and invalid values distinct through the actual bridge', () => {
    const metrics: readonly StatMetric[] = [
      { metricId: 'count', occurrenceId: 'reservations', rawValue: 0, label: 'Active reservations' },
      { metricId: 'percent', occurrenceId: 'forecast', rawValue: 20.3, label: 'Forecast utilization' },
      { metricId: 'count', occurrenceId: 'assignments', rawValue: null, label: 'Assigned vehicles' },
      { metricId: 'percent', occurrenceId: 'invalid', rawValue: Number.NaN, label: 'Invalid forecast' },
    ];
    const { result } = renderHook(() => useOperationalMetrics(metrics));
    expect(result.current[0]).toMatchObject({ key: 'reservations', rawValue: 0, valueState: 'value', value: '0' });
    expect(result.current[1]).toMatchObject({ key: 'forecast', rawValue: 20.3, valueState: 'value', value: '20.3%' });
    expect(result.current[2]).toMatchObject({ key: 'assignments', rawValue: null, valueState: 'missing', value: '—' });
    expect(result.current[3]?.rawValue).toBeNaN();
    expect(result.current[3]).toMatchObject({ valueState: 'invalid', value: '—' });
  });

  it('preserves all original count operands, percent precision and independent source context', () => {
    const input = props();
    const original = JSON.stringify(input);
    renderSummary(input);
    const brief = screen.getByTestId('fleet-operations-summary');
    expect(brief).toHaveAttribute('data-operational-brief');
    expect(brief).not.toHaveAttribute('aria-busy');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    for (const key of ['reservations', 'assignments', 'work-orders']) {
      expect(metric(key)).toHaveAttribute('data-value-state', 'value');
      expect(metric(key).querySelector('[data-operational-value]')).toHaveTextContent('1');
      expect(metric(key)).toHaveTextContent('1 loaded of 1 source records; offset 0, limit 100');
      expect(metric(key)).toHaveTextContent('Operational lists are not date-filtered.');
    }
    expect(metric('assignments')).toHaveTextContent('not a count of assignments active at this instant');
    expect(metric('forecast').querySelector('[data-operational-value]')).toHaveTextContent('20.3%');
    expect(metric('forecast')).toHaveTextContent('14-day fleet average');
    expect(metric('forecast')).toHaveTextContent(formatDateTime(input.forecastSource?.from));
    expect(metric('forecast')).toHaveTextContent(formatDateTime(input.forecastSource?.to));
    expect(metric('forecast')).toHaveTextContent('1 returned vehicle-day points');
    expect(brief).toHaveTextContent('Fleet-wide · Loaded operational records');
    expect(JSON.stringify(input)).toBe(original);
  });

  it('keeps existing reservation statuses, distinct-vehicle counts and open-order rules unchanged', () => {
    const input = props();
    input.reservations.push(
      { ...input.reservations[0]!, id: 4, status: 'requested' },
      { ...input.reservations[0]!, id: 5, status: 'completed' },
      { ...input.reservations[0]!, id: 6, status: 'cancelled' },
    );
    input.assignments.push(
      { ...input.assignments[0]!, id: 2 },
      { ...input.assignments[0]!, id: 3, vehicle_id: 8, ends_at: '2026-10-02T00:00:00Z' },
    );
    input.workOrders.push(
      { ...input.workOrders[0]!, id: 7, status: 'in_progress' },
      { ...input.workOrders[0]!, id: 8, status: 'completed' },
      { ...input.workOrders[0]!, id: 9, status: 'cancelled' },
    );
    input.forecast.push({ ...input.forecast[0]!, expected_utilization_pct: 40.3 });
    renderSummary(input);
    for (const key of ['reservations', 'assignments', 'work-orders']) {
      expect(metric(key).querySelector('[data-operational-value]')).toHaveTextContent('2');
    }
    expect(metric('forecast').querySelector('[data-operational-value]')).toHaveTextContent('30.3%');
  });

  it('distinguishes successful empty list counts from unavailable forecast measurements', () => {
    const input = props();
    input.reservations = [];
    input.assignments = [];
    input.workOrders = [];
    input.forecast = [];
    input.forecastSource = { ...input.forecastSource!, points: [] };
    input.coverage = {
      reservations: { ...listCoverage, total: 0 },
      assignments: { ...listCoverage, total: 0 },
      workOrders: { ...listCoverage, total: 0 },
    };
    renderSummary(input);
    for (const key of ['reservations', 'assignments', 'work-orders']) {
      expect(metric(key)).toHaveAttribute('data-value-state', 'value');
      expect(metric(key).querySelector('[data-operational-value]')).toHaveTextContent('0');
    }
    expect(metric('forecast')).toHaveAttribute('data-value-state', 'missing');
    expect(metric('forecast').querySelector('[data-operational-value]')).toHaveTextContent('—');
    expect(screen.getByTestId('fleet-operations-summary')).toHaveTextContent('Partial source coverage');
  });

  it('does not turn an unavailable reservation source into zero or blank independent sources', () => {
    const input = props();
    input.reservations = [];
    input.availability = { ...input.availability, reservations: false };
    input.sources.reservations = deriveDataState({ error: new Error('Reservations unavailable') });
    input.coverage.reservations = undefined;
    renderSummary(input);
    expect(metric('reservations')).toHaveAttribute('data-value-state', 'missing');
    expect(metric('reservations')).toHaveTextContent('Source unavailable');
    expect(metric('reservations')).toHaveTextContent('List coverage unavailable');
    expect(metric('assignments')).toHaveAttribute('data-value-state', 'value');
    expect(metric('forecast').querySelector('[data-operational-value]')).toHaveTextContent('20.3%');
  });

  it('retains measured values and identifies paused and failed-refresh snapshots', () => {
    const input = props();
    input.sources.assignments = deriveDataState({
      data: {}, dataUpdatedAt: receivedAt, error: new Error('Refresh failed'),
    });
    input.sources.forecast = deriveDataState({
      data: {}, dataUpdatedAt: receivedAt, fetchStatus: 'paused',
    });
    renderSummary(input);
    expect(metric('assignments').querySelector('[data-operational-value]')).toHaveTextContent('1');
    expect(metric('assignments')).toHaveTextContent('Retained source data');
    expect(metric('assignments')).toHaveTextContent(formatDateTime(new Date(receivedAt)));
    expect(metric('forecast')).toHaveTextContent('Refresh paused');
    expect(metric('forecast').querySelector('[data-operational-value]')).toHaveTextContent('20.3%');
  });

  it('explicitly distinguishes partial loaded records from source-wide totals', () => {
    const input = props();
    input.coverage.reservations = { total: 101, limit: 100, offset: 100 };
    renderSummary(input);
    expect(metric('reservations').querySelector('[data-operational-value]')).toHaveTextContent('1');
    expect(metric('reservations')).toHaveTextContent('1 loaded of 101 source records; offset 100, limit 100');
    expect(screen.getByTestId('fleet-operations-summary')).toHaveTextContent('Partial source coverage');
  });

  it('uses a busy loading root only before any source measurements are available', () => {
    const input = props();
    input.loading = true;
    input.availability = { reservations: false, assignments: false, workOrders: false, forecast: false };
    input.sources = {
      reservations: deriveDataState({}), assignments: deriveDataState({}),
      workOrders: deriveDataState({}), forecast: deriveDataState({}),
    };
    const view = renderSummary(input);
    const brief = screen.getByTestId('fleet-operations-summary');
    expect(brief).toHaveAttribute('aria-busy', 'true');
    expect(brief.querySelector('[data-operational-value]')).toBeNull();
    input.availability.assignments = true;
    input.sources.assignments = loaded();
    view.rerender(<MemoryRouter><FleetKpis {...input} /></MemoryRouter>);
    expect(metric('assignments').querySelector('[data-operational-value]')).toHaveTextContent('1');
    expect(metric('reservations')).toHaveAttribute('data-value-state', 'missing');
    expect(brief).toHaveTextContent('Refreshing source data');
  });

  it('keeps a non-finite source forecast invalid instead of fabricating utilization or health', () => {
    const input = props();
    input.forecast = [{ ...input.forecast[0]!, expected_utilization_pct: Number.NaN }];
    renderSummary(input);
    expect(metric('forecast')).toHaveAttribute('data-value-state', 'invalid');
    expect(metric('forecast').querySelector('[data-operational-value]')).toHaveTextContent('—');
    expect(metric('forecast')).toHaveTextContent('Expected a finite numeric measurement');
    expect(screen.getByTestId('fleet-operations-summary')).toHaveTextContent('Partial source coverage');
    expect(screen.queryByText('On track')).not.toBeInTheDocument();
  });

  it('opens the real details drawer with full meanings, source windows, limitations and provenance', async () => {
    const input = props();
    renderSummary(input);
    const review = screen.getByRole('button', { name: 'Review details' });
    fireEvent.click(review);
    const drawer = await screen.findByRole('dialog', { name: 'Operational record summary details' });
    expect(within(drawer).getByText('Active reservations')).toBeInTheDocument();
    expect(drawer).toHaveTextContent('Distinct vehicle IDs in the loaded assignments');
    expect(drawer).toHaveTextContent('Loaded work orders excluding completed and cancelled orders.');
    expect(drawer).toHaveTextContent('rounded to one decimal');
    expect(drawer).toHaveTextContent(formatDateTime(input.forecastSource?.generated_at));
    expect(drawer).toHaveTextContent('Forecast limitations: Returned forecast limitation.');
    expect(drawer).toHaveTextContent('Loaded counts are not server-wide totals.');
    fireEvent.keyDown(drawer, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('fleet-operations-summary')).toHaveAttribute('data-operational-brief');
  });
});
