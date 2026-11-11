import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type Rule } from 'postcss';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Power } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import type { RepairCase, RepairImpactPreview, RepairSuggestion } from '@/api/hooks/useDataRepair';
import { deriveDataState } from '@/api/dataState';
import type { FSMTransition } from '@/types/fsm';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import {
  APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes,
} from '@/components/ui/app-designs/designs';
import { RepairCaseEvidencePanel } from './RepairCaseEvidencePanel';
import { RepairEvidenceTimeline } from './RepairEvidenceTimeline';
import { RepairImpactSummary } from './RepairImpactSummary';
import { StateBadge } from './StateBadge';
import { ToggleCommandTile } from './ToggleCommandTile';
import { SearchResultGroup } from './search/SearchResultGroup';
import { LiveControls } from './state-machine/LiveControls';
import { StateTimeline } from './state-machine/StateTimeline';
import { SnapshotInspector } from './state-machine/SnapshotInspector';

const ruleCache = new Map<string, Array<{ selector: string; properties: string[] }>>();
function consumers(file: string, element: Element, contract: string) {
  let rules = ruleCache.get(file);
  if (!rules) {
    rules = [];
    const selectors = (rule: Rule): string[] => {
      if (rule.parent?.type !== 'rule') return rule.selectors;
      const parents = selectors(rule.parent);
      return parents.flatMap(parent => rule.selectors.map(selector =>
        selector.includes('&') ? selector.replaceAll('&', parent) : `${parent} ${selector}`));
    };
    postcss.parse(readFileSync(resolve(
      process.cwd(), 'src', 'components', 'ui', 'app-designs', ...file.split('\\'),
    ), 'utf8')).walkRules(rule => {
      const properties = (rule.nodes ?? []).filter(node => node.type === 'decl').map(node => node.prop);
      for (const selector of selectors(rule)) rules!.push({ selector, properties });
    });
    ruleCache.set(file, rules);
  }
  return rules.filter(rule => rule.selector.includes(contract) && element.matches(rule.selector));
}

const repairCase: RepairCase = {
  id: 7, fingerprint: 'synthetic-evidence', kind: 'drive', session_id: 42, vehicle_id: 3,
  rule: 'drive_open_charging_started', confidence: 'high', status: 'open', applicable: true,
  evidence_started_at: '2026-08-25T09:00:00Z', evidence_gap_s: 120.125,
  evidence_last_in_session_ts: '2026-08-25T09:58:00Z',
  evidence_last_in_session_src: 'signal_log', evidence_last_in_session_field: 'gear',
  evidence_last_in_session_value: 'D\nunchanged source',
  evidence_contradiction_ts: '2026-08-25T10:00:00Z',
  evidence_contradiction_src: 'charging_sessions', evidence_contradiction_field: 'energy_used_wh',
  evidence_contradiction_value: '-1.00123456789',
  first_seen_at: '2026-08-25T10:01:00Z', last_seen_at: '2026-08-25T10:02:00Z',
  created_at: '2026-08-25T10:01:00Z', updated_at: '2026-08-25T10:02:00Z',
};
const suggestion: RepairSuggestion = {
  kind: 'drive', session_id: 42, vehicle_id: 3, rule: repairCase.rule, confidence: 'high',
  applicable: true, started_at: repairCase.evidence_started_at,
  stored_ended_at: null, stored_duration_s: null,
  suggested_ended_at: '2026-08-25T09:59:00Z', suggested_duration_s: 3540, evidence_gap_s: 120.125,
  last_in_session_evidence: {
    ts: repairCase.evidence_last_in_session_ts!, source: 'signal_log', field: 'gear', value: 'D',
  },
  contradicting_evidence: {
    ts: repairCase.evidence_contradiction_ts, source: 'charging_sessions', field: 'started_at', value: '#9',
  },
};
const impact: RepairImpactPreview = {
  kind: 'drive', session_id: 42, rule: repairCase.rule, source: 'suggestion', status: 'ready',
  started_at: repairCase.evidence_started_at, current_ended_at: null,
  proposed_ended_at: suggestion.suggested_ended_at, current_duration_s: null, proposed_duration_s: 3540,
  fields_changed: [{
    field: 'duration_s', before: { type: 'null', null: true }, after: { type: 'float64', float64: 3540.001 },
  }],
  fields_preserved: [{ field: 'distance_m', value: { type: 'float64', float64: 1234.56789 }, reason: 'measured' }],
  warnings: [],
};
const earlier: FSMTransition = {
  id: 11, vehicle_id: 3, fsm_name: 'vehicle', from_state: 'online', to_state: 'driving',
  trigger: 'synthetic-trigger', ts: '2026-08-25T11:52:30Z',
};
const later: FSMTransition = {
  ...earlier, id: 12, from_state: 'driving', to_state: 'charging', ts: '2026-08-25T11:57:30Z',
};
const emptySnapshot = { vehicle_id: 3, at: later.ts, count: 0, signals: {} };

describe('owned system native design consumers (source-only)', () => {
  it.each(PACK_IDS)('%s adopts actual frames, notices, readings and controls without changing source or geometry', pack => {
    const onSelect = vi.fn();
    const clear = vi.fn();
    const jump = vi.fn();
    const widen = vi.fn();
    const execute = vi.fn();
    const favorite = vi.fn();
    const originals = structuredClone({ repairCase, suggestion, impact, earlier, later });
    const view = render(<MemoryRouter>
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <RepairCaseEvidencePanel repairCase={repairCase} />
        <RepairEvidenceTimeline suggestion={suggestion} />
        <RepairImpactSummary preview={impact} />
        <StateBadge state="parked" fsmType="vehicle" />
        <ToggleCommandTile
          def={{ id: 'climate', command: 'synthetic-on', commandOff: 'synthetic-off',
            labelKey: 'commands.climate.toggle', labelFallback: 'Climate', icon: Power,
            category: 'climate', type: 'toggle' }}
          state={null} onExecute={execute} onRequestDialog={vi.fn()} loading={false}
          isFavorite={false} onToggleFavorite={favorite}
        />
        <SearchResultGroup group={{ type: 'drive', hits: [{
          id: 42, type: 'drive', title: 'Complete synthetic result', subtitle: 'Unmodified source context',
          url: '/drives/42', score: 1, when: later.ts,
        }] }} />
        <LiveControls isLive={false} onToggleLive={vi.fn()} onStepPrev={vi.fn()}
          onStepNext={vi.fn()} windowMinutes={1440} onWindowChange={vi.fn()} onClearBuffer={clear}
          windowCount={2} filteredBufferCount={4} loadedCount={50} totalCount={233}
        />
        <StateTimeline transitions={[later, earlier]} fsmType="vehicle" selectedId={12}
          detailId="retained-detail" anchor={new Date('2026-08-25T12:00:00Z')} onSelect={onSelect} />
        <StateTimeline transitions={[]} fsmType="vehicle" lastTransition={earlier}
          widerPreset={360} onWidenWindow={widen} onJumpToLast={jump} />
        <SnapshotInspector fsmType="vehicle" transition={later} snapshot={emptySnapshot}
          selectedTrust={deriveDataState({ data: emptySnapshot })} />
      </div>
    </MemoryRouter>);
    const release = observeAppDesignScopes(view.container);
    try {
      const mode = APPLICATION_DESIGNS[pack];
      const identity = `packs\\${pack}.css`;
      for (const frame of [
        screen.getByTestId('live-controls'), screen.getByRole('region', { name: 'Evidence timeline' }),
      ]) {
        expect(consumers('base.css', frame, '[data-app-part~="panel"]').length).toBeGreaterThan(0);
        expect(consumers(identity, frame, '[data-app-part~="panel"]').length).toBeGreaterThan(0);
      }
      const notices = view.container.querySelectorAll('[data-app-feedback-kind="notice"]');
      expect(notices).toHaveLength(3);
      for (const notice of notices) {
        expect(consumers('feedback.css', notice, `[data-app-feedback="${mode.feedback}"]`).length).toBeGreaterThan(0);
        const content = notice.querySelector(':scope > [data-app-part~="feedback-content"]')!;
        expect(consumers('feedback.css', content, '[data-app-part~="feedback-content"]').length).toBeGreaterThan(0);
        expect(notice.querySelector('[data-app-part~="feedback-title"]')).not.toBeNull();
        expect(notice.querySelector('[data-app-part~="feedback-message"]')).not.toBeNull();
      }
      expect(notices[1]).toHaveAttribute('data-app-tone', 'warning');
      expect(notices[1]).toHaveTextContent('charging_sessions · energy_used_wh · -1.00123456789');
      expect(notices[0].querySelector('[data-app-part~="feedback-detail"]')?.textContent)
        .toBe('signal_log · gear · D\nunchanged source');
      expect(notices[2]).toHaveTextContent('1 measured fields stay unchanged');
      expect(notices[2]).toHaveTextContent('Distance m');
      expect(screen.getByText('duration_s: — → 3540.001')).toBeVisible();
      const evidence = screen.getByRole('list', { name: 'Evidence timeline' });
      const causalLabels = ['Session started', 'Last evidence the session was still running', 'Contradicting evidence', 'Proposed end'];
      within(evidence).getAllByRole('listitem').forEach((row, index) => {
        expect(within(row).getByText(causalLabels[index])).toBeInTheDocument();
      });

      const badge = screen.getByText('parked');
      expect(consumers(identity, badge, '[data-app-part~="badge"]').length).toBeGreaterThan(0);
      expect(badge).toHaveClass('bg-purple-500/10', 'text-purple-400');
      expect(badge.querySelector('[aria-hidden="true"]')).toHaveClass('bg-purple-400');
      const tile = screen.getByRole('button', { name: 'Climate' });
      expect(tile).toHaveAttribute('data-app-part', 'panel button');
      expect(consumers('controls.css', tile, `[data-app-controls="${mode.controls}"]`).length).toBeGreaterThan(0);
      expect(tile).not.toHaveAttribute('aria-pressed');
      fireEvent.click(tile);
      fireEvent.click(screen.getByRole('button', { name: 'Toggle favorite' }));
      expect(execute).not.toHaveBeenCalled();
      expect(favorite).toHaveBeenCalledOnce();
      const result = screen.getByRole('link', { name: 'Open Complete synthetic result' });
      expect(result).toHaveAttribute('href', '/drives/42');
      expect(consumers('controls.css', result, '[data-app-part~="button"]').length).toBeGreaterThan(0);
      expect(result).toHaveAttribute('data-app-variant', 'ghost');
      expect(screen.getByRole('option', { name: '24 h' })).toHaveProperty('selected', true);
      expect(screen.getByTestId('live-controls-counter')).toHaveTextContent('2 in window · 4 in filtered buffer · 50 loaded · 233 matching');
      fireEvent.click(screen.getByRole('button', { name: 'Clear buffer' }));
      expect(clear).toHaveBeenCalledOnce();

      const chart = screen.getByTestId('state-timeline');
      expect(consumers(identity, chart, '[data-app-part~="chart"]').length).toBeGreaterThan(0);
      const plot = chart.querySelector('[data-chart-viewport]')!;
      expect(plot).toHaveClass('relative', 'h-10');
      const plotConsumers = consumers('charts.css', plot, '[data-chart-viewport]');
      expect(plotConsumers.length).toBeGreaterThan(0);
      for (const rule of plotConsumers) {
        expect(rule.properties.some(property => /^(?:padding|height|width|border-width|border-inline|position|transform|left)/.test(property))).toBe(false);
      }
      expect(consumers('charts.css', chart.querySelector('[data-chart-scale]')!, `[data-app-chart="${mode.chart}"]`).length).toBeGreaterThan(0);
      expect([...plot.querySelectorAll('button')].map(tick => tick.getAttribute('data-testid')))
        .toEqual(['state-timeline-tick-11', 'state-timeline-tick-12']);
      expect(screen.getByTestId('state-timeline-tick-11')).toHaveStyle({ left: '25%' });
      const selected = screen.getByTestId('state-timeline-tick-12');
      expect(selected).toHaveStyle({ left: '75%' });
      expect(selected).toHaveAttribute('aria-pressed', 'true');
      expect(selected).toHaveAttribute('aria-controls', 'retained-detail');
      fireEvent.click(selected);
      expect(onSelect).toHaveBeenCalledExactlyOnceWith(later);
      for (const empty of [
        screen.getByTestId('state-timeline-empty'), screen.getByTestId('snapshot-inspector-no-signals'),
      ]) {
        expect(consumers('feedback.css', empty, `[data-app-feedback="${mode.feedback}"]`).length).toBeGreaterThan(0);
        expect(empty.querySelector('[data-app-part~="feedback-message"]')).not.toBeNull();
      }
      fireEvent.click(screen.getByTestId('state-timeline-widen'));
      fireEvent.click(screen.getByTestId('state-timeline-jump'));
      expect(widen).toHaveBeenCalledOnce();
      expect(jump).toHaveBeenCalledOnce();
      expect({ repairCase, suggestion, impact, earlier, later }).toEqual(originals);
    } finally {
      release();
      view.unmount();
    }
  });

  it('does not borrow a live profile across a complete or incomplete native preview', () => {
    const names = Object.keys(getAppDesignAttributes('classic'));
    const root = document.documentElement;
    const previous = names.map(name => [name, root.getAttribute(name)] as const);
    Object.entries(getAppDesignAttributes('v1')).forEach(([name, value]) => root.setAttribute(name, value));
    const view = render(<>
      <div data-testid="complete" data-app-design-preview="" {...getAppDesignAttributes('blueprint')}>
        <StateBadge state="parked" fsmType="vehicle" />
      </div>
      <div data-testid="incomplete" data-app-design-preview="" data-app-design-pack="v1">
        <StateBadge state="parked" fsmType="vehicle" />
      </div>
    </>);
    const release = observeAppDesignScopes(view.container);
    try {
      const complete = within(screen.getByTestId('complete')).getByText('parked');
      const incomplete = within(screen.getByTestId('incomplete')).getByText('parked');
      expect(complete.getAttribute('data-app-design-owner')).toContain('pack-blueprint');
      expect(complete.getAttribute('data-app-design-owner')).not.toContain('pack-v1');
      expect(incomplete).not.toHaveAttribute('data-app-design-owner');
      expect(consumers('packs\\v1.css', incomplete, '[data-app-part~="badge"]')).toHaveLength(0);
    } finally {
      release();
      view.unmount();
      for (const [name, value] of previous) {
        if (value === null) root.removeAttribute(name);
        else root.setAttribute(name, value);
      }
    }
  });
});
