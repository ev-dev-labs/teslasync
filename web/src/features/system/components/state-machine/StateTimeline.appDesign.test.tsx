import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it, vi } from 'vitest';
import { deriveDataState } from '@/api/dataState';
import type { SignalSnapshotResponse } from '@/api/hooks/useTelemetry';
import { matchesAppDesignCss } from '@/components/feedback/appDesignCss.test-utils';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import type { FSMTransition } from '@/types/fsm';
import { StateBadge } from '../StateBadge';
import { LiveControls } from './LiveControls';
import { SnapshotInspector } from './SnapshotInspector';
import { StateTimeline } from './StateTimeline';

const base = postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'base.css'), 'utf8'));
const charts = postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'charts.css'), 'utf8'));
const transition: FSMTransition = {
  id: 11, vehicle_id: 7, fsm_name: 'vehicle', from_state: 'parked',
  to_state: 'driving', trigger: 'speed_changed', ts: '2026-10-01T11:55:00Z',
};
const anchor = new Date('2026-10-01T12:00:00Z');

function chartRules(node: Element, mode: string) {
  const found: Rule[] = [];
  charts.walkRules(rule => {
    if (!rule.selector.includes(`data-app-design-owner~="chart-${mode}"`)) return;
    if (node.matches(rule.selector.replace(/^&\s*/, ''))) found.push(rule);
  });
  return found;
}

describe('FSM native source composition', () => {
  it.each(PACK_IDS)('%s adopts the real toolbar and plot without changing state colors, coordinates or actions', pack => {
    const select = vi.fn();
    const toggle = vi.fn();
    const clear = vi.fn();
    const windowChange = vi.fn();
    const view = render(<div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
      <LiveControls isLive={false} onToggleLive={toggle} onStepPrev={vi.fn()} onStepNext={vi.fn()}
        windowMinutes={360} onWindowChange={windowChange} onClearBuffer={clear}
        windowCount={0} filteredBufferCount={4} loadedCount={50} totalCount={233} />
      <StateTimeline transitions={[
        { ...transition, id: 12, ts: '2026-10-01T11:58:00Z', to_state: 'parked' },
        { ...transition, id: 99, ts: 'not-a-timestamp' },
        transition,
      ]} fsmType="vehicle" anchor={anchor} windowMinutes={10}
        selectedId={11} detailId="actual-transition-detail" onSelect={select} />
      <StateBadge state="unknown-upstream-state" fsmType="vehicle" />
    </div>);
    const release = observeAppDesignScopes(view.container);
    try {
      const toolbar = screen.getByTestId('live-controls');
      const panelRules: string[] = [];
      base.walkRules(rule => {
        panelRules.push(...rule.selectors.filter(selector =>
          selector.includes('[data-app-part~="panel"]') && toolbar.matches(selector)));
      });
      expect(panelRules.length).toBeGreaterThan(0);
      expect(screen.getByTestId('live-controls-counter')).toHaveTextContent(
        '0 in window · 4 in filtered buffer · 50 loaded · 233 matching',
      );
      expect(screen.getByRole('combobox', { name: 'Window' })).toHaveValue('360');
      expect(screen.getByRole('option', { name: '6 h' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Step to previous transition' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Live' }));
      fireEvent.click(screen.getByRole('button', { name: 'Clear buffer' }));
      fireEvent.change(screen.getByRole('combobox', { name: 'Window' }), { target: { value: '120' } });
      expect(toggle).toHaveBeenCalledWith(true);
      expect(clear).toHaveBeenCalledOnce();
      expect(windowChange).toHaveBeenCalledWith(120);
      const plot = screen.getByTestId('state-timeline');
      expect(plot).toHaveAttribute('data-app-part', 'chart');
      const mode = APPLICATION_DESIGNS[pack].chart;
      const scale = plot.querySelector('[data-chart-scale]')!;
      const viewport = plot.querySelector('[data-chart-viewport]')!;
      expect(chartRules(scale, mode).length).toBeGreaterThan(0);
      expect(chartRules(viewport, mode).length).toBeGreaterThan(0);
      for (const rule of chartRules(viewport, mode)) {
        rule.walkDecls(declaration => {
          expect(declaration.prop).not.toMatch(/^(?:height|width|padding.*|left|transform|display)$/);
        });
      }
      expect(viewport).toHaveClass('relative', 'h-10');
      expect([...viewport.querySelectorAll('button')].map(button => button.dataset.testid))
        .toEqual(['state-timeline-tick-11', 'state-timeline-tick-12']);
      const tick = screen.getByTestId('state-timeline-tick-11');
      expect(tick).toHaveStyle({ left: '50%' });
      expect(tick).toHaveClass('bg-green-400', 'h-4', 'w-4');
      expect(tick).toHaveAttribute('aria-pressed', 'true');
      expect(tick).toHaveAttribute('aria-controls', 'actual-transition-detail');
      expect(screen.getByTestId('state-timeline-tick-12')).toHaveStyle({ left: '80%' });
      fireEvent.click(tick);
      expect(select).toHaveBeenCalledWith(transition);
      const badge = screen.getByText('unknown-upstream-state');
      expect(badge).toHaveAttribute('data-app-part', 'badge');
      expect(badge).toHaveClass('bg-gray-500/10', 'text-[var(--text-muted)]');
      expect(matchesAppDesignCss(badge, '[data-app-part~="badge"]').length).toBeGreaterThan(0);
    } finally {
      release();
      view.unmount();
    }
  });

  it.each(PACK_IDS)('%s composes actionable empty windows and only confirmed empty snapshots', async pack => {
    const widen = vi.fn();
    const jump = vi.fn();
    const empty: SignalSnapshotResponse = { vehicle_id: 7, at: transition.ts, count: 0, signals: {} };
    const tree = (snapshot?: SignalSnapshotResponse) => (
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <StateTimeline transitions={[]} fsmType="vehicle" lastTransition={transition}
          widerPreset={1440} onWidenWindow={widen} onJumpToLast={jump} />
        <SnapshotInspector fsmType="vehicle" transition={transition} snapshot={snapshot}
          loading={!snapshot} selectedTrust={deriveDataState({
            data: snapshot, isPending: !snapshot, isFetching: !snapshot, fetchStatus: snapshot ? 'idle' : 'fetching',
          })} />
      </div>
    );
    const view = render(tree());
    const release = observeAppDesignScopes(view.container);
    try {
      const windowEmpty = screen.getByTestId('state-timeline-empty');
      const contract = `[data-app-feedback="${APPLICATION_DESIGNS[pack].feedback}"]`;
      expect(matchesAppDesignCss(windowEmpty, contract).length).toBeGreaterThan(0);
      expect(windowEmpty.querySelector('[data-app-part="feedback-message"]')).not.toBeNull();
      expect(windowEmpty.querySelector('[data-app-part="feedback-actions"]')).not.toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Widen window to 24 h' }));
      fireEvent.click(screen.getByRole('button', { name: 'Jump to last transition' }));
      expect(widen).toHaveBeenCalledOnce();
      expect(jump).toHaveBeenCalledOnce();
      expect(screen.queryByTestId('snapshot-inspector-no-signals')).toBeNull();
      view.rerender(tree(empty));
      await act(async () => {});
      const snapshotEmpty = screen.getByTestId('snapshot-inspector-no-signals');
      expect(snapshotEmpty).toHaveAttribute('role', 'status');
      expect(matchesAppDesignCss(snapshotEmpty, contract).length).toBeGreaterThan(0);
      expect(snapshotEmpty.querySelector('[data-app-part="feedback-message"]'))
        .toHaveTextContent('No signals captured for this transition');
      expect(screen.getByText('speed_changed')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Copy snapshot' })).toBeEnabled();
      expect(screen.getByRole('switch', { name: 'Diff vs previous' })).toBeInTheDocument();
    } finally {
      release();
      view.unmount();
    }
  });

  it('leaves default and incomplete-preview source controls outside the app design', () => {
    const view = render(<div data-app-design-preview="" data-app-design-pack="blueprint">
      <StateTimeline transitions={[transition]} fsmType="vehicle" anchor={anchor} />
      <StateBadge state="charging" fsmType="vehicle" />
    </div>);
    const release = observeAppDesignScopes(view.container);
    try {
      for (const node of view.container.querySelectorAll('[data-app-part]')) {
        expect(node).not.toHaveAttribute('data-app-design-owner');
        expect(matchesAppDesignCss(node)).toEqual([]);
      }
    } finally {
      release();
    }
  });

  it('binds the real plot and badge to the nearest complete profile rather than conflicting root modes', () => {
    const root = document.documentElement;
    const previous = Object.keys(getAppDesignAttributes('v1')).map(name => [name, root.getAttribute(name)] as const);
    for (const [name, value] of Object.entries(getAppDesignAttributes('v1'))) root.setAttribute(name, value);
    const view = render(<div data-app-design-preview="" {...getAppDesignAttributes('blueprint')}>
      <StateTimeline transitions={[transition]} fsmType="vehicle" anchor={anchor} />
      <StateBadge state="charging" fsmType="vehicle" />
    </div>);
    const release = observeAppDesignScopes(root);
    try {
      const plot = screen.getByTestId('state-timeline');
      const scale = plot.querySelector('[data-chart-scale]')!;
      expect(scale.getAttribute('data-app-design-owner')).toContain('pack-blueprint');
      expect(chartRules(scale, 'precision').length).toBeGreaterThan(0);
      expect(chartRules(scale, 'instrument')).toHaveLength(0);
      const badge = screen.getByText('charging');
      expect(badge.getAttribute('data-app-design-owner')).toContain('pack-blueprint');
      expect(badge.getAttribute('data-app-design-owner')).not.toContain('pack-v1');
      expect(badge).toHaveClass('bg-status-activity/10', 'text-status-activity');
    } finally {
      release();
      view.unmount();
      for (const [name, value] of previous) {
        if (value == null) root.removeAttribute(name);
        else root.setAttribute(name, value);
      }
    }
  });
});
