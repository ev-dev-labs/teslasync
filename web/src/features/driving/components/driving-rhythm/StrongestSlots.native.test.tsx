import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type Rule } from 'postcss';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Drive } from '@/types/driving';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { expectAppDesignDataMode, matchesAppDesignCss } from '@/components/feedback/appDesignCss.test-utils';
import { buildDrivingRhythm } from '../../lib/drivingRhythm';
import { StrongestSlots } from './StrongestSlots';
import { DepartureConsistency } from './DepartureConsistency';
import { WeekdayWeekendComparison } from './WeekdayWeekendComparison';
import { RhythmCoverageSummary } from './RhythmCoverageSummary';

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: null, vehicleId: 1 }),
}));

const ready = { isLoading: false, retained: false, error: null, onRetry: vi.fn() };
const empty = buildDrivingRhythm([], { timeZone: 'UTC', nowMs: Date.parse('2026-08-08T12:00:00Z') });
const summary = {
  ...empty,
  observed: 4,
  total: 4,
  strongestSlots: [
    { day: 1, hour: 0, count: 2, rank: 1, share: 0.5, distanceM: 0, measuredDistanceDrives: 0, qualified: false },
    { day: 2, hour: 0, count: 2, rank: 2, share: 0.5, distanceM: 0, measuredDistanceDrives: 2, qualified: false },
  ],
};
const surfaceRules: Rule[] = [];
postcss.parse(readFileSync(resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', 'base.css'), 'utf8'))
  .walkRules(rule => { surfaceRules.push(rule); });
function departure(id: number, startTs: string, distanceM: number | null): Drive {
  return {
    id, startTs, distanceM, vehicleId: 1, endTs: startTs, durationS: 0,
    startAddress: null, endAddress: null, startLat: null, startLon: null, endLat: null, endLon: null,
    startBatteryPct: null, endBatteryPct: null, energyUsedWh: null, regenEnergyWh: null,
    avgSpeedMps: null, maxSpeedMps: null, avgPowerW: null, outsideTempAvgC: null, insideTempAvgC: null,
    score: null, endedStatus: null, createdAt: startTs, updatedAt: startTs,
  };
}

describe('driving-rhythm native adoption', () => {
  it.each(PACK_IDS)('%s composes actual ranked records, independent frames and the coverage notice', pack => {
    const { container } = render(
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <StrongestSlots summary={summary} state={ready} />
        <DepartureConsistency summary={summary} state={ready} />
        <WeekdayWeekendComparison summary={summary} state={ready} />
        <RhythmCoverageSummary summary={summary} state={ready} />
      </div>,
    );
    const host = container.firstElementChild!;
    const release = observeAppDesignScopes(host);
    try {
      const ranked = host.querySelector('[data-app-list="ranked"]')!;
      const rows = within(ranked as HTMLElement).getAllByRole('listitem');
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveTextContent('#1Mon at 00:00');
      expect(rows[1]).toHaveTextContent('#2Tue at 00:00');
      for (const row of rows) {
        expectAppDesignDataMode(row, APPLICATION_DESIGNS[pack].data, '[data-app-list="ranked"]');
        expect(row.querySelector('[data-app-part~="metric-value"]')).toHaveTextContent('2');
        expect(row.querySelector('[data-app-part~="metric-reading"]')).toHaveTextContent(/^2$/);
        expect(row.querySelector('[data-app-part~="metric-context"]')).toHaveTextContent('50.00% of valid starts');
        expect(row).toHaveTextContent('below 3-drive floor');
      }
      expect(rows[0]).toHaveTextContent('— logged across 0 measured drives');
      expect(rows[1]).toHaveTextContent('0.00 km logged across 2 measured drives');
      const cards = host.querySelectorAll('[data-app-part="card"][data-surface-variant="standalone"]');
      expect(cards).toHaveLength(9);
      for (const card of cards) {
        expect(surfaceRules.some(rule => rule.nodes.some(node => node.type === 'decl' && node.prop === 'border-radius')
          && rule.selectors.some(selector => card.matches(selector)))).toBe(true);
      }
      const notice = host.querySelector('[data-app-feedback-kind="notice"]')!;
      expect(notice).toHaveAttribute('data-app-tone', 'warning');
      expect(notice.querySelector('[data-app-part~="feedback-content"]')).toHaveTextContent('All 4 drives in the selected dates were fetched across API pages and accounted for.');
      expect(notice.querySelector('[data-app-part~="feedback-content"] > [data-app-part~="feedback-message"]'))
        .toHaveTextContent('All 4 drives');
      expect(matchesAppDesignCss(notice, `[data-app-feedback="${APPLICATION_DESIGNS[pack].feedback}"]`)
        .some(match => match.declarations.display === 'grid')).toBe(true);
    } finally {
      release();
    }
  });

  it('keeps ranking unavailable during loading/error and retains retry and empty behavior', () => {
    const retry = vi.fn();
    const { container, rerender } = render(<StrongestSlots summary={summary} state={{ ...ready, isLoading: true }} />);
    expect(screen.getByRole('status', { name: 'Loading driving rhythm evidence' })).toBeInTheDocument();
    expect(container.querySelector('[data-app-list="ranked"]')).toBeNull();
    rerender(<StrongestSlots summary={summary} state={{ ...ready, error: new Error('offline'), onRetry: retry }} />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-app-list="ranked"]')).toBeNull();
    rerender(<StrongestSlots summary={empty} state={ready} />);
    expect(screen.getByText('No occupied weekday-hour slots are available to rank.')).toBeInTheDocument();
  });

  it('keeps seven real weekday frames, midnight circular readings and below-floor absence separate', () => {
    const model = buildDrivingRhythm([
      departure(1, '2026-07-27T23:55:00Z', null),
      departure(2, '2026-08-03T00:05:00Z', 0),
      departure(3, '2026-08-03T00:00:00Z', 1000),
      departure(4, '2026-08-04T08:00:00Z', null),
    ], { timeZone: 'UTC', nowMs: Date.parse('2026-08-08T12:00:00Z') });
    const snapshot = JSON.stringify(model);
    const { container } = render(<DepartureConsistency summary={model} state={ready} />);
    const cards = container.querySelectorAll('[data-app-part="card"]');
    expect(cards).toHaveLength(7);
    expect(within(cards[0] as HTMLElement).getByText('3/3')).toBeInTheDocument();
    expect(within(cards[0] as HTMLElement).getByText('00:00')).toBeInTheDocument();
    expect(within(cards[0] as HTMLElement).getByText(/^±/)).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).getByText('1/3')).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).getByText('08:00')).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).queryByText(/^±/)).toBeNull();
    expect(within(cards[2] as HTMLElement).getByText('0/3')).toBeInTheDocument();
    expect(within(cards[2] as HTMLElement).queryByText('00:00')).toBeNull();
    expect(JSON.stringify(model)).toBe(snapshot);
  });

  it('preserves a zero-day weekend denominator versus an unknown calendar scope without inventing a rate', () => {
    const drives = [departure(1, '2026-08-03T00:00:00Z', 0), departure(2, '2026-08-04T08:00:00Z', null)];
    const options = { timeZone: 'UTC', nowMs: Date.parse('2026-08-08T12:00:00Z') };
    const model = buildDrivingRhythm(drives, { ...options, rangeStart: '2026-08-03', rangeEnd: '2026-08-04' });
    const { container, rerender } = render(<WeekdayWeekendComparison summary={model} state={ready} />);
    const cards = container.querySelectorAll('[data-app-part="card"]');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('0.00 km logged');
    expect(cards[1]).toHaveTextContent('0 active of 0 selected calendar days · — logged');
    expect(cards[1]).not.toHaveTextContent('Drives / selected day');
    expect(container).not.toHaveTextContent(/NaN|Infinity/);
    rerender(<WeekdayWeekendComparison summary={buildDrivingRhythm(drives, options)} state={ready} />);
    expect(screen.getAllByText('Selected calendar-day coverage is unavailable; raw counts remain valid.')).toHaveLength(2);
  });
});
