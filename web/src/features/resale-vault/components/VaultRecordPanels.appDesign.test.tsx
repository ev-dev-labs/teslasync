import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  expectAppDesignDataMode, setAppDesignTestProfile,
} from '@/components/feedback/appDesignCss.test-utils';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { BatteryCertificatePanel } from './BatteryCertificatePanel';
import { ExportReportPanel } from './ExportReportPanel';
import { ImportVerifyPanel } from './ImportVerifyPanel';
import { MaintenanceSummaryPanel } from './MaintenanceSummaryPanel';
import { SignatureKeyPanel } from './SignatureKeyPanel';
import { SoftwareUpdateSummaryPanel } from './SoftwareUpdateSummaryPanel';
import { makeMinimalReport } from '../lib/testFixtures';
import { signReport } from '../lib/reportSigner';
import { __resetAuditTrailForTests } from '../lib/auditTrail';
import { __resetKeyRepositoryForTests, revokeSigningKey } from '../lib/signingKeyRepository';
import type { UseSigningVaultResult } from '../hooks/useSigningVault';
import type { SigningKeyRecord } from '../lib/types';
import type { BatteryCertificate } from '@/api/hooks/useBatteryCertificate';

const certificate: BatteryCertificate = {
  issuer: 'teslasync', version: 1, vehicle_id: 7,
  issued_at: '2026-03-01T12:00:00Z', expires_at: '2026-03-31T12:00:00Z',
  current_soh: 0, estimated_capacity_kwh: 0, original_capacity_kwh: 75,
  degradation_rate_pct_per_year: 0, battery_age_months: 36, total_cycles: 0,
  charge_habits_score: 0, stress_level: 'low', fast_charge_pct: 0,
  temp_exposure_score: 0, temp_exposure_reason: '',
};
const queryMocks = vi.hoisted(() => ({ certificate: vi.fn(), verification: vi.fn() }));
vi.mock('@/api/hooks/useBatteryCertificate', () => ({
  useBatteryCertificate: queryMocks.certificate,
  useVerifyBatteryCertificate: queryMocks.verification,
}));
const profiles = ['classic', 'blueprint', 'v2', 'v1'] as const;
let release = () => {};
let savedProfile: Array<readonly [string, string | null]>;

beforeEach(() => {
  __resetAuditTrailForTests();
  __resetKeyRepositoryForTests();
  savedProfile = Object.keys(getAppDesignAttributes('classic')).map(name => [name, document.documentElement.getAttribute(name)] as const);
  for (const [name] of savedProfile) document.documentElement.removeAttribute(name);
  queryMocks.certificate.mockReturnValue({
    data: { certificate, signature: 'complete-server-signature' }, isLoading: false, isError: false,
  });
  queryMocks.verification.mockReturnValue({
    mutate: vi.fn(), isPending: false, isError: false, data: { valid: false },
    variables: { certificate, signature: 'complete-server-signature' },
  });
});
afterEach(() => {
  release();
  for (const [name, value] of savedProfile) {
    if (value === null) document.documentElement.removeAttribute(name);
    else document.documentElement.setAttribute(name, value);
  }
});

describe('vault native records retain their real payload and lifecycle', () => {
  it.each(profiles)('%s binds service, firmware, key and certificate records without inventing evidence', pack => {
    setAppDesignTestProfile(document.documentElement, pack);
    const key: SigningKeyRecord = {
      key_id: 'key_complete_identifier', public_jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
      created_at: '2026-01-01', revoked_at: null, revoked_reason: null, rotated_from: 'key_previous', persisted: false,
    };
    const vault: UseSigningVaultResult = {
      capability: { supported: true, reason: null }, keys: [key], activeKey: key, auditLog: [],
      isLoading: false, isMutating: false, error: null,
      generateKey: vi.fn(), rotateKey: vi.fn(), revokeKey: vi.fn(), refresh: vi.fn(),
    };
    const view = render(<>
      <MaintenanceSummaryPanel maintenance={{
        scheduled_item_count: 0, service_record_count: 2, categories: [],
        service_records: [
          { item_id: 'later', date: '2026-08-03', odometer_m: 0, notes: 'Complete service note' },
          { item_id: 'earlier', date: '2026-01-01', odometer_m: null, notes: '' },
        ],
      }} />
      <SoftwareUpdateSummaryPanel softwareUpdates={{
        update_count: 2, latest_version: null,
        installed_versions: [
          { version: '2026.40-long-complete-version', installed_at: null },
          { version: '2026.2', installed_at: '2026-01-01' },
        ],
      }} />
      <SignatureKeyPanel vault={vault} />
      <BatteryCertificatePanel vehicleId="7" />
    </>);
    release = observeAppDesignScopes(document.documentElement);
    const mode = APPLICATION_DESIGNS[pack].data;
    const records = view.container.querySelectorAll('[data-app-card-kind="record"]');
    expect(records).toHaveLength(4);
    for (const record of records) {
      expectAppDesignDataMode(record, mode, '[data-app-card-kind="record"]');
      expectAppDesignDataMode(record.querySelector('[data-app-part~="record-header"]')!, mode, '[data-app-part~="record-header"]');
    }
    const serviceRows = screen.getByText('2026-08-03').closest('ul')!.children;
    expect([...serviceRows].map(row => row.querySelector('[data-app-part="record-title"]')?.textContent)).toEqual(['2026-08-03', '2026-01-01']);
    expect(serviceRows[0]).toHaveTextContent('0 km');
    expect(serviceRows[0]).toHaveTextContent('Complete service note');
    expect(serviceRows[1]).toHaveTextContent('—');
    expect(serviceRows[1].querySelector('[data-app-part~="record-body"]')).toBeNull();
    const firmware = screen.getByText('2026.40-long-complete-version').closest('li')!;
    expectAppDesignDataMode(firmware, mode, '[data-app-list="definitions"]');
    expectAppDesignDataMode(firmware.querySelector('[data-app-part~="metric-reading"]')!, mode, '[data-app-part~="metric-reading"]');
    expect(firmware).toHaveTextContent('—');
    expect(firmware.nextElementSibling).toHaveTextContent('2026.2');
    expect(screen.queryByText('Signature verified')).not.toBeInTheDocument();
    expect(screen.getByText(/Self-verification failed/)).toBeInTheDocument();
    const signature = screen.getByText(/Signature: complete-server-signature/).closest('[data-app-card-kind="record"]')!;
    expectAppDesignDataMode(signature.querySelector('[data-app-part="record-body"]')!, mode, '[data-app-part~="record-body"]');
    expect(within(signature).getByRole('button', { name: 'Copy certificate' })).toBeEnabled();
    expect(within(signature).getByRole('button', { name: 'Copy signature' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(vault.revokeKey).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    expect(vault.revokeKey).toHaveBeenCalledExactlyOnceWith(key.key_id, 'manual_revocation');
    expect(screen.getByText(/Rotated from key_previous/)).toBeInTheDocument();
    expect(screen.getAllByText('Session-only (lost on reload)')).toHaveLength(2);
    expect(screen.getByText(/does NOT verify the identity/)).toBeInTheDocument();
  });

  it.each(profiles)('%s composes retained signed snapshots and a real locally verified revoked-key report', async pack => {
    setAppDesignTestProfile(document.documentElement, pack);
    const report = makeMinimalReport();
    const signed = await signReport(report);
    await revokeSigningKey(signed.signature.key_id, 'test-local-revocation');
    const retained = structuredClone(signed);
    const retainedBytes = JSON.stringify(retained);
    const view = render(<>
      <ExportReportPanel report={{ ...report, report_id: 'changed-preview' }}
        retainedExport={{ signed: retained, readinessKey: 'earlier-preview' }} />
      <ImportVerifyPanel />
    </>);
    release = observeAppDesignScopes(document.documentElement);
    const file = new File([JSON.stringify(signed)], 'signed-report.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText('Choose report file'), { target: { files: [file] } });
    expect(await screen.findByText('All checks passed')).toBeInTheDocument();
    expect(screen.getByText('Signed with a locally-known, revoked key')).toHaveAttribute('data-app-variant', 'danger');
    expect(screen.getByText('Digest matches')).toBeInTheDocument();
    expect(screen.getByText('Signature valid')).toBeInTheDocument();
    const records = view.container.querySelectorAll('[data-app-card-kind="record"]');
    expect(records).toHaveLength(2);
    await waitFor(() => expect(records[1]).toHaveAttribute('data-app-design-owner'));
    for (const record of records) {
      expectAppDesignDataMode(record, APPLICATION_DESIGNS[pack].data, '[data-app-card-kind="record"]');
      expectAppDesignDataMode(record.querySelector('[data-app-part="record-body"]')!, APPLICATION_DESIGNS[pack].data, '[data-app-part~="record-body"]');
      expect(record).toHaveTextContent(signed.signature.key_id);
      expect(record).toHaveTextContent(report.report_id);
    }
    expect(records[0]).toHaveTextContent(signed.digest_sha256_hex);
    expect(records[0]).toHaveTextContent('This signed snapshot belongs to an older preview.');
    expect(screen.getByRole('button', { name: 'Download JSON' })).toBeEnabled();
    expect(JSON.stringify(retained)).toBe(retainedBytes);
    expect(screen.getByLabelText('Choose report file')).toHaveValue('');
  });
});
