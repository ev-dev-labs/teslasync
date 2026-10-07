import type { Page } from '@playwright/test';
import {
  COMMUNITY_DRAFT_ENVELOPE,
  EFFICIENCY_INSIGHTS_ENVELOPE,
  TAMPERED_DEMO_ENVELOPE,
} from '../../src/features/intelligence-packs/lib/catalogFixtures';
import type { SignedPackEnvelope } from '../../src/features/intelligence-packs/lib/manifestTypes';
import { SAMPLE_TELEMETRY_ROWS } from '../../src/features/intelligence-packs/lib/sampleTelemetry';

export const MARKETPLACE_PATH = '/intelligence-packs';
export const SANDBOX_BRIEF_ID = 'intelligence-packs-sandbox-run-brief';
export const SIMULATED_GRANT = 'Preview mode: simulating full requested-capability grant (not installed)';
export const INSTALLED_GRANT = 'Using installed capability grant';

export const BUNDLED_ENVELOPES: readonly SignedPackEnvelope[] = [
  EFFICIENCY_INSIGHTS_ENVELOPE,
  COMMUNITY_DRAFT_ENVELOPE,
  TAMPERED_DEMO_ENVELOPE,
];

interface SandboxChartExpectation {
  title: string;
  unit: string;
  values: readonly number[];
}

interface SandboxExpectation {
  envelope: SignedPackEnvelope;
  rows: number;
  steps: number;
  charts: readonly SandboxChartExpectation[];
}

// These are the real offline catalog's declared sample units, not SI API
// fixtures or measurements of a user's vehicle. Do not relabel their data.
export const STARTER_EXPECTATION: SandboxExpectation = {
  envelope: EFFICIENCY_INSIGHTS_ENVELOPE,
  rows: SAMPLE_TELEMETRY_ROWS.length,
  // 3 + 3 + 1 + 3 AST evaluations per bundled row.
  steps: SAMPLE_TELEMETRY_ROWS.length * 10,
  charts: [
    {
      title: 'Efficiency Gap vs Target',
      unit: 'Wh/km',
      values: SAMPLE_TELEMETRY_ROWS.map(row => row.drive_efficiency_wh_per_km - 150),
    },
    {
      title: 'Battery Headroom',
      unit: '%',
      values: SAMPLE_TELEMETRY_ROWS.map(row => row.battery_level_pct - 20),
    },
    {
      title: 'Charge Added',
      unit: 'kWh',
      values: SAMPLE_TELEMETRY_ROWS.map(row => row.charge_energy_added_kwh),
    },
  ],
};

export const DRAFT_EXPECTATION: SandboxExpectation = {
  envelope: COMMUNITY_DRAFT_ENVELOPE,
  rows: SAMPLE_TELEMETRY_ROWS.length,
  // Subtract(field, coefficient) and one field evaluation per row.
  steps: SAMPLE_TELEMETRY_ROWS.length * 4,
  charts: [{
    title: 'Cabin Temp vs Comfort',
    unit: '°C',
    values: SAMPLE_TELEMETRY_ROWS.map(row => row.cabin_temp_c - 21),
  }],
};

export type { SandboxExpectation };

type TrustFaultWindow = Window & {
  __intelligencePackTrustReadFault?: {
    attempts: number;
    originalGet: IDBObjectStore['get'];
  };
};

export async function failLocalTrustReads(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as TrustFaultWindow;
    if (target.__intelligencePackTrustReadFault) throw new Error('Trust-read fault already installed');
    const fault = { attempts: 0, originalGet: IDBObjectStore.prototype.get };
    target.__intelligencePackTrustReadFault = fault;
    IDBObjectStore.prototype.get = function (key: IDBValidKey | IDBKeyRange) {
      if (this.transaction.db.name === 'teslasync-intelligence-packs' && this.name === 'kv' && key === 'trust') {
        fault.attempts += 1;
        throw new DOMException('Synthetic local trust-read failure', 'InvalidStateError');
      }
      return fault.originalGet.call(this, key);
    };
  });
}

export async function localTrustReadAttempts(page: Page): Promise<number> {
  return page.evaluate(() => (window as TrustFaultWindow).__intelligencePackTrustReadFault?.attempts ?? 0);
}

export async function restoreLocalTrustReads(page: Page): Promise<void> {
  await page.evaluate(() => {
    const target = window as TrustFaultWindow;
    const fault = target.__intelligencePackTrustReadFault;
    if (!fault) throw new Error('No trust-read fault to restore');
    IDBObjectStore.prototype.get = fault.originalGet;
    delete target.__intelligencePackTrustReadFault;
  });
}
