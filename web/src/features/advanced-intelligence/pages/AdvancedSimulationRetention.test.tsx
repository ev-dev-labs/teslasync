import type { ComponentType, ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ToastProvider } from '@/components/feedback';
import { formatDateTime } from '@/lib/dateFormat';
import type {
  ChargingSiteTwinRequest, ChargingSiteTwinResponse,
  JourneyAssuranceRequest, JourneyAssuranceResponse,
  ResiliencePlanRequest, ResiliencePlanResponse, TwinLabRequest, TwinLabResponse,
} from '@/types/advancedIntelligence';
import TwinLabPage from './TwinLabPage';
import JourneyAssurancePage from './JourneyAssurancePage';
import ChargingSiteTwinPage from './ChargingSiteTwinPage';
import EmergencyResiliencePage from './EmergencyResiliencePage';
import { twin, journey, site, resilience, quality, observation } from './advancedIntelligenceClosure.fixtures';

const state = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  twin: vi.fn<(inputs: TwinLabRequest) => Promise<TwinLabResponse>>(),
  journey: vi.fn<(inputs: JourneyAssuranceRequest) => Promise<JourneyAssuranceResponse>>(),
  site: vi.fn<(inputs: ChargingSiteTwinRequest) => Promise<ChargingSiteTwinResponse>>(),
  resilience: vi.fn<(inputs: ResiliencePlanRequest) => Promise<ResiliencePlanResponse>>(),
}));

// Real mutation observers clear data between requests; only API boundaries
// are replaced. Briefs, drawers, forms, chart tables and export controls are real.
vi.mock('@/api/hooks/useAdvancedIntelligence', () => ({
  useRunTwinLab: () => useMutation({ mutationFn: state.twin }),
  useRunJourneyAssurance: () => useMutation({ mutationFn: state.journey }),
  useRunChargingSiteTwin: () => useMutation({ mutationFn: state.site }),
  useCreateResiliencePlan: () => useMutation({ mutationFn: state.resilience }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: state.vehicleId }),
}));
vi.mock('@/api/hooks/useStormguard', () => ({
  useStormguardStatus: () => ({ data: undefined, isLoading: false, isError: false }),
  useStormguardEvents: () => ({ data: [], isLoading: false, isError: false }),
  useSaveStormguardConfig: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function renderPage(Page: ComponentType) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>
      <MemoryRouter><ToastProvider>{children}</ToastProvider></MemoryRouter>
    </QueryClientProvider>;
  }
  return render(<Page />, { wrapper });
}

function subject<TInputs, TData extends { vehicle_id: number; generated_at: string }>(
  name: string,
  Page: ComponentType,
  handler: Mock<(inputs: TInputs) => Promise<TData>>,
  response: TData,
  title: string,
  runLabel: string,
  editLabel: RegExp,
  preservedSection: string,
  briefId: string,
  chartTitle?: string,
) {
  return {
    name, Page, title, runLabel, editLabel, preservedSection, briefId, chartTitle,
    prepare() {
      const held = deferred<TData>();
      handler.mockResolvedValueOnce(response).mockImplementationOnce(() => held.promise);
      return {
        reject: held.reject,
        resolve: () => held.resolve({
          ...response, generated_at: '2026-08-05T00:00:00Z',
        }),
      };
    },
    firstInputs: () => structuredClone(handler.mock.calls[0]?.[0]),
    callCount: () => handler.mock.calls.length,
    recover() {
      handler.mockResolvedValueOnce({ ...response, generated_at: '2026-08-05T00:00:00Z' });
    },
    initialFailure() {
      handler.mockRejectedValueOnce(new Error('initial simulation unavailable'));
    },
  };
}

const subjects = [
  subject('twin', TwinLabPage, state.twin, twin, 'Calibrated baseline',
    'Run confirmed simulation', /Route distance/, 'Sensitivity drivers',
    'advanced-intelligence-twin-brief', 'Range-effect uncertainty comparison'),
  subject('journey', JourneyAssurancePage, state.journey, journey, 'Readiness and arrival range',
    'Run confirmed readiness assessment', /Route distance/, 'Readiness factors',
    'advanced-intelligence-journey-brief'),
  subject('site', ChargingSiteTwinPage, state.site, site, 'Utilization and constraints',
    'Run confirmed site simulation', /Per-charger power/, 'Ranked mitigations and assumptions',
    'advanced-intelligence-site-brief'),
  subject('resilience', EmergencyResiliencePage, state.resilience, resilience, 'Survival horizon',
    'Create confirmed outage plan', /Vehicle energy/, 'Load priorities and recommendations',
    'advanced-intelligence-resilience-brief', 'Outage risk timeline'),
];

function values(brief: HTMLElement) {
  return Array.from(brief.querySelectorAll('[data-operational-metric]')).map(metric => ({
    key: metric.getAttribute('data-operational-metric'),
    state: metric.getAttribute('data-value-state'),
    text: metric.querySelector('[data-operational-value]')?.textContent,
  }));
}

function sourceDrawer(brief: HTMLElement, title: string) {
  fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
  const drawer = screen.getByRole('dialog', { name: `${title} details` });
  expect(drawer).toHaveTextContent(observation.source);
  expect(drawer).toHaveTextContent(observation.summary);
  expect(drawer).toHaveTextContent(quality.reasons[0]);
  expect(drawer).toHaveTextContent('Source quality sample count: 0');
  expect(drawer).toHaveTextContent('Source coverage not supplied');
  return drawer;
}

beforeEach(() => {
  state.vehicleId = 7;
  state.twin.mockReset();
  state.journey.mockReset();
  state.site.mockReset();
  state.resilience.mockReset();
  window.localStorage.clear();
});

describe.each(subjects)('$name publication retention with actual mutation transitions', current => {
  it.each(['success', 'error'] as const)('retains the successful brief/source/chart through pending and %s refresh', async outcome => {
    const held = current.prepare();
    const view = renderPage(current.Page);
    const brief = screen.getByTestId(current.briefId);
    const run = screen.getByRole('button', { name: current.runLabel });
    expect(brief).toHaveTextContent('Not calculated');
    fireEvent.click(run);
    await waitFor(() => expect(brief).toHaveTextContent('Limited evidence'));
    const publishedValues = values(brief);
    const firstInputs = current.firstInputs();
    expect(brief).toHaveTextContent('Vehicle #7');
    expect(brief).toHaveTextContent(formatDateTime(quality.window_start));
    expect(brief).toHaveTextContent(formatDateTime(quality.window_end));
    expect(brief).toHaveTextContent(formatDateTime('2026-08-03T00:00:00Z'));
    expect(screen.getByRole('heading', { name: current.preservedSection })).toBeVisible();
    let chartRows: string | undefined;
    if (current.chartTitle) {
      chartRows = screen.getByRole('table', { name: `${current.chartTitle} — data table` }).textContent ?? '';
    }
    const edit = screen.getAllByLabelText(current.editLabel)[0];
    fireEvent.change(edit, { target: { value: '90000' } });
    fireEvent.click(run);
    await waitFor(() => expect(current.callCount()).toBe(2));
    await waitFor(() => expect(brief).toHaveTextContent('Updating result'));
    expect(run).toBeDisabled();
    expect(brief).not.toHaveAttribute('aria-busy');
    expect(values(brief)).toEqual(publishedValues);
    expect(current.firstInputs()).toEqual(firstInputs);
    expect(brief).toHaveTextContent(formatDateTime('2026-08-03T00:00:00Z'));
    expect(edit).toHaveValue(90000);
    const drawer = sourceDrawer(brief, current.title);
    expect(values(brief)).toEqual(publishedValues);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(drawer).not.toBeInTheDocument();
    if (current.chartTitle) {
      expect(screen.getByRole('table', { name: `${current.chartTitle} — data table` }).textContent).toBe(chartRows);
    }

    if (outcome === 'error') {
      held.reject(new Error('recalculation unavailable'));
      await waitFor(() => expect(brief).toHaveTextContent('Retained result'));
      expect(values(brief)).toEqual(publishedValues);
      expect(brief).toHaveTextContent(formatDateTime('2026-08-03T00:00:00Z'));
      expect(screen.getByText('Previously loaded data remains visible while affected sources recover.')).toBeVisible();
      expect(screen.getByText('recalculation unavailable')).toBeVisible();
      sourceDrawer(brief, current.title);
      fireEvent.keyDown(document, { key: 'Escape' });
      current.recover();
      fireEvent.click(run);
    } else {
      held.resolve();
    }
    await waitFor(() => expect(brief).toHaveTextContent(formatDateTime('2026-08-05T00:00:00Z')));
    expect(brief).toHaveTextContent('Limited evidence');
    expect(brief).not.toHaveTextContent('Retained result');
    expect(run).toBeEnabled();
    expect(values(brief)).toEqual(publishedValues);
    view.unmount();
  });

  it('clears vehicle publication and drawer contents before accepting any late previous-scope response', async () => {
    const held = current.prepare();
    const view = renderPage(current.Page);
    const brief = screen.getByTestId(current.briefId);
    fireEvent.click(screen.getByRole('button', { name: current.runLabel }));
    await waitFor(() => expect(brief).toHaveTextContent('Limited evidence'));
    fireEvent.click(screen.getByRole('button', { name: current.runLabel }));
    await waitFor(() => expect(brief).toHaveTextContent('Updating result'));
    const drawer = sourceDrawer(brief, current.title);
    state.vehicleId = 8;
    view.rerender(<current.Page />);
    expect(brief).toHaveTextContent('Vehicle #8');
    expect(brief).not.toHaveTextContent('Vehicle #7');
    expect(brief).toHaveTextContent('Not calculated');
    expect(brief).toHaveTextContent('Observation window not supplied');
    expect(brief).toHaveTextContent('Result generation time not supplied');
    expect(values(brief).every(metric => metric.state === 'missing')).toBe(true);
    expect(drawer).not.toHaveTextContent(observation.summary);
    expect(drawer).not.toHaveTextContent(quality.reasons[0]);
    expect(drawer).not.toHaveTextContent(formatDateTime('2026-08-03T00:00:00Z'));
    fireEvent.keyDown(document, { key: 'Escape' });
    held.resolve();
    await waitFor(() => expect(screen.getByRole('button', { name: current.runLabel })).toBeEnabled());
    state.vehicleId = 7;
    view.rerender(<current.Page />);
    expect(brief).toHaveTextContent('Not calculated');
    expect(brief).not.toHaveTextContent(formatDateTime('2026-08-03T00:00:00Z'));
    expect(screen.getByRole('heading', { name: current.preservedSection })).toBeVisible();
    state.vehicleId = null;
    view.rerender(<current.Page />);
    expect(brief).toHaveTextContent('Select a vehicle');
    expect(screen.getByRole('button', { name: current.runLabel })).toBeDisabled();
  });

  it('shows an initial error without claiming retained measurements or hiding controls/sections', async () => {
    current.initialFailure();
    renderPage(current.Page);
    const brief = screen.getByTestId(current.briefId);
    fireEvent.click(screen.getByRole('button', { name: current.runLabel }));
    await waitFor(() => expect(brief).toHaveTextContent('Source unavailable'));
    expect(brief).not.toHaveTextContent('Retained result');
    expect(values(brief).every(metric => metric.state === 'missing')).toBe(true);
    expect(screen.getByRole('button', { name: current.runLabel })).toBeEnabled();
    expect(screen.getByRole('heading', { name: current.preservedSection })).toBeVisible();
  });
});
