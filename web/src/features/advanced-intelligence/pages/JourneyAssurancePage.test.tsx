import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager, useMutation } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback';
import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import type { JourneyAssuranceRequest, JourneyAssuranceResponse } from '@/types/advancedIntelligence';
import JourneyAssurancePage from './JourneyAssurancePage';
import { journey } from './advancedIntelligenceClosure.fixtures';

const state = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  run: vi.fn<(input: JourneyAssuranceRequest) => Promise<JourneyAssuranceResponse>>(),
}));
vi.mock('@/api/hooks/useAdvancedIntelligence', () => ({
  useRunJourneyAssurance: () => useMutation({ mutationFn: state.run }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: state.vehicleId }),
}));

let client: QueryClient;
function renderPage() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>
      <MemoryRouter><ToastProvider>{children}</ToastProvider></MemoryRouter>
    </QueryClientProvider>;
  }
  return render(<JourneyAssurancePage />, { wrapper });
}
function runButton() {
  return screen.getByRole('button', { name: 'Run confirmed readiness assessment' });
}
function form() {
  const element = runButton().closest('form');
  if (!element) throw new Error('Journey scenario form is not mounted');
  return element;
}
function scenario() {
  return screen.getByRole('region', { name: 'Journey readiness assessment' });
}
beforeEach(() => {
  state.vehicleId = 7;
  state.run.mockReset().mockResolvedValue(journey);
  onlineManager.setOnline(true);
  window.localStorage.clear();
});
afterEach(() => {
  client?.clear();
  onlineManager.setOnline(true);
});

describe('Journey assurance scoped modernization', () => {
  it('preserves all initial sections and six controls without implying returned evidence', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Limitations' })).toBeVisible());
    for (const title of ['Journey assurance', 'Journey scenario', 'Readiness and arrival range',
      'Readiness factors', 'Evidence, quality, and limitations', 'Data quality', 'Evidence sources', 'Limitations']) {
      expect(screen.getByRole('heading', { name: title })).toBeVisible();
    }
    expect(screen.getByText('Planning estimate')).toBeVisible();
    expect(screen.getByText('Live traffic and charger availability')).toBeVisible();
    expect(screen.getByText('Navigation, charging, or climate commands')).toBeVisible();
    expect(form().querySelectorAll('input')).toHaveLength(6);
    expect(form().querySelector('.grid')).toHaveClass('@2xl:grid-cols-2', '@5xl:grid-cols-3');
    expect(runButton()).toHaveClass('min-h-11', 'max-w-full', 'whitespace-normal');
    assertOperationalBriefDisclosure(screen.getByTestId('advanced-intelligence-journey-brief'), 'Not calculated');
    expect(screen.queryByText('No supporting evidence was returned.')).not.toBeInTheDocument();
    expect(screen.queryByText('No additional limitations were returned.')).not.toBeInTheDocument();
    expect(state.run).not.toHaveBeenCalled();
  });

  it('submits the selected vehicle local departure and unchanged canonical SI defaults', async () => {
    renderPage();
    const departure = '2026-10-13T14:30';
    fireEvent.change(screen.getByLabelText(/Departure/), { target: { value: departure } });
    expect(state.run).not.toHaveBeenCalled();
    fireEvent.click(runButton());
    await waitFor(() => expect(state.run).toHaveBeenCalledTimes(1));
    expect(state.run.mock.calls[0][0]).toEqual({
      vehicle_id: 7, confirmed: true, route_distance_m: 250000,
      departure_at: new Date(departure).toISOString(), reserve_target_pct: 15,
      outside_temp_c: null, average_speed_mps: null, auxiliary_load_w: null,
    });
  });

  it('keeps cleared required values blank instead of substituting measured zero', () => {
    renderPage();
    for (const label of [/Route distance/, /Reserve target/]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: '' } });
      expect(screen.getByLabelText(label)).toHaveValue(null);
    }
    expect(screen.queryByText('Display equivalent: 0.00 km')).not.toBeInTheDocument();
    fireEvent.submit(form());
    expect(state.run).not.toHaveBeenCalled();
  });

  it('preserves input bounds and rejects invalid or missing vehicle submissions', () => {
    const view = renderPage();
    for (const [label, value] of [[/Route distance/, '99'], [/Route distance/, '5000001'],
      [/Reserve target/, '81'], [/Outside temperature/, '-81'], [/Average speed/, '0'],
      [/Auxiliary load/, '50001']] as const) {
      const input = screen.getByLabelText(label);
      const original = (input as HTMLInputElement).value;
      fireEvent.change(input, { target: { value } });
      fireEvent.submit(form());
      expect(state.run).not.toHaveBeenCalled();
      fireEvent.change(input, { target: { value: original } });
    }
    fireEvent.change(screen.getByLabelText(/Departure/), { target: { value: '' } });
    fireEvent.submit(form());
    expect(state.run).not.toHaveBeenCalled();
    state.vehicleId = null;
    view.rerender(<JourneyAssurancePage />);
    expect(runButton()).toBeDisabled();
    assertOperationalBriefDisclosure(
      screen.getByTestId('advanced-intelligence-journey-brief'), 'Vehicle scope not selected', { contains: true });
  });

  it('preserves legitimate zero weather load and reserve while leaving speed in raw SI', async () => {
    renderPage();
    for (const [label, value] of [[/Outside temperature/, '0'], [/Auxiliary load/, '0'],
      [/Reserve target/, '0'], [/Average speed/, '20']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.click(runButton());
    await waitFor(() => expect(state.run).toHaveBeenCalledTimes(1));
    expect(state.run.mock.calls[0][0]).toMatchObject({
      route_distance_m: 250000, outside_temp_c: 0, auxiliary_load_w: 0,
      reserve_target_pct: 0, average_speed_mps: 20, confirmed: true,
    });
    await waitFor(() => expect(scenario()).toBeVisible());
    expect(scenario()).toHaveTextContent(/0(?:\.0+)? °C/);
    expect(scenario()).toHaveTextContent(/20(?:\.0+)? m\/s/);
    expect(scenario()).toHaveTextContent(/0(?:\.0+)? W/);
  });

  it('keeps first pending evidence unresolved and blocks duplicate form submissions', async () => {
    let settle!: (value: JourneyAssuranceResponse) => void;
    state.run.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
    renderPage();
    fireEvent.click(runButton());
    await waitFor(() => expect(state.run).toHaveBeenCalledTimes(1));
    expect(runButton()).toBeDisabled();
    assertOperationalBriefDisclosure(screen.getByTestId('advanced-intelligence-journey-brief'), 'Awaiting result');
    for (const title of ['Data quality', 'Evidence sources', 'Limitations']) {
      await waitFor(() => expect(screen.getByRole('heading', { name: title })).toBeVisible());
    }
    expect(screen.queryByText('No supporting evidence was returned.')).not.toBeInTheDocument();
    fireEvent.submit(form());
    expect(state.run).toHaveBeenCalledTimes(1);
    await act(async () => { settle(journey); });
  });

  it('distinguishes the first paused assessment from loading returned emptiness or failure', async () => {
    onlineManager.setOnline(false);
    renderPage();
    fireEvent.click(runButton());
    await waitFor(() => expect(runButton()).toBeDisabled());
    assertOperationalBriefDisclosure(
      screen.getByTestId('advanced-intelligence-journey-brief'),
      'The initial evidence query is paused; no empty result is inferred.',
    );
    expect(runButton()).toBeDisabled();
    expect(screen.queryByText('No supporting evidence was returned.')).not.toBeInTheDocument();
    expect(screen.queryByText('Intelligence evidence could not be loaded.')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Navigation, charging, or climate commands')).toBeVisible());
    expect(state.run).not.toHaveBeenCalled();
  });

  it('retains measured zero factors unknown bounds every metric and evidence detail', async () => {
    renderPage();
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getByText('observed charge')).toBeVisible());
    const brief = screen.getByTestId('advanced-intelligence-journey-brief');
    for (const label of ['Readiness score', 'Arrival SoC low']) {
      expect(within(brief).getByText(label)).toBeVisible();
    }
    assertOperationalMetricUnavailable(brief, 'Arrival SoC high');
    assertOperationalMetricUnavailable(brief, 'Energy required');
    const articles = screen.getAllByRole('article');
    expect(articles).toHaveLength(2);
    expect(articles[0]).toHaveTextContent(/0(?:\.0+)?%/);
    expect(articles[1]).toHaveTextContent('—');
    expect(articles[0]).toHaveClass('min-w-0', 'break-words', 'border-[var(--panel-border)]');
    expect(articles[0].querySelector('.flex')).toHaveClass('flex-wrap');
    expect(screen.getByText('Observed charge, not readiness proof.')).toBeVisible();
    expect(screen.getByText('Unknown weather is not zero degrees.')).toBeVisible();
    expect(screen.getAllByText('Observed vehicle energy, not a simulated outcome.').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/No live charger reservations\./).length).toBeGreaterThan(0);
    expect(journey.arrival_soc_high_pct).toBeNull();
    expect(journey.energy_required_wh).toBeNull();
  });

  it('keeps the captured submitted scenario and all retained evidence after an edited retry fails', async () => {
    state.run.mockResolvedValueOnce(journey).mockRejectedValueOnce(new Error('journey recalculation unavailable'));
    renderPage();
    fireEvent.click(runButton());
    await waitFor(() => expect(scenario()).toBeVisible());
    const before = scenario().textContent;
    fireEvent.change(screen.getByLabelText(/Route distance/), { target: { value: '500000' } });
    fireEvent.change(screen.getByLabelText(/Reserve target/), { target: { value: '30' } });
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getByText('journey recalculation unavailable')).toBeVisible());
    assertOperationalBriefDisclosure(screen.getByTestId('advanced-intelligence-journey-brief'), 'Retained result');
    expect(scenario().textContent).toBe(before);
    expect(screen.getByLabelText(/Route distance/)).toHaveValue(500000);
    expect(screen.getByText('observed charge')).toBeVisible();
    expect(screen.getAllByText(/No live charger reservations\./).length).toBeGreaterThan(0);
    expect(state.run.mock.calls[1][0]).toMatchObject({ route_distance_m: 500000, reserve_target_pct: 30 });
    expect(runButton()).toBeEnabled();
  });

  it('keeps failure recovery and unsupported disclosures without inventing an empty response', async () => {
    state.run.mockRejectedValueOnce(new Error('initial journey unavailable'));
    renderPage();
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getByText('initial journey unavailable')).toBeVisible());
    expect(screen.getByRole('heading', { name: 'Journey scenario' })).toBeVisible();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Readiness factors' })).toBeVisible());
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Evidence, quality, and limitations' })).toBeVisible());
    expect(screen.queryByText('No supporting evidence was returned.')).not.toBeInTheDocument();
    expect(screen.getByText('Live traffic and charger availability')).toBeVisible();
    expect(runButton()).toBeEnabled();
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getByText('observed charge')).toBeVisible());
    expect(state.run).toHaveBeenCalledTimes(2);
  });

  it('normalizes null factor collections while keeping neighboring metrics and evidence', async () => {
    const wire = JSON.parse(JSON.stringify({ ...journey, factors: null })) as JourneyAssuranceResponse;
    state.run.mockResolvedValueOnce(wire);
    renderPage();
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getByText('No supported readiness factors are available.')).toBeVisible());
    assertOperationalMetricUnavailable(screen.getByTestId('advanced-intelligence-journey-brief'), 'Arrival SoC high');
    expect(screen.getAllByText('Observed vehicle energy, not a simulated outcome.').length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });

  it('keeps unrecognized factor status neutral and preserves its source identity', async () => {
    state.run.mockResolvedValueOnce({ ...journey, factors: [{
      factor: 'a-long-new-factor-identity', status: 'new_source_state', score_pct: null,
      explanation: 'Unclassified source status is not a warning or success.',
    }] });
    renderPage();
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getByText('new_source_state')).toBeVisible());
    expect(screen.getByRole('article')).toHaveTextContent('a-long-new-factor-identity');
    expect(screen.getByRole('article')).toHaveTextContent('—');
    expect(screen.getByText('new_source_state')).toHaveClass('text-[var(--text-secondary)]');
  });

  it('rejects a late old vehicle result while preserving the editable unsent scenario', async () => {
    let settle!: (value: JourneyAssuranceResponse) => void;
    state.run.mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
    const view = renderPage();
    fireEvent.click(runButton());
    await waitFor(() => expect(state.run).toHaveBeenCalledTimes(1));
    state.vehicleId = 8;
    view.rerender(<JourneyAssurancePage />);
    await act(async () => { settle(journey); });
    expect(screen.queryByText('observed charge')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Journey readiness assessment' })).not.toBeInTheDocument();
    assertOperationalBriefDisclosure(
      screen.getByTestId('advanced-intelligence-journey-brief'), 'Vehicle #8', { contains: true });
    expect(screen.getByLabelText(/Route distance/)).toHaveValue(250000);
    expect(state.run.mock.calls[0][0].vehicle_id).toBe(7);
  });
});
