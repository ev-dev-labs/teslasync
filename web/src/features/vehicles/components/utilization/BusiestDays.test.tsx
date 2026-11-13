import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Drive } from '@/types/driving';
import { formatDistance, formatEnergy } from '@/lib/unitConversion';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { summarizeUtilization } from '../../lib/utilization';
import { BusiestDays } from './BusiestDays';
import { UtilizationMethodology } from './UtilizationMethodology';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: unknown, options?: Record<string, unknown>) =>
    typeof fallback === 'string' ? fallback.replace(/{{(\w+)}}/g, (match, name: string) => String(options?.[name] ?? match)) : key }),
}));
vi.mock('@/hooks/useSettings', () => ({ useSettings: () => ({
  locale: 'en-US', decimals: 2, density: 'comfortable', settings: {
    unit_of_length: 'km', unit_of_temp: 'C', unit_of_pressure: 'bar', decimal_precision: 2,
    locale: 'en-US', tz_display_default: 'utc', timezone_user: 'UTC',
  },
}) }));

const preferences = {
  distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'bar',
  energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US',
} as const;
const state = { isLoading: false, error: null, onRetry: vi.fn() };
function drive(id: number, startTs: string, overrides: Partial<Drive> = {}): Drive {
  return {
    id, vehicleId: 1, startTs, endTs: null, durationS: 3600, distanceM: 12345,
    startAddress: null, endAddress: null, startLat: null, startLon: null, endLat: null, endLon: null,
    startBatteryPct: null, endBatteryPct: null, energyUsedWh: 1234, regenEnergyWh: null,
    avgSpeedMps: null, maxSpeedMps: null, avgPowerW: null, outsideTempAvgC: null, insideTempAvgC: null,
    score: null, endedStatus: null, createdAt: '', updatedAt: '', ...overrides,
  };
}
function summary(historyLimit = 1000, rows = [
  drive(1, '2026-07-01T10:00:00Z'),
  drive(2, '2026-07-02T10:00:00Z', { durationS: 7200, energyUsedWh: null }),
]) {
  return summarizeUtilization(rows, 0.123456, {
    rangeStart: '2026-07-01', rangeEnd: '2026-07-03', timezone: 'UTC',
    asOfMs: Date.parse('2026-07-04T00:00:00Z'), historyLimit,
  });
}
beforeEach(() => {
  state.onRetry.mockClear();
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});

describe('Utilization native records and methodology surfaces', () => {
  it('connects actual ranked readings, framed tables and factual notices to each profile without changing their content', () => {
    const dataSelectors: string[] = [];
    const feedbackSelectors: string[] = [];
    postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'feedback.css'), 'utf8'))
      .walkRules(rule => {
        dataSelectors.push(...rule.selectors.filter(selector =>
          selector.includes('data-app-list="ranked"') && selector.includes('data-app-design-owner')));
        feedbackSelectors.push(...rule.selectors.filter(selector =>
          selector.includes('data-app-feedback-kind="notice"') && selector.includes('data-app-design-owner')));
      });
    const surfaceSelectors: string[] = [];
    postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'base.css'), 'utf8'))
      .walkRules(rule => {
        if (rule.nodes.some(node => node.type === 'decl' && node.prop === 'border-radius')) {
          surfaceSelectors.push(...rule.selectors.filter(selector =>
            selector.includes('[data-app-part~="card"]') && selector.includes('data-app-design-owner')));
        }
      });
    const model = summary(2);
    const view = render(<MemoryRouter><section data-app-design-preview>
      <BusiestDays summary={model} state={state} />
      <UtilizationMethodology summary={model} historyLimit={2} state={state} />
    </section></MemoryRouter>);
    const host = view.container.querySelector('[data-app-design-preview]')!;
    const list = host.querySelector('[data-app-list="ranked"]')!;
    const rows = [...list.children];
    const notice = host.querySelector('[data-app-feedback-kind="notice"]')!;
    const frames = ['Timestamp eligibility', 'Metric field coverage'].map(name =>
      screen.getByRole('table', { name }).closest('[data-app-part="card"]')!);
    const content = host.textContent;
    const release = observeAppDesignScopes(host);
    try {
      expect(rows.every(row => !row.hasAttribute('data-app-design-owner'))).toBe(true);
      for (const pack of Object.keys(APPLICATION_DESIGNS) as Array<keyof typeof APPLICATION_DESIGNS>) {
        for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) host.setAttribute(name, value);
        const refresh = observeAppDesignScopes(host);
        try {
          const selectors = dataSelectors.filter(selector => selector.includes(`[data-app-data="${APPLICATION_DESIGNS[pack].data}"]`));
          expect(rows.every(row => selectors.some(selector => row.matches(selector)))).toBe(true);
          for (const row of rows) {
            for (const value of row.querySelectorAll('[data-app-part="metric-value"]')) {
              expect(value).toHaveAttribute('data-app-design-owner');
            }
          }
          const notices = feedbackSelectors.filter(selector =>
            selector.includes(`[data-app-feedback="${APPLICATION_DESIGNS[pack].feedback}"]`));
          expect(notices.some(selector => notice.matches(selector))).toBe(true);
          for (const frame of frames) {
            expect(frame).toHaveAttribute('data-surface-variant', 'embedded');
            expect(surfaceSelectors.some(selector => frame.matches(selector))).toBe(false);
            const enclosingFrame = frame.parentElement!.closest('[data-surface-variant="standalone"]')!;
            expect(enclosingFrame).not.toBeNull();
            expect(surfaceSelectors.some(selector => enclosingFrame.matches(selector))).toBe(true);
            expect(frame).toHaveClass('bg-transparent', 'shadow-none');
          }
          expect(host.textContent).toBe(content);
          expect(list.parentElement).toHaveClass('sm:hidden');
        } finally { refresh(); }
      }
      for (const name of Object.keys(getAppDesignAttributes('classic'))) host.removeAttribute(name);
      const refresh = observeAppDesignScopes(host);
      try {
        expect(rows.every(row => dataSelectors.every(selector => !row.matches(selector)))).toBe(true);
        expect(feedbackSelectors.every(selector => !notice.matches(selector))).toBe(true);
      } finally { refresh(); }
    } finally { release(); }
  });

  it('owns mobile ranked cards and four real readings while retaining desktop rows and missing-energy dashes', () => {
    const model = summary();
    const { container } = render(<BusiestDays summary={model} state={state} />);
    const list = container.querySelector('ol[data-app-list="ranked"]')!;
    expect(list.parentElement).toHaveClass('sm:hidden');
    expect(list).not.toHaveClass('sm:hidden');
    const cards = [...list.children];
    expect(cards).toHaveLength(2);
    expect(cards.map(card => card.querySelector('[data-app-part="metric-label"]')?.textContent))
      .toEqual(['Jul 2, 2026', 'Jul 1, 2026']);
    const first = cards[0] as HTMLElement;
    expect(first).toHaveAttribute('data-app-part', 'list-row');
    expect(first.querySelector('[data-app-part~="metric-context"]')).toHaveTextContent('#1');
    expect([...first.querySelectorAll('[data-app-metric="inline"] > [data-app-part="metric-label"]')].map(label => label.textContent))
      .toEqual(['Driving time', 'Distance', 'Drives', 'Energy']);
    expect([...first.querySelectorAll('[data-app-part="metric-value"]')].map(value => value.textContent))
      .toEqual(['2h', formatDistance(12345, preferences), '1', '—']);
    expect(within(cards[1] as HTMLElement).getByText(formatEnergy(1234, preferences))).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(model.busiestDays.map(day => day.day)).toEqual(['2026-07-02', '2026-07-01']);
  });

  it.each([2, 1000])('keeps actual framed tables and %s cap notice semantics', (limit) => {
    const model = summary(limit);
    const { container } = render(<MemoryRouter><UtilizationMethodology summary={model} historyLimit={limit} state={state} /></MemoryRouter>);
    for (const name of ['Timestamp eligibility', 'Metric field coverage']) {
      expect(screen.getByRole('table', { name }).closest('[data-app-part="card"]')).not.toBeNull();
    }
    const notice = container.querySelector('[data-app-feedback-kind="notice"]')!;
    expect(notice).toHaveAttribute('data-app-tone', limit === 2 ? 'warning' : 'neutral');
    expect(notice.querySelector('[data-app-part="feedback-content"] > [data-app-part="feedback-message"]'))
      .toHaveTextContent(limit === 2 ? 'additional matching drives may exist.' : 'below the 1,000-drive API limit.');
    expect(notice).not.toHaveAttribute('role', 'alert');
  });

  it('keeps loading, failed, empty and recovery behavior outside the ranked renderer', () => {
    const view = render(<BusiestDays summary={summary()} state={{ ...state, isLoading: true }} />);
    expect(screen.getByRole('status', { name: 'Loading utilization analysis' })).toBeInTheDocument();
    expect(view.container.querySelector('[data-app-list="ranked"]')).toBeNull();
    view.rerender(<BusiestDays summary={summary()} state={{ ...state, error: new Error('Synthetic history failure') }} />);
    fireEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(state.onRetry).toHaveBeenCalledOnce();
    view.rerender(<BusiestDays summary={summary(1000, [])} state={state} />);
    expect(screen.getByText('No active observed days are available to rank.')).toBeInTheDocument();
    expect(view.container.querySelector('[data-app-list="ranked"]')).toBeNull();
  });
});
