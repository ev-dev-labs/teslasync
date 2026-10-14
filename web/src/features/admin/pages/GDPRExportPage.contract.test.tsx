import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import type { ComponentProps, ReactNode } from 'react';
import type { DataStateSource } from '@/api/dataState';
import type { GDPRExportArtifact } from '@/types/admin-operator-confidence';
import type { StatMetric } from '@/components/data-display';
import { PageLayout } from '@/components/layout';
import { Button, Input } from '@/components/ui';
import { DataSourceNotice } from '@/components/feedback';
import { ApiError } from '@/api/client';

const mocks = vi.hoisted(() => ({
  hook: vi.fn(),
  refetch: vi.fn(),
  summary: vi.fn(),
  details: vi.fn(),
  lifecycle: vi.fn(),
  download: vi.fn(),
  bytes: vi.fn((value: number) => `formatted ${value}`),
  relative: vi.fn((value: string) => `preferred ${value}`),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ formatBytes: mocks.bytes }),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatRelative: mocks.relative }),
}));
vi.mock('@/api/hooks/useOperatorConfidence', () => ({
  useGDPRExport: (id: string) => mocks.hook(id),
}));
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/layout', () => ({
  PageLayout: ({ children, secondaryActions, dataSources, subtitle }: ComponentProps<typeof PageLayout>) => (
    <main>
      <p>{subtitle}</p>
      {secondaryActions}
      {dataSources && <DataSourceNotice sources={dataSources} />}
      {children}
    </main>
  ),
}));
vi.mock('../components/operationalbrief-a-g/AdminSummary', () => ({
  AdminSummary: (props: {
    metrics: readonly StatMetric[];
    loading: boolean;
    sourceStatus: string;
    description: string;
    scope: string;
  }) => {
    mocks.summary(props);
    return (
      <section aria-label="Artifact summary" data-loading={props.loading} data-source-status={props.sourceStatus}>
        <p>{props.description}</p>
        <p>{props.scope}</p>
        {props.metrics.map(metric => (
          <div key={metric.occurrenceId} data-occurrence={metric.occurrenceId}>
            {metric.label}: {metric.rawValue == null ? '—' : String(metric.rawValue)}
          </div>
        ))}
      </section>
    );
  },
}));
vi.mock('../components/gdpr-export', () => ({
  GDPRLookupPanel: ({ idInput, onIdChange, onLookup }: {
    idInput: string; onIdChange: (id: string) => void; onLookup: () => void;
  }) => (
    <section aria-label="Lookup artifact">
      <Input label="Artifact ID" value={idInput} onChange={event => onIdChange(event.target.value)} />
      <Button onClick={onLookup} disabled={!idInput.trim()}>Look up</Button>
    </section>
  ),
  GDPRArtifactDetails: (props: { artifact?: GDPRExportArtifact; loading?: boolean }) => {
    mocks.details(props);
    return <section aria-label="Artifact details" data-loading={props.loading}>{props.artifact?.id}</section>;
  },
  GDPRDownloadPanel: (props: { artifact?: GDPRExportArtifact; loading?: boolean; downloadUrl: string | null }) => {
    mocks.download(props);
    return <section aria-label="Download" data-loading={props.loading}>
      {props.downloadUrl && <a href={props.downloadUrl} download>Download bundle</a>}
    </section>;
  },
  GDPRLifecyclePanel: (props: { artifact?: GDPRExportArtifact; loading?: boolean; now?: number }) => {
    mocks.lifecycle(props);
    return <section aria-label="Lifecycle" data-loading={props.loading} data-clock={props.now} />;
  },
}));

import GDPRExportPage from './GDPRExportPage';

const ID = 'artifact/% ?#é';
const NOW = Date.parse('2026-10-14T01:00:00.000Z');
const manifest: GDPRExportArtifact = {
  id: ID,
  export_job_id: ' job/% ?#é ',
  vehicle_id: 17,
  storage_kind: 'local_fs',
  storage_path: 'synthetic-only',
  sha256: 'f'.repeat(64),
  byte_count: 0,
  created_at: '2026-10-14T00:00:00.000Z',
  expires_at: '2026-10-14T02:00:00.000Z',
  downloaded_at: null,
  download_count: 0,
};
let query: DataStateSource<GDPRExportArtifact>;

function mount(id: string | null = ID, extra?: ReactNode) {
  return render(<MemoryRouter initialEntries={[
    `/admin/gdpr-exports${id == null ? '' : `?id=${encodeURIComponent(id)}`}`,
  ]}>{extra}<GDPRExportPage /></MemoryRouter>);
}

function Navigate() {
  const [, setParams] = useSearchParams();
  return <Button onClick={() => setParams({ id: 'other/raw?#' })}>Change selection</Button>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  query = { data: manifest, isSuccess: true, isFetching: false, isLoading: false,
    fetchStatus: 'idle', dataUpdatedAt: NOW - 60_000, refetch: mocks.refetch };
  mocks.hook.mockImplementation(() => query);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('GDPRExportPage manifest trust and expiry contract (isolated sibling interfaces)', () => {
  it('forwards canonical raw metadata, zero bytes, opaque identities and all five section interfaces', () => {
    mount();
    expect(mocks.hook).toHaveBeenCalledWith(ID);
    const props = mocks.summary.mock.lastCall?.[0] as { metrics: StatMetric[] };
    expect(props.metrics).toHaveLength(6);
    expect(props.metrics.find(metric => metric.occurrenceId === 'bytes')?.rawValue).toBe(0);
    expect(props.metrics.find(metric => metric.occurrenceId === 'export-job')?.rawValue).toBe(manifest.export_job_id);
    expect(props.metrics.find(metric => metric.occurrenceId === 'storage')?.rawValue).toBe('local_fs');
    for (const name of ['Lookup artifact', 'Artifact summary', 'Artifact details', 'Download', 'Lifecycle']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
    expect(mocks.details.mock.lastCall?.[0].artifact).toBe(manifest);
    expect(mocks.lifecycle.mock.lastCall?.[0].artifact).toBe(manifest);
    expect(mocks.download.mock.lastCall?.[0].artifact).toBe(manifest);
    expect(mocks.relative).toHaveBeenCalledWith(manifest.created_at);
    expect(mocks.relative).toHaveBeenCalledWith(manifest.expires_at);
    expect(screen.getByRole('link', { name: 'Download bundle' })).toHaveAttribute(
      'href', expect.stringContaining(`/api/v1/admin/gdpr/exports/${encodeURIComponent(ID)}/download`),
    );
    expect(screen.queryByText(/Export failed|queued|running|when it completes/i)).not.toBeInTheDocument();
  });

  it('keeps a cold paused lookup unknown with skeletons and explicit retry rather than failure or empty', () => {
    query = { data: undefined, isPending: true, isLoading: false, fetchStatus: 'paused', refetch: mocks.refetch };
    mount();
    expect(screen.getByText('Artifact lookup paused')).toBeInTheDocument();
    expect(screen.getByText(/not an export failure or an empty result/)).toBeInTheDocument();
    for (const name of ['Artifact summary', 'Artifact details', 'Download', 'Lifecycle']) {
      expect(screen.getByRole('region', { name })).toHaveAttribute('data-loading', 'true');
    }
    expect(screen.queryByText(/Artifact not found|No artifact selected|No bundle available|Service unavailable/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Download bundle' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps ordinary cold fetching initial without fabricating values or eligibility', () => {
    query = { data: undefined, isLoading: true, isPending: true, fetchStatus: 'fetching', refetch: mocks.refetch };
    mount();
    expect(screen.getByRole('region', { name: 'Artifact summary' })).toHaveAttribute('data-source-status', 'initial');
    expect(screen.queryByText('Artifact lookup paused')).not.toBeInTheDocument();
    expect(screen.queryByText('Eligible to request download')).not.toBeInTheDocument();
  });

  it('keeps retained 503 refresh failure distinct from a fatal unsupported deployment and permits retry', () => {
    query = { ...query, error: new ApiError('refresh failed', 503), isError: true, isSuccess: false };
    mount();
    expect(screen.getByText('Data may be stale')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Artifact summary' })).toHaveAttribute('data-source-status', 'stale');
    expect(screen.getByRole('link', { name: 'Download bundle' })).toBeInTheDocument();
    expect(screen.queryByText('Feature not supported')).not.toBeInTheDocument();
    expect(mocks.details.mock.lastCall?.[0].artifact).toBe(manifest);
    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources' }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps retained paused metadata without inventing a fatal error', () => {
    query = { ...query, fetchStatus: 'paused' };
    mount();
    expect(screen.getByText('Data may be stale')).toBeInTheDocument();
    expect(screen.queryByText('Artifact lookup paused')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Artifact details' })).toHaveTextContent(ID);
  });

  it.each([404, 503, 500])('uses fatalError for cold HTTP %s and retains lookup plus explicit refresh', status => {
    query = { data: undefined, error: new ApiError('synthetic fatal', status),
      isError: true, fetchStatus: 'idle', refetch: mocks.refetch };
    mount();
    expect(screen.getByRole('region', { name: 'Lookup artifact' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Download bundle' })).not.toBeInTheDocument();
    const label = status === 404 ? 'Artifact not found' : status === 503 ? 'Feature not supported' : 'Server error';
    expect(screen.getByText(label)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh artifact manifest' }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['before', NOW + 1, true],
    ['at', NOW, false],
    ['after', NOW - 1, false],
  ] as const)('gates download %s the validated expiry instant', (_name, expiryMs, eligible) => {
    query = { ...query, data: { ...manifest, expires_at: new Date(expiryMs).toISOString() } };
    mount();
    expect(Boolean(screen.queryByRole('link', { name: 'Download bundle' }))).toBe(eligible);
    const summary = screen.getByRole('region', { name: 'Artifact summary' });
    expect(summary).toHaveTextContent(eligible ? 'Eligible to request download' : 'Expired');
  });

  it.each(['', 'not-a-date', '2026-10-14', '2026-10-14T02:00:00', '2026-02-30T02:00:00Z', '2026-13-01T02:00:00Z'])(
    'keeps invalid or unzoned expiry %j unknown and blocks download', expiry => {
      query = { ...query, data: { ...manifest, expires_at: expiry } };
      mount();
      expect(screen.getByRole('region', { name: 'Artifact summary' })).toHaveTextContent('Download eligibility unknown');
      expect(screen.queryByRole('link', { name: 'Download bundle' })).not.toBeInTheDocument();
    },
  );

  it('accepts a valid offset expiry as an instant without rewriting the source string', () => {
    query = { ...query, data: { ...manifest, expires_at: '2026-10-13T20:00:00-07:00' } };
    mount();
    expect(screen.getByRole('link', { name: 'Download bundle' })).toBeInTheDocument();
    expect(mocks.relative).toHaveBeenCalledWith('2026-10-13T20:00:00-07:00');
  });

  it.each([undefined, null])('keeps missing expiry %s unknown rather than assuming unlimited retention', expiry => {
    const missingExpiry = { ...manifest };
    Object.defineProperty(missingExpiry, 'expires_at', { value: expiry });
    query = { ...query, data: missingExpiry };
    mount();
    expect(screen.getByRole('region', { name: 'Artifact summary' })).toHaveTextContent('Download eligibility unknown');
    expect(screen.queryByRole('link', { name: 'Download bundle' })).not.toBeInTheDocument();
  });

  it('keeps missing storage unknown rather than inferring local filesystem support', () => {
    query = { ...query, data: { ...manifest, storage_kind: '' } };
    mount();
    expect(screen.getByRole('region', { name: 'Artifact summary' })).toHaveTextContent('Download eligibility unknown');
    expect(screen.queryByRole('link', { name: 'Download bundle' })).not.toBeInTheDocument();
  });

  it.each(['s3', 'new_vendor', 'LOCAL_FS', ' local_fs '])('does not infer download support for raw storage %j', storage => {
    query = { ...query, data: { ...manifest, storage_kind: storage } };
    mount();
    expect(screen.getByRole('region', { name: 'Artifact summary' })).toHaveTextContent('Storage download not supported');
    expect(screen.queryByRole('link', { name: 'Download bundle' })).not.toBeInTheDocument();
    expect(mocks.download.mock.lastCall?.[0].artifact.storage_kind).toBe(storage);
  });

  it('blocks download when response identity differs from the selected lookup without recasing it', () => {
    query = { ...query, data: { ...manifest, id: 'DIFFERENT/raw?#' } };
    mount();
    expect(screen.getByRole('region', { name: 'Artifact details' })).toHaveTextContent('DIFFERENT/raw?#');
    expect(screen.getByRole('region', { name: 'Artifact summary' })).toHaveTextContent('Download eligibility unknown');
    expect(screen.queryByRole('link', { name: 'Download bundle' })).not.toBeInTheDocument();
  });

  it('revokes a retained download exactly at expiry and advances the lifecycle clock without polling', () => {
    query = { ...query, data: { ...manifest, expires_at: new Date(NOW + 500).toISOString() },
      error: new ApiError('retained refresh failure', 500), isError: true };
    mount();
    expect(screen.getByRole('link', { name: 'Download bundle' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(499));
    expect(screen.getByRole('link', { name: 'Download bundle' })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('link', { name: 'Download bundle' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Artifact summary' })).toHaveTextContent('Expired');
    expect(mocks.lifecycle.mock.lastCall?.[0].now).toBe(NOW + 500);
    expect(screen.getByText('Data may be stale')).toBeInTheDocument();
    expect(mocks.refetch).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1_500));
    expect(mocks.lifecycle.mock.lastCall?.[0].now).toBe(NOW + 2_000);
  });

  it('cleans up expiry timers when unmounted', () => {
    const view = mount();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses truthful no-selection copy, disables refresh and commits a trimmed editable lookup', () => {
    query = { data: undefined, fetchStatus: 'idle', refetch: mocks.refetch };
    mount(null);
    expect(screen.getByRole('button', { name: 'Refresh artifact manifest' })).toBeDisabled();
    expect(screen.getByText(/Use Refresh to check for updated metadata/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: `  ${ID}  ` } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    expect(mocks.hook).toHaveBeenLastCalledWith(ID);
    expect(screen.getByRole('textbox')).toHaveValue(ID);
  });

  it('resynchronizes the editable draft and lookup on same-route URL selection changes', () => {
    const view = mount(ID, <Navigate />);
    fireEvent.click(within(view.container).getByRole('button', { name: 'Change selection' }));
    expect(mocks.hook).toHaveBeenLastCalledWith('other/raw?#');
    expect(screen.getByRole('textbox')).toHaveValue('other/raw?#');
    expect(screen.queryByRole('link', { name: 'Download bundle' })).not.toBeInTheDocument();
  });
});
