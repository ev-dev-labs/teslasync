import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it, vi } from 'vitest';

import {
  APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes,
} from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { DepartureForecastHourDistribution } from '@/features/driving/components/departure-forecast/DepartureForecastHourDistribution';
import { forecastDepartures } from '@/features/driving/lib/departureForecast';
import { summarizeComfortConsistency } from '../../lib/comfortConsistency';
import { summarizeHvacCycling } from '../../lib/hvacCycling';
import { HvacCyclingHourlyDuty } from '../hvac-cycling/HvacCyclingHourlyDuty';
import { ComfortConsistencyHourlyProfile } from './ComfortConsistencyHourlyProfile';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => String(values?.[name] ?? '')),
    i18n: { language: 'en-US' },
  }),
}));

vi.mock('@/components/charts', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/charts')>(),
  ...(await import('@/test/chartTestDoubles')).chartTestDoubles,
  ...(await import('@/test/chartTestDoubles')).inertCartesianParts,
  ChartContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Bar: () => null,
  BarChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const now = Date.parse('2026-10-14T13:00:00Z');
const rows = [0, 1, 2].map(index => ({
  timestamp: new Date(now - 3_600_000 + index * 60_000).toISOString(),
  hvacPower: true,
  insideTemp: 21,
  driverTempSetting: 21,
  passengerTempSetting: 21,
}));
const comfort = summarizeComfortConsistency(rows);
const hvac = summarizeHvacCycling(rows, { timeZone: 'UTC' });
const emptyForecast = forecastDepartures([], now, 'UTC');
const forecast = {
  ...emptyForecast,
  totalDepartures: 1,
  daypartDistribution: emptyForecast.daypartDistribution.map((bucket, index) => ({
    ...bucket,
    departures: index === 2 ? 1 : 0,
    share: index === 2 ? 1 : 0,
  })),
};
const ready = {
  vehicleSelected: true, isLoading: false, isResolved: true,
  error: null, refreshError: null, onRetry: vi.fn(),
};
const duration = (value: number | null | undefined) => value == null ? '—' : `${value}s`;
const rules: Rule[] = [];
postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'feedback.css'), 'utf8'))
  .walkRules(rule => { rules.push(rule); });

function consumes(node: Element, contract: string, property: string, owner?: string) {
  return rules.some(rule => rule.selector.includes(contract)
    && (!owner || rule.selector.includes(`[data-app-design-owner~="${owner}"]`))
    && rule.nodes.some(declaration => declaration.type === 'decl' && declaration.prop === property)
    && rule.selectors.some(selector => node.matches(selector)));
}

describe('compact native support records', () => {
  it.each(PACK_IDS)('keeps all hour/daypart definitions and positive %s paint without standalone card ownership', pack => {
    const snapshot = structuredClone({ comfort, hvac, forecast });
    const { container } = render(
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <ComfortConsistencyHourlyProfile summary={comfort} state={ready} formatDuration={duration} />
        <HvacCyclingHourlyDuty summary={hvac} state={ready} formatDuration={duration} />
        <DepartureForecastHourDistribution forecast={forecast} state={ready} locale="en-US" timeZone="UTC" />
      </div>,
    );
    const host = container.firstElementChild!;
    const release = observeAppDesignScopes(host);
    try {
      const owner = `data-${APPLICATION_DESIGNS[pack].data}`;
      const banks = [...host.querySelectorAll('dl[data-app-list="definitions"]')];
      expect(banks).toHaveLength(3);
      expect(banks.map(bank => bank.children.length)).toEqual([24, 24, 4]);
      for (const bank of banks) {
        expect(bank.querySelector('[data-surface-variant]')).toBeNull();
        const terms = [...bank.querySelectorAll('dt[data-app-part="metric-label"]')];
        expect(terms).toHaveLength(bank.children.length);
        const readings = [...bank.querySelectorAll('dd[data-app-part="metric-reading"]')];
        expect(readings).toHaveLength(bank.children.length);
        expect([...bank.children].every(row => row.matches('[data-app-part~="list-row"][data-app-metric="tile"]'))).toBe(true);
        const row = bank.firstElementChild!;
        expect(consumes(row, '[data-app-list="definitions"]', 'display', owner)).toBe(true);
        expect(consumes(row, '[data-app-metric="tile"]', 'padding', owner)).toBe(true);
        expect(consumes(terms[0], '[data-app-part~="metric-label"]', 'overflow-wrap')).toBe(true);
        expect(consumes(readings[0], '[data-app-part~="metric-reading"]', 'font-variant-numeric')).toBe(true);
      }
      expect([...banks[0].querySelectorAll('dt')].map(term => term.textContent))
        .toEqual(Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`));
      expect(banks[0].querySelector('[data-app-part="metric-value"]')).toHaveTextContent('—');
      expect(banks[1].querySelector('[data-app-part="metric-value"]')).toHaveTextContent(duration(0));
      const dayparts = [...banks[2].querySelectorAll('[data-app-part="metric-value"]')];
      expect(dayparts[0]).toHaveTextContent(/^0 · 0/);
      expect(dayparts[2]).toHaveTextContent(/^1 · 100/);
      expect({ comfort, hvac, forecast }).toEqual(snapshot);
    } finally { release(); }
  });
});
