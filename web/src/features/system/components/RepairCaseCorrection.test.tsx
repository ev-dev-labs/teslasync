import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepairCase, RepairCaseCorrectionPreview } from '@/api/hooks/useDataRepair';
import { ToastProvider } from '@/components/feedback';
import { RepairCaseBoundaryCorrection } from './RepairCaseBoundaryCorrection';
import { RepairCaseCorrection } from './RepairCaseCorrection';
import { RepairCaseEvidencePanel } from './RepairCaseEvidencePanel';

const transport = vi.hoisted(() => vi.fn());
vi.mock('@/api/client', () => ({ request: transport }));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { distance: 'mi', energy: 'kWh' },
    formatDistance: (value: number) => `${value} m`,
    formatEnergy: (value: number) => `${value} Wh`,
    formatDuration: (value: number) => `${value} s`,
  }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    tz: 'America/Los_Angeles',
    formatDateTime: (value: string | null) => value ?? '—',
  }),
}));
vi.mock('react-i18next', async (importActual) => ({
  ...await importActual<typeof import('react-i18next')>(),
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, values?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : String(fallback?.defaultValue ?? key);
      const args = typeof fallback === 'object' ? fallback : values;
      return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(args?.[name] ?? ''));
    },
    i18n: { language: 'en' },
  }),
}));

const repairCase: RepairCase = {
  id: 7, fingerprint: 'drive:42:duration_mismatch', kind: 'drive', session_id: 42, vehicle_id: 3,
  rule: 'duration_mismatch', confidence: 'high', status: 'open', applicable: false,
  blocked_reason: 'structural_anomaly_requires_manual_correction',
  evidence_started_at: '2026-08-25T09:00:00Z', evidence_stored_ended_at: '2026-08-25T10:00:00Z',
  evidence_contradiction_ts: '2026-08-25T10:00:00Z', evidence_contradiction_src: 'drives',
  evidence_contradiction_field: 'duration_s', evidence_contradiction_value: '900',
  evidence_gap_s: 0, first_seen_at: '2026-08-25T10:01:00Z', last_seen_at: '2026-08-25T10:02:00Z',
  created_at: '2026-08-25T10:01:00Z', updated_at: '2026-08-25T10:02:00Z',
};

const preview: RepairCaseCorrectionPreview = {
  case_id: 7, case_updated_at: repairCase.updated_at, kind: 'drive', session_id: 42,
  started_at: '2026-08-25T09:00:00Z', ended_at: '2026-08-25T10:00:00Z',
  source_hash: 'reviewed-source-hash',
  changes: [{ field: 'duration_s', before: 900, after: 3600 }],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup(element: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrap = (child: ReactNode) => (
    <QueryClientProvider client={client}><ToastProvider>{child}</ToastProvider></QueryClientProvider>
  );
  const view = render(wrap(element));
  return { ...view, client, wrap };
}

function callsFor(suffix: string) {
  return transport.mock.calls.filter(([path]) => String(path).endsWith(suffix));
}

beforeEach(() => {
  transport.mockReset();
  transport.mockImplementation((path: string) => {
    if (path.endsWith('/correction-preview') || path.endsWith('/correction')) return Promise.resolve(preview);
    throw new Error(`Unexpected request: ${path}`);
  });
});

describe('reviewed case corrections', () => {
  it('presents the scanned duration facts in readable units and keeps the raw evidence available', () => {
    setup(<RepairCaseEvidencePanel repairCase={{
      ...repairCase, evidence_contradiction_value: 'stored=900 computed=3600 tolerance_s=90',
    }} />);
    expect(screen.getByText('Stored duration')).toBeVisible();
    expect(screen.getByText('900 s')).toBeVisible();
    expect(screen.getByText('Duration from start and end')).toBeVisible();
    expect(screen.getByText('3600 s')).toBeVisible();
    const raw = screen.getByText(/stored=900 computed=3600/);
    expect(raw).not.toBeVisible();
    fireEvent.click(screen.getByText('Technical details'));
    expect(raw).toBeVisible();
  });

  it('previews duration, cancels without writing, and applies the exact reviewed choice once', async () => {
    const pending = deferred<RepairCaseCorrectionPreview>();
    transport.mockImplementation((path: string) =>
      path.endsWith('/correction-preview') ? Promise.resolve(preview) : pending.promise);
    setup(<RepairCaseCorrection repairCase={repairCase} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'Review correction' }));
    let dialog = await screen.findByRole('dialog', { name: 'Apply this correction?' });
    expect(within(dialog).getByText(/900 s.*3600 s/)).toBeVisible();
    expect(within(dialog).getByText(/start and end are correct/)).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(callsFor('/correction')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Review correction' }));
    dialog = await screen.findByRole('dialog', { name: 'Apply this correction?' });
    const confirm = within(dialog).getByRole('button', { name: 'Apply correction' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(callsFor('/correction')).toHaveLength(1));
    const [, options] = callsFor('/correction')[0];
    expect(options).toMatchObject({ method: 'POST', requiresLiveMode: true, skipAuthRefresh: true });
    expect(JSON.parse(options.body)).toEqual({
      expected_updated_at: repairCase.updated_at, field: 'duration_s', mode: 'derive',
      value: null, expected_source_hash: preview.source_hash,
    });
    expect(confirm).toBeDisabled();
    await act(async () => { pending.resolve(preview); });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Apply this correction?' })).toBeNull());
  });

  it('converts distance to SI and requires a real value rather than displaying unknown as zero', async () => {
    const negativeCase = { ...repairCase, rule: 'negative_aggregate_distance_m' };
    transport.mockImplementation((path: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      if (path.endsWith('/correction-preview')) {
        return Promise.resolve({
          ...preview, changes: [{ field: 'distance_m', before: -100, after: body.value }],
        });
      }
      return Promise.resolve(preview);
    });
    setup(<RepairCaseCorrection repairCase={negativeCase} canWrite />);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Corrected Distance (mi)' }), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review correction' }));
    const dialog = await screen.findByRole('dialog', { name: 'Apply this correction?' });
    const firstBody = JSON.parse(callsFor('/correction-preview')[0][1].body);
    expect(firstBody.value).toBeCloseTo(3218.688);
    expect(within(dialog).getByText(/exact: 3218.688 m/)).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('option', { name: 'Mark measurement unknown' })).toBeNull();
    expect(screen.getByText(/existing views.*unknown reading/i)).toBeVisible();
  });

  it.each([
    ['drive energy', 'drive', 'negative_aggregate_energy_used_wh', null],
    ['charging energy', 'charging', 'negative_aggregate_total_energy_added_wh', null],
    ['drive starting battery', 'drive', 'soc_inconsistent', 'start_soc_pct'],
    ['drive ending battery', 'drive', 'soc_inconsistent', 'end_soc_pct'],
    ['charging starting battery', 'charging', 'soc_inconsistent', 'start_soc_pct'],
    ['charging ending battery', 'charging', 'soc_inconsistent', 'end_soc_pct'],
  ] as const)('does not allow unknown %s when existing views invent a value', (_, kind, rule, field) => {
    setup(<RepairCaseCorrection repairCase={{ ...repairCase, kind, rule }} canWrite />);
    if (field) {
      fireEvent.change(screen.getByRole('combobox', { name: 'Which reading is incorrect?' }), {
        target: { value: field },
      });
    }
    expect(screen.queryByRole('option', { name: 'Mark measurement unknown' })).toBeNull();
    expect(screen.getByText(/existing views.*unknown reading/i)).toBeVisible();
  });

  it('can mark a nullable regenerated energy measurement unknown without substituting zero', async () => {
    const energyCase = { ...repairCase, rule: 'negative_aggregate_regen_energy_wh' };
    transport.mockResolvedValue({
      ...preview, changes: [{ field: 'regen_energy_wh', before: -100, after: null }],
    });
    setup(<RepairCaseCorrection repairCase={energyCase} canWrite />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Correction' }), { target: { value: 'clear' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review correction' }));
    const dialog = await screen.findByRole('dialog', { name: 'Apply this correction?' });
    expect(JSON.parse(callsFor('/correction-preview')[0][1].body)).toMatchObject({
      field: 'regen_energy_wh', mode: 'clear', value: null,
    });
    expect(within(dialog).getByText(/Unknown/)).toBeVisible();
    expect(within(dialog).getByText(/does not recover the measurement/)).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply correction' }));
    await waitFor(() => expect(callsFor('/correction')).toHaveLength(1));
  });

  it('does not request a preview or apply when write access is unavailable', () => {
    setup(<RepairCaseCorrection repairCase={repairCase} canWrite={false} writeBlockReason="Read-only mode" />);
    const review = screen.getByRole('button', { name: 'Review correction' });
    expect(review).toBeDisabled();
    expect(review).toHaveAttribute('title', 'Read-only mode');
    fireEvent.click(review);
    expect(transport).not.toHaveBeenCalled();
  });

  it('displays the exact estimated cost impact without implying the corrected energy is cleared', async () => {
    transport.mockResolvedValue({
      ...preview,
      kind: 'charging',
      changes: [
        { field: 'total_energy_added_wh', before: -100, after: 1200 },
        { field: 'cost_decimal', before: null, after: null, before_text: '4.1250', unit: 'USD' },
        { field: 'cost_source', before: null, after: null, before_text: 'default_estimate', after_text: 'unknown' },
      ],
    });
    const { client } = setup(<RepairCaseCorrection repairCase={{ ...repairCase, kind: 'charging', rule: 'negative_aggregate_total_energy_added_wh' }} canWrite />);
    const derivedKeys = [
      ['charging-sessions'], ['geofences', 7, 'charging-summary'],
      ['cost-forecast', '7'], ['bill-variance', '7'], ['dashboard', 'stats'], ['analytics', 'cost', '7'],
    ];
    for (const key of derivedKeys) client.setQueryData(key, { value: 'old' });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Corrected Energy added (kWh)' }), { target: { value: '1.2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review correction' }));
    const dialog = await screen.findByRole('dialog', { name: 'Apply this correction?' });
    expect(within(dialog).getByText(/4\.1250 USD.*Unknown/)).toBeVisible();
    expect(within(dialog).getByText(/previous estimate depended on the incorrect energy value/)).toBeVisible();
    expect(within(dialog).queryByText(/does not recover the measurement/)).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply correction' }));
    await waitFor(() => expect(callsFor('/correction')).toHaveLength(1));
    for (const key of derivedKeys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });

  it('rejects conversions that would become infinity rather than sending JSON null', () => {
    setup(<RepairCaseCorrection repairCase={{ ...repairCase, rule: 'negative_aggregate_distance_m' }} canWrite />);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Corrected Distance (mi)' }), { target: { value: '1e308' } });
    expect(screen.getByRole('alert')).toHaveTextContent('too large to convert safely');
    expect(screen.getByRole('button', { name: 'Review correction' })).toBeDisabled();
    expect(callsFor('/correction-preview')).toHaveLength(0);
  });

  it('disables a reviewed correction after case or write access changes', async () => {
    const { rerender, wrap } = setup(<RepairCaseCorrection repairCase={repairCase} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'Review correction' }));
    const dialog = await screen.findByRole('dialog', { name: 'Apply this correction?' });
    rerender(wrap(<RepairCaseCorrection repairCase={{ ...repairCase, updated_at: '2026-08-25T10:04:00Z' }} canWrite={false} />));
    expect(within(dialog).getByRole('button', { name: 'Apply correction' })).toBeDisabled();
    expect(within(dialog).getByRole('status')).toHaveTextContent('case or write access changed');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply correction' }));
    expect(callsFor('/correction')).toHaveLength(0);
  });

  it('ignores a preview that arrives after the case changes', async () => {
    const pending = deferred<RepairCaseCorrectionPreview>();
    transport.mockReturnValue(pending.promise);
    const { rerender, wrap } = setup(<RepairCaseCorrection repairCase={repairCase} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'Review correction' }));
    rerender(wrap(<RepairCaseCorrection repairCase={{ ...repairCase, updated_at: '2026-08-25T10:04:00Z' }} canWrite />));
    await act(async () => { pending.resolve(preview); });
    expect(screen.queryByRole('dialog', { name: 'Apply this correction?' })).toBeNull();
    expect(callsFor('/correction')).toHaveLength(0);
  });

  it('surfaces preview and apply failures without closing the reviewed impact', async () => {
    let failPreview = true;
    transport.mockImplementation((path: string) => {
      if (path.endsWith('/correction-preview')) {
        return failPreview ? Promise.reject(new Error('Preview unavailable')) : Promise.resolve(preview);
      }
      return Promise.reject(new Error('Session changed; review again'));
    });
    setup(<RepairCaseCorrection repairCase={repairCase} canWrite />);
    fireEvent.click(screen.getByRole('button', { name: 'Review correction' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Preview unavailable');
    failPreview = false;
    fireEvent.click(screen.getByRole('button', { name: 'Review correction' }));
    const dialog = await screen.findByRole('dialog', { name: 'Apply this correction?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply correction' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Session changed; review again');
    expect(within(dialog).getByRole('button', { name: 'Apply correction' })).toBeEnabled();
  });

  it('reviews a time-zone-aware overlap correction with both sessions and an exact UTC boundary', async () => {
    const overlap = {
      ...repairCase, rule: 'cross_kind_overlap_drive_charging', related_session_id: 51,
    };
    const boundaryPreview: RepairCaseCorrectionPreview = {
      ...preview,
      changes: [
        { field: 'ended_at', before: null, after: null, before_text: '2026-03-08T11:00:00Z', after_text: '2026-03-08T10:30:00Z' },
        { field: 'duration_s', before: 3600, after: 1800 },
      ],
      other: { kind: 'charging', id: 51, started_at: '2026-03-08T10:30:00Z', ended_at: '2026-03-08T11:30:00Z' },
    };
    transport.mockResolvedValue(boundaryPreview);
    setup(<RepairCaseBoundaryCorrection repairCase={overlap} canWrite />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Which session has the incorrect end?' }), { target: { value: 'primary' } });
    const input = screen.getByLabelText('Correct end time (America/Los_Angeles)');
    fireEvent.change(input, { target: { value: '2026-03-08T02:30' } });
    expect(screen.getByRole('alert')).toHaveTextContent('valid time that exists');
    expect(screen.getByRole('button', { name: 'Review correction' })).toBeDisabled();
    fireEvent.change(input, { target: { value: '2026-03-08T03:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review correction' }));
    const dialog = await screen.findByRole('dialog', { name: 'Apply this correction?' });
    expect(JSON.parse(callsFor('/correction-preview')[0][1].body)).toMatchObject({
      field: 'ended_at', mode: 'boundary', target: 'primary', ended_at: '2026-03-08T10:30:00.000Z',
    });
    expect(within(dialog).getByText('Charging session #51')).toBeVisible();
    expect(within(dialog).getByText(/2026-03-08T11:00:00Z.*2026-03-08T10:30:00Z/)).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply correction' }));
    await waitFor(() => expect(callsFor('/correction')).toHaveLength(1));
  });

  it('preserves verified seconds when reviewing a corrected end time', async () => {
    setup(<RepairCaseBoundaryCorrection repairCase={{ ...repairCase, rule: 'ended_before_started' }} canWrite />);
    fireEvent.change(screen.getByLabelText('Correct end time (America/Los_Angeles)'), {
      target: { value: '2026-03-08T03:30:45' },
    });
    const review = screen.getByRole('button', { name: 'Review correction' });
    expect(review).toBeEnabled();
    fireEvent.click(review);
    await waitFor(() => expect(callsFor('/correction-preview')).toHaveLength(1));
    expect(JSON.parse(callsFor('/correction-preview')[0][1].body)).toMatchObject({
      field: 'ended_at', mode: 'boundary', ended_at: '2026-03-08T10:30:45.000Z',
    });
  });
});
