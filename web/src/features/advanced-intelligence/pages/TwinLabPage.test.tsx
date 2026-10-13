import type { ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback';
import type { TwinLabRequest, TwinLabResponse } from '@/types/advancedIntelligence';
import { twin } from './advancedIntelligenceClosure.fixtures';
import TwinLabPage from './TwinLabPage';

const state = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  mutation: {
    data: undefined as TwinLabResponse | undefined,
    variables: undefined as TwinLabRequest | undefined,
    error: null as Error | null,
    isPending: false,
    isPaused: false,
    mutate: vi.fn<(inputs: TwinLabRequest) => void>(),
    reset: vi.fn(),
  },
}));

vi.mock('@/api/hooks/useAdvancedIntelligence', () => ({
  useRunTwinLab: () => state.mutation,
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: state.vehicleId }),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Providers({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>
      <MemoryRouter><ToastProvider>{children}</ToastProvider></MemoryRouter>
    </QueryClientProvider>;
  }
  return render(<TwinLabPage />, { wrapper: Providers });
}

function chartTable() {
  return screen.getByRole('table', { name: 'Range-effect uncertainty comparison — data table' });
}

function card(title: string) {
  const element = screen.getByRole('heading', { name: title }).closest<HTMLElement>('[data-card]');
  if (!element) throw new Error(`Missing card: ${title}`);
  return element;
}

function scenario(name: string) {
  const element = screen.getByRole('heading', { name }).closest('article');
  if (!element) throw new Error(`Missing sensitivity scenario: ${name}`);
  return element;
}

function expectSections() {
  for (const title of ['Calibrated scenarios', 'Calibrated baseline',
    'Range-effect uncertainty comparison', 'Sensitivity drivers', 'Evidence, quality, and limitations']) {
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
  }
  expect(screen.getByText('Simulation only')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Data quality' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Evidence sources' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Limitations' })).toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  state.vehicleId = 7;
  Object.assign(state.mutation, {
    data: undefined, variables: undefined, error: null, isPending: false, isPaused: false,
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 1024, bottom: 300,
    width: 1024, height: 300, toJSON: () => ({}),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TwinLabPage restrained source adoption', () => {
  it('keeps all six sections and unknown baseline before explicit simulation', () => {
    renderPage();
    expectSections();
    const brief = screen.getByTestId('advanced-intelligence-twin-brief');
    expect(brief).toHaveTextContent('Not calculated');
    const metrics = brief.querySelectorAll('[data-operational-metric]');
    expect(metrics).toHaveLength(4);
    for (const metric of metrics) expect(metric).toHaveAttribute('data-value-state', 'missing');
    expect(screen.getByText('At least two supported scenario results are required.')).toBeInTheDocument();
    expect(screen.getAllByLabelText(/Scenario name/).map(input => (input as HTMLInputElement).value))
      .toEqual(['Scenario 1', 'Scenario 2']);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(state.mutation.mutate).not.toHaveBeenCalled();
  });

  it('preserves all edited SI fields, nullable temperature, real zero and scenario limits', () => {
    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove scenario' })[1]);
    expect(screen.getByRole('button', { name: 'Remove scenario' })).toBeDisabled();
    const edits: Array<[RegExp, string]> = [
      [/Scenario name/, 'Caller scenario'], [/Route distance/, '123456'],
      [/Average speed/, '12.5'], [/Scenario horizon/, '7200'],
      [/Outside temperature/, ''], [/Auxiliary load/, '0'],
    ];
    for (const [label, value] of edits) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    for (let count = 1; count < 12; count++) fireEvent.click(screen.getByRole('button', { name: 'Add scenario' }));
    expect(screen.getAllByLabelText(/Scenario name/)).toHaveLength(12);
    expect(screen.getByRole('button', { name: 'Add scenario' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Run confirmed simulation' }));
    expect(state.mutation.mutate).toHaveBeenCalledExactlyOnceWith({
      vehicle_id: 7, confirmed: true,
      scenarios: [
        { name: 'Caller scenario', horizon_s: 7200, distance_m: 123456, speed_mps: 12.5,
          outside_temp_c: null, auxiliary_load_w: 0 },
        ...Array.from({ length: 11 }, (_, index) => ({
          name: `Scenario ${index + 2}`, horizon_s: 3600, distance_m: 60000,
          speed_mps: 27, outside_temp_c: 20, auxiliary_load_w: 1000,
        })),
      ],
    });
  });

  it('disables simulation without workspace vehicle and keeps disclosure and controls', () => {
    state.vehicleId = null;
    renderPage();
    expectSections();
    expect(screen.getByRole('button', { name: 'Run confirmed simulation' })).toBeDisabled();
    expect(screen.getByTestId('advanced-intelligence-twin-brief')).toHaveTextContent('Select a vehicle');
    const limitations = screen.getByRole('region', { name: 'Limitations' });
    expect(within(limitations).getByText('• Vehicle commands and physical actuation')).toBeInTheDocument();
    expect(within(limitations).getByText('• Guaranteed real-world outcomes')).toBeInTheDocument();
    expect(state.mutation.mutate).not.toHaveBeenCalled();
  });

  it('keeps pending shells and form draft without inventing a calibrated result', () => {
    state.mutation.isPending = true;
    renderPage();
    expectSections();
    expect(screen.getByRole('button', { name: 'Run confirmed simulation' })).toBeDisabled();
    const brief = screen.getByTestId('advanced-intelligence-twin-brief');
    expect(brief).toHaveTextContent('Awaiting result');
    expect(brief).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByLabelText(/Route distance/)[0]).toHaveValue(50000);
    expect(screen.queryByText('calibrated-not-guaranteed')).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /uncertainty.*data table/ })).not.toBeInTheDocument();
    const form = screen.getByRole('button', { name: 'Run confirmed simulation' }).closest('form');
    if (!form) throw new Error('Missing scenario form');
    fireEvent.submit(form);
    expect(state.mutation.mutate).not.toHaveBeenCalled();
  });

  it('distinguishes initial paused simulation from empty success and initial failure', () => {
    state.mutation.isPending = true;
    state.mutation.isPaused = true;
    renderPage();
    expectSections();
    const message = 'The initial evidence query is paused; no empty result is inferred.';
    expect(screen.getByTestId('advanced-intelligence-twin-brief')).toHaveTextContent(message);
    expect(card('Range-effect uncertainty comparison')).toHaveTextContent(message);
    expect(card('Sensitivity drivers')).toHaveTextContent(message);
    expect(screen.getByTestId('advanced-intelligence-twin-brief')).not.toHaveAttribute('aria-busy');
    expect(screen.queryByText('Intelligence evidence could not be loaded.')).not.toBeInTheDocument();
    expect(screen.queryByText('calibrated-not-guaranteed')).not.toBeInTheDocument();
  });

  it('shows initial source failure without hiding inputs, evidence or neighboring shells', () => {
    state.mutation.error = new Error('simulation unavailable');
    renderPage();
    expectSections();
    expect(screen.getByTestId('advanced-intelligence-twin-brief')).toHaveTextContent('Source unavailable');
    expect(card('Range-effect uncertainty comparison')).toHaveTextContent("Can't reach server");
    expect(card('Sensitivity drivers')).toHaveTextContent('Intelligence evidence could not be loaded.');
    expect(screen.getByText('simulation unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run confirmed simulation' })).toBeEnabled();
    expect(screen.queryByText('Retained result')).not.toBeInTheDocument();
  });

  it('preserves signed uncertainty, null gaps, measured zero, source fields and raw payload', () => {
    state.mutation.data = structuredClone(twin);
    const original = structuredClone(state.mutation.data);
    renderPage();
    expectSections();
    const brief = screen.getByTestId('advanced-intelligence-twin-brief');
    expect(brief.querySelector('[data-operational-metric="efficiency"]')).toHaveAttribute('data-value-state', 'missing');
    expect(brief.querySelector('[data-operational-metric="usable-battery"]')).toHaveAttribute('data-value-state', 'value');
    expect(brief).toHaveTextContent('0.00 kWh');
    const rows = within(chartTable()).getAllByRole('row');
    expect(within(rows[0]).getAllByRole('columnheader').map(cell => cell.textContent))
      .toEqual(['Scenario name', 'Low', 'Estimate', 'High']);
    expect(within(rows[1]).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['Modeled A', '-1', '0', '2']);
    expect(within(rows[2]).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['Unsupported B', '—', '—', '—']);
    expect(scenario('Modeled A')).toHaveTextContent('0.00%');
    expect(scenario('Modeled A')).toHaveTextContent('-5.00%');
    expect(screen.getByRole('region', { name: 'Data quality' })).toHaveTextContent(twin.data_quality.reasons[0]);
    expect(screen.getByRole('region', { name: 'Evidence sources' })).toHaveTextContent(twin.evidence[0].summary);
    expect(screen.getByRole('region', { name: 'Limitations' })).toHaveTextContent(twin.limitations[0]);
    expect(state.mutation.data).toEqual(original);
    expect(state.mutation.mutate).not.toHaveBeenCalled();
  });

  it('keeps brief details, full evidence context and chart export actions reachable', () => {
    state.mutation.data = structuredClone(twin);
    renderPage();
    fireEvent.click(within(screen.getByTestId('advanced-intelligence-twin-brief')).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Calibrated baseline details' });
    expect(drawer).toHaveTextContent(twin.evidence[0].source);
    expect(drawer).toHaveTextContent(twin.data_quality.reasons[0]);
    expect(drawer).toHaveTextContent(twin.limitations[0]);
    fireEvent.keyDown(drawer, { key: 'Escape' });
    const chart = card('Range-effect uncertainty comparison');
    fireEvent.click(within(chart).getByRole('button', { name: 'Export chart' }));
    for (const label of ['Save as PNG', 'Save as SVG', 'Copy image to clipboard']) {
      expect(within(chart).getByRole('menuitem', { name: label })).toBeInTheDocument();
    }
    expect(state.mutation.mutate).not.toHaveBeenCalled();
  });

  it('explains unavailable drivers per scenario and wraps long labels in neutral surfaces', () => {
    state.mutation.data = structuredClone(twin);
    const label = 'synthetic-long-driver'.repeat(20);
    state.mutation.data.scenarios[0].sensitivity_drivers[0].driver = label;
    renderPage();
    expect(scenario('Unsupported B')).toHaveTextContent('No supported data is available.');
    expect(scenario('Unsupported B')).not.toHaveTextContent('0.00%');
    expect(scenario('Modeled A')).toHaveClass('min-w-0', 'rounded-panel', 'bg-[var(--surface-2)]', 'border-[var(--border-default)]');
    expect(screen.getByText(label)).toHaveClass('break-words', 'min-w-0');
    expect(scenario('Modeled A').parentElement).toHaveClass('@2xl:grid-cols-2');
  });

  it('preserves repeated scenario and driver names without React sibling-key collisions', () => {
    state.mutation.data = structuredClone(twin);
    state.mutation.data.scenarios[1].name = 'Modeled A';
    state.mutation.data.scenarios[0].sensitivity_drivers[1].driver = 'first-assumption';
    const errors = vi.spyOn(console, 'error');
    renderPage();
    expect(screen.getAllByRole('heading', { name: 'Modeled A' })).toHaveLength(2);
    expect(screen.getAllByText('first-assumption')).toHaveLength(2);
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key|unique.*key/i);
  });

  it.each([
    { name: 'pending refresh', isPending: true, isPaused: false, error: null,
      message: 'Updating result' },
    { name: 'failed refresh', isPending: false, isPaused: false, error: new Error('refresh unavailable'),
      message: 'Retained result' },
    { name: 'paused refresh', isPending: true, isPaused: true, error: null,
      message: 'Retained result' },
  ])('retains every result and source disclosure during $name', ({ isPending, isPaused, error, message }) => {
    state.mutation.data = structuredClone(twin);
    const view = renderPage();
    const rows = chartTable().textContent;
    Object.assign(state.mutation, { data: undefined, isPending, isPaused, error });
    view.rerender(<TwinLabPage />);
    expectSections();
    expect(chartTable()).toHaveTextContent(rows ?? '');
    expect(screen.getByTestId('advanced-intelligence-twin-brief')).toHaveTextContent(message);
    expect(scenario('Modeled A')).toHaveTextContent('first-assumption');
    expect(screen.getByRole('region', { name: 'Evidence sources' })).toHaveTextContent(twin.evidence[0].summary);
    if (error || isPaused) {
      expect(card('Range-effect uncertainty comparison')).toHaveTextContent('Retained result');
      expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent(error
        ? 'The refresh failed; the most recently loaded evidence remains visible.'
        : 'Cached evidence remains visible while its refresh is paused.');
    }
    expect(state.mutation.mutate).not.toHaveBeenCalled();
  });

  it('clears old vehicle publication and refuses late previous-scope results', () => {
    state.mutation.data = structuredClone(twin);
    state.mutation.variables = { vehicle_id: 7, confirmed: true, scenarios: [] };
    const view = renderPage();
    expect(chartTable()).toBeInTheDocument();
    state.vehicleId = 8;
    view.rerender(<TwinLabPage />);
    expectSections();
    expect(screen.queryByText('calibrated-not-guaranteed')).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /uncertainty.*data table/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('advanced-intelligence-twin-brief')).toHaveTextContent('Vehicle #8');
    state.mutation.data = { ...twin, generated_at: '2026-08-05T00:00:00Z' };
    view.rerender(<TwinLabPage />);
    expect(screen.queryByText('calibrated-not-guaranteed')).not.toBeInTheDocument();
    expect(state.mutation.reset).toHaveBeenCalledOnce();
  });

  it('keeps single-scenario chart guidance and sensitivity without a whole-result gate', () => {
    state.mutation.data = { ...twin, scenarios: [twin.scenarios[0]] };
    renderPage();
    expectSections();
    expect(card('Range-effect uncertainty comparison')).toHaveTextContent('At least two supported scenario results are required.');
    expect(scenario('Modeled A')).toHaveTextContent('first-assumption');
    expect(screen.getByTestId('advanced-intelligence-twin-brief')).toHaveTextContent('calibrated-not-guaranteed');
  });

  it('keeps baseline and evidence when a resolved result contains no scenarios', () => {
    state.mutation.data = { ...twin, scenarios: [] };
    renderPage();
    expectSections();
    expect(card('Range-effect uncertainty comparison')).toHaveTextContent('At least two supported scenario results are required.');
    expect(card('Sensitivity drivers')).toHaveTextContent('Sensitivity drivers appear after a supported simulation.');
    expect(screen.getByTestId('advanced-intelligence-twin-brief')).toHaveTextContent('calibrated-not-guaranteed');
    expect(screen.getByRole('region', { name: 'Evidence sources' })).toHaveTextContent(twin.evidence[0].summary);
    expect(screen.queryByRole('heading', { name: 'Modeled A' })).not.toBeInTheDocument();
  });
});
