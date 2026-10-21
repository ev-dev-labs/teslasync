import type { ComponentProps, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveDataState } from '@/api/dataState';
import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { motorFixture } from './fixtures';
import { LiveMotorPanel } from './LiveMotorPanel';

type Props = ComponentProps<typeof LiveMotorPanel>;
const motor = motorFixture({ source: 'reported-source', ts: '2026-09-01T12:00:00Z' });
const previousPreferences = getFormatterPreferences();
let client: QueryClient;

function Providers({ children }: { children: ReactNode }) {
  return <MemoryRouter>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  </MemoryRouter>;
}

function show(overrides: Partial<Props> = {}) {
  const props: Props = {
    motorLatest: motor, isolationResistance: 650, state: deriveDataState({ data: motor }),
    loading: false, connected: false, ...overrides,
  };
  return render(<LiveMotorPanel {...props} />, { wrapper: Providers });
}

function metric(container: HTMLElement, identity: string) {
  const element = container.querySelector<HTMLElement>(`[data-operational-metric="${identity}"]`);
  if (!element) throw new Error(`Missing public metric ${identity}`);
  return element;
}

function record(label: string) {
  const table = screen.getByRole('table', { name: 'Live motor record details' });
  const row = within(table).getByText(label).closest('tr');
  if (!row) throw new Error(`Missing record detail ${label}`);
  return within(row);
}

beforeEach(() => {
  localStorage.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});

afterEach(() => {
  client.clear();
  setGlobalLocale(previousPreferences.locale);
  setGlobalPrecision(previousPreferences.precision);
});

describe('LiveMotorPanel independent isolation trust', () => {
  it.each([
    { caseId: 'fatal', state: deriveDataState({ error: new Error('motor unavailable') }), loading: false },
    { caseId: 'loading', state: deriveDataState({ isLoading: true }), loading: true },
    { caseId: 'empty', state: deriveDataState({ data: null }), loading: false },
  ])('keeps independent isolation visible during motor $caseId', ({ state, loading }) => {
    const retry = vi.fn();
    const { container } = show({ motorLatest: null, state: { ...state, retry }, loading });
    expect(metric(container, 'isolation')).toHaveAttribute('data-value-state', 'value');
    expect(within(metric(container, 'isolation')).getByText('650.00 kΩ')).toBeVisible();
    expect(record('HV Isolation').getByText('650.00 kΩ')).toBeVisible();
    expect(record('Power').getByText('—')).toBeVisible();
    expect(container.querySelector('[data-operational-metric="power"]')).toBeNull();
    expect(screen.getByText('Source observation time not provided')).toBeVisible();
    if (state.fatalError) {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(retry).toHaveBeenCalledOnce();
    } else if (loading) {
      expect(screen.queryByText('No live motor telemetry yet')).not.toBeInTheDocument();
    } else {
      expect(screen.getByText('No live motor telemetry yet')).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      expect(retry).toHaveBeenCalledOnce();
    }
  });

  it.each([
    { caseId: 'fatal', source: { error: new Error('isolation unavailable') } },
    { caseId: 'loading', source: { isLoading: true } },
    { caseId: 'empty', source: { data: null } },
  ])('keeps all motor readings during isolation $caseId', ({ source }) => {
    const { container } = show({ isolationState: deriveDataState<number | null>(source) });
    expect(within(metric(container, 'power')).getByText('0.00 kW')).toBeVisible();
    expect(within(metric(container, 'rpm-front')).getByText('0 RPM')).toBeVisible();
    expect(within(metric(container, 'temp-front')).getByText('0.00°C')).toBeVisible();
    expect(record('Source').getByText('reported-source')).toBeVisible();
    expect(record('HV Isolation').getByText('—')).toBeVisible();
    expect(screen.queryByText('650.00 kΩ')).not.toBeInTheDocument();
  });

  it.each([
    { caseId: 'refresh-failed', source: { error: new Error('isolation refresh failed') } },
    { caseId: 'paused', source: { fetchStatus: 'paused' as const } },
    { caseId: 'refreshing-retained', source: { error: new Error('isolation refresh failed'), isFetching: true } },
  ])('retains actual isolation evidence while $caseId', ({ source }) => {
    const retry = vi.fn();
    const { container } = show({
      motorLatest: null, state: deriveDataState({ error: new Error('motor unavailable') }),
      connected: true, isolationResistance: 900,
      isolationState: deriveDataState({ data: 250, refetch: retry, ...source }, { provenance: 'live' }),
    });
    expect(within(metric(container, 'isolation')).getByText('250.00 kΩ')).toBeVisible();
    expect(record('HV Isolation').getByText('250.00 kΩ')).toBeVisible();
    expect(screen.queryByText('900.00 kΩ')).not.toBeInTheDocument();
    assertOperationalBriefDisclosure(container.querySelector('[data-operational-brief]'), 'Retained source');
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('HV Isolation may be out of date');
    expect(screen.getByText('Source observation time not provided')).toBeVisible();
    expect(screen.queryByText('Up to date')).not.toBeInTheDocument();
    const refresh = screen.getByRole('button', { name: source.isFetching ? 'Updating…' : 'Refresh' });
    if (source.isFetching) {
      expect(refresh).toBeDisabled();
    } else {
      fireEvent.click(refresh);
      expect(retry).toHaveBeenCalledOnce();
    }
    if (source.fetchStatus === 'paused') {
      expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
      expect(screen.queryByText(/device is offline/i)).not.toBeInTheDocument();
    }
  });

  it('preserves measured isolation zero without reinterpreting the legacy default', () => {
    const view = show({ isolationResistance: 0 });
    assertOperationalMetricUnavailable(view.container.querySelectorAll('[data-operational-brief]')[1], 'HV Isolation');
    expect(record('HV Isolation').getByText('—')).toBeVisible();
    view.rerender(<LiveMotorPanel motorLatest={motor} state={deriveDataState({ data: motor })}
      isolationResistance={650} isolationState={deriveDataState({ data: 0 })}
      loading={false} connected />);
    expect(within(metric(view.container, 'isolation')).getByText('0.00 kΩ')).toBeVisible();
    expect(metric(view.container, 'isolation')).toHaveAttribute('data-value-state', 'value');
    expect(record('HV Isolation').getByText('0.00 kΩ')).toBeVisible();
    const zeroBrief = view.container.querySelectorAll('[data-operational-brief]')[1];
    fireEvent.click(within(zeroBrief).getByRole('button', { name: 'Review details' }));
    const zeroDrawer = screen.getByRole('dialog', { name: 'HV Isolation details' });
    expect(within(zeroDrawer).getByRole('group', { name: 'HV Isolation' })).toHaveTextContent('Below 100 kΩ');
    fireEvent.keyDown(zeroDrawer, { key: 'Escape' });
    expect(screen.queryByText(/Non-positive readings use/)).not.toBeInTheDocument();
  });

  it.each([
    { caseId: 'absent', value: undefined },
    { caseId: 'null', value: null },
    { caseId: 'nonfinite', value: Number.NaN },
    { caseId: 'infinite', value: Number.POSITIVE_INFINITY },
    { caseId: 'legacy-negative', value: -1 },
  ])('keeps $caseId isolation unknown rather than fabricating zero', ({ value }) => {
    const { container } = show({ isolationResistance: value, connected: true });
    assertOperationalMetricUnavailable(container.querySelectorAll('[data-operational-brief]')[1], 'HV Isolation');
    expect(record('HV Isolation').getByText('—')).toBeVisible();
    expect(screen.queryByText('0.00 kΩ')).not.toBeInTheDocument();
  });

  it.each([
    { caseId: 'below-middle', value: 99, band: 'Below 100 kΩ' },
    { caseId: 'at-middle', value: 100, band: '100–499 kΩ' },
    { caseId: 'below-high', value: 499, band: '100–499 kΩ' },
    { caseId: 'at-high', value: 500, band: '500 kΩ or above' },
  ])('preserves the isolation band $caseId', ({ value, band }) => {
    const { container } = show({ isolationResistance: value });
    expect(within(metric(container, 'isolation')).getByText(`${value}.00 kΩ`)).toBeVisible();
    const bandBrief = container.querySelectorAll('[data-operational-brief]')[1];
    fireEvent.click(within(bandBrief).getByRole('button', { name: 'Review details' }));
    const bandDrawer = screen.getByRole('dialog', { name: 'HV Isolation details' });
    expect(within(bandDrawer).getByRole('group', { name: 'HV Isolation' })).toHaveTextContent(band);
    fireEvent.keyDown(bandDrawer, { key: 'Escape' });
  });

  it('keeps all thirteen record fields and real details actions through retained motor loading', () => {
    const { container } = show({
      loading: true,
      state: deriveDataState({ data: motor, error: new Error('motor refresh failed'), isFetching: true }),
    });
    const table = screen.getByRole('table', { name: 'Live motor record details' });
    expect(within(table).getAllByRole('row')).toHaveLength(14);
    for (const label of ['Shift State', 'Power', 'Regen', 'Source', 'Front Motor RPM',
      'Rear Motor RPM', 'Front Torque', 'Rear Torque', 'Front Motor Temp', 'Rear Motor Temp',
      'Inverter Temp', 'Battery Temp', 'HV Isolation']) {
      expect(within(table).getByText(label)).toBeVisible();
    }
    expect(within(metric(container, 'power')).getByText('0.00 kW')).toBeVisible();
    expect(record('Battery Temp').getByText('—')).toBeVisible();
    const readingsBrief = container.querySelectorAll('[data-operational-brief]')[0];
    assertOperationalBriefDisclosure(readingsBrief, 'Retained source');
    assertOperationalBriefDisclosure(readingsBrief, 'Latest returned motor snapshot; reported source: reported-source. Observation freshness and continuous coverage are not established. HV isolation comes from the separate live signal state.');
    fireEvent.click(screen.getAllByRole('button', { name: 'Review details' })[1]);
    const dialog = screen.getByRole('dialog', { name: 'HV Isolation details' });
    expect(within(dialog).getByText('650.00 kΩ')).toBeVisible();
    expect(within(dialog).getByText('Source observation time not provided')).toBeVisible();
  });

  it('keeps supplied isolation observation separate from motor and fetch times', () => {
    const { container } = show({
      isolationState: deriveDataState({ data: 987, dataUpdatedAt: 1_790_000_000_000 }),
      isolationPeriod: { kind: 'snapshot', label: 'HV Isolation', observedAt: '2026-08-01T10:00:00Z',
        provenance: 'Reported isolation signal; freshness not established.' },
    });
    expect(within(metric(container, 'isolation')).getByText('987.00 kΩ')).toBeVisible();
    const motorBriefs = container.querySelectorAll('[data-operational-brief]');
    assertOperationalBriefDisclosure(motorBriefs[1], 'HV Isolation · Aug 1, 2026, 10:00 AM');
    expect(screen.getByText('Reported isolation signal; freshness not established.')).toBeVisible();
    assertOperationalBriefDisclosure(motorBriefs[0], 'Live Motor Status · Sep 1, 2026, 12:00 PM');
    expect(screen.queryByText(/1790000000000/)).not.toBeInTheDocument();
  });
});
