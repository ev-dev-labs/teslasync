import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type Rule } from 'postcss';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveDataState, type DataStateSource } from '@/api/dataState';
import type { StaleChargingSession, StaleDrive } from '@/api/hooks/useDataRepair';
import type { SupportBundleSourceState, UseSupportBundleResult } from '@/api/hooks/useSupport';
import { ToastProvider } from '@/components/feedback';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { buildSupportBundle, serializeSupportBundle } from '@/lib/supportBundle';
import { FSM_STATES, type FSMTransition } from '@/types/fsm';
import { COMMANDS } from '../commands';
import { ChargingRepairForm } from './ChargingRepairForm';
import { CommandDomainBrowser } from './command-center/CommandDomainBrowser';
import { DriveRepairForm } from './DriveRepairForm';
import { FSMHealthPanel } from './FSMHealthPanel';
import { FSMStateDiagram } from './FSMStateDiagram';
import { FSMSubFSMPanel } from './FSMSubFSMPanel';
import { DashboardPresetPanel } from './help-index/DashboardPresetPanel';
import { HelpGlossaryPanel } from './help-index/HelpGlossaryPanel';
import { HelpSearch } from './help-index/HelpSearch';
import { ReleaseNotesPanel } from './help-index/ReleaseNotesPanel';
import { SupportBundlePanel } from './help-index/SupportBundlePanel';
import { IncidentSeverityChip } from './incident/IncidentSeverityChip';
import { InputCommandTile } from './InputCommandTile';
import { RepairCaseCollaboration } from './RepairCaseCollaboration';

const fixture = vi.hoisted(() => ({
  support: {} as UseSupportBundleResult,
  transport: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  favorite: vi.fn(),
  dialog: vi.fn(),
}));
vi.mock('@/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  request: fixture.transport,
}));
vi.mock('@/api/hooks/useSupport', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/hooks/useSupport')>(),
  useSupportBundle: () => fixture.support,
}));

const rules = new Map<string, Array<{ selector: string; properties: string[] }>>();
function consumers(file: string, element: Element, contract: string) {
  if (!rules.has(file)) {
    const flattened: Array<{ selector: string; properties: string[] }> = [];
    const selectors = (rule: Rule): string[] => {
      if (rule.parent?.type !== 'rule') return rule.selectors;
      return selectors(rule.parent).flatMap(parent => rule.selectors.map(selector =>
        selector.includes('&') ? selector.replaceAll('&', parent) : `${parent} ${selector}`));
    };
    postcss.parse(readFileSync(resolve(
      process.cwd(), 'src', 'components', 'ui', 'app-designs', ...file.split('\\'),
    ), 'utf8')).walkRules(rule => {
      const properties = rule.nodes.filter(node => node.type === 'decl').map(node => node.prop);
      selectors(rule).forEach(selector => flattened.push({ selector, properties }));
    });
    rules.set(file, flattened);
  }
  return rules.get(file)!.filter(rule => rule.selector.includes(contract) && element.matches(rule.selector));
}

function source(query: DataStateSource<unknown>): SupportBundleSourceState {
  const { data: _data, ...state } = deriveDataState(query);
  return { ...state, isLoading: query.isLoading === true, isPending: !state.hasData && !state.fatalError, observedAt: null };
}

const drive: StaleDrive = {
  id: 202, vehicle_id: 7, start_ts: '2026-03-29T09:00:00Z', end_ts: null,
  duration_s: null, distance_m: 0, start_battery_pct: 80, end_battery_pct: 80,
  max_speed_mps: 30, avg_speed_mps: 20, energy_used_wh: null,
};
const charging: StaleChargingSession = {
  id: 77, vehicle_id: 3, started_at: '2026-03-30T02:00:00Z', ended_at: null,
  start_soc_pct: 20, end_soc_pct: 82, delta_soc_pct: 62,
  total_energy_added_wh: 0, peak_power_w: 11000, avg_power_w: null,
  cost_decimal: 0, cost_currency: 'USD',
};
const note = {
  id: 11, case_id: 7, actor: 'Evidence reviewer',
  body: 'Original full note\nSecond line retained', created_at: '2026-08-25T10:04:00Z',
};
const transition: FSMTransition = {
  id: 1, vehicle_id: 7, fsm_name: 'vehicle', from_state: 'online', to_state: 'driving',
  trigger: 'speed_detected', ts: '2026-08-25T10:04:00Z',
};
const rows: FSMTransition[] = [
  ...Array.from({ length: 6 }, (_, index) => ({
    ...transition, id: index + 1, ts: `2026-08-25T10:04:${String(index).padStart(2, '0')}Z`,
  })),
  { ...transition, id: 7, fsm_name: 'drive_session', to_state: 'active', ts: '2025-01-01T00:00:00Z' },
  { ...transition, id: 8, fsm_name: 'charge_session', to_state: 'recovered' },
];
const inputDefinition = COMMANDS.find(definition => definition.type === 'input')!;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  fixture.transport.mockReset().mockResolvedValue({});
  fixture.favorite.mockReset();
  fixture.dialog.mockReset();
  const bundle = buildSupportBundle({
    generatedAt: '2026-10-14T07:00:00Z', appVersion: '2.0.0',
    healthOverall: 'degraded', userAgent: 'Firefox/140.0', online: true,
  });
  fixture.support = {
    bundle, json: serializeSupportBundle(bundle), filename: 'support-fixture.json',
    isLoading: false, download: vi.fn(),
    sources: {
      version: source({ data: {}, dataUpdatedAt: 1 }),
      health: source({ data: {}, error: new Error('retained health fixture'), dataUpdatedAt: 2 }),
    },
  };
});

function NativeSources() {
  return <>
    <CommandDomainBrowser activeDomainId="access" vehicleKey={7} onDomainChange={vi.fn()}
      renderTile={definition => <span key={definition.id}>{definition.labelFallback}</span>} />
    <InputCommandTile def={inputDefinition} onRequestDialog={fixture.dialog} loading={false}
      isFavorite={false} onToggleFavorite={fixture.favorite} />
    <DriveRepairForm drive={drive} formId="owned-drive-editor" onClose={vi.fn()} disabled />
    <ChargingRepairForm session={charging} formId="owned-charging-editor" onClose={vi.fn()} disabled />
    <RepairCaseCollaboration caseId={7} comments={[note]} canWrite={false} />
    <FSMSubFSMPanel fsmType="vehicle" activeSubs={[
      { type: 'drive', state: 'active', start_time: transition.ts },
      { type: 'charge', state: 'done', start_time: charging.started_at },
    ]} />
    <FSMHealthPanel transitions={rows} />
    <FSMStateDiagram fsmType="vehicle" transitions={rows} />
    <HelpSearch pathname="/battery" />
    <ReleaseNotesPanel limit={1} />
    <DashboardPresetPanel />
    <HelpGlossaryPanel />
    <SupportBundlePanel />
    <IncidentSeverityChip severity="critical" />
  </>;
}

function renderSources() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}>
    <ToastProvider>
      <MemoryRouter><div data-testid="system-01-scope" data-app-design-preview=""><NativeSources /></div></MemoryRouter>
    </ToastProvider>
  </QueryClientProvider>);
  return { ...view, client, scope: screen.getByTestId('system-01-scope') };
}

describe('system-01 actual source-to-consumer contracts (not rendered acceptance)', () => {
  it('activates every deliberate native record/frame/readout/control/notice/code consumer across all 27 profiles', () => {
    const { container, scope, client, unmount } = renderSources();
    const records = scope.querySelectorAll('[data-app-record-kind]');
    expect(new Set([...records].map(record => record.getAttribute('data-app-record-kind')))).toEqual(new Set([
      'command-domain', 'repair-note', 'fsm-session', 'help-result', 'release-note', 'dashboard-preset',
    ]));
    const exactJson = screen.getByTestId('support-bundle-json');
    const diagram = screen.getByTestId('fsm-node-driving').closest('[data-chart-family="state-machine"]')!;
    const geometry = [...diagram.querySelectorAll('svg')].map(svg => svg.outerHTML);
    for (const pack of PACK_IDS) {
      Object.entries(getAppDesignAttributes(pack)).forEach(([name, value]) => scope.setAttribute(name, value));
      const release = observeAppDesignScopes(container);
      try {
        const mode = APPLICATION_DESIGNS[pack];
        const dataMode = `[data-app-data="${mode.data}"]`;
        for (const record of records) {
          expect(record.getAttribute('data-app-design-owner')).toContain(`pack-${pack}`);
          expect(consumers('feedback.css', record, dataMode), `${pack}: ${record.getAttribute('data-app-record-kind')}`)
            .not.toHaveLength(0);
          expect(consumers(`packs\\${pack}.css`, record, '[data-app-part~="card"]')).not.toHaveLength(0);
          for (const slot of record.querySelectorAll('[data-app-record-slot]')) {
            expect(consumers('feedback.css', slot, dataMode)).not.toHaveLength(0);
          }
        }
        for (const id of ['owned-drive-editor', 'owned-charging-editor']) {
          const editor = document.getElementById(id)!;
          expect(consumers(`packs\\${pack}.css`, editor, '[data-app-part~="panel"]')).not.toHaveLength(0);
          expect(consumers('controls.css', editor, '[data-app-form-section]')).not.toHaveLength(0);
          expect(consumers('controls.css', editor.querySelector('[data-app-form-body]')!, '[data-app-form-body]')).not.toHaveLength(0);
        }
        for (const choice of scope.querySelectorAll('[data-app-choice-surface]')) {
          expect(consumers('controls.css', choice, `[data-app-controls="${mode.controls}"]`)).not.toHaveLength(0);
        }
        const definition = scope.querySelector('dl[data-app-list="definitions"] > [data-app-part="list-row"]')!;
        expect(consumers('feedback.css', definition, dataMode)).not.toHaveLength(0);
        const header = diagram.querySelector('[data-app-part="chart-header"]')!;
        expect(consumers('charts.css', header, `[data-app-chart="${mode.chart}"]`)).not.toHaveLength(0);
        for (const readout of diagram.querySelectorAll('[data-chart-readout]')) {
          expect(consumers('charts.css', readout, `[data-app-chart="${mode.chart}"]`)).not.toHaveLength(0);
          expect(readout.querySelector('[data-app-part~="metric-label"]')).not.toBeNull();
          if (readout.getAttribute('data-chart-readout') === 'edge' ||
            ['fsm-node-online', 'fsm-node-driving'].includes(readout.getAttribute('data-testid') ?? '')) {
            expect(readout.querySelector('[data-app-part~="metric-reading"]')).not.toBeNull();
          } else {
            expect(readout.querySelector('[data-app-part~="metric-reading"]')).toBeNull();
          }
        }
        for (const notice of scope.querySelectorAll('[data-app-feedback-kind="notice"]')) {
          expect(consumers('feedback.css', notice, `[data-app-feedback="${mode.feedback}"]`)).not.toHaveLength(0);
          expect(notice.querySelector(':scope > [data-app-part="feedback-content"] [data-app-part~="feedback-title"]')).not.toBeNull();
          expect(notice.querySelector('[data-app-part~="feedback-message"]')).not.toBeNull();
        }
        expect(consumers('feedback.css', exactJson, dataMode)).not.toHaveLength(0);
        for (const rule of consumers('feedback.css', exactJson, '[data-app-code-kind="support-bundle"]')) {
          expect(rule.properties.some(property => /^(?:white-space|overflow|font|width|height|padding|color|background)/.test(property))).toBe(false);
        }
        const severity = screen.getByText('Critical');
        expect(consumers(`packs\\${pack}.css`, severity, '[data-app-part~="badge"]')).not.toHaveLength(0);
        expect(severity).toHaveAttribute('data-app-variant', 'danger');
        expect(severity.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
        expect(screen.getByTestId('fsm-node-driving')).toHaveAttribute('aria-current', 'true');
        expect(screen.getByTestId('fsm-node-driving').querySelector('[data-app-part="metric-context"]')).toHaveTextContent('current state');
        expect(exactJson.textContent).toBe(fixture.support.json);
        expect(screen.getByText(/Original full note/).textContent).toBe(note.body);
        expect([...diagram.querySelectorAll('svg')].map(svg => svg.outerHTML.replace(/ data-app-design-owner="[^"]*"/g, ''))).toEqual(geometry);
        expect(within(screen.getByRole('region', { name: 'Repair drive #202' })).getByLabelText('Distance (m)')).toHaveValue(0);
        expect(within(screen.getByRole('region', { name: 'Repair charging session #77' })).getByLabelText('Avg power (w)')).toHaveValue(null);
      } finally {
        release();
      }
    }
    expect(screen.getByText(/not authoritative current FSM health/)).toBeVisible();
    expect(screen.getByTestId('fsm-health-alert-recovery')).toHaveTextContent('cause is not established');
    expect(screen.getByTestId('support-source-health')).toHaveTextContent('Cached · refresh failed');
    expect(screen.getByTestId('support-source-health')).toHaveTextContent('degraded');
    expect(screen.getByTestId('support-bundle-never').querySelectorAll('li')).toHaveLength(5);
    expect(screen.getByTestId('support-bundle-json')).toHaveClass('max-h-80', 'overflow-auto');
    const tile = screen.getByRole('button', { name: inputDefinition.labelFallback });
    fireEvent.keyDown(tile, { key: 'Enter' });
    expect(fixture.dialog).toHaveBeenCalledExactlyOnceWith(inputDefinition);
    fireEvent.click(screen.getByRole('button', { name: 'Toggle favorite' }));
    expect(fixture.favorite).toHaveBeenCalledOnce();
    expect(fixture.dialog).toHaveBeenCalledTimes(1);
    unmount();
    client.clear();
  }, 30_000);

  it('keeps missing observations, actual loading and retained evidence distinct under every profile', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    fixture.support.sources.version = source({ isLoading: true, isPending: true, fetchStatus: 'fetching' });
    const { container, unmount } = render(<QueryClientProvider client={client}>
      <MemoryRouter><div data-testid="system-01-scope" data-app-design-preview="">
        <FSMHealthPanel transitions={[]} isLoading sourceState={deriveDataState({ isPending: true, fetchStatus: 'fetching' })} />
        <FSMStateDiagram fsmType="vehicle" transitions={[]} />
        <SupportBundlePanel />
      </div></MemoryRouter>
    </QueryClientProvider>);
    const scope = screen.getByTestId('system-01-scope');
    for (const pack of PACK_IDS) {
      Object.entries(getAppDesignAttributes(pack)).forEach(([name, value]) => scope.setAttribute(name, value));
      const release = observeAppDesignScopes(container);
      try {
        const skeletons = scope.querySelectorAll('[data-app-part~="skeleton"]');
        expect(skeletons).toHaveLength(2);
        for (const skeleton of skeletons) {
          expect(consumers('feedback.css', skeleton, '[data-app-part~="skeleton"]')).not.toHaveLength(0);
          expect(consumers(`packs\\${pack}.css`, skeleton, '[data-app-part~="skeleton"]')).not.toHaveLength(0);
        }
        expect(screen.getByRole('status', { name: 'Loading' })).toBeVisible();
        expect(screen.queryByTestId('fsm-health-all-clear')).not.toBeInTheDocument();
        expect(scope.querySelectorAll('[data-testid^="fsm-node-"]')).toHaveLength(FSM_STATES.vehicle.length);
        expect(scope.querySelector('[aria-current]')).toBeNull();
        expect(scope.querySelector('[data-chart-readout] [data-app-part~="metric-reading"]')).toBeNull();
        expect(screen.queryByTestId('fsm-edge-summary')).not.toBeInTheDocument();
        expect(screen.getByTestId('support-source-health')).toHaveTextContent('Cached · refresh failed');
        expect(screen.getByRole('button', { name: 'Copy bundle' })).toBeEnabled();
        expect(screen.getByTestId('support-bundle-json').textContent).toBe(fixture.support.json);
      } finally {
        release();
      }
    }
    unmount();
    client.clear();
  }, 30_000);

  it('does not style unselected/widget-only sources or borrow an ancestor profile across an incomplete preview', () => {
    const { container, scope, client, unmount } = renderSources();
    const record = scope.querySelector('[data-app-record-kind="repair-note"]')!;
    let release = observeAppDesignScopes(container);
    expect(record).not.toHaveAttribute('data-app-design-owner');
    expect(consumers('feedback.css', record, '[data-app-record-kind="repair-note"]')).toHaveLength(0);
    release();
    const ancestor = document.createElement('div');
    ancestor.setAttribute('data-app-design-preview', '');
    Object.entries(getAppDesignAttributes('v1')).forEach(([name, value]) => ancestor.setAttribute(name, value));
    container.before(ancestor);
    ancestor.append(container);
    Object.entries(getAppDesignAttributes('blueprint')).forEach(([name, value]) => scope.setAttribute(name, value));
    release = observeAppDesignScopes(ancestor);
    try {
      expect(record.getAttribute('data-app-design-owner')).toContain('pack-blueprint');
      expect(record.getAttribute('data-app-design-owner')).not.toContain('pack-v1');
      expect(consumers('feedback.css', record, '[data-app-data="ledger"]')).not.toHaveLength(0);
    } finally {
      release();
    }
    scope.removeAttribute('data-app-data');
    release = observeAppDesignScopes(ancestor);
    try {
      expect(ancestor.getAttribute('data-app-design-owner')).toContain('pack-v1');
      for (const source of scope.querySelectorAll('[data-app-part]')) expect(source).not.toHaveAttribute('data-app-design-owner');
      expect(consumers('feedback.css', record, '[data-app-record-kind="repair-note"]')).toHaveLength(0);
      expect(screen.getByTestId('support-bundle-json').textContent).toBe(fixture.support.json);
    } finally {
      release();
      unmount();
      client.clear();
      ancestor.remove();
    }
  });
});
