import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { deriveDataState, type DataStateSource } from '@/api/dataState';
import type { PeriodStats } from '@/api/hooks/usePeriodStats';
import { expectAppDesignDataMode, matchesAppDesignCss, setAppDesignTestProfile } from '@/components/feedback/appDesignCss.test-utils';
import { APPLICATION_DESIGNS, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { PeriodSources } from './PeriodSources';

const units = vi.hoisted(() => ({ distance: 'km' as 'km' | 'mi' }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({ unitPrefs: units }) }));
const initialPreferences = getFormatterPreferences();
const available: PeriodStats = {
  total_distance: 1000, total_drives: 50, energy_used: 200,
  avg_efficiency: 200, total_cost: 40, co2_saved: 120,
};
const labels = ['Total distance', 'Total drives', 'Energy used', 'Avg efficiency', 'Total cost', 'CO₂ saved'];
beforeEach(() => {
  units.distance = 'km';
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});
afterEach(() => {
  setGlobalLocale(initialPreferences.locale);
  setGlobalPrecision(initialPreferences.precision);
});
const source = (input: DataStateSource<PeriodStats> = {}) => deriveDataState(input);
function show(a = source({ data: available }), b = source()) {
  const retryA = vi.fn();
  const retryB = vi.fn();
  return {
    retryA, retryB,
    ...render(<MemoryRouter><PeriodSources stateA={a} stateB={b} retryA={retryA} retryB={retryB} /></MemoryRouter>),
  };
}
const readings = (region: HTMLElement) => [...region.querySelectorAll('dd')].map(node => node.textContent);

describe('PeriodSources independent definition readouts', () => {
  it.each(['A', 'B'] as const)('keeps every available %s reading while its neighbor loads, pauses or fails', operand => {
    const retained = source({ data: available, error: new Error('retained refresh failed') });
    const view = show(operand === 'A' ? retained : source(), operand === 'B' ? retained : source());
    const usable = screen.getByRole('region', { name: `Period ${operand}` });
    const neighborName = `Period ${operand === 'A' ? 'B' : 'A'}`;
    expect(readings(usable)).toEqual(['1,000.00 km', '50', '200.00 kWh', '200.00 Wh/km', '40.00 $', '120.00 kg']);
    expect([...usable.querySelectorAll('dt')].map(node => node.textContent)).toEqual(labels);
    for (const pending of [
      source({ fetchStatus: 'paused' }),
      source({ error: new Error('initial failure') }),
    ]) {
      view.rerender(<MemoryRouter><PeriodSources
        stateA={operand === 'A' ? retained : pending} stateB={operand === 'B' ? retained : pending}
        retryA={view.retryA} retryB={view.retryB}
      /></MemoryRouter>);
      expect(readings(usable)).toHaveLength(6);
      const neighbor = screen.getByRole('region', { name: neighborName });
      expect(neighbor.querySelector('dl')).toBeNull();
      if (pending.fatalError) {
        fireEvent.click(within(neighbor).getByRole('button', { name: 'Retry' }));
        expect(operand === 'A' ? view.retryB : view.retryA).toHaveBeenCalledOnce();
        expect(operand === 'A' ? view.retryA : view.retryB).not.toHaveBeenCalled();
      } else {
        expect(within(neighbor).getByText(/waiting for a connection/)).toBeInTheDocument();
      }
    }
    expect(available.total_distance).toBe(1000);
    expect(available.avg_efficiency).toBe(200);
  });

  it('keeps measured zero, absent fields and changed periods distinct without parsing formatted units', () => {
    const zero: PeriodStats = { total_distance: 0, total_drives: 0, energy_used: 0, avg_efficiency: 0, total_cost: 0, co2_saved: 0 };
    const view = show(source({ data: zero }));
    const a = screen.getByRole('region', { name: 'Period A' });
    expect(readings(a)).toEqual(['0.00 km', '0', '0.00 kWh', '0.00 Wh/km', '0.00 $', '0.00 kg']);
    const missing: PeriodStats = JSON.parse(JSON.stringify({ ...available, total_cost: null, co2_saved: null }));
    units.distance = 'mi';
    view.rerender(<MemoryRouter><PeriodSources stateA={source({ data: missing })} stateB={source()}
      retryA={view.retryA} retryB={view.retryB} /></MemoryRouter>);
    expect(readings(a)).toEqual(['621.37 mi', '50', '200.00 kWh', '321.87 Wh/mi', '—', '—']);
    expect(a.querySelectorAll('[data-app-part="metric-unit"]')).toHaveLength(3);
    expect(a.querySelector('meter, [role="meter"], [role="progressbar"]')).toBeNull();
  });

  it('activates deliberate definition rows, real readings and unit/context slots in every complete design only', () => {
    const { container } = show();
    const a = screen.getByRole('region', { name: 'Period A' });
    const original = readings(a);
    const list = a.querySelector('dl[data-app-list="definitions"]')!;
    expect(list.children).toHaveLength(6);
    container.setAttribute('data-app-design-preview', '');
    let release = observeAppDesignScopes(container);
    expect(matchesAppDesignCss(list.children[0])).toHaveLength(0);
    release();
    container.setAttribute('data-widget-design-pack', 'cyber');
    release = observeAppDesignScopes(container);
    expect(matchesAppDesignCss(list.children[0])).toHaveLength(0);
    release();
    for (const pack of PACK_IDS) {
      setAppDesignTestProfile(container, pack);
      release = observeAppDesignScopes(container);
      try {
        const mode = APPLICATION_DESIGNS[pack].data;
        for (const row of list.children) {
          expectAppDesignDataMode(row, mode, '[data-app-list="definitions"]');
          const reading = row.querySelector('dd')!;
          expectAppDesignDataMode(reading, mode, '[data-app-part~="metric-reading"]');
          for (const part of ['metric-label', 'metric-value']) {
            expect(matchesAppDesignCss(row.querySelector(`[data-app-part="${part}"]`)!, `[data-app-part~="${part}"]`).length)
              .toBeGreaterThan(0);
          }
        }
        for (const unit of list.querySelectorAll('[data-app-part="metric-unit"]')) {
          expect(matchesAppDesignCss(unit, '[data-app-part~="metric-unit"]').length).toBeGreaterThan(0);
        }
        expect(matchesAppDesignCss(within(a).getByRole('heading'), '[data-app-part~="metric-context"]').length).toBeGreaterThan(0);
        expect(readings(a)).toEqual(original);
      } finally { release(); }
    }
    container.setAttribute('data-app-data', 'incomplete');
    release = observeAppDesignScopes(container);
    try {
      expect(list.children[0]).not.toHaveAttribute('data-app-design-owner');
      expect(matchesAppDesignCss(list.children[0])).toHaveLength(0);
    } finally { release(); }
  });
});
