import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager, useMutation } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback';
import { assertOperationalBriefDisclosure } from '@/test/operationalBriefAssertions';
import type { ResiliencePlanRequest, ResiliencePlanResponse } from '@/types/advancedIntelligence';
import EmergencyResiliencePage from './EmergencyResiliencePage';
import { resilience } from './advancedIntelligenceClosure.fixtures';

const state = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  run: vi.fn<(input: ResiliencePlanRequest) => Promise<ResiliencePlanResponse>>(),
}));
vi.mock('@/api/hooks/useAdvancedIntelligence', () => ({
  useCreateResiliencePlan: () => useMutation({ mutationFn: state.run }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: state.vehicleId }),
}));
vi.mock('@/api/hooks/useStormguard', () => ({
  useStormguardStatus: () => ({ data: undefined, isLoading: false, isError: false }),
  useStormguardEvents: () => ({ data: [], isLoading: false, isError: false }),
  useSaveStormguardConfig: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null }),
}));

let client: QueryClient;
function renderPage() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>
      <MemoryRouter><ToastProvider>{children}</ToastProvider></MemoryRouter>
    </QueryClientProvider>;
  }
  return render(<EmergencyResiliencePage />, { wrapper });
}
function runButton() {
  return screen.getByRole('button', { name: 'Create confirmed outage plan' });
}
function form() {
  const element = runButton().closest('form');
  if (!element) throw new Error('Scenario form is not mounted');
  return element;
}
function timeline() {
  return screen.getByRole('table', { name: 'Outage risk timeline — data table' });
}
beforeEach(() => {
  state.vehicleId = 7;
  state.run.mockReset().mockResolvedValue(resilience);
  onlineManager.setOnline(true);
  window.localStorage.clear();
});
afterEach(() => {
  client?.clear();
  onlineManager.setOnline(true);
});

describe('Emergency resilience scoped modernization', () => {
  it('preserves seven section identities and independent guardian without implying a completed plan', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Evidence, quality, and limitations' })).toBeVisible());
    for (const title of ['Emergency resilience', 'Storm guardian', 'Outage plan scenario',
      'Survival horizon', 'Outage risk timeline', 'Load priorities and recommendations',
      'Evidence, quality, and limitations']) {
      expect(screen.getByRole('heading', { name: title })).toBeVisible();
    }
    expect(screen.getByText('Advisory plan only')).toBeVisible();
    expect(screen.getByText('Automatic load shedding or energy dispatch')).toBeVisible();
    expect(screen.getByText('Assumed vehicle-to-home capability or authorization')).toBeVisible();
    expect(form().querySelectorAll('input')).toHaveLength(7);
    expect(runButton()).toHaveClass('min-h-11', 'max-w-full', 'whitespace-normal');
    expect(form().querySelector('.grid')).toHaveClass('@2xl:grid-cols-2', '@5xl:grid-cols-3');
    assertOperationalBriefDisclosure(screen.getByTestId('advanced-intelligence-resilience-brief'), 'Not calculated');
    expect(screen.queryByText('No supporting evidence was returned.')).not.toBeInTheDocument();
    expect(state.run).not.toHaveBeenCalled();
  });

  it('keeps every cleared required draft blank and never substitutes zero on submit', () => {
    renderPage();
    for (const label of [/Vehicle energy/, /Stationary storage/, /Expected solar/,
      /Essential load/, /Outage duration/, /Evacuation reserve/, /Restoration uncertainty/]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: '' } });
      expect(screen.getByLabelText(label)).toHaveValue(null);
    }
    expect(screen.queryByText('Display equivalent: 0.00 kWh')).not.toBeInTheDocument();
    fireEvent.submit(form());
    expect(state.run).not.toHaveBeenCalled();
  });

  it('submits exact raw SI defaults and preserves legitimate zero energy and uncertainty', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/Expected solar/), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText(/Restoration uncertainty/), { target: { value: '0' } });
    expect(state.run).not.toHaveBeenCalled();
    fireEvent.click(runButton());
    await waitFor(() => expect(state.run).toHaveBeenCalledTimes(1));
    expect(state.run.mock.calls[0][0]).toEqual({
      vehicle_id: 7, confirmed: true, vehicle_energy_wh: 60000, stationary_storage_wh: 13500,
      expected_solar_wh: 0, essential_load_w: 1200, outage_duration_s: 172800,
      evacuation_reserve_wh: 15000, restoration_uncertainty_pct: 0,
    });
  });

  it('retains original minimum and uncertainty maximum constraints and disables missing-vehicle submission', () => {
    const view = renderPage();
    for (const [label, value] of [[/Essential load/, '0'], [/Outage duration/, '59'],
      [/Restoration uncertainty/, '201']] as const) {
      const input = screen.getByLabelText(label);
      const original = (input as HTMLInputElement).value;
      fireEvent.change(input, { target: { value } });
      fireEvent.submit(form());
      expect(state.run).not.toHaveBeenCalled();
      fireEvent.change(input, { target: { value: original } });
    }
    expect(screen.getByLabelText(/Restoration uncertainty/)).toHaveAttribute('max', '200');
    state.vehicleId = null;
    view.rerender(<EmergencyResiliencePage />);
    expect(runButton()).toBeDisabled();
    fireEvent.submit(form());
    expect(state.run).not.toHaveBeenCalled();
  });

  it('distinguishes first pending and paused requests from returned empty evidence', async () => {
    onlineManager.setOnline(false);
    renderPage();
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getAllByText('The initial evidence query is paused; no empty result is inferred.').length).toBeGreaterThanOrEqual(3));
    expect(runButton()).toBeDisabled();
    expect(screen.queryByText('No supporting evidence was returned.')).not.toBeInTheDocument();
    expect(screen.queryByText('At least two supported timeline points are required.')).not.toBeInTheDocument();
    expect(state.run).not.toHaveBeenCalled();
  });

  it('retains every risk point unit-bearing export column priority recommendation and evidence after failure', async () => {
    state.run.mockResolvedValueOnce(resilience).mockRejectedValueOnce(new Error('modeled recalculation unavailable'));
    renderPage();
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getByText('Caller priority first')).toBeVisible());
    const table = timeline();
    expect(within(table).getByRole('columnheader', { name: 'Time (h)' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Remaining energy (kWh)' })).toBeInTheDocument();
    for (const risk of ['supported', 'modeled', 'depleted']) expect(within(table).getByText(risk)).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(screen.getAllByRole('article')[0]).toHaveTextContent('#2');
    expect(screen.getByText('• Review evacuation reserve.')).toBeInTheDocument();
    expect(screen.getAllByText('• Modeled outage, not a weather observation.').length).toBeGreaterThan(0);
    const before = table.textContent;
    fireEvent.change(screen.getByLabelText(/Vehicle energy/), { target: { value: '90000' } });
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getByText('modeled recalculation unavailable')).toBeVisible());
    assertOperationalBriefDisclosure(screen.getByTestId('advanced-intelligence-resilience-brief'), 'Retained result');
    expect(timeline().textContent).toBe(before);
    expect(screen.getByText('Caller priority second')).toBeVisible();
    expect(screen.getByText('modeled recalculation unavailable')).toBeVisible();
    expect(state.run.mock.calls[0][0].vehicle_energy_wh).toBe(60000);
    expect(resilience.risk_timeline[1]).toEqual({ time_s: 3600, remaining_energy_wh: 6000, risk: 'modeled' });
  });

  it('explains empty returned collections separately without dropping neighboring recommendations', async () => {
    state.run.mockResolvedValueOnce({ ...resilience, load_priorities: [] });
    renderPage();
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getByText('No supported data is available.')).toBeVisible());
    expect(screen.getByText('• No automatic shedding.')).toBeVisible();
    expect(timeline()).toHaveTextContent('depleted');
  });

  it('keeps source shells and controls on fatal calculation failure without inferred evidence emptiness', async () => {
    state.run.mockRejectedValueOnce(new Error('initial modeled calculation unavailable'));
    renderPage();
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getByText('initial modeled calculation unavailable')).toBeVisible());
    expect(screen.getAllByText('Intelligence evidence could not be loaded.').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('heading', { name: 'Storm guardian' })).toBeVisible();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Evidence, quality, and limitations' })).toBeVisible());
    expect(screen.queryByText('No supporting evidence was returned.')).not.toBeInTheDocument();
    expect(runButton()).toBeEnabled();
  });

  it('rejects late old-vehicle results and retains the unsent raw draft under selection changes', async () => {
    let settle!: (value: ResiliencePlanResponse) => void;
    state.run.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
    const view = renderPage();
    fireEvent.click(runButton());
    await waitFor(() => expect(state.run).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Outage risk timeline' })).toBeVisible());
    expect(screen.queryByText('At least two supported timeline points are required.')).not.toBeInTheDocument();
    state.vehicleId = 8;
    view.rerender(<EmergencyResiliencePage />);
    await act(async () => { settle(resilience); });
    expect(screen.queryByText('Caller priority first')).not.toBeInTheDocument();
    assertOperationalBriefDisclosure(
      screen.getByTestId('advanced-intelligence-resilience-brief'), 'Vehicle #8', { contains: true });
    expect(screen.getByLabelText(/Vehicle energy/)).toHaveValue(60000);
    expect(state.run.mock.calls[0][0].vehicle_id).toBe(7);
  });
});
