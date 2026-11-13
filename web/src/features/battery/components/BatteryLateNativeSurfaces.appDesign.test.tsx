import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import postcss, { type Rule } from 'postcss';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BatteryPassport } from '@/api/hooks/useBatteryPassport';
import { deriveDataState } from '@/api/dataState';
import { ToastProvider } from '@/components/feedback';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';
import type { ChargingSession } from '@/types/charging';
import type { Drive } from '@/types/driving';
import { computeBatteryCare } from '../lib/batteryCare';
import { analyzeBatteryPassport } from '../lib/batteryPassportAnalysis';
import { computeChargeAdvice } from '../lib/chargeAdvisor';
import { BatteryCareMethodology } from './battery-care/BatteryCareMethodology';
import { RankedCareHabits } from './battery-care/RankedCareHabits';
import { CareRisk } from './battery-care-modernization/CareRisk';
import { EvidenceBar } from './battery-care-modernization/EvidenceBar';
import { careSectionState } from './battery-care-modernization/state';
import { BatteryPassportGradeAudit } from './battery-passport/BatteryPassportGradeAudit';
import { BatteryPassportMasthead } from './battery-passport/BatteryPassportMasthead';
import { BatteryPassportMethodology } from './battery-passport/BatteryPassportMethodology';
import { BatteryPassportRecommendations } from './battery-passport/BatteryPassportRecommendations';
import { BatteryPassportTrendDiagnostics } from './battery-passport/BatteryPassportTrendDiagnostics';
import { BatteryPassportVerificationDiagnostics } from './battery-passport/BatteryPassportVerificationDiagnostics';
import type { BatteryPassportQueryState, BatteryPassportVerificationState } from './battery-passport/types';
import { ChargeAdvisorAccounting } from './charge-advisor/ChargeAdvisorAccounting';
import { ChargeAdvisorBurnDistribution } from './charge-advisor/ChargeAdvisorBurnDistribution';
import type { ChargeAdvisorQueryState } from './charge-advisor/types';

const NOW = Date.parse('2026-08-09T12:00:00Z');
const retry = vi.fn();
const exportCertificate = vi.fn();
const specialistState = { isLoading: false, error: null, onRetry: retry };
const verification: BatteryPassportVerificationState = {
  status: 'valid', data: { valid: true, expected_hash: 'a'.repeat(64), provided_hash: 'a'.repeat(64) },
  error: null, onRetry: retry, isPaused: false, isRetrying: false,
};
const advisorState: ChargeAdvisorQueryState = {
  vehicleSelected: true, isLoading: false, driveLoading: false, chargingLoading: false,
  driveAvailable: true, chargingAvailable: true, initialError: null, refreshError: null, onRetry: retry,
};
function drive(id: number, arrival = 5): Drive {
  const startTs = `2026-08-0${id}T10:00:00Z`;
  return {
    id, vehicleId: 7, startTs, endTs: startTs.replace('10:00', '10:30'),
    durationS: 1800, distanceM: 10_000, startAddress: null, endAddress: null,
    startLat: null, startLon: null, endLat: null, endLon: null,
    startBatteryPct: 60, endBatteryPct: arrival, energyUsedWh: 3000, regenEnergyWh: null,
    avgSpeedMps: null, maxSpeedMps: null, avgPowerW: null, outsideTempAvgC: null,
    insideTempAvgC: null, score: null, endedStatus: 'completed', createdAt: startTs, updatedAt: startTs,
  };
}
function session(id: number, endSoc = 95, charger = 'DC'): ChargingSession {
  const startTs = `2026-08-0${id}T11:00:00Z`;
  return {
    id: String(id), vehicle_id: '7', charger_type: charger, start_soc_pct: 20,
    end_soc_pct: endSoc, total_energy_added_wh: 30_000, peak_power_w: 50_000,
    cost_decimal: null, started_at: startTs, ended_at: startTs.replace('11:00', '12:00'),
    start_ts: startTs, startedAt: startTs, duration_min: 60, duration_s: 3600,
  };
}
const drives = Array.from({ length: 5 }, (_, i) => drive(i + 1));
const sessions = Array.from({ length: 5 }, (_, i) => session(i + 1));
const care = computeBatteryCare(sessions, drives, { nowMs: NOW, sessionLimit: 5, driveLimit: 5 });
const careState = careSectionState([
  { label: 'Charging history', state: deriveDataState({ data: sessions }, { provenance: 'historical' }) },
  { label: 'Drive history', state: deriveDataState({ data: drives }, { provenance: 'historical' }) },
]);
const certificate: BatteryPassport = {
  vehicle_id: 7, vin_masked: 'TEST********1234', issued_at: '2026-08-09T10:00:00Z',
  first_observed_at: null, soh_pct: 91.2, capacity_kwh: 68.4, original_capacity_kwh: 75,
  equivalent_full_cycles: 0, fast_charge_ratio: 0, avg_charge_limit_pct: 0,
  thermal_exposure: { cold_pct: 0, nominal_pct: 100, hot_pct: 0 }, health_grade: 'B',
  degradation_trend: [
    { date: '2026-08-01', soh_pct: 95 }, { date: 'invalid', soh_pct: 95 },
    { date: '2026-08-10', soh_pct: 95 }, { date: '2026-08-02', soh_pct: NaN },
    { date: '2026-08-01', soh_pct: 94 },
  ],
  recommendations: ['First returned rule: preserve its complete uncertainty and context.',
    'Second returned rule: not a prescription, damage estimate, or eligibility decision.'],
  provenance_hash: 'a'.repeat(64),
};
const passportState: BatteryPassportQueryState = {
  vehicleSelected: true, passport: certificate, isLoading: false, isResolved: true,
  initialError: null, refreshError: null, onRetry: retry,
};
const analysis = analyzeBatteryPassport(certificate, NOW);
const advice = computeChargeAdvice(drives, sessions, null, NOW, 'UTC');

function cssRules(name: string) {
  const rules: Rule[] = [];
  postcss.parse(readFileSync(resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', name), 'utf8'))
    .walkRules(rule => { rules.push(rule); });
  return rules;
}
const baseRules = cssRules('base.css');
const feedbackRules = cssRules('feedback.css');
function consumes(node: Element, rules: readonly Rule[], contract: string, property: string, mode = '') {
  return rules.some(rule => rule.nodes.some(declaration => declaration.type === 'decl' && declaration.prop === property)
    && rule.selectors.some(selector => selector.includes(contract)
      && (!mode || selector.includes(mode)) && node.matches(selector)));
}
function mount(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false, gcTime: 0 } } });
  return render(<MemoryRouter><QueryClientProvider client={client}><ToastProvider>
    {children}
  </ToastProvider></QueryClientProvider></MemoryRouter>);
}
function Surfaces() {
  return <>
    <CareRisk care={care} state={careState} />
    <div data-testid="unknown-evidence"><EvidenceBar label="Uncalibrated deduction" value={null} max={30} color="#123456" sublabel="Not calibrated · 2 samples" /></div>
    <BatteryCareMethodology care={care} state={specialistState} sessionLimit={5} driveLimit={5} sessionsAvailable drivesAvailable />
    <RankedCareHabits care={care} state={specialistState} />
    <BatteryPassportGradeAudit analysis={analysis} state={passportState} />
    <BatteryPassportMasthead state={passportState} verification={verification} locale="en-US" timeZone="UTC" onExport={exportCertificate} />
    <BatteryPassportMethodology />
    <BatteryPassportRecommendations state={passportState} />
    <BatteryPassportTrendDiagnostics analysis={analysis} state={passportState} />
    <BatteryPassportVerificationDiagnostics state={passportState} verification={verification} />
    <ChargeAdvisorAccounting analysis={advice} state={advisorState} />
    <ChargeAdvisorBurnDistribution analysis={advice} state={advisorState} />
  </>;
}
beforeEach(() => {
  retry.mockClear();
  exportCertificate.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('battery-late-01 exact native source consumers (source-only)', () => {
  it.each(PACK_IDS)('%s activates the real metric, record, definitions and scope-notice consumers', pack => {
    const snapshot = structuredClone({ care, advice, certificate });
    const { container } = mount(<div data-app-design-preview="" {...getAppDesignAttributes(pack)}><Surfaces /></div>);
    const release = observeAppDesignScopes(container.querySelector('[data-app-design-preview]')!);
    try {
      const design = APPLICATION_DESIGNS[pack];
      const dataMode = `[data-app-data="${design.data}"]`;
      const tiles = container.querySelectorAll('[data-app-metric="tile"]');
      expect(tiles).toHaveLength(12);
      for (const tile of tiles) {
        expect(consumes(tile, baseRules, '[data-app-part~="card"]', 'border-radius')).toBe(true);
        expect(consumes(tile, feedbackRules, '[data-app-metric="tile"]', 'padding', dataMode)).toBe(true);
        expect(tile.querySelector(':scope > [data-app-part~="metric-label"]')).toBeInTheDocument();
        const reading = tile.querySelector(':scope > [data-app-part~="metric-reading"]')!;
        expect(consumes(reading, feedbackRules, '[data-app-part~="metric-reading"]', 'font-variant-numeric')).toBe(true);
        expect(tile.querySelector('[role="progressbar"], svg, [data-metric-track]')).toBeNull();
      }
      const records = container.querySelectorAll('[data-app-card-kind="record"]');
      expect(records).toHaveLength(care.opportunities.length + 14 + certificate.recommendations.length);
      for (const record of records) {
        expect(consumes(record, baseRules, '[data-app-part~="card"]', 'border-radius')).toBe(true);
        expect(consumes(record, feedbackRules, '[data-app-card-kind="record"]', 'display', dataMode)).toBe(true);
        const body = record.querySelector(':scope > [data-app-part~="record-body"]')!;
        expect(consumes(body, feedbackRules, '[data-app-part~="record-body"]', 'min-inline-size', dataMode)).toBe(true);
      }
      const rows = container.querySelectorAll('dl[data-app-list="definitions"] > [data-app-part~="list-row"]');
      expect(rows).toHaveLength(5 + 2 + Object.keys(advice.driveAccounting.categories).length + Object.keys(advice.chargingAccounting.categories).length);
      for (const row of rows) {
        expect(consumes(row, baseRules, '[data-app-part~="card"]', 'border-radius')).toBe(true);
        expect(consumes(row, feedbackRules, '[data-app-list="definitions"]', 'display', dataMode)).toBe(true);
        expect(row.querySelector('dt[data-app-part~="metric-label"]')).toBeInTheDocument();
        const reading = row.querySelector('dd[data-app-part~="metric-reading"]')!;
        expect(consumes(reading, feedbackRules, '[data-app-list="definitions"]', 'white-space', dataMode)).toBe(true);
      }
      const method = screen.getByTestId('battery-care-methodology');
      const notice = method.querySelector('[data-app-feedback-kind="notice"][data-app-tone="neutral"]')!;
      expect(consumes(notice, feedbackRules, '[data-app-feedback-kind="notice"]', 'border', `[data-app-feedback="${design.feedback}"]`)).toBe(true);
      expect(notice.querySelector('[data-app-part~="feedback-content"] > [data-app-part~="feedback-message"]')).toHaveTextContent('Both sources filled their requested caps');
      expect(notice.querySelector('[data-app-part~="feedback-detail"]')).toHaveTextContent('does not measure battery health');
      expect(screen.getByTestId('battery-care-score').querySelector('[data-app-metric="tile"]')).toHaveTextContent('0');
      expect(care.score).toBe(0);
      const bars = within(screen.getByTestId('battery-care-score')).getAllByRole('progressbar');
      expect(bars.map(bar => [Number(bar.getAttribute('aria-valuenow')), Number(bar.getAttribute('aria-valuemax'))]))
        .toEqual(care.riskComponents.map(component => [component.penaltyPoints, component.maxPoints]));
      expect([...screen.getByTestId('battery-passport-recommendations').querySelectorAll('[data-app-part~="record-context"]')].map(node => node.textContent))
        .toEqual(certificate.recommendations);
      expect([...screen.getByTestId('battery-passport-trend-diagnostics').querySelectorAll('dl dd')].map(node => node.textContent))
        .toEqual(Object.values(analysis.trend.accounting.categories).map(value => fmtInt(value)));
      expect(screen.getByTestId('battery-passport-methodology').querySelectorAll('article')).toHaveLength(12);
      expect({ care, advice, certificate }).toEqual(snapshot);
    } finally {
      release();
    }
  });

  it('leaves default/widget-only and incomplete-preview sources neutral even beneath an active app design', () => {
    const root = document.documentElement;
    const original = Object.keys(getAppDesignAttributes('v1')).map(name => [name, root.getAttribute(name)] as const);
    for (const [name, value] of Object.entries(getAppDesignAttributes('v1'))) root.setAttribute(name, value);
    const { container } = mount(<>
      <div data-app-design-preview=""><Surfaces /></div>
      <div data-app-design-preview="" data-app-design-pack="v1"><Surfaces /></div>
    </>);
    const release = observeAppDesignScopes(root);
    try {
      for (const source of container.querySelectorAll('[data-app-metric="tile"], [data-app-card-kind="record"], dl > [data-app-part~="list-row"]')) {
        expect(source).not.toHaveAttribute('data-app-design-owner');
        expect(consumes(source, baseRules, '[data-app-part~="card"]', 'border-radius')).toBe(false);
        expect(consumes(source, feedbackRules, '[data-app-data=', 'display')).toBe(false);
      }
    } finally {
      release();
      for (const [name, value] of original) {
        if (value == null) root.removeAttribute(name);
        else root.setAttribute(name, value);
      }
    }
  });

  it('keeps unknown fallback separate from true-zero and positive bars, including original extents and color', async () => {
    const view = render(<EvidenceBar label="Measured deduction" value={null} max={30} color="#123456" sublabel="Not calibrated · 2 samples" />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText('—').closest('[data-app-state="missing"]')).toHaveTextContent('Not calibrated · 2 samples');
    view.rerender(<EvidenceBar label="Measured deduction" value={0} max={30} color="#123456" sublabel="Zero deduction" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '30');
    view.rerender(<EvidenceBar label="Measured deduction" value={12} max={30} color="#123456" sublabel="12 / 30 pts" />);
    const fill = screen.getByRole('progressbar').querySelector('[data-metric-fill]') as HTMLElement;
    expect(fill.style.background).toBe('rgb(18, 52, 86)');
    await waitFor(() => expect(fill.style.width).toBe('40%'));
  });

  it('preserves independent source absence, real counts, caps, limitations and calibrated versus unsupported rankings', () => {
    const partial = computeBatteryCare([], drives, { nowMs: NOW });
    const view = mount(<BatteryCareMethodology care={partial} state={specialistState} sessionLimit={5} driveLimit={5} sessionsAvailable={false} drivesAvailable />);
    const cells = screen.getByTestId('battery-care-methodology').querySelectorAll('[data-app-metric="tile"]');
    expect([...cells].map(cell => cell.querySelector('[data-app-part~="metric-reading"]')?.textContent)).toEqual(['—', '—', '5', '5']);
    expect(cells[0]).toHaveAttribute('data-app-state', 'missing');
    expect(cells[2]).not.toHaveAttribute('data-app-state');
    expect(screen.getByTestId('battery-care-methodology')).toHaveTextContent('does not measure battery health, infer degradation, or know time spent');
    view.unmount();
    const ranking = mount(<RankedCareHabits care={partial} state={specialistState} />);
    expect(partial.scoreReady).toBe(false);
    expect(screen.getByTestId('battery-care-habits')).toHaveTextContent('Review very low drive arrivals');
    expect(screen.getByTestId('battery-care-habits').querySelectorAll('[data-app-card-kind="record"]')).toHaveLength(1);
    ranking.unmount();
    const thin = computeBatteryCare([], drives.slice(0, 2), { nowMs: NOW });
    const unsupported = mount(<RankedCareHabits care={thin} state={specialistState} />);
    expect(screen.getByTestId('battery-care-habits')).toHaveTextContent('More eligible evidence is needed');
    const healthy = computeBatteryCare(sessions.map(row => ({ ...row, end_soc_pct: 60, charger_type: 'AC' })),
      drives.map(row => ({ ...row, endBatteryPct: 50 })), { nowMs: NOW });
    unsupported.unmount();
    mount(<RankedCareHabits care={healthy} state={specialistState} />);
    expect(screen.getByTestId('battery-care-habits')).toHaveTextContent('No calibrated observation crossed the ranking thresholds');
  });

  it('keeps hash copying, full bytes, toast, export and empty hash behavior separate from verification truth', async () => {
    const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    try {
      const view = mount(<BatteryPassportMasthead state={{ ...passportState, refreshError: new Error('refresh failed') }} verification={{ ...verification, status: 'error' }} locale="en-US" timeZone="UTC" onExport={exportCertificate} />);
      const hash = screen.getByText(certificate.provenance_hash);
      expect(hash.tagName).toBe('CODE');
      expect(hash).toHaveClass('break-all');
      expect(hash.closest('[data-app-card-kind="record"]')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Copy certificate hash' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(certificate.provenance_hash));
      expect(await screen.findByText('Copied to clipboard')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Export certificate' }));
      expect(exportCertificate).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(retry).toHaveBeenCalledOnce();
      expect(screen.getByTestId('battery-passport-masthead')).toHaveTextContent('Verification unavailable');
      view.unmount();
      mount(<BatteryPassportMasthead state={{ ...passportState, passport: { ...certificate, provenance_hash: '' } }} verification={{ ...verification, status: 'unavailable', data: null }} locale="en-US" timeZone="UTC" onExport={exportCertificate} />);
      const emptyHash = screen.getByRole('button', { name: 'Copy certificate hash' }).closest('[data-app-card-kind="record"]')!;
      expect(emptyHash.querySelector('code')).toHaveTextContent('—');
      fireEvent.click(within(emptyHash as HTMLElement).getByRole('button'));
      await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(''));
    } finally {
      if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it.each(['unavailable', 'loading', 'refreshing', 'error', 'mismatch', 'valid'] as const)('retains the verification state machine and hash readouts for %s', status => {
    const data = status === 'loading' || status === 'unavailable' ? null
      : status === 'mismatch' ? { valid: false, expected_hash: 'b'.repeat(64), provided_hash: 'a'.repeat(64) }
      : verification.data;
    mount(<BatteryPassportVerificationDiagnostics state={passportState} verification={{ ...verification, status, data, isPaused: status === 'unavailable' }} />);
    const diagnostics = screen.getByTestId('battery-passport-verification-diagnostics');
    const values = [...diagnostics.querySelectorAll('dd code')].map(node => node.textContent);
    expect(values).toEqual([data ? `${data.expected_hash.slice(0, 16)}…` : '—', `${'a'.repeat(16)}…`]);
    if (status === 'error') {
      expect(diagnostics).toHaveTextContent('previous response, not a current digest comparison');
      fireEvent.click(within(diagnostics).getByRole('button', { name: 'Retry verification' }));
      expect(retry).toHaveBeenCalledOnce();
    } else {
      expect(within(diagnostics).queryByRole('button', { name: 'Retry verification' })).not.toBeInTheDocument();
    }
    if (status === 'valid') expect(diagnostics).toHaveTextContent('does not establish that upstream telemetry');
    expect(diagnostics.querySelector('[role="progressbar"], [data-app-metric="tile"]')).toBeNull();
  });

  it('preserves distribution order, complete formatted readings, nulls and independent accounting-source availability', () => {
    const view = mount(<>
      <ChargeAdvisorBurnDistribution analysis={advice} state={advisorState} />
      <ChargeAdvisorAccounting analysis={advice} state={{ ...advisorState, chargingAvailable: false }} />
    </>);
    const distribution = screen.getByTestId('charge-advisor-distribution');
    const labels = [...distribution.querySelectorAll('[data-app-part~="metric-label"]')].map(node => node.textContent);
    expect(labels).toEqual(['Mean', 'Median', 'p75', 'p90', 'Minimum', 'Maximum']);
    const expected = advice.burnDistribution;
    expect([...distribution.querySelectorAll('[data-app-part~="metric-reading"]')].map(node => node.textContent))
      .toEqual([expected.meanPct, expected.medianPct, expected.p75Pct, expected.p90Pct, expected.minPct, expected.maxPct].map(value => value == null ? '—' : fmtPercent(value)));
    const driveRows = screen.getByTestId('charge-advisor-accounting-drive').querySelectorAll('dl > div');
    expect([...driveRows].map(row => row.querySelector('dd')?.textContent))
      .toEqual(Object.values(advice.driveAccounting.categories).map(value => fmtInt(value)));
    expect(screen.getByTestId('charge-advisor-accounting-charging')).toHaveTextContent('Charging history is unavailable');
    expect(screen.getByTestId('charge-advisor-accounting-charging').querySelector('dl')).toBeNull();
    view.unmount();
    mount(<ChargeAdvisorBurnDistribution analysis={computeChargeAdvice([], [], null, NOW, 'UTC')} state={advisorState} />);
    for (const tile of screen.getByTestId('charge-advisor-distribution').querySelectorAll('[data-app-metric="tile"]')) {
      expect(tile).toHaveAttribute('data-app-state', 'missing');
      expect(tile.querySelector('[data-app-part~="metric-reading"]')).toHaveTextContent('—');
    }
  });

  it('keeps all methodology articles without a certificate and shows the actual empty recommendation result', () => {
    mount(<>
      <BatteryPassportMethodology />
      <BatteryPassportRecommendations state={{ ...passportState, passport: { ...certificate, recommendations: [] } }} />
    </>);
    const methodology = screen.getByTestId('battery-passport-methodology');
    expect(methodology.querySelectorAll('article')).toHaveLength(12);
    expect(methodology).toHaveTextContent('not a forecast');
    expect(methodology).toHaveTextContent('does not establish regulatory compliance');
    expect(screen.getByTestId('battery-passport-recommendations')).toHaveTextContent('empty rule-result state, not a health or safety assessment');
    expect(screen.getByTestId('battery-passport-recommendations').querySelector('ol')).toBeNull();
  });
});
