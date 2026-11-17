import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import postcss from 'postcss';

import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import type { VehicleLiveState } from '@/hooks/useVehicleLive';
import { formatDayKey } from '@/lib/dateFormat';
import { fmtNumber, getFormatterPreferences, setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { formatEnergy } from '@/lib/unitConversion';
import type { ChargingSession } from '@/types/charging';
import type { Drive } from '@/types/driving';
import { computeChargeAdvice, type ChargeAdvice } from '../../lib/chargeAdvisor';
import { ChargeAdvisorChargingProfile } from './ChargeAdvisorChargingProfile';
import { ChargeAdvisorChargingTiming } from './ChargeAdvisorChargingTiming';
import { ChargeAdvisorCurrentState } from './ChargeAdvisorCurrentState';
import { ChargeAdvisorFrequencySupport } from './ChargeAdvisorFrequencySupport';
import { ChargeAdvisorMethodology } from './ChargeAdvisorMethodology';
import { ChargeAdvisorReserveSensitivity } from './ChargeAdvisorReserveSensitivity';
import { ChargeAdvisorScenarioDirectory } from './ChargeAdvisorScenarioDirectory';
import { ChargeAdvisorWeekdayProfile } from './ChargeAdvisorWeekdayProfile';
import type { ChargeAdvisorQueryState } from './types';

const consumers: Array<{ selector: string; declarations: Record<string, string> }> = [];
postcss.parse(readFileSync(resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', 'feedback.css'), 'utf8'))
  .walkRules(rule => {
    const declarations: Record<string, string> = {};
    rule.walkDecls(declaration => { declarations[declaration.prop] = declaration.value; });
    for (const selector of rule.selectors) consumers.push({ selector, declarations });
  });
function matchesAppDesignCss(node: Element, contract = '', mode?: string) {
  return consumers.filter(rule => rule.selector.includes(contract)
    && (!mode || rule.selector.includes(`[data-app-data="${mode}"]`)) && node.matches(rule.selector));
}
function expectAppDesignDataMode(node: Element, mode: string, contract: string) {
  const selected = matchesAppDesignCss(node, contract, mode);
  expect(selected.length).toBeGreaterThan(0);
  expect(node.getAttribute('data-app-design-owner')?.split(' ')).toContain(`data-${mode}`);
  for (const rule of selected) expect(rule.selector).toContain(`[data-app-design-owner~="data-${mode}"]`);
}

vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) =>
      (typeof fallback === 'string' ? fallback : key).replace(
        /\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? ''),
      ),
  }),
}));
vi.mock('@/hooks/useSettings', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useSettings')>(),
  useSettings: () => ({
    locale: 'en-US', settings: { locale: 'en-US', tz_display_default: 'utc' },
  }),
}));
vi.mock('@/lib/timezone', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/timezone')>(),
  useTimezone: () => 'UTC',
}));

const now = Date.parse('2026-06-02T12:00:00Z');
const dates = Array.from({ length: 34 }, (_, index) =>
  new Date(now - (index + 1) * 86_400_000).toISOString().slice(0, 10));
const drives: Drive[] = [1, 5, 9, 13, 17, 21, 25, 29].map((days, index) => {
  const date = dates[days - 1];
  const startTs = `${date}T09:00:00Z`;
  return {
    id: index + 1, vehicleId: 7, startTs, endTs: `${date}T09:30:00Z`,
    durationS: 1800, distanceM: 10_000, startAddress: null, endAddress: null,
    startLat: null, startLon: null, endLat: null, endLon: null,
    startBatteryPct: 80, endBatteryPct: 75, energyUsedWh: 2000, regenEnergyWh: null,
    avgSpeedMps: 15, maxSpeedMps: 30, avgPowerW: null, outsideTempAvgC: null,
    insideTempAvgC: null, score: null, endedStatus: 'completed', createdAt: startTs, updatedAt: startTs,
  };
});
const charging: ChargingSession[] = [20_000, 0].map((energy, index) => {
  const date = dates[index];
  return {
    id: date, vehicle_id: '7', charger_type: 'home', start_soc_pct: 30, end_soc_pct: 80,
    total_energy_added_wh: energy, peak_power_w: 7200, cost_decimal: null,
    started_at: `${date}T20:00:00Z`, ended_at: `${date}T21:00:00Z`,
    start_ts: `${date}T20:00:00Z`, startedAt: `${date}T20:00:00Z`, duration_min: 60,
  };
});
const analysis = computeChargeAdvice(drives, charging, {
  batteryPct: 80, observedAtMs: now - 60_000, source: 'live',
  retrievalState: 'connected', connected: true, isCharging: false, chargeLimitPct: 0,
}, now, 'UTC', { historyWindowDays: 35, coveredLocalDates: dates });
const provenance: VehicleLiveState['advisorProvenance'] = {
  batteryLevel: { source: 'l1', observedAtMs: now - 60_000, ageMs: 60_000, receivedAtMs: now },
  isCharging: { source: 'l2', observedAtMs: null, ageMs: null, receivedAtMs: now },
  chargeLimitSoc: { source: 'timestamp', observedAtMs: now - 300_000, ageMs: 300_000, receivedAtMs: now },
};
const ready: ChargeAdvisorQueryState = {
  vehicleSelected: true, isLoading: false, driveLoading: false, chargingLoading: false,
  driveAvailable: true, chargingAvailable: true, initialError: null, refreshError: null, onRetry: vi.fn(),
};
const energy = (value: number | null | undefined) =>
  formatEnergy(value, {
    distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa', energy: 'kWh',
    duration: 'h', power: 'kW', precision: 2, locale: 'en-US',
  });
function Records({ value = analysis, state = ready }: { value?: ChargeAdvice; state?: ChargeAdvisorQueryState }) {
  const props = { analysis: value, state };
  return <>
    <ChargeAdvisorCurrentState {...props} provenance={provenance} />
    <ChargeAdvisorScenarioDirectory {...props} />
    <ChargeAdvisorWeekdayProfile {...props} />
    <ChargeAdvisorFrequencySupport {...props} />
    <ChargeAdvisorReserveSensitivity {...props} />
    <ChargeAdvisorChargingProfile {...props} formatEnergy={energy} />
    <ChargeAdvisorChargingTiming {...props} />
    <ChargeAdvisorMethodology {...props} />
  </>;
}
function mount(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
  const view = render(<QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>);
  return { ...view, client };
}
const originalPreferences = getFormatterPreferences();
afterEach(() => {
  act(() => { setGlobalLocale(originalPreferences.locale); setGlobalPrecision(originalPreferences.precision); });
});

describe('battery-late-02 charge-advisor native records (source-only)', () => {
  it.each(PACK_IDS)('%s composes each real readout and complete scenario/method record without new data geometry', pack => {
    const before = JSON.stringify({ analysis, drives, charging, provenance });
    const view = mount(<div data-app-design-preview="" {...getAppDesignAttributes(pack)}><Records /></div>);
    const host = view.container.querySelector('[data-app-design-preview]')!;
    const release = observeAppDesignScopes(host);
    try {
      const mode = APPLICATION_DESIGNS[pack].data;
      for (const [id, count] of [
        ['current', 5], ['weekday', 7], ['support', 4], ['charging-profile', 4], ['charging-timing', 7],
      ] as const) {
        const tiles = screen.getByTestId(`charge-advisor-${id}`).querySelectorAll('[data-app-metric="tile"]');
        expect(tiles).toHaveLength(count);
        for (const tile of tiles) {
          expectAppDesignDataMode(tile, mode, '[data-app-metric="tile"]');
          expect(tile.querySelector(':scope > [data-app-part~="metric-label"]')).not.toBeEmptyDOMElement();
          const reading = tile.querySelector(':scope > [data-app-part~="metric-reading"]')!;
          expect(reading).toHaveAttribute('data-app-part', 'metric-reading metric-value');
          expect(matchesAppDesignCss(reading).some(match => match.declarations['font-variant-numeric'])).toBe(true);
        }
      }
      for (const [id, count] of [['directory', 7], ['sensitivity', analysis.reserveSensitivity.length], ['methodology', 4]] as const) {
        const cards = screen.getByTestId(`charge-advisor-${id}`).querySelectorAll('article');
        expect(cards).toHaveLength(count);
        for (const card of cards) {
          expectAppDesignDataMode(card, mode, '[data-app-card-kind="record"]');
          expectAppDesignDataMode(card.querySelector('[data-app-part~="record-header"]')!, mode, '[data-app-part~="record-header"]');
          expectAppDesignDataMode(card.querySelector('[data-app-part~="record-body"]')!, mode, '[data-app-part~="record-body"]');
          expect(card.querySelector('[data-app-part~="record-title"]')).not.toBeEmptyDOMElement();
        }
      }
      const days = screen.getByTestId('charge-advisor-directory').querySelectorAll('article');
      expect([...days].map(day => day.querySelector('[data-app-part="record-title"]')?.textContent))
        .toEqual(analysis.scenarios.meanPath.map(day => formatDayKey(day.localDate, { locale: 'en-US', tz: 'UTC' })));
      for (const [index, day] of analysis.scenarios.meanPath.entries()) {
        const readings = days[index].querySelectorAll('[data-app-part~="metric-reading"]');
        expect([...readings].map(node => node.textContent)).toEqual([
          day.meanBurnPct, day.p75BurnPct, day.meanEndSocPct, day.p75EndSocPct,
        ].map(value => `${fmtNumber(value)}%`));
        for (const reading of readings) expectAppDesignDataMode(reading, mode, '[data-app-metric="headline"]');
        expect(readings[2]).toHaveClass('text-theme-accent');
        expect(readings[3]).toHaveClass('text-amber-300');
      }
      const current = screen.getByTestId('charge-advisor-current');
      expect(within(current).getByTestId('charge-advisor-source-batteryLevel')).toHaveTextContent('l1');
      expect(within(current).getByTestId('charge-advisor-source-isCharging')).toHaveTextContent('Unknown');
      expect(within(current).getByTestId('charge-advisor-source-chargeLimitSoc')).toHaveTextContent('Stale');
      expect(current).toHaveTextContent(`Charge limit ${fmtNumber(0)}%`);
      expect(screen.getByTestId('charge-advisor-charging-profile')).toHaveTextContent('20.00 kWh');
      expect(screen.getByTestId('charge-advisor-methodology')).toHaveTextContent('not calibrated outcomes');
      expect(screen.getByTestId('charge-advisor-sensitivity')).toHaveTextContent('not a battery operating limit');
      expect(host.querySelector('[role="meter"], [role="progressbar"], [data-metric-track]')).toBeNull();
      expect(JSON.stringify({ analysis, drives, charging, provenance })).toBe(before);
    } finally { release(); view.unmount(); view.client.clear(); }
  });

  it('retains independently loading/unavailable/partial evidence and all always-visible method limitations', () => {
    const view = mount(<Records state={{ ...ready, driveAvailable: false, chargingLoading: true, refreshError: new Error('retained') }} />);
    expect(screen.getByTestId('charge-advisor-directory')).toHaveTextContent('Drive history is unavailable');
    expect(screen.getByTestId('charge-advisor-charging-profile').querySelector('[data-app-part~="skeleton"]')).not.toBeNull();
    expect(screen.getByTestId('charge-advisor-charging-profile').querySelector('[data-app-metric]')).toBeNull();
    expect(screen.getByTestId('charge-advisor-current')).toHaveTextContent('Not charging');
    expect(screen.getByTestId('charge-advisor-methodology').querySelectorAll('article')).toHaveLength(4);
    expect(screen.getByTestId('charge-advisor-methodology')).toHaveTextContent('weather, passengers, HVAC');
    expect(screen.getByTestId('charge-advisor-methodology')).toHaveTextContent('not total energy use');
    view.unmount(); view.client.clear();
  });

  it('preserves measured zero, unknown calendar support, missing energy and empty scenarios without a fabricated gauge', () => {
    const missing = computeChargeAdvice([], [], null, now, 'UTC');
    const zero: ChargeAdvice = {
      ...missing, current: { ...missing.current, batteryPct: 0, isCharging: false, chargeLimitPct: 0 },
      chargingProfile: { ...missing.chargingProfile, startsByWeekday: [0, Number.NaN, 0, 0, 0, 0, 0] },
      reserveSensitivity: [{ floorPct: 20, meanDaysToCross: 0, p75DaysToCross: null }],
    };
    const view = mount(<Records value={zero} />);
    const current = screen.getByTestId('charge-advisor-current').querySelectorAll('[data-app-metric="tile"]');
    expect(current[0].querySelector('[data-app-part~="metric-value"]')).toHaveTextContent(`${fmtNumber(0)}%`);
    expect(current[1]).toHaveTextContent('No valid source');
    expect(current[2].querySelector('[data-app-part~="metric-value"]')).toHaveTextContent('—');
    const weekdays = screen.getByTestId('charge-advisor-weekday').querySelectorAll('article');
    expect(weekdays).toHaveLength(7);
    expect(weekdays[0].querySelector('[data-app-part~="metric-value"]')).toHaveTextContent('—');
    expect(weekdays[0]).toHaveTextContent('0 driving days');
    const profile = screen.getByTestId('charge-advisor-charging-profile').querySelectorAll('[data-app-metric="tile"]');
    expect(profile[0].querySelector('[data-app-part~="metric-value"]')).toHaveTextContent('0');
    expect(profile[3].querySelector('[data-app-part~="metric-value"]')).toHaveTextContent('—');
    const timing = screen.getByTestId('charge-advisor-charging-timing').querySelectorAll('[data-app-part~="metric-value"]');
    expect(timing[0]).toHaveTextContent('0'); expect(timing[1]).toHaveTextContent('—');
    expect(screen.getByTestId('charge-advisor-directory')).toHaveTextContent('No seven-day scenario');
    expect(screen.getByTestId('charge-advisor-directory').querySelector('article')).toBeNull();
    const reserves = screen.getByTestId('charge-advisor-sensitivity').querySelectorAll('[data-app-part~="metric-value"]');
    expect(reserves[0]).toHaveTextContent('0 days'); expect(reserves[1]).toHaveTextContent('—');
    view.unmount(); view.client.clear();
  });

  it('keeps widget-only/incomplete previews neutral and source formatting intact as precision changes', () => {
    const view = mount(<div data-app-design-preview="" {...getAppDesignAttributes('v1')}>
      <div data-testid="neutral" data-app-design-preview="" data-widget-design-pack="v1"><Records /></div>
      <div data-testid="incomplete" data-app-design-preview="" data-app-design-pack="v1">
        <ChargeAdvisorChargingProfile analysis={analysis} state={ready} formatEnergy={energy} />
      </div>
    </div>);
    const release = observeAppDesignScopes(view.container.firstElementChild!);
    try {
      for (const id of ['neutral', 'incomplete']) {
        for (const node of screen.getByTestId(id).querySelectorAll('[data-app-metric], [data-app-card-kind]')) {
          expect(node).not.toHaveAttribute('data-app-design-owner');
          expect(matchesAppDesignCss(node)).toHaveLength(0);
        }
      }
      act(() => { setGlobalLocale('de-DE'); setGlobalPrecision(3); });
      const battery = within(screen.getByTestId('neutral')).getByTestId('charge-advisor-current')
        .querySelector('[data-app-part~="metric-value"]');
      expect(battery).toHaveTextContent('80,000%');
      expect(screen.getByTestId('neutral').querySelector('[data-app-part~="metric-unit"]')).toBeNull();
    } finally { release(); view.unmount(); view.client.clear(); }
  });
});
