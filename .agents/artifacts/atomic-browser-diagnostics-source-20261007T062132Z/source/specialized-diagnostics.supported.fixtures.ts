import { expect, type Page } from '@playwright/test';
import type { SignalHistoryPoint, SignalHistoryResp, SoftwareUpdate } from '../../src/api/types';
import type { SignalHistoryResponse } from '../../src/types/telemetry';
import { fulfillApiFixture, type MockApiController } from '../mockApi';

export const FOCAL_SIGNAL = 'BatteryLevel';
export const RELATED_SIGNALS = ['EstBatteryRange', 'IdealBatteryRange', 'PackVoltage'] as const;
export const DIAGNOSTIC_SIGNALS = [FOCAL_SIGNAL, ...RELATED_SIGNALS] as const;
export type DiagnosticSignal = typeof DIAGNOSTIC_SIGNALS[number];
export const SAMPLE_COUNT = 90;
export const HISTORY_START = '2026-08-26T14:00:00.000Z';
export const HISTORY_END = '2026-08-26T15:29:00.000Z';

// Registry-proven source scales: BatteryLevel is charge percent, range is
// meters, and PackVoltage is an unconverted voltage scalar (UnitKindNone).
export const SIGNAL_CATALOG = {
  vehicle_id: 7, count: DIAGNOSTIC_SIGNALS.length, source: 'protomodel',
  signals: DIAGNOSTIC_SIGNALS.map(name => ({
    name, category: 'charging', value_kind: 'ValueKindFloat',
    unit_kind: name === FOCAL_SIGNAL ? 'UnitKindCharge'
      : name === 'PackVoltage' ? 'UnitKindNone' : 'UnitKindDistance',
    is_compound: false, is_setting_unit: false,
  })),
};

export const SOFTWARE_UPDATES: SoftwareUpdate[] = [{
  id: 41, vehicle_id: 7, version: '2026.20.1', status: 'installed',
  scheduled_at: null, installed_at: '2026-08-25T12:00:00.000Z',
  created_at: '2026-08-25T12:00:00.000Z',
}];

// The flat constant and deterministic lead/lag steps translate the existing
// rootCauseIntelligence.test.ts fixtures onto actual registry signal names.
const STEP_PARAMETERS: Record<DiagnosticSignal, {
  before: number; after: number; shiftAt: number; amplitude: number;
}> = {
  BatteryLevel: { before: 80, after: 62, shiftAt: 45, amplitude: 0.2 },
  PackVoltage: { before: 380, after: 350, shiftAt: 35, amplitude: 0.4 },
  EstBatteryRange: { before: 300_000, after: 270_000, shiftAt: 55, amplitude: 400 },
  IdealBatteryRange: { before: 320_000, after: 320_000, shiftAt: 90, amplitude: 0 },
};

export function diagnosticHistory(signal: DiagnosticSignal, empty = false): SignalHistoryResp {
  const step = STEP_PARAMETERS[signal];
  const data: SignalHistoryPoint[] = empty ? [] : Array.from({ length: SAMPLE_COUNT }, (_, index) => {
    const ts = new Date(Date.parse(HISTORY_START) + index * 60_000).toISOString();
    const hash = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
    const jitter = ((hash - Math.floor(hash)) - 0.5) * 2 * step.amplitude;
    return {
      ts, kind: 'ValueKindFloat',
      value: (index < step.shiftAt ? step.before : step.after) + jitter,
      ingest_origin: 'fleet_telemetry_mqtt', source_emitted_at: ts, received_at: ts,
      normalization_version: 1,
    };
  });
  // Keep the native wire envelope. request() supplies the vehicleId alias;
  // do not pad points with timestamp/valueNum to conceal parsing defects.
  const history: Omit<SignalHistoryResponse, 'vehicleId'> = {
    signal, from: HISTORY_START, to: HISTORY_END, count: data.length, data,
  };
  return { vehicle_id: 7, expected_kind: 'ValueKindFloat', ...history };
}

export const EXPECTED_QUALITY_SCORE = 0.4 * (90 / 200) + 0.35 * (2 / 3) + 0.25 * (89 / 1440);
export const EXPECTED_SUMMARY =
  'BatteryLevel shows a robust shift with 2 ranked, evidence-based hypotheses for review ' +
  '(evidence quality: moderate). This is an evidence-ranked hypothesis, not a diagnosis or a claim of causal proof.';
export const NO_CAUSAL_PROOF =
  'This is an evidence-ranked hypothesis, not a diagnosis or a claim of causal proof.';
export const COMMON_LIMITATIONS = [
  `Every listed item is an evidence-ranked hypothesis derived from statistical association. ${NO_CAUSAL_PROOF}`,
  'Analysis is limited to the selected time window and the bounded set of related signals available in the catalog; unrecorded or unavailable signals cannot be considered.',
  'Temporal proximity alone does not establish which signal, if any, is upstream of the other.',
] as const;
export const MISSING_FOCAL_LIMITATIONS = [
  'The focal signal did not show a robust, well-supported shift in this window, so hypotheses are withheld rather than guessed.',
  'Evidence quality is low — treat any listed hypothesis as preliminary and confirm with additional data before acting.',
] as const;
export const SOURCE_ATTRIBUTION =
  'Evidence-ranked analysis of retrieved signal histories; not a diagnosis or proof of causation.';
export const SCORE_BASIS =
  'Existing evidence-quality score on a 0–1 scale, not a probability or causal confidence.';

export interface DiagnosticFixtureControls {
  availableRequests: number;
  historyRequests: DiagnosticSignal[];
  softwareRequests: number;
  focalEmpty: boolean;
  holdNextFocal: () => void;
  releaseFocal: () => void;
}

export async function installDiagnosticFixtures(
  page: Page,
  mocks: MockApiController | null,
  service: boolean,
  focalEmpty = false,
): Promise<DiagnosticFixtureControls> {
  if (!mocks) throw new Error('Supported diagnostics contracts require strict mocked E2E mode');
  let hold = false;
  let release: (() => void) | undefined;
  const controls: DiagnosticFixtureControls = {
    availableRequests: 0, historyRequests: [], softwareRequests: 0, focalEmpty,
    holdNextFocal: () => { hold = true; },
    releaseFocal: () => { hold = false; release?.(); release = undefined; },
  };
  await page.route(url => url.pathname === '/api/v1/signals/7/available', async route => {
    expect(route.request().method()).toBe('GET');
    expect(new URL(route.request().url()).search).toBe('');
    controls.availableRequests += 1;
    await fulfillApiFixture(route, mocks, { json: SIGNAL_CATALOG });
  });
  // Catch every signal-history request in this workspace, not just the
  // expected ones: unsupported candidates or wrong windows must fail.
  await page.route(url => /^\/api\/v1\/signals\/7\/[^/]+\/history$/.test(url.pathname), async route => {
    const url = new URL(route.request().url());
    const name = decodeURIComponent(url.pathname.split('/')[5] ?? '');
    expect(DIAGNOSTIC_SIGNALS).toContain(name);
    const signal = name as DiagnosticSignal;
    expect(route.request().method()).toBe('GET');
    expect(url.pathname).toBe(`/api/v1/signals/7/${encodeURIComponent(signal)}/history`);
    expect(url.search).toBe('?hours=72&limit=10000');
    controls.historyRequests.push(signal);
    if (signal === FOCAL_SIGNAL && hold) {
      hold = false;
      await new Promise<void>(resolve => { release = resolve; });
    }
    await fulfillApiFixture(route, mocks, {
      json: diagnosticHistory(signal, signal === FOCAL_SIGNAL && controls.focalEmpty),
    });
  });
  if (service) {
    await page.route(url => url.pathname === '/api/v1/software-updates', async route => {
      expect(route.request().method()).toBe('GET');
      expect(new URL(route.request().url()).search).toBe('?vehicle_id=7');
      controls.softwareRequests += 1;
      await fulfillApiFixture(route, mocks, { json: SOFTWARE_UPDATES });
    });
  }
  return controls;
}
