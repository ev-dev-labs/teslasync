import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ComponentType, ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import postcss, { type Rule } from 'postcss';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/feedback';
import { setAppDesignTestProfile } from '@/components/feedback/appDesignCss.test-utils';
import { observeAppDesignScopes, APP_DESIGN_PACK_FILES } from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import type {
  ChargingSiteTwinRequest, ChargingSiteTwinResponse, ResiliencePlanRequest,
  ResiliencePlanResponse, TwinScenarioInput,
} from '@/types/advancedIntelligence';
import { TwinScenarioForm } from '../components/TwinScenarioForm';
import BehavioralSentinelPage from './BehavioralSentinelPage';
import CausalExperimentationPage from './CausalExperimentationPage';
import ChargingSiteTwinPage from './ChargingSiteTwinPage';
import EmergencyResiliencePage from './EmergencyResiliencePage';
import FederatedLearningStudioPage from './FederatedLearningStudioPage';
import { causal, modelCard, observation, quality, resilience, sentinel, site } from './advancedIntelligenceClosure.fixtures';

const state = vi.hoisted(() => ({
  site: vi.fn<(input: ChargingSiteTwinRequest) => Promise<ChargingSiteTwinResponse>>(),
  resilience: vi.fn<(input: ResiliencePlanRequest) => Promise<ResiliencePlanResponse>>(),
  write: vi.fn(),
}));

vi.mock('@/api/hooks/useAdvancedIntelligence', () => ({
  useBehavioralSentinel: () => ({
    data: sentinel, isSuccess: true, fetchStatus: 'idle',
  }),
  useCausalExperiments: () => ({
    data: {
      items: ['estimated', 'insufficient', 'non_causal', 'unknown-source-state'].map((status, index) => ({
        ...causal, id: index + 1, state: status,
      })),
      total: 4, limit: 10, offset: 0,
    },
    isSuccess: true, fetchStatus: 'idle',
  }),
  useCreateCausalExperiment: () => ({ mutate: state.write, reset: vi.fn(), isPending: false }),
  useRunChargingSiteTwin: () => useMutation({ mutationFn: state.site }),
  useCreateResiliencePlan: () => useMutation({ mutationFn: state.resilience }),
  useFederatedModelCards: () => ({
    data: {
      vehicle_id: 7, items: [modelCard, {
        ...modelCard, id: 32, model_name: 'Unknown-source-model-'.repeat(8), latest_sample_count: null,
        latest_status: null,
      }],
      total: 2, limit: 12, offset: 0, total_epsilon_budget: 4, total_epsilon_spent: 3,
      data_quality: quality, evidence: [observation],
    },
    isSuccess: true, fetchStatus: 'idle',
  }),
  useStartFederatedRound: () => ({ mutate: state.write, isPending: false }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: 7 }),
}));
vi.mock('@/api/hooks/useStormguard', () => ({
  useStormguardStatus: () => ({ data: undefined, isLoading: false, isError: false }),
  useStormguardEvents: () => ({ data: [], isLoading: false, isError: false }),
  useSaveStormguardConfig: () => ({ mutate: state.write, reset: vi.fn(), isPending: false, isError: false }),
}));

function stylesheet(...names: string[]) {
  const rules: Rule[] = [];
  postcss.parse(readFileSync(resolve(
    process.cwd(), 'src', 'components', 'ui', 'app-designs', ...names,
  ), 'utf8')).walkRules(rule => { rules.push(rule); });
  return rules;
}

const baseRules = stylesheet('base.css');
const feedbackRules = stylesheet('feedback.css');
const packRules = new Map(PACK_IDS.map(pack => [pack, stylesheet('packs', APP_DESIGN_PACK_FILES[pack])]));

function consumes(node: Element, rules: readonly Rule[], contract: string, property?: string) {
  return rules.some(rule => rule.selector.includes(contract) && node.matches(rule.selector)
    && rule.nodes.some(declaration => declaration.type === 'decl'
      && (property === undefined || declaration.prop === property)));
}

function checkSurfaceActivation(host: Element, surfaces: Element[], part: 'card' | 'panel', embedded: readonly Element[] = []) {
  const contract = `[data-app-part~="${part}"]`;
  const text = surfaces.map(surface => surface.textContent);
  for (const surface of surfaces) {
    expect(surface).not.toHaveAttribute('data-app-design-owner');
    expect(consumes(surface, baseRules, contract, 'border-radius')).toBe(false);
  }
  host.setAttribute('data-app-design-preview', '');
  for (const pack of PACK_IDS) {
    setAppDesignTestProfile(host, pack);
    const release = observeAppDesignScopes(host);
    try {
      for (const surface of surfaces) {
        if (embedded.includes(surface)) {
          expect(surface).toHaveAttribute('data-surface-variant', 'embedded');
          expect(consumes(surface, baseRules, contract, 'border-radius')).toBe(false);
          expect(consumes(surface, packRules.get(pack)!, contract), pack).toBe(false);
          const frame = surface.parentElement!.closest('[data-surface-variant="standalone"]')!;
          expect(frame).not.toBeNull();
          expect(consumes(frame, packRules.get(pack)!, contract), pack).toBe(true);
          continue;
        }
        expect(surface).toHaveAttribute('data-surface-variant', 'standalone');
        expect(consumes(surface, baseRules, contract, 'border-radius')).toBe(true);
        expect(consumes(surface, packRules.get(pack)!, contract), pack).toBe(true);
        expect(surface.getAttribute('data-app-design-owner')?.split(' ')).toContain(`pack-${pack}`);
      }
      expect(surfaces.map(surface => surface.textContent)).toEqual(text);
    } finally {
      release();
    }
    for (const surface of surfaces) {
      expect(surface).not.toHaveAttribute('data-app-design-owner');
      expect(consumes(surface, packRules.get(pack)!, contract), pack).toBe(false);
    }
  }
  host.removeAttribute('data-app-map');
  const release = observeAppDesignScopes(host);
  try {
    for (const surface of surfaces) expect(surface).not.toHaveAttribute('data-app-design-owner');
    expect(surfaces.map(surface => surface.textContent)).toEqual(text);
  } finally {
    release();
  }
}

const clients: QueryClient[] = [];
function renderSubject(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}>
    <MemoryRouter><ToastProvider>{children}</ToastProvider></MemoryRouter>
  </QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  state.site.mockResolvedValue(site);
  state.resilience.mockResolvedValue(resilience);
});
afterEach(() => {
  clients.forEach(client => client.clear());
  clients.length = 0;
});

describe('Advanced intelligence recorded surface gaps (source-only)', () => {
  it.each([
    { name: 'finding and both detail cards', Page: BehavioralSentinelPage, count: 1 },
    { name: 'all experiment states', Page: CausalExperimentationPage, count: 4 },
    { name: 'submitted mitigations', Page: ChargingSiteTwinPage, count: 2, action: 'Run confirmed site simulation' },
    { name: 'submitted load priorities', Page: EmergencyResiliencePage, count: 2, action: 'Create confirmed outage plan' },
    { name: 'model records and selection', Page: FederatedLearningStudioPage, count: 2 },
  ] satisfies Array<{ name: string; Page: ComponentType; count: number; action?: string }>)(
    'activates all 27 real card consumers for $name without altering content or actions',
    async ({ Page, count, ...item }) => {
      const { container } = renderSubject(<Page />);
      if ('action' in item && item.action) fireEvent.click(screen.getByRole('button', { name: item.action }));
      await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(count));
      const articles = screen.getAllByRole('article');
      const surfaces = articles.flatMap(article => [...article.querySelectorAll('[data-app-part~="card"]')]);
      expect(surfaces).toHaveLength(Page === BehavioralSentinelPage ? 3 : count);
      const formValues = [...container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')]
        .map(input => input.value);
      checkSurfaceActivation(container, surfaces, 'card', Page === BehavioralSentinelPage ? surfaces.slice(1) : []);
      expect([...container.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')]
        .map(input => input.value)).toEqual(formValues);
      expect(state.write).not.toHaveBeenCalled();
      if (Page === ChargingSiteTwinPage) {
        expect(articles[0]).toHaveTextContent('#2');
        expect(articles[0]).toHaveTextContent('Queue -20.00% · peak -2.00 kW');
        expect(articles[1]).toHaveTextContent('Queue 0.00% · peak 0.00 kW');
        setAppDesignTestProfile(container, 'classic');
        const release = observeAppDesignScopes(container);
        try {
          for (const article of articles) {
            for (const [part, property] of [
              ['metric-label', 'white-space'], ['metric-reading', 'column-gap'], ['metric-context', 'white-space'],
            ]) {
              const slot = article.querySelector(`[data-app-part~="${part}"]`)!;
              expect(consumes(slot, feedbackRules, `[data-app-part~="${part}"]`, property)).toBe(true);
            }
            expect(article.querySelector('[data-metric-track], [role="progressbar"]')).toBeNull();
          }
        } finally {
          release();
        }
        expect(state.site).toHaveBeenCalledOnce();
        expect(state.site.mock.calls[0][0].charger_power_w).toBe(11500);
      }
      if (Page === EmergencyResiliencePage) {
        expect(articles[0]).toHaveTextContent('#2Caller priority firstRecommendation only.');
        expect(articles[1]).toHaveTextContent('#1Caller priority secondNo dispatch performed.');
        expect(state.resilience).toHaveBeenCalledOnce();
        expect(state.resilience.mock.calls[0][0].outage_duration_s).toBe(172800);
      }
      if (Page === FederatedLearningStudioPage) {
        fireEvent.click(screen.getByRole('button', { name: 'Use for next local round local-observation-model' }));
        expect(screen.getByLabelText(/^Model name/)).toHaveValue('local-observation-model');
        expect(screen.getByLabelText(/^Expected model-card version/)).toHaveValue(8);
        expect(state.write).not.toHaveBeenCalled();
      }
    },
  );

  it('activates the inherited GlassPanel form fix for all 27 identities while retaining SI callbacks and validation', () => {
    const scenarios: TwinScenarioInput[] = [{
      name: 'Original scenario', distance_m: 60000, speed_mps: 27, horizon_s: 3600,
      outside_temp_c: null, auxiliary_load_w: 0,
    }];
    const original = structuredClone(scenarios);
    const update = vi.fn();
    const submit = vi.fn();
    const { container } = renderSubject(<TwinScenarioForm scenarios={scenarios} pending={false} disabled={false}
      onUpdate={update} onAdd={vi.fn()} onRemove={vi.fn()}
      onSubmit={event => { event.preventDefault(); submit(); }} />);
    const panels = [...container.querySelectorAll('.glass-panel')];
    expect(panels).toHaveLength(1);
    expect(panels[0].querySelectorAll('input')).toHaveLength(6);
    checkSurfaceActivation(container, panels, 'panel');
    expect(screen.getByRole('button', { name: 'Remove scenario' })).toBeDisabled();
    const distance = screen.getByLabelText(/Route distance/) as HTMLInputElement;
    fireEvent.change(distance, { target: { value: '' } });
    expect(distance.validity.valueMissing).toBe(true);
    fireEvent.submit(distance.form!);
    expect(submit).not.toHaveBeenCalled();
    fireEvent.change(distance, { target: { value: '12345.5' } });
    expect(update).toHaveBeenCalledExactlyOnceWith(0, { distance_m: 12345.5 });
    fireEvent.click(screen.getByRole('button', { name: 'Run confirmed simulation' }));
    expect(submit).toHaveBeenCalledOnce();
    expect(scenarios).toEqual(original);
  });
});
