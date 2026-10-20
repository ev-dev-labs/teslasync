import { expect, type Page, type Route } from '@playwright/test';
import type { ExportJobSummary } from '../../src/api/hooks/useExports';
import type {
  CommunicationsCatalogStatus,
  ServiceIntelligenceResponse,
} from '../../src/api/hooks/useServiceIntelligence';
import {
  catalogReport,
  claimReport,
  serviceReport,
  warrantyReport,
} from '../../src/features/service-intelligence/pages/ServiceIntelligencePage.closure.fixtures';
import { fulfillApiFixture, type MockApiController } from '../mockApi';

export { catalogReport, claimReport, serviceReport, warrantyReport };

export const operationsNow = '2026-08-05T08:00:00Z';
export const operationsRoutes = {
  exports: '/exports',
  service: '/service-intelligence?vehicle_id=7',
  connect: '/connect',
} as const;

export const exportJobs: ExportJobSummary[] = [
  { id: '00000000-0000-4000-8000-000000000001', type: 'drives', format: 'csv', status: 'ready', file_size: 1024, created_at: '2026-08-05T07:00:00Z' },
  { id: '00000000-0000-4000-8000-000000000002', type: 'charging', format: 'json', status: 'ready', file_size: 2048, created_at: '2026-08-05T06:00:00Z' },
  { id: '00000000-0000-4000-8000-000000000003', type: 'trips', format: 'csv', status: 'queued', file_size: 0, created_at: '2026-08-05T05:00:00Z' },
  { id: '00000000-0000-4000-8000-000000000004', type: 'analytics', format: 'json', status: 'processing', file_size: 512, created_at: '2026-08-05T04:00:00Z' },
  { id: '00000000-0000-4000-8000-000000000005', type: 'backup', format: 'zip', status: 'failed', file_size: 256, created_at: '2026-08-05T03:00:00Z' },
  { id: '00000000-0000-4000-8000-000000000006', type: 'account', format: 'zip', status: 'expired', created_at: '2026-08-05T02:00:00Z' },
];

// Missing wire fields deliberately differ from a successfully measured zero.
export type ServiceWireReport = Omit<ServiceIntelligenceResponse, 'summary' | 'generated_at'> & {
  summary: ServiceIntelligenceResponse['summary'] | null;
  generated_at: string | null;
};
export type CatalogWireReport = Omit<CommunicationsCatalogStatus, 'record_count'> & {
  record_count?: number;
};

export const zeroServiceReport: ServiceIntelligenceResponse = {
  ...serviceReport,
  summary: {
    recall_candidates: 0,
    potentially_applicable_recalls: 0,
    manufacturer_communications: 0,
    symptom_matches: 0,
  },
  recall_findings: [],
  communications: [],
  ranked_symptoms: [],
};
export const unknownServiceReport: ServiceWireReport = {
  ...serviceReport,
  summary: null,
  generated_at: null,
};
export const zeroCatalogReport: CommunicationsCatalogStatus = {
  ...catalogReport,
  record_count: 0,
};
export const unknownCatalogReport: CatalogWireReport = {
  latest_attempt: null,
  latest_successful: null,
};
export const failedLaterCatalog: CommunicationsCatalogStatus = {
  ...catalogReport,
  latest_attempt: {
    ...catalogReport.latest_successful!,
    id: 6,
    status: 'failed',
    imported_rows: 0,
    completed_at: operationsNow,
    error_detail: 'The latest artifact failed; the previous import remains active.',
  },
};

function assertRequest(route: Route, method: 'GET' | 'POST', path: string, query: Record<string, string> = {}) {
  const request = route.request();
  const url = new URL(request.url());
  expect(request.method()).toBe(method);
  expect(url.pathname).toBe(path);
  expect(Object.fromEntries(url.searchParams)).toEqual(query);
}

export async function installExportFixtures(
  page: Page,
  mocks: MockApiController | null,
  initialJobs: readonly ExportJobSummary[] = exportJobs,
) {
  let jobs = [...initialJobs];
  let failed = false;
  let reads = 0;
  const deletions: string[][] = [];
  await page.route('**/api/v1/export/jobs', async route => {
    assertRequest(route, 'GET', '/api/v1/export/jobs');
    reads += 1;
    await fulfillApiFixture(route, mocks, failed
      ? { status: 503, json: { error: 'Export job source temporarily unavailable' } }
      : { json: jobs });
  });
  await page.route('**/api/v1/export/jobs/bulk', async route => {
    assertRequest(route, 'POST', '/api/v1/export/jobs/bulk');
    const payload: unknown = route.request().postDataJSON();
    expect(payload).toEqual({ ids: [exportJobs[0].id], op: 'delete' });
    deletions.push([exportJobs[0].id]);
    jobs = jobs.filter(job => job.id !== exportJobs[0].id);
    await fulfillApiFixture(route, mocks, { json: { deleted: 1, failed: [] } });
  });
  return {
    deletions,
    get reads() { return reads; },
    fail: () => { failed = true; },
    recover: () => { failed = false; },
  };
}

export async function installServiceFixtures(
  page: Page,
  mocks: MockApiController | null,
  report: ServiceIntelligenceResponse | ServiceWireReport = serviceReport,
  catalog: CommunicationsCatalogStatus | CatalogWireReport = catalogReport,
) {
  let failed = false;
  let reportReads = 0;
  let warrantyReads = 0;
  let catalogReads = 0;
  let currentCatalog = catalog;
  const importedArtifacts: string[] = [];
  await page.route('**/api/v1/service-intelligence/vehicles/7?refresh=false', async route => {
    assertRequest(route, 'GET', '/api/v1/service-intelligence/vehicles/7', { refresh: 'false' });
    reportReads += 1;
    await fulfillApiFixture(route, mocks, failed
      ? { status: 503, json: { error: 'Service report temporarily unavailable' } }
      : { json: report });
  });
  await page.route('**/api/v1/service-intelligence/vehicles/7/warranty', async route => {
    assertRequest(route, 'GET', '/api/v1/service-intelligence/vehicles/7/warranty');
    warrantyReads += 1;
    await fulfillApiFixture(route, mocks, { json: warrantyReport });
  });
  await page.route('**/api/v1/admin/service-intelligence/communications/status', async route => {
    assertRequest(route, 'GET', '/api/v1/admin/service-intelligence/communications/status');
    catalogReads += 1;
    await fulfillApiFixture(route, mocks, { json: currentCatalog });
  });
  await page.route('**/api/v1/admin/service-intelligence/communications/import', async route => {
    assertRequest(route, 'POST', '/api/v1/admin/service-intelligence/communications/import');
    const imported = catalogReport.latest_successful;
    if (!imported) throw new Error('The existing catalog fixture must supply its successful import');
    const payload: unknown = route.request().postDataJSON();
    expect(payload).toEqual({ artifact_url: imported.artifact_url });
    importedArtifacts.push(imported.artifact_url);
    currentCatalog = { ...catalogReport, latest_attempt: imported };
    await fulfillApiFixture(route, mocks, { json: imported });
  });
  await page.route('**/api/v1/service-intelligence/vehicles/7/claim-draft?*', async route => {
    assertRequest(route, 'GET', '/api/v1/service-intelligence/vehicles/7/claim-draft', {
      issue: claimReport.issue,
    });
    await fulfillApiFixture(route, mocks, { json: claimReport });
  });
  return {
    get reportReads() { return reportReads; },
    get warrantyReads() { return warrantyReads; },
    get catalogReads() { return catalogReads; },
    importedArtifacts,
    fail: () => { failed = true; },
    recover: () => { failed = false; },
  };
}
