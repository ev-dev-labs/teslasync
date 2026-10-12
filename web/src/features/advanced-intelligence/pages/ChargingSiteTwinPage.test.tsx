import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager, useMutation } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback';
import type { ChargingSiteTwinRequest, ChargingSiteTwinResponse } from '@/types/advancedIntelligence';
import ChargingSiteTwinPage from './ChargingSiteTwinPage';
import { site } from './advancedIntelligenceClosure.fixtures';

const state = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  run: vi.fn<(input: ChargingSiteTwinRequest) => Promise<ChargingSiteTwinResponse>>(),
}));

vi.mock('@/api/hooks/useAdvancedIntelligence', () => ({
  useRunChargingSiteTwin: () => useMutation({ mutationFn: state.run }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: state.vehicleId }),
}));

let client: QueryClient;
function renderPage() {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>
      <MemoryRouter><ToastProvider>{children}</ToastProvider></MemoryRouter>
    </QueryClientProvider>;
  }
  return render(<ChargingSiteTwinPage />, { wrapper });
}
function runButton() {
  return screen.getByRole('button', { name: 'Run confirmed site simulation' });
}
function form() {
  const element = runButton().closest('form');
  if (!element) throw new Error('Scenario form is not mounted');
  return element;
}

beforeEach(() => {
  state.vehicleId = 7;
  state.run.mockReset().mockResolvedValue(site);
  onlineManager.setOnline(true);
  window.localStorage.clear();
});
afterEach(() => {
  client?.clear();
  onlineManager.setOnline(true);
});

describe('Charging site twin scoped modernization', () => {
  it('keeps every initial section and ten fields without inventing a completed mitigation result', () => {
    renderPage();
    for (const title of ['Site scenario', 'Utilization and constraints', 'Ranked mitigations and assumptions']) {
      expect(screen.getByRole('heading', { name: title })).toBeVisible();
    }
    expect(screen.getByText('Design scenario, not site control')).toBeVisible();
    expect(screen.getByText('Charger, panel, solar, or storage control')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Evidence, quality, and limitations' })).toBeVisible();
    expect(form().querySelectorAll('input, select')).toHaveLength(10);
    expect(screen.getByTestId('advanced-intelligence-site-brief')).toHaveTextContent('Not calculated');
    expect(screen.queryByText('No supported mitigations were returned.')).not.toBeInTheDocument();
    expect(runButton()).toHaveClass('min-h-11', 'max-w-full', 'whitespace-normal');
    expect(form().querySelector('.grid')).toHaveClass('@2xl:grid-cols-2', '@5xl:grid-cols-3');
    expect(state.run).not.toHaveBeenCalled();
  });

  it('retains cleared required numeric drafts as blank and prevents a fabricated zero request', () => {
    renderPage();
    for (const label of [/Charger count/, /Per-charger power/, /Panel limit/, /Arrival rate/, /Mean service/, /Fleet growth/]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: '' } });
      expect(screen.getByLabelText(label)).toHaveValue(null);
    }
    expect(screen.queryByText('Display equivalent: 0.00 kW')).not.toBeInTheDocument();
    fireEvent.submit(form());
    expect(state.run).not.toHaveBeenCalled();
  });

  it('submits exact canonical SI and distributions only through the explicit confirmed action', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/Arrival rate/), { target: { value: '0.0000001' } });
    fireEvent.change(screen.getByLabelText(/Fleet growth/), { target: { value: '-12.5' } });
    fireEvent.change(screen.getByLabelText(/Solar power/), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Arrival distribution'), { target: { value: 'fixed' } });
    fireEvent.change(screen.getByLabelText('Service distribution'), { target: { value: 'deterministic' } });
    expect(state.run).not.toHaveBeenCalled();
    fireEvent.click(runButton());
    await waitFor(() => expect(state.run).toHaveBeenCalledTimes(1));
    expect(state.run.mock.calls[0][0]).toEqual({
      vehicle_id: 7, confirmed: true, charger_count: 8, charger_power_w: 11500,
      panel_limit_w: 100000, arrival_rate_per_s: 0.0000001, mean_service_s: 7200,
      fleet_growth_pct: -12.5, solar_power_w: 0, storage_energy_wh: null,
      arrival_distribution: 'fixed', service_distribution: 'deterministic',
    });
  });

  it('rejects a zero arrival rate and preserves server upper bounds', () => {
    renderPage();
    const rate = screen.getByLabelText(/Arrival rate/) as HTMLInputElement;
    fireEvent.change(rate, { target: { value: '0' } });
    expect(rate.validity.customError).toBe(true);
    fireEvent.submit(form());
    expect(state.run).not.toHaveBeenCalled();
    fireEvent.change(rate, { target: { value: '0.0008' } });
    expect(rate.validity.valid).toBe(true);
    for (const [label, max] of [
      [/Panel limit/, '1000000000'], [/Mean service/, '604800'],
      [/Solar power/, '1000000000'], [/Storage energy/, '10000000000'],
    ] as const) {
      expect(screen.getByLabelText(label)).toHaveAttribute('max', max);
    }
    fireEvent.change(screen.getByLabelText(/Panel limit/), { target: { value: '1000000001' } });
    fireEvent.submit(form());
    expect(state.run).not.toHaveBeenCalled();
  });

  it('distinguishes paused first submission from loading without claiming successful empty results', async () => {
    onlineManager.setOnline(false);
    renderPage();
    fireEvent.click(runButton());
    const brief = screen.getByTestId('advanced-intelligence-site-brief');
    await waitFor(() => expect(brief).toHaveTextContent('The initial evidence query is paused'));
    expect(brief).not.toHaveAttribute('aria-busy');
    expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(screen.queryByText('No supported mitigations were returned.')).not.toBeInTheDocument();
    expect(runButton()).toBeDisabled();
    expect(state.run).not.toHaveBeenCalled();
  });

  it('preserves metrics order rank effects assumptions and details while retaining a failed recalculation', async () => {
    state.run.mockResolvedValueOnce(site).mockRejectedValueOnce(new Error('recalculation unavailable'));
    renderPage();
    fireEvent.click(runButton());
    const brief = screen.getByTestId('advanced-intelligence-site-brief');
    await waitFor(() => expect(brief).toHaveTextContent('Limited evidence'));
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(within(brief).getByText('Stable')).toBeInTheDocument();
    const articles = screen.getAllByRole('article');
    expect(articles[0]).toHaveTextContent('#2');
    expect(articles[0]).toHaveTextContent('Caller order first');
    expect(articles[0]).toHaveTextContent('Assumed arrivals only.');
    expect(articles[0].querySelector('span')).toHaveClass('bg-[var(--surface-2)]');
    expect(screen.getByText('Poisson arrivals are modeled, not live charger telemetry.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Per-charger power/), { target: { value: '90000' } });
    fireEvent.click(runButton());
    await waitFor(() => expect(brief).toHaveTextContent('Retained result'));
    expect(within(brief).getByText('0.00 h')).toBeInTheDocument();
    expect(within(brief).getByRole('button', { name: 'Review details' })).toBeEnabled();
    expect(screen.getByText('Previously loaded data remains visible while affected sources recover.')).toBeVisible();
    expect(runButton()).toBeEnabled();
    expect(screen.getByText('Caller order first')).toBeInTheDocument();
    expect(state.run.mock.calls[0][0].charger_power_w).toBe(11500);
  });

  it('handles malformed nullable result arrays without hiding the evidence or six-metric brief', async () => {
    const response = { ...site, mitigations: null, assumptions: null } as unknown as ChargingSiteTwinResponse;
    state.run.mockResolvedValueOnce(response);
    renderPage();
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getByText('No supported mitigations were returned.')).toBeVisible());
    expect(screen.getByTestId('advanced-intelligence-site-brief').querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(screen.getByText('Design approximation only.')).toBeInTheDocument();
  });

  it('clears published vehicle results before a late old-scope response can replace the selected vehicle', async () => {
    let settle!: (value: ChargingSiteTwinResponse) => void;
    state.run.mockResolvedValueOnce(site).mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }));
    const view = renderPage();
    fireEvent.click(runButton());
    await waitFor(() => expect(screen.getByText('Caller order first')).toBeVisible());
    fireEvent.click(runButton());
    await waitFor(() => expect(state.run).toHaveBeenCalledTimes(2));
    state.vehicleId = 8;
    view.rerender(<ChargingSiteTwinPage />);
    expect(screen.queryByText('Caller order first')).not.toBeInTheDocument();
    await act(async () => { settle(site); });
    expect(screen.queryByText('Caller order first')).not.toBeInTheDocument();
    expect(screen.getByTestId('advanced-intelligence-site-brief')).toHaveTextContent('Vehicle #8');
  });
});
