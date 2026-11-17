import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import postcss, { type Rule } from 'postcss';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes, APP_DESIGN_PACK_FILES } from '@/components/ui/app-designs/designs';
import { FsdDriveAnalyticsPanels } from './FsdDriveAnalyticsPanels';
import { FsdObservatoryJournalTable } from './FsdObservatoryJournalTable';
import { fsdInsights } from './__tests__/fixtures';

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: null, vehicleId: 1 }),
}));

const ready = { isLoading: false, error: null, onRetry: vi.fn(), noVehicle: false };
function rules(name: string) {
  const result: Rule[] = [];
  postcss.parse(readFileSync(resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', name), 'utf8'))
    .walkRules(rule => { result.push(rule); });
  return result;
}
const controls = rules('controls.css');
const base = rules('base.css');
const feedback = rules('feedback.css');
function consumes(node: Element, sheet: readonly Rule[], property: string, contract = '', value?: string) {
  return sheet.some(rule => rule.nodes.some(declaration => declaration.type === 'decl' && declaration.prop === property
    && (value === undefined || declaration.value === value))
    && rule.selectors.some(selector => selector.includes(contract) && node.matches(selector)));
}

describe('FSD native source-to-consumer contracts (source-only)', () => {
  it.each([false, true])('preserves neutral native rendering without a complete nearest profile (nested=%s)', nested => {
    const { container } = render(<MemoryRouter>
      <div {...(nested ? getAppDesignAttributes('terminal') : {})} data-app-design-preview={nested ? '' : undefined}>
        <div data-app-design-preview={nested ? '' : undefined}>
          <FsdDriveAnalyticsPanels insights={fsdInsights()} state={ready} />
        </div>
      </div>
    </MemoryRouter>);
    const release = observeAppDesignScopes(container.firstElementChild!);
    try {
      const tiles = screen.getByTestId('fsd-attribution').querySelectorAll('[data-app-metric="tile"]');
      expect(tiles).toHaveLength(5);
      for (const tile of tiles) {
        expect(tile).not.toHaveAttribute('data-app-design-owner');
        expect(consumes(tile, feedback, 'padding')).toBe(false);
      }
      const link = screen.getByRole('link', { name: 'Open drive 295' });
      expect(link).toHaveAttribute('href', '/drives/295');
      expect(link).not.toHaveAttribute('data-app-design-owner');
      expect(consumes(link, controls, 'touch-action')).toBe(false);
      expect(link).toHaveClass('focus-visible:outline-2', 'min-h-11', 'min-w-11');
    } finally { release(); }
  });

  it.each(PACK_IDS)('%s composes all five distance buckets, reset records and real anchor controls', pack => {
    const insights = structuredClone(fsdInsights());
    insights.drive_analytics.attribution.attributed_distance_m = 0;
    insights.drive_analytics.attribution.estimated_distance_m = null;
    insights.drive_analytics.reset_events = [{
      field: 'SelfDrivingMilesSinceReset', at: '2026-03-02T12:00:00Z',
      previous_value_m: 9000, current_value_m: 0, affected_drive_ids: [295], firmware_version: null,
    }, {
      field: 'MilesSinceReset', at: '2026-03-02T13:00:00Z',
      previous_value_m: 10000, current_value_m: 20, affected_drive_ids: [], firmware_version: '2026.20.3',
    }];
    const snapshot = JSON.stringify(insights);
    const { container } = render(<MemoryRouter>
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <FsdDriveAnalyticsPanels insights={insights} state={ready} />
        <FsdObservatoryJournalTable events={insights.drive_analytics.observatory.timeline} />
      </div>
    </MemoryRouter>);
    const host = container.firstElementChild!;
    const release = observeAppDesignScopes(host);
    try {
      const design = APPLICATION_DESIGNS[pack];
      const attribution = screen.getByTestId('fsd-attribution');
      const tiles = attribution.querySelectorAll('[data-app-metric="tile"]');
      expect(tiles).toHaveLength(5);
      const labels = ['High-confidence attributed', 'Estimated', 'Ambiguous between drives', 'Outside a known drive', 'Drive distance unknown'];
      tiles.forEach((tile, index) => {
        expect(consumes(tile, feedback, 'padding', `[data-app-data="${design.data}"]`)).toBe(true);
        expect(tile.querySelector('[data-app-part~="metric-label"]')).toHaveTextContent(labels[index]);
        expect(tile.querySelector('[data-app-part~="badge"]')).toHaveAttribute('data-app-variant',
          ['success', 'info', 'warning', 'neutral', 'neutral'][index]);
      });
      expect(tiles[0].querySelector('[data-app-part~="metric-reading"]')).toHaveTextContent('0.00 km');
      expect(tiles[1].querySelector('[data-app-part~="metric-reading"]')).toHaveTextContent('Not measured');
      const resets = within(attribution).getAllByRole('listitem');
      expect(resets).toHaveLength(2);
      for (const reset of resets) {
        expect(reset).toHaveAttribute('data-app-tone', 'warning');
        expect(consumes(reset, feedback, 'display', `[data-app-feedback="${design.feedback}"]`, 'grid')).toBe(true);
        const content = reset.querySelector('[data-app-part~="feedback-content"]')!;
        expect(consumes(content, feedback, 'grid-column', '[data-app-part~="feedback-content"]', '2')).toBe(true);
        expect(content.querySelector('[data-app-part~="feedback-message"]')).toHaveTextContent('Counter moved from');
      }
      expect(resets[0]).toHaveTextContent('9.00 km to 0.00 km');
      expect(resets[1]).toHaveTextContent('2026.20.3');
      expect(within(resets[0]).getByRole('link', { name: '#295' })).toHaveAttribute('href', '/drives/295');
      expect(within(resets[1]).queryByRole('link')).toBeNull();
      const links = host.querySelectorAll('a[href^="/drives/"]');
      expect(links).toHaveLength(5);
      const packRules = rules(join('packs', APP_DESIGN_PACK_FILES[pack]));
      for (const link of links) {
        expect(link).toHaveAttribute('data-app-part', 'button');
        expect(link).toHaveAttribute('data-app-variant', 'ghost');
        expect(link).toHaveAttribute('data-app-size', 'sm');
        expect(consumes(link, controls, 'touch-action')).toBe(true);
        expect(packRules.some(rule => rule.selectors.some(selector =>
          selector.includes('[data-app-part~="button"]') && link.matches(selector)))).toBe(true);
        expect(link).not.toHaveAttribute('role', 'button');
      }
      expect(screen.getByRole('link', { name: 'Open drive 295' }).querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      expect(screen.getByTestId('fsd-observatory-reset')).toHaveTextContent('Break in the stitch — not travelled FSD');
      expect(screen.getAllByTestId('fsd-observatory-drive-fsd')[0]).toHaveTextContent('Not measured');
      expect(JSON.stringify(insights)).toBe(snapshot);
    } finally { release(); }
  });

  it('keeps shell/loading/recovery ownership and never turns absent attribution into zero', () => {
    const retry = vi.fn();
    const content = (isLoading: boolean, error: Error | null) => <MemoryRouter>
      <div data-app-design-preview="" {...getAppDesignAttributes('terminal')}>
        <FsdDriveAnalyticsPanels insights={undefined} state={{ ...ready, isLoading, error, onRetry: retry }} />
      </div>
    </MemoryRouter>;
    const { container, rerender } = render(content(true, null));
    const release = observeAppDesignScopes(container.firstElementChild!);
    try {
      const panels = container.querySelectorAll('[data-app-part="panel"]');
      expect(panels).toHaveLength(8);
      panels.forEach(panel => expect(consumes(panel, base, 'border-radius')).toBe(true));
      expect(screen.getAllByRole('status')).toHaveLength(8);
      expect(container.querySelector('[data-app-metric="tile"]')).toBeNull();
      rerender(content(false, new Error('offline')));
      fireEvent.click(screen.getAllByRole('button', { name: /retry/i })[0]);
      expect(retry).toHaveBeenCalledOnce();
      expect(container.querySelector('[data-app-metric="tile"]')).toBeNull();
      rerender(content(false, null));
      const attribution = screen.getByTestId('fsd-attribution');
      expect(attribution.querySelectorAll('[data-app-metric="tile"]')).toHaveLength(5);
      expect(within(attribution).getAllByText('Not measured')).toHaveLength(5);
      expect(within(attribution).getByText('No trusted counter reset was observed in this period.')).toBeInTheDocument();
    } finally { release(); }
  });
});
