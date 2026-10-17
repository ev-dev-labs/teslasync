import type { ComponentType, ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ToastProvider } from '@/components/feedback';
import { formatDateTime } from '@/lib/dateFormat';
import { assertOperationalBriefDisclosure } from '@/test/operationalBriefAssertions';

const utcDateTime = (value: Parameters<typeof formatDateTime>[0]) => formatDateTime(value, { tz: 'UTC' });
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
  useSaveStormguardConfig: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false, error: null }),
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
  retainedNotices = 1,
) {
  return {
    name, Page, title, runLabel, editLabel, preservedSection, briefId, chartTitle, retainedNotices,
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
    'advanced-intelligence-journey-brief', undefined, 2),
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
    assertOperationalBriefDisclosure(brief, 'Not calculated');
    fireEvent.click(run);
    await waitFor(() => expect(run).toBeEnabled());
    assertOperationalBriefDisclosure(brief, 'Limited evidence');
    const publishedValues = values(brief);
    const firstInputs = current.firstInputs();
    assertOperationalBriefDisclosure(brief, 'Vehicle #7', { contains: true });
    assertOperationalBriefDisclosure(brief, utcDateTime(quality.window_start), { contains: true });
    assertOperationalBriefDisclosure(brief, utcDateTime(quality.window_end), { contains: true });
    assertOperationalBriefDisclosure(brief, utcDateTime('2026-08-03T00:00:00Z'), { contains: true });
    await waitFor(() => expect(screen.getByRole('heading', { name: current.preservedSection })).toBeVisible());
    let chartRows: string | undefined;
    if (current.chartTitle) {
      chartRows = screen.getByRole('table', { name: `${current.chartTitle} — data table` }).textContent ?? '';
    }
    const edit = screen.getAllByLabelText(current.editLabel)[0];
    fireEvent.change(edit, { target: { value: '90000' } });
    fireEvent.click(run);
    await waitFor(() => expect(current.callCount()).toBe(2));
    await waitFor(() => expect(run).toBeDisabled());
    assertOperationalBriefDisclosure(brief, 'Updating result');
    expect(brief).not.toHaveAttribute('aria-busy');
    expect(values(brief)).toEqual(publishedValues);
    expect(current.firstInputs()).toEqual(firstInputs);
    assertOperationalBriefDisclosure(brief, utcDateTime('2026-08-03T00:00:00Z'), { contains: true });
    expect(edit).toHaveValue(90000);
    const drawer = sourceDrawer(brief, current.title);
    expect(values(brief)).toEqual(publishedValues);
    fireEvent.keyDown(screen.getByRole('dialog', { name: `${current.title} details` }), { key: 'Escape' });
    expect(drawer).not.toBeInTheDocument();
    if (current.chartTitle) {
      expect(screen.getByRole('table', { name: `${current.chartTitle} — data table` }).textContent).toBe(chartRows);
    }

    if (outcome === 'error') {
      held.reject(new Error('recalculation unavailable'));
      await waitFor(() => expect(run).toBeEnabled());
      assertOperationalBriefDisclosure(brief, 'Retained result');
      expect(values(brief)).toEqual(publishedValues);
      assertOperationalBriefDisclosure(brief, utcDateTime('2026-08-03T00:00:00Z'), { contains: true });
      const notices = screen.getAllByText('Previously loaded data remains visible while affected sources recover.');
      expect(notices).toHaveLength(current.retainedNotices);
      notices.forEach(notice => expect(notice).toBeVisible());
      expect(screen.getByText('recalculation unavailable')).toBeVisible();
      sourceDrawer(brief, current.title);
      fireEvent.keyDown(screen.getByRole('dialog', { name: `${current.title} details` }), { key: 'Escape' });
      current.recover();
      fireEvent.click(run);
    } else {
      held.resolve();
    }
    await waitFor(() => expect(run).toBeEnabled());
    assertOperationalBriefDisclosure(brief, utcDateTime('2026-08-05T00:00:00Z'), { contains: true });
    assertOperationalBriefDisclosure(brief, 'Limited evidence');
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
    await waitFor(() => expect(screen.getByRole('button', { name: current.runLabel })).toBeEnabled());
    assertOperationalBriefDisclosure(brief, 'Limited evidence');
    fireEvent.click(screen.getByRole('button', { name: current.runLabel }));
    await waitFor(() => expect(screen.getByRole('button', { name: current.runLabel })).toBeDisabled());
    assertOperationalBriefDisclosure(brief, 'Updating result');
    const drawer = sourceDrawer(brief, current.title);
    state.vehicleId = 8;
    view.rerender(<current.Page />);
    expect(drawer).not.toHaveTextContent(observation.summary);
    expect(drawer).not.toHaveTextContent(quality.reasons[0]);
    expect(drawer).not.toHaveTextContent(utcDateTime('2026-08-03T00:00:00Z'));
    fireEvent.keyDown(screen.getByRole('dialog', { name: `${current.title} details` }), { key: 'Escape' });
    assertOperationalBriefDisclosure(brief, 'Vehicle #8', { contains: true });
    assertOperationalBriefDisclosure(brief, 'Vehicle #7', { contains: true, absent: true });
    assertOperationalBriefDisclosure(brief, 'Not calculated');
    assertOperationalBriefDisclosure(brief, 'Observation window not supplied', { contains: true });
    assertOperationalBriefDisclosure(brief, 'Result generation time not supplied', { contains: true });
    expect(values(brief)).toHaveLength(0);
    held.resolve();
    await waitFor(() => expect(screen.getByRole('button', { name: current.runLabel })).toBeEnabled());
    state.vehicleId = 7;
    view.rerender(<current.Page />);
    assertOperationalBriefDisclosure(brief, 'Not calculated');
    assertOperationalBriefDisclosure(brief, utcDateTime('2026-08-03T00:00:00Z'), { contains: true, absent: true });
    await waitFor(() => expect(screen.getByRole('heading', { name: current.preservedSection })).toBeVisible());
    state.vehicleId = null;
    view.rerender(<current.Page />);
    assertOperationalBriefDisclosure(brief, 'Select a vehicle', { contains: true });
    expect(screen.getByRole('button', { name: current.runLabel })).toBeDisabled();
  });

  it('shows an initial error without claiming retained measurements or hiding controls/sections', async () => {
    current.initialFailure();
    renderPage(current.Page);
    const brief = screen.getByTestId(current.briefId);
    fireEvent.click(screen.getByRole('button', { name: current.runLabel }));
    await waitFor(() => expect(screen.getByRole('button', { name: current.runLabel })).toBeEnabled());
    assertOperationalBriefDisclosure(brief, 'Source unavailable');
    expect(brief).not.toHaveTextContent('Retained result');
    expect(values(brief)).toHaveLength(0);
    expect(screen.getByRole('button', { name: current.runLabel })).toBeEnabled();
    await waitFor(() => expect(screen.getByRole('heading', { name: current.preservedSection })).toBeVisible());
  });
});
