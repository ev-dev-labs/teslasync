import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { createInstance } from 'i18next';
import postcss, { type Rule } from 'postcss';
import type { ComponentProps, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '@/components/ui/ThemeProvider';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes, APP_DESIGN_PACK_FILES } from '@/components/ui/app-designs/designs';
import {
  expectAppDesignDataMode, matchesAppDesignCss,
} from '@/components/feedback/appDesignCss.test-utils';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import type { UseUnitsResult } from '@/hooks/useUnits';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import * as display from '@/lib/unitConversion';
import type { Drive } from '@/types/driving';
import { analyzeJourneyFragmentation } from '../lib/journeyFragmentation';
import { analyzeRangeBuffer } from '../lib/rangeBuffer';
import { buildRegenEfficiencyModel } from '../lib/regenEfficiency';
import { analyzeSeasonalEfficiency } from '../lib/seasonalEfficiency';
import { AccountingPanel } from './journey-fragmentation/AccountingPanel';
import { JourneyDirectory } from './journey-fragmentation/JourneyDirectory';
import { RangeBufferMethodology } from './range-buffer/RangeBufferMethodology';
import { RecoveryContext } from './regen-efficiency-modernization/RecoveryContext';
import { RegenMethodologyList } from './regen-efficiency/RegenMethodologyList';
import { ScoreDistributionTipsSection } from './score-orchestrator/ScoreDistributionTipsSection';
import { buildTips } from './score-orchestrator/scoreTips';
import { SeasonalComponentDiagnostics } from './seasonal-efficiency/SeasonalComponentDiagnostics';
import { SeasonalRankedMonths } from './seasonal-efficiency/SeasonalRankedMonths';
import { SeasonalResidualDistribution } from './seasonal-efficiency/SeasonalResidualDistribution';
import { SeasonalYearDirectory } from './seasonal-efficiency/SeasonalYearDirectory';
import { formatIntensityWhPerM } from './seasonal-efficiency/formatters';

const translation = createInstance();
await translation.init({ lng: 'en', resources: {}, fallbackLng: 'en' });
vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: translation.t, i18n: translation }),
}));
vi.mock('@/components/motion', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/motion')>(),
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
// Plots are outside this batch; keep the real native frames and data primitives.
vi.mock('@/components/charts', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/charts')>(),
  ChartContainer: ({ title }: { title: string }) => <figure aria-label={title} />,
}));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => units }));

const unitPrefs: display.UnitPref = {
  distance: 'km', speed: 'km/h', temperature: '°C', energy: 'kWh',
  duration: 'h', pressure: 'bar', power: 'kW', locale: 'en-US', precision: 2,
};
const units: UseUnitsResult = {
  unitPrefs,
  formatDistance: (v, o) => display.formatDistance(v, unitPrefs, o),
  formatDuration: (v, o) => display.formatDuration(v, unitPrefs, o),
  formatEnergy: (v, o) => display.formatEnergy(v, unitPrefs, o),
  formatPower: (v, o) => display.formatPower(v, unitPrefs, o),
  formatSpeed: (v, o) => display.formatSpeed(v, unitPrefs, o),
  formatTemperature: (v, o) => display.formatTemperature(v, unitPrefs, o),
  formatPressure: (v, o) => display.formatPressure(v, unitPrefs, o),
};
const now = Date.parse('2026-12-31T23:59:00Z');
function drive(id: number, overrides: Partial<Drive> = {}): Drive {
  const startTs = new Date(Date.UTC(2025 + Math.floor((id - 1) / 12), (id - 1) % 12, 15, 12)).toISOString();
  const endTs = new Date(Date.parse(startTs) + 600_000).toISOString();
  return {
    id, vehicleId: 7, startTs, endTs, durationS: 600, distanceM: 20_000,
    startAddress: null, endAddress: null, startLat: null, startLon: null, endLat: null, endLon: null,
    startBatteryPct: 70, endBatteryPct: 60, energyUsedWh: 3000 + id % 4 * 100,
    regenEnergyWh: 0, avgSpeedMps: 15, maxSpeedMps: 30, avgPowerW: 4000,
    outsideTempAvgC: 15, insideTempAvgC: 21, score: null, endedStatus: 'completed',
    createdAt: startTs, updatedAt: endTs, ...overrides,
  };
}
const history = Array.from({ length: 24 }, (_, i) => drive(i + 1));
const journey = analyzeJourneyFragmentation(history, now, 'UTC');
const range = analyzeRangeBuffer([], now, 'UTC');
const regen = buildRegenEfficiencyModel([
  drive(1), drive(2, { regenEnergyWh: null, outsideTempAvgC: -5, startBatteryPct: 30 }),
], 1000, 'UTC');
const seasonal = analyzeSeasonalEfficiency(history, now, 'UTC');
const ready = { vehicleSelected: true, isLoading: false, isResolved: true, error: null, refreshError: null, onRetry: vi.fn() };
const seasonalProps = { analysis: seasonal, state: ready, units, locale: 'en-US', timeZone: 'UTC' };
const tipsModel: ComponentProps<typeof ScoreDistributionTipsSection>['model'] = {
  t: translation.t, hasDrives: false, drivesLoading: false, drivesIsError: false, histogramData: [],
  hasCategoryReadings: true, weakestCategoryLabel: 'Efficiency',
  relevantTips: buildTips(translation.t).filter(tip => tip.category === 'efficiency'),
};

function harness(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, gcTime: 0 } } });
  client.setQueryData(['settings'], { locale: 'en-US', decimal_precision: 2, unit_of_length: 'km' });
  function Wrapper({ children: content }: { children: ReactNode }) {
    return <QueryClientProvider client={client}><ThemeProvider><MemoryRouter>
      <div data-app-design-preview="" {...getAppDesignAttributes('classic')}>{content}</div>
    </MemoryRouter></ThemeProvider></QueryClientProvider>;
  }
  return render(<>{children}</>, { wrapper: Wrapper });
}
const identityRules = new Map(PACK_IDS.map(pack => {
  const rules: Rule[] = [];
  postcss.parse(readFileSync(resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', 'packs', APP_DESIGN_PACK_FILES[pack]), 'utf8'))
    .walkRules(rule => { rules.push(rule); });
  return [pack, rules];
}));

beforeEach(() => {
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});

describe('driving-04 native source-to-consumer adoption', () => {
  it.each(PACK_IDS)('activates real record, reading and notice consumers for %s without changing source content', pack => {
    expect(seasonal.fit.status).toBe('ready');
    const source = JSON.stringify({ journey, regen, seasonal });
    const { container } = harness(<>
      <div data-testid="accounting"><AccountingPanel result={journey} /></div>
      <div data-testid="journeys"><JourneyDirectory result={journey} /></div>
      <RangeBufferMethodology result={range} startDate="2025-01-01" endDate="2026-12-31" />
      <RecoveryContext kind="temperature" model={regen} state={ready} />
      <RecoveryContext kind="soc" model={regen} state={ready} />
      <div data-testid="regen-methods"><RegenMethodologyList historyLimit={1000} /></div>
      <div data-testid="score-tips"><ScoreDistributionTipsSection model={tipsModel} driveState={() => null} scoreState={() => null} /></div>
      <SeasonalComponentDiagnostics {...seasonalProps} />
      <SeasonalRankedMonths {...seasonalProps} />
      <SeasonalResidualDistribution {...seasonalProps} />
      <SeasonalYearDirectory {...seasonalProps} />
    </>);
    const host = container.querySelector('[data-app-design-preview]')!;
    const content = host.textContent;
    const accounting = screen.getByTestId('accounting');
    const tiles = accounting.querySelectorAll('[data-app-metric="tile"]');
    expect(tiles).toHaveLength(12);
    expect(accounting.querySelectorAll('[data-app-part="metric-grid"]')).toHaveLength(2);
    expect([...tiles].map(tile => tile.querySelector('[data-app-part="metric-value"]')?.textContent))
      .toEqual(['24', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', '23']);
    expect(within(accounting).getByText('Over selected gap').nextElementSibling).toHaveTextContent('23');
    const directory = screen.getByTestId('journeys');
    expect(directory.querySelectorAll('[data-app-metric="headline"]')).toHaveLength(8);
    const ordered = [...journey.journeys].sort((a, b) => b.fragments - a.fragments || b.distanceM - a.distanceM).slice(0, 8);
    expect([...directory.querySelectorAll('[data-app-part="metric-value"]')].map(node => node.textContent))
      .toEqual(ordered.map(row => units.formatDistance(row.distanceM)));
    expect(within(directory).getAllByText('Unlocated start → Unlocated end')).toHaveLength(8);
    const rangeArticles = screen.getByTestId('range-buffer-methodology').querySelectorAll('article');
    expect(rangeArticles).toHaveLength(8);
    const regenMethods = screen.getByTestId('regen-methods').querySelectorAll('ul > li');
    expect(regenMethods).toHaveLength(6);
    expect(screen.getByTestId('regen-methods')).toHaveTextContent('measured zero regen is 0% only with a positive drive-energy denominator');
    const residual = screen.getByTestId('seasonal-residual-distribution');
    expect(residual.querySelectorAll('[data-app-metric="tile"]')).toHaveLength(4);
    const ranked = screen.getByTestId('seasonal-ranked-months').querySelector('[data-app-list="ranked"]')!;
    expect([...ranked.querySelectorAll('[data-app-part="metric-value"]')].map(node => node.textContent))
      .toEqual([...seasonal.months].sort((a, b) =>
        (b.observedEnergyIntensityWhPerM ?? -Infinity) - (a.observedEnergyIntensityWhPerM ?? -Infinity) || a.month - b.month,
      ).map(month => formatIntensityWhPerM(month.observedEnergyIntensityWhPerM, unitPrefs)));
    for (const kind of ['temperature', 'soc']) {
      const context = screen.getByTestId(`regen-${kind}`);
      expect(context.querySelectorAll('[data-app-part="card"]')).toHaveLength(5);
      expect(within(context).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
      expect(context.querySelectorAll('[data-app-list="definitions"]')).toHaveLength(4);
      expect(context.querySelectorAll('[data-metric-track]')).toHaveLength(1);
      expect(within(context).getAllByLabelText('Recovery share is unavailable; no zero value is inferred.')).toHaveLength(4);
    }

    for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) host.setAttribute(name, value);
    const release = observeAppDesignScopes(host);
    try {
        const mode = APPLICATION_DESIGNS[pack].data;
        const frames = [
          directory.querySelector('[data-app-part~="card"]')!, ...rangeArticles, ...regenMethods,
          screen.getByTestId('regen-temperature').querySelector('[data-app-part="card"]')!,
          screen.getByTestId('seasonal-year-directory').querySelector('[data-app-part="card"]')!,
          ranked.firstElementChild!,
        ];
        for (const frame of frames) {
          expect(identityRules.get(pack)!.some(rule => rule.selectors.some(selector =>
            selector.includes('[data-app-part~="card"]') && frame.matches(selector),
          )), `${pack}: independent record frame`).toBe(true);
        }
        for (const metric of [tiles[0], residual.querySelector('[data-app-metric="tile"]')!]) {
          expectAppDesignDataMode(metric, mode, '[data-app-metric="tile"]');
          expect(matchesAppDesignCss(metric.querySelector('[data-app-part="metric-reading"]')!)
            .some(match => match.declarations['flex-wrap'] === 'wrap')).toBe(true);
        }
        expectAppDesignDataMode(directory.querySelector('[data-app-part="metric-reading"]')!, mode, '[data-app-metric="headline"]');
        expectAppDesignDataMode(ranked.firstElementChild!, mode, '[data-app-list="ranked"]');
        for (const id of ['seasonal-component-diagnostics', 'seasonal-year-directory', 'regen-temperature', 'regen-soc']) {
          const reading = screen.getByTestId(id).querySelector('[data-app-list="definitions"] > [data-app-part="list-row"] > [data-app-part="metric-reading"]')!;
          expectAppDesignDataMode(reading, mode, '[data-app-list="definitions"]');
        }
        const notice = screen.getByTestId('score-tips').querySelector('[data-app-feedback-kind="notice"]')!;
        expect(matchesAppDesignCss(notice, `[data-app-feedback="${APPLICATION_DESIGNS[pack].feedback}"]`)
          .some(match => match.declarations['border-inline-start'] || match.declarations['border-block-start'])).toBe(true);
        expect(notice.querySelector(':scope > [data-app-part="feedback-content"] > [data-app-part="feedback-message"]'))
          .toHaveTextContent(tipsModel.relevantTips[0].key);
        expect(host.textContent).toBe(content);
    } finally { release(); }
    expect(JSON.stringify({ journey, regen, seasonal })).toBe(source);
  });

  it('keeps negative, measured-zero and missing diagnostics distinct and does not invent an eligible fit', () => {
    const analysis = {
      ...seasonal,
      diagnostics: { ...seasonal.diagnostics, residualP10WhPerM: -0.02, residualP50WhPerM: 0, residualP90WhPerM: 0.02, weightedRmseWhPerM: null },
      years: seasonal.years.map(year => ({ ...year, deseasonalizedEnergyIntensityWhPerM: null })),
    };
    const { container } = harness(<>
      <SeasonalResidualDistribution {...seasonalProps} analysis={analysis} />
      <SeasonalYearDirectory {...seasonalProps} analysis={analysis} />
      <SeasonalResidualDistribution {...seasonalProps} analysis={{ ...analysis, fit: { ...analysis.fit, status: 'insufficient samples' } }} />
    </>);
    const residuals = screen.getAllByTestId('seasonal-residual-distribution');
    expect([...residuals[0].querySelectorAll('[data-app-part="metric-value"]')].map(node => node.textContent))
      .toEqual([-0.02, 0, 0.02, null].map(value => formatIntensityWhPerM(value, unitPrefs)));
    expect(residuals[1].querySelector('[data-app-part="metric-grid"]')).toBeNull();
    expect(residuals[1]).toHaveTextContent('not eligible yet');
    const adjusted = screen.getAllByText('Deseasonalized');
    adjusted.forEach(label => expect(label.nextElementSibling).toHaveTextContent('—'));
    expect(container.querySelector('[data-app-design-owner]')).toBeNull();
  });

  it.each(['efficiency', 'smoothness', 'speed'] as const)('keeps only the qualified %s tips and suppresses them without category readings', category => {
    const model = { ...tipsModel, weakestCategoryLabel: category, relevantTips: buildTips(translation.t).filter(tip => tip.category === category) };
    const { rerender } = harness(<ScoreDistributionTipsSection model={model} driveState={() => null} scoreState={() => null} />);
    expect(screen.getAllByRole('listitem').map(node => node.textContent)).toEqual(model.relevantTips.map(tip => tip.key));
    rerender(<ScoreDistributionTipsSection model={{ ...model, hasCategoryReadings: false }} driveState={() => null} scoreState={() => null} />);
    expect(screen.queryByRole('listitem')).toBeNull();
    expect(screen.getByText('Tips appear once drives are scored')).toBeInTheDocument();
  });

  it('keeps the explicit no-tips state when category evidence has no applicable tips', () => {
    harness(<ScoreDistributionTipsSection model={{ ...tipsModel, relevantTips: [] }} driveState={() => null} scoreState={() => null} />);
    expect(screen.queryByRole('listitem')).toBeNull();
    expect(screen.getByText('Tips appear once drives are scored')).toBeInTheDocument();
  });
});
