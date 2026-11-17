import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type Rule } from 'postcss';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { expectAppDesignDataMode, matchesAppDesignCss } from '@/components/feedback/appDesignCss.test-utils';
import { summarizeTarget, type WeekResult } from '../../lib/efficiencyTarget';
import { TargetMethodology } from './TargetMethodology';
import { GoalPulse } from './GoalPulse';

const source = vi.hoisted(() => ({ status: 'ready', hasData: true, fatalError: null as Error | null }));
vi.mock('@/api/hooks/useDriving', () => ({ useDriveHistory: () => ({}) }));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: null, vehicleId: 1 }),
}));
vi.mock('@/hooks/useDataState', () => ({ useDataState: () => source }));

const ready = { isLoading: false, error: null, onRetry: vi.fn() };
const empty = summarizeTarget([], 200, Date.parse('2026-08-08T12:00:00Z'));
const surfaceRules: Rule[] = [];
postcss.parse(readFileSync(resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', 'base.css'), 'utf8'))
  .walkRules(rule => { surfaceRules.push(rule); });

describe('efficiency-target native adoption', () => {
  it('keeps retained completed grading separate from the ungraded active snapshot in both frames', () => {
    const completed: WeekResult = {
      weekStart: '2026-07-27', whPerKm: 180, distanceM: 10_000, energyWh: 1800,
      drives: 2, isActive: false, hit: true, band: 'onTarget', targetGapWhPerKm: -20,
      rolling4WeekWhPerKm: 180, rank: 1,
    };
    source.status = 'stale';
    try {
      render(<GoalPulse summary={{
        ...empty, latestCompletedWeek: completed,
        activeWeek: { ...completed, weekStart: '2026-08-03', isActive: true, hit: null, band: null, rank: null },
      }} state={ready} />);
      const cards = screen.getByTestId('efficiency-target-pulse').querySelectorAll('[data-app-part="card"]');
      expect(cards).toHaveLength(2);
      expect(cards[0]).toHaveTextContent('On target');
      expect(cards[0]).toHaveTextContent('180.00 Wh/km');
      expect(cards[0]).toHaveTextContent('20.00 Wh/km under target');
      expect(cards[1]).toHaveTextContent('In progress · not graded');
      expect(cards[1]).not.toHaveTextContent('On target');
      for (const card of cards) {
        fireEvent.click(within(card as HTMLElement).getByRole('button', { name: 'Review details' }));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('Retained source')).toBeInTheDocument();
        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      }
    } finally {
      source.status = 'ready';
    }
  });

  it.each(PACK_IDS)('%s composes genuine zero coverage and both empty week frames', pack => {
    const { container } = render(
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <TargetMethodology summary={empty} historyLimit={1000} state={ready} />
        <GoalPulse summary={empty} state={ready} />
      </div>,
    );
    const release = observeAppDesignScopes(container.firstElementChild!);
    try {
      const method = screen.getByTestId('efficiency-target-method');
      const tiles = method.querySelectorAll('[data-app-metric="tile"]');
      expect(tiles).toHaveLength(3);
      for (const tile of tiles) {
        expectAppDesignDataMode(tile, APPLICATION_DESIGNS[pack].data, '[data-app-metric="tile"]');
        expect(tile.querySelector('[data-app-part~="metric-reading"]')).toHaveTextContent('0');
        expect(tile.querySelector('[data-app-part~="metric-label"]')).not.toBeEmptyDOMElement();
      }
      const notice = method.querySelector('[data-app-feedback-kind="notice"]')!;
      expect(notice).toHaveTextContent('Results describe the 0 drives returned');
      expect(notice.querySelector('[data-app-part~="feedback-content"] > [data-app-part~="feedback-message"]'))
        .toHaveTextContent('Results describe the 0 drives returned');
      expect(matchesAppDesignCss(notice, `[data-app-feedback="${APPLICATION_DESIGNS[pack].feedback}"]`)
        .some(match => match.declarations.display === 'grid')).toBe(true);
      const pulse = screen.getByTestId('efficiency-target-pulse');
      const cards = pulse.querySelectorAll('[data-app-part="card"][data-surface-variant="standalone"]');
      expect(cards).toHaveLength(2);
      for (const card of cards) {
        expect(surfaceRules.some(rule => rule.nodes.some(node => node.type === 'decl' && node.prop === 'border-radius')
          && rule.selectors.some(selector => card.matches(selector)))).toBe(true);
      }
      expect(within(pulse).getByText('No completed eligible week is available to grade yet.')).toBeInTheDocument();
      expect(within(pulse).getByText('No eligible drives have been observed in the active week.')).toBeInTheDocument();
    } finally {
      release();
    }
  });

  it('retains capped accounting notices without exposing numeric tiles as unavailable', () => {
    const { container, rerender } = render(
      <TargetMethodology summary={{ ...empty, observed: 10, analyzed: 7, excluded: 3, historyCapReached: true }} historyLimit={10} state={ready} />,
    );
    const notices = container.querySelectorAll('[data-app-feedback-kind="notice"]');
    expect(notices).toHaveLength(2);
    expect(notices[0]).toHaveTextContent('7 eligible and 3 excluded across 10 returned rows.');
    expect(notices[1]).toHaveTextContent('older drives may not be represented.');
    source.hasData = false;
    source.fatalError = new Error('offline');
    try {
      rerender(<TargetMethodology summary={empty} historyLimit={10} state={ready} />);
      expect(container.querySelector('[data-app-metric="tile"]')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /retry/i }));
      expect(ready.onRetry).toHaveBeenCalled();
    } finally {
      source.hasData = true;
      source.fatalError = null;
    }
  });
});
