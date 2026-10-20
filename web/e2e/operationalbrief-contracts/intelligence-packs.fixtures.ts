import type { Page } from '@playwright/test';
import {
  COMMUNITY_DRAFT_ENVELOPE,
  EFFICIENCY_INSIGHTS_ENVELOPE,
  TAMPERED_DEMO_ENVELOPE,
} from '../../src/features/intelligence-packs/lib/catalogFixtures';
import {
  PACK_CAPABILITY_CATALOG,
  type PackCapabilityId,
  type SignedPackEnvelope,
} from '../../src/features/intelligence-packs/lib/manifestTypes';
import { createMemoryKvStore } from '../../src/features/intelligence-packs/lib/kvStore';
import { installPack } from '../../src/features/intelligence-packs/lib/packActions';
import { createPackRepository } from '../../src/features/intelligence-packs/lib/packRepository';
import { SAMPLE_TELEMETRY_ROWS } from '../../src/features/intelligence-packs/lib/sampleTelemetry';
import type { TrustDecision } from '../../src/features/intelligence-packs/lib/trust';
import { verifyPackEnvelope } from '../../src/features/intelligence-packs/lib/verifyEnvelope';

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

interface InstalledGrantExpectation {
  id: 'denied' | 'partial';
  approvedCapabilities: readonly PackCapabilityId[];
  sandbox: SandboxExpectation;
  flagAverage: string;
  headroomLatest: string;
  headroomRange: string;
  notices: readonly { title: string; occurrence: number; field: string | null }[];
}

export const INSTALLED_GRANT_EXPECTATIONS: readonly InstalledGrantExpectation[] = [
  {
    id: 'denied',
    approvedCapabilities: [],
    sandbox: {
      ...STARTER_EXPECTATION,
      charts: [
        { title: 'Efficiency Gap vs Target', unit: 'Wh/km', values: SAMPLE_TELEMETRY_ROWS.map(() => -150) },
        { title: 'Battery Headroom', unit: '%', values: SAMPLE_TELEMETRY_ROWS.map(() => -20) },
        { title: 'Charge Added', unit: 'kWh', values: SAMPLE_TELEMETRY_ROWS.map(() => 0) },
      ],
    },
    flagAverage: 'avg 0.00 flag',
    headroomLatest: '-20.0',
    headroomRange: 'sample -20.00–-20.00 %',
    notices: [
      { title: 'Efficiency Gap vs Target', occurrence: 0, field: 'drive_efficiency_wh_per_km' },
      { title: 'Battery Headroom', occurrence: 0, field: 'battery_level_pct' },
      { title: 'Charge Added', occurrence: 0, field: 'charge_energy_added_kwh' },
      { title: 'Currently Below Target', occurrence: 0, field: 'drive_efficiency_wh_per_km' },
      { title: 'Efficiency Gap Trend', occurrence: 0, field: 'drive_efficiency_wh_per_km' },
      { title: 'Battery Headroom', occurrence: 1, field: 'battery_level_pct' },
    ],
  },
  {
    id: 'partial',
    approvedCapabilities: [
      'read:telemetry-sample', 'read:battery-sample', 'read:drive-sample',
      'render:dashboard', 'suggest:automation',
    ],
    sandbox: {
      ...STARTER_EXPECTATION,
      charts: STARTER_EXPECTATION.charts.map(chart => chart.title === 'Charge Added'
        ? { ...chart, values: SAMPLE_TELEMETRY_ROWS.map(() => 0) }
        : chart),
    },
    flagAverage: 'avg 0.64 flag',
    headroomLatest: '63.0',
    headroomRange: 'sample 21.00–69.00 %',
    notices: [
      { title: 'Efficiency Gap vs Target', occurrence: 0, field: null },
      { title: 'Battery Headroom', occurrence: 0, field: null },
      { title: 'Charge Added', occurrence: 0, field: 'charge_energy_added_kwh' },
      { title: 'Currently Below Target', occurrence: 0, field: null },
      { title: 'Efficiency Gap Trend', occurrence: 0, field: null },
      { title: 'Battery Headroom', occurrence: 1, field: null },
    ],
  },
];

export const STARTER_CAPABILITIES = PACK_CAPABILITY_CATALOG.filter(capability =>
  EFFICIENCY_INSIGHTS_ENVELOPE.manifest.capabilities.includes(capability.id));

type LocalPackTable = 'installed' | 'trust' | 'audit';
type LocalPackTables = Record<LocalPackTable, string | null>;

export async function localPackTables(page: Page, seed?: LocalPackTables): Promise<LocalPackTables> {
  return page.evaluate(saved => new Promise<LocalPackTables>((resolve, reject) => {
    const request = indexedDB.open('teslasync-intelligence-packs', 1);
    request.onupgradeneeded = () => {
      if (!saved) {
        request.transaction?.abort();
        return;
      }
      request.result.createObjectStore('kv');
    };
    request.onerror = () => reject(request.error ?? new Error('Local pack database open failed'));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('kv', saved ? 'readwrite' : 'readonly');
      const store = tx.objectStore('kv');
      const tables: LocalPackTables = { installed: null, trust: null, audit: null };
      for (const key of ['installed', 'trust', 'audit'] as const) {
        if (saved) {
          const value = saved[key];
          if (value == null) store.delete(key);
          else store.put(value, key);
        }
        const read = store.get(key);
        read.onsuccess = () => { tables[key] = (read.result as string | undefined) ?? null; };
      }
      tx.oncomplete = () => {
        db.close();
        resolve(tables);
      };
      const fail = () => {
        db.close();
        reject(tx.error ?? new Error('Local pack table transaction failed'));
      };
      tx.onerror = fail;
      tx.onabort = fail;
    };
  }), seed ?? null);
}

export async function seedInstalledCapabilityGrant(
  page: Page,
  fixture: InstalledGrantExpectation,
): Promise<LocalPackTables> {
  const envelope = EFFICIENCY_INSIGHTS_ENVELOPE;
  const verification = await verifyPackEnvelope(envelope);
  if (verification.status !== 'signature-valid' || verification.claimedFingerprintMismatch
    || verification.recomputedDigestSha256Hex !== envelope.contentDigestSha256Hex
    || verification.recomputedPublisherFingerprint !== envelope.manifest.publisher.fingerprint
    || verification.recognizedPublisherName == null) {
    throw new Error('Capability fixtures require the genuine verified, locally recognized signed starter pack');
  }
  const store = createMemoryKvStore();
  const repository = createPackRepository(store);
  const decidedAtIso = '2026-10-01T10:00:00.000Z';
  const decision: TrustDecision = {
    packId: envelope.manifest.id,
    decision: 'trusted-signed-recognized',
    publisherFingerprint: verification.recomputedPublisherFingerprint,
    decidedAtIso,
    approvedCapabilities: [...fixture.approvedCapabilities],
    note: `Browser test fixture: ${fixture.id} capability grant; publisher trust is not a capability grant.`,
  };
  await repository.putTrustDecision(decision);
  await installPack(repository, {
    envelope, verification, enabled: true, now: () => new Date(decidedAtIso),
  });
  const tables: LocalPackTables = {
    installed: await store.getItem('installed'),
    trust: await store.getItem('trust'),
    audit: await store.getItem('audit'),
  };
  if (Object.values(tables).some(value => value == null)) throw new Error('Repository fixture tables are incomplete');

  // Establish the real origin without mounting the SPA. Transfer only the
  // blobs serialized by the typed repository, then remove this document route.
  const seedDocument = (url: URL) => url.pathname === MARKETPLACE_PATH;
  await page.route(seedDocument, route => route.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><html><head></head><body></body></html>',
  }));
  try {
    await page.goto(MARKETPLACE_PATH, { waitUntil: 'domcontentloaded' });
    const persisted = await localPackTables(page, tables);
    if (JSON.stringify(persisted) !== JSON.stringify(tables)) throw new Error('Local repository seed did not persist exactly');
  } finally {
    await page.unroute(seedDocument);
  }
  return tables;
}

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
