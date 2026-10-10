import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { RbacMatrixSessionResponse } from '@/api/hooks/useRbacMatrix';
import type { QueueStatusResponse, RateLimitStatusResponse } from '@/api/types';
import { useRateLimitStatus } from '@/api/hooks/useSystem';
import { useQueueStatus } from '@/api/hooks/useSystemQueues';
import { request } from '@/api/client';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { RbacOperationalBrief } from './RbacOperationalBrief';
import { SubjectsOperationalBrief } from './SubjectsOperationalBrief';
import { SystemOperationalBrief } from './SystemOperationalBrief';
import { SecurityOperationalBrief } from './SecurityOperationalBrief';
import { SecurityStatisticsBrief } from './SecurityStatisticsBrief';
import type { BriefSource } from './briefSource';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, options?: Record<string, unknown>) =>
      (fallback ?? key).replace(/{{(\w+)}}/g, (_, name: string) => String(options?.[name] ?? `{{${name}}}`)),
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({
  unitPrefs: { distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
    energy: 'Wh', duration: 's', power: 'W', precision: 2, locale: 'en-US' },
}) }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));
vi.mock('@/hooks/useOperationalMetrics', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useOperationalMetrics')>('@/hooks/useOperationalMetrics');
  return { ...actual, useOperationalMetrics: vi.fn(actual.useOperationalMetrics) };
});
vi.mock('@/api/client', async () => ({
  ...await vi.importActual<typeof import('@/api/client')>('@/api/client'),
  request: vi.fn(),
}));

const snapshot: BriefSource = { known: true, loading: false, retained: false, failed: false };
const retained: BriefSource = { ...snapshot, retained: true };
const matrix: RbacMatrixSessionResponse = {
  mode: 'session', roles: [{ id: 'admin', name: 'admin' }],
  permissions: [
    { id: 'fleet.read', name: 'View vehicles', category: 'fleet' },
    { id: 'admin.audit', name: 'View audit log', category: 'admin' },
  ],
  categories: ['fleet', 'admin'],
  matrix: { admin: { 'fleet.read': true, 'admin.audit': true } },
  effective_for_me: { 'fleet.read': true, 'admin.audit': false },
  my_roles: ['admin'], groups_header_name: 'X-Forwarded-Groups',
};
const start = '2026-10-01T00:00:00Z';
const end = '2026-10-02T00:00:00Z';
const scope = 'Vehicle 7 · Security events from 2026-10-01 to 2026-10-02 (exclusive)';

function show(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  return { client, ...render(<MemoryRouter><QueryClientProvider client={client}>{children}</QueryClientProvider></MemoryRouter>) };
}
function value(key: string) {
  return document.querySelector(`[data-operational-metric="${key}"] [data-operational-value]`);
}
function latestRaw() {
  return vi.mocked(useOperationalMetrics).mock.calls.at(-1)?.[0] ?? [];
}
function SystemHarness() {
  const rateLimit = useRateLimitStatus();
  const queue = useQueueStatus();
  return <SystemOperationalBrief rateLimit={rateLimit} queue={queue} />;
}

beforeEach(() => { vi.mocked(useOperationalMetrics).mockClear(); vi.mocked(request).mockReset(); });
afterEach(cleanup);

describe('Admin R–Z real OperationalBrief source contracts', () => {
  it('retains all six saved RBAC counts and the effective permission denominator in details', () => {
    show(<RbacOperationalBrief payload={matrix} source={retained} />);
    expect(latestRaw().map(metric => metric.rawValue)).toEqual([1, 2, 2, 2, 1, 1]);
    expect(latestRaw().at(-1)?.metricId).toBe('count');
    expect(latestRaw().at(-1)?.display?.countTotal).toBe(2);
    expect(value('rbac-effective')).toHaveTextContent('1 / 2');
    expect(screen.getByText('Retained evidence')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('Effective for me')).toBeVisible();
    expect(within(drawer).getByText('1 / 2')).toBeVisible();
    expect(within(drawer).getAllByText(/unsaved edits are not included/).length).toBeGreaterThan(0);
  });

  it('keeps unavailable RBAC counts missing and renders the actual loading brief', () => {
    const { rerender } = show(<RbacOperationalBrief source={{ known: false, loading: true, retained: false, failed: false }} />);
    expect(screen.getByTestId('rbac-operational-brief')).toHaveAttribute('aria-busy', 'true');
    expect(latestRaw().every(metric => metric.rawValue === null)).toBe(true);
    expect(document.querySelector('[data-operational-value]')).toBeNull();
    rerender(<RbacOperationalBrief source={{ known: false, loading: false, retained: false, failed: true }} />);
    expect(value('rbac-roles')).toHaveTextContent('—');
    expect(document.querySelector('[data-operational-metric="rbac-roles"]')).toHaveAttribute('data-value-state', 'missing');
    expect(screen.getByText('Source unavailable')).toBeVisible();
  });

  it('retains a raw canonical 900-second policy limit without confusing it with expiry', () => {
    show(<SubjectsOperationalBrief subjectCount={0} accessMode="Open" sessionStatus="Idle" source={snapshot} />);
    expect(latestRaw().find(metric => metric.occurrenceId === 'subjects-limit')).toMatchObject({
      metricId: 'duration', rawValue: 900, display: { units: { duration: 'min' }, precision: 0 },
    });
    expect(value('subjects-limit')).toHaveTextContent('15 min');
    expect(value('subjects-available')).toHaveTextContent('0');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText(/not the active session’s remaining time/)).toBeVisible();
  });

  it('does not convert an unknown subject count or session status into measured zero or idle', () => {
    show(<SubjectsOperationalBrief subjectCount={null} accessMode={null} sessionStatus={null}
      source={{ ...snapshot, known: false, failed: true }} />);
    expect(latestRaw().slice(0, 3).map(metric => metric.rawValue)).toEqual([null, null, null]);
    expect(value('subjects-available')).toHaveTextContent('—');
    expect(value('subjects-session')).toHaveTextContent('—');
    expect(value('subjects-limit')).toHaveTextContent('15 min');
  });

  it('preserves security snapshot versus bounded event-sample scope and the existing lock-age display', () => {
    show(<SecurityOperationalBrief isSecure={false} lastLockChange={new Date(Date.now() - 120000).toISOString()}
      sentryUptime={50} totalEvents={4} latestLoading={false} historyLoading={false}
      source={retained} start={start} endExclusive={end} vehicleId="7" />);
    expect(latestRaw().map(metric => metric.metricId)).toEqual(['status', 'duration', 'percent', 'count']);
    expect(latestRaw()[1].rawValue).toBeGreaterThanOrEqual(120);
    expect(latestRaw()[2].rawValue).toBe(50);
    expect(value('security-last-lock')).toHaveTextContent('2m ago');
    expect(value('security-status')).toHaveTextContent('Unsecure');
    expect(value('security-sentry')).toHaveTextContent('50%');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getAllByText(/not time-weighted uptime/).length).toBeGreaterThan(0);
    expect(within(drawer).getAllByText(/History 2026-10-01T00:00:00Z to 2026-10-02T00:00:00Z/).length).toBeGreaterThan(0);
  });

  it('preserves all seven additional statistics and retry actions after a retained refresh failure', () => {
    const retry = vi.fn();
    show(<SecurityStatisticsBrief securityStats={{ lockEvents: 2, doorOpenCount: 1, windowOpenCount: 3,
      homelinkCount: 0, guestCount: 1, total: 4 }} sentryUptime={50} isLoading={false}
      error={null} onRetry={retry} source={retained} scope={scope} />);
    expect(latestRaw().map(metric => metric.rawValue)).toEqual([2, 50, 1, 3, 0, 1, 4]);
    expect(document.querySelectorAll('[data-operational-metric]')).toHaveLength(7);
    expect(value('security-homelink')).toHaveTextContent('0');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh security history' }));
    expect(retry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText('HomeLink detections')).toBeVisible();
    expect(within(screen.getByRole('dialog')).getAllByText(scope).length).toBeGreaterThan(0);
  });

  it('keeps known latest security posture while the independent history feed is loading', () => {
    show(<SecurityOperationalBrief isSecure={true} sentryUptime={null} totalEvents={null}
      latestLoading={false} historyLoading={true} source={{ ...snapshot, known: false }}
      start={start} endExclusive={end} vehicleId="7" />);
    expect(value('security-status')).toHaveTextContent('Secure');
    expect(value('security-events')).toHaveTextContent('—');
    expect(latestRaw().slice(1).every(metric => metric.rawValue === null)).toBe(true);
    expect(screen.getByTestId('security-operational-brief')).not.toHaveAttribute('aria-busy');
  });

  it('keeps the real statistics brief busy with labels, sample context and no fabricated loading values', () => {
    show(<SecurityStatisticsBrief securityStats={null} sentryUptime={0} isLoading={true}
      error={null} source={{ known: false, loading: true, retained: false, failed: false }} scope={scope} />);
    expect(screen.getByTestId('security-statistics-brief')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('HomeLink detections')).toBeVisible();
    expect(document.querySelector('[data-operational-value]')).toBeNull();
  });

  it('keeps statistics empty-state recovery and missing metrics instead of fabricated zeros', () => {
    show(<SecurityStatisticsBrief securityStats={null} sentryUptime={0} isLoading={false}
      error={null} onRetry={vi.fn()} source={snapshot} scope={scope} />);
    expect(latestRaw().every(metric => metric.rawValue == null)).toBe(true);
    expect(value('security-stats-total')).toHaveTextContent('—');
    expect(screen.getByText('No security events are available in this history window.')).toBeVisible();
  });

  it('keeps invalid fractional counts invalid rather than disguising them as source text', () => {
    show(<SubjectsOperationalBrief subjectCount={1.5} accessMode="Forward-auth" sessionStatus="Idle" source={snapshot} />);
    expect(latestRaw()[0]).toMatchObject({ metricId: 'count', rawValue: 1.5 });
    expect(document.querySelector('[data-operational-metric="subjects-available"]')).toHaveAttribute('data-value-state', 'invalid');
    expect(value('subjects-available')).toHaveTextContent('—');
  });

  it('uses both real system feeds, six raw typed measurements and source-specific 24-hour periods', async () => {
    const rate: RateLimitStatusResponse = { generated_at: start, scopes: [
      { id: 'write', name: 'Writes', current: 110, limit: 120, window_seconds: 60, severity: 'critical', detail: 'Minute window' },
    ] };
    const queue: QueueStatusResponse = { generated_at: end, workers: [
      { worker: 'export', display_name: 'Export', pending: 3, in_progress: 1,
        succeeded_24h: 7, failed_24h: 2, oldest_pending_age_seconds: 4,
        heartbeat_severity: 'ok', heartbeat_detail: '', last_heartbeat_at: start,
        started_at: start, host: 'test-host', version: '1.0' },
    ] };
    vi.mocked(request).mockResolvedValueOnce(rate).mockResolvedValueOnce(queue);
    show(<SystemHarness />);
    await waitFor(() => expect(value('system-succeeded')).toHaveTextContent('7'));
    expect(latestRaw().map(metric => metric.metricId)).toEqual(['count', 'percent', 'count', 'count', 'count', 'count']);
    expect(latestRaw().map(metric => metric.rawValue)).toEqual([1, 110 / 120 * 100, 1, 4, 7, 2]);
    expect(value('system-workers')).toHaveTextContent('1 / 1');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getAllByText(/terminally failed jobs cover the last 24 hours/).length).toBeGreaterThan(0);
    expect(within(drawer).getByText('Failed 24h')).toBeVisible();
  });
});
