import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { queryResult, renderWidget } from '../components/continuation-dashboard-2/testSupport';
import VersionInfoWidget from './VersionInfoWidget';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';

const hooks = vi.hoisted(() => ({ version: vi.fn(), capture: vi.fn() }));
vi.mock('@/api/hooks/useSettings', async (original) => {
  const actual = await original<typeof import('@/api/hooks/useSettings')>();
  return { ...actual, useVersionInfo: () => hooks.version(), useCaptureStats: () => hooks.capture() };
});

const version = {
  chart_version: '1.4.2',
  git_commit: 'abcdef0123456789',
  go_version: 'go1.25.0',
  build_date: '2026-09-01',
  uptime_seconds: 90061,
  os: 'linux',
  arch: 'amd64',
};

function widgetForPack(packId: PackId, cols = 4) {
  return <PackBoundary requestedPackId={packId}><VersionInfoWidget size={{ cols, rows: 4 }} /></PackBoundary>;
}

async function renderPackWidget(packId: PackId, cols = 4) {
  const view = renderWidget(widgetForPack(packId, cols));
  if (packId !== 'classic') {
    await waitFor(() => expect(view.container.querySelector(`[data-status-appearance="${PACK_APPEARANCES[packId]}"]`)).toBeInTheDocument());
  }
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  hooks.version.mockReturnValue(queryResult(version));
  hooks.capture.mockReturnValue(queryResult({ signals_per_sec: 0, messages_today: 0, bytes_processed: 0, avg_processing_latency_ms: 0 }));
});

describe.each(PACK_IDS)('version and capture source independence (%s)', (packId) => {
  it('retains capture measurements while version fails and retries only the failed source from its own boundary', async () => {
    const retry = vi.fn();
    const captureRetry = vi.fn();
    hooks.version.mockReturnValue(queryResult(undefined, { isError: true, error: new Error('Version offline'), refetch: retry }));
    hooks.capture.mockReturnValue(queryResult({ signals_per_sec: 23, messages_today: 456 }, { refetch: captureRetry }));
    const { container } = await renderPackWidget(packId);
    expect(container.querySelector('[data-data-state="partial"]')).toBeInTheDocument();
    expect(screen.getByText('Version information could not be loaded.')).toBeVisible();
    expect(screen.getByText('Signals/sec')).toBeVisible();
    expect(screen.getByText(fmtNumber(23))).toBeVisible();
    expect(screen.getByText(fmtInt(456))).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(captureRetry).not.toHaveBeenCalled();
  });

  it('keeps unknown capture metric sections and version evidence when capture fails', async () => {
    hooks.capture.mockReturnValue(queryResult(undefined, { isError: true, error: new Error('Capture offline') }));
    await renderPackWidget(packId);
    for (const value of ['1.4.2', 'abcdef0']) {
      for (const reading of screen.getAllByText(value)) expect(reading).toBeVisible();
    }
    expect(screen.getByText('1d 1h 1m')).toBeVisible();
    for (const label of ['Signals/sec', 'Messages today', 'Bytes processed', 'Avg latency']) {
      const caption = screen.getByText(label);
      expect(caption).toBeVisible();
      expect(caption.closest('[data-stat-card]')?.textContent ?? caption.parentElement?.parentElement?.textContent).toContain('—');
    }
    expect(screen.getByRole('alert')).toBeVisible();
  });

  it.each([true, false])('keeps unknown version initial without hiding capture data when isLoading is %s', async (isLoading) => {
    hooks.version.mockReturnValue(queryResult(undefined, { isLoading }));
    hooks.capture.mockReturnValue(queryResult({ signals_per_sec: 23, messages_today: 456 }));
    await renderPackWidget(packId, 2);
    expect(screen.getByRole('status', { name: 'Loading Version info' })).toBeVisible();
    expect(screen.getByText(fmtNumber(23))).toBeVisible();
    expect(screen.queryByText('Go version')).not.toBeInTheDocument();
  });

  it('uses responsive wrapping definitions without dropping long build strings or preferred details', async () => {
    hooks.version.mockReturnValue(queryResult({ ...version, build_date: 'A deliberately long complete deployment build timestamp', go_version: 'go1.25.0-with-build-metadata' }));
    await renderPackWidget(packId, 2);
    const date = screen.getByText('Build date').parentElement;
    expect(date?.querySelector('dd')).toHaveTextContent('A deliberately long complete deployment build timestamp');
    expect(date?.querySelector('dd')).not.toHaveClass('truncate');
    expect(screen.getByText('go1.25.0-with-build-metadata')).toBeVisible();
  });

  it('keeps compact version identity independent of an irrelevant capture failure', async () => {
    hooks.capture.mockReturnValue(queryResult(undefined, { isError: true, error: new Error('Capture offline') }));
    const { container } = await renderPackWidget(packId, 1);
    expect(screen.getByText('1.4.2')).toBeVisible();
    expect(screen.getByText('abcdef0')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Signals/sec')).not.toBeInTheDocument();
    expect(within(screen.getByRole('heading', { name: 'Version info' }).parentElement!).queryByText('Capture offline')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-role="freshness-dot"]')).toHaveLength(1);
    expect(container.querySelector('[data-data-state="ok"]')).toBeInTheDocument();
  });

  it('preserves complete build evidence and measured zeros without treating disabled capture as unknown', async () => {
    hooks.version.mockReturnValue(queryResult({ ...version, uptime_seconds: 0 }));
    hooks.capture.mockReturnValue(queryResult({
      capture_enabled: false,
      total_documents: 0,
      distinct_vins: [],
      signals_per_sec: 0,
      messages_today: 0,
      bytes_processed: 0,
      avg_processing_latency_ms: 0,
    }));
    await renderPackWidget(packId);
    for (const value of ['Version', 'Build date', 'Git commit', 'Server uptime', 'Data capture', 'Go version', 'Platform',
      '2026-09-01', 'go1.25.0', 'linux/amd64', '0m', 'Disabled', `${fmtInt(0)} documents`, '0 VINs']) {
      expect(screen.getByText(value)).toBeVisible();
    }
    for (const [label, reading] of [
      ['Signals/sec', fmtNumber(0)],
      ['Messages today', fmtInt(0)],
      ['Bytes processed', fmtInt(0)],
      ['Avg latency', `${fmtNumber(0)} ms`],
    ]) {
      const cell = screen.getByText(label).closest('[role="listitem"]');
      expect(cell).not.toBeNull();
      expect(within(cell as HTMLElement).getByText(reading)).toBeVisible();
    }
  });

  it('keeps invalid uptime and non-finite capture values unknown alongside a measured zero', async () => {
    hooks.version.mockReturnValue(queryResult({ ...version, uptime_seconds: -1 }));
    hooks.capture.mockReturnValue(queryResult({
      signals_per_sec: Number.NaN,
      messages_today: 0,
      bytes_processed: Number.POSITIVE_INFINITY,
      avg_processing_latency_ms: Number.NaN,
      distinct_vins: null,
    }));
    await renderPackWidget(packId);
    for (const label of ['Server uptime', 'Data capture']) {
      expect(screen.getByText(label).parentElement?.querySelector('dd')).toHaveTextContent('—');
    }
    for (const label of ['Signals/sec', 'Bytes processed', 'Avg latency']) {
      const cell = screen.getByText(label).closest('[role="listitem"]');
      expect(within(cell as HTMLElement).getByText('—')).toBeVisible();
    }
    expect(screen.queryByText('0m')).not.toBeInTheDocument();
    expect(screen.queryByText(/documents|VINs|NaN|Infinity/)).not.toBeInTheDocument();
    expect(within(screen.getByText('Messages today').closest('[role="listitem"]') as HTMLElement).getByText(fmtInt(0))).toBeVisible();
  });

  it('retains both sources after refresh failures and preserves source-specific and shell refresh commands', async () => {
    const versionRetry = vi.fn();
    const captureRetry = vi.fn();
    const retainedVersion = queryResult(version, { isError: true, error: new Error('Version refresh failed'), refetch: versionRetry });
    const retainedCapture = queryResult({ signals_per_sec: 23, avg_processing_latency_ms: 12.5 }, {
      isError: true, error: new Error('Capture refresh failed'), refetch: captureRetry,
    });
    hooks.version.mockReturnValue(retainedVersion);
    hooks.capture.mockReturnValue(retainedCapture);
    const view = await renderPackWidget(packId);
    expect(view.container.querySelector('[data-data-state="stale"]')).toBeInTheDocument();
    expect(screen.getByText('Previously loaded version information remains visible while it refreshes.')).toBeVisible();
    expect(screen.getByText('1d 1h 1m')).toBeVisible();
    expect(screen.getByText(fmtNumber(23))).toBeVisible();
    expect(screen.getByText(`${fmtNumber(12.5)} ms`)).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry', exact: true }));
    expect(versionRetry).toHaveBeenCalledOnce();
    expect(captureRetry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh', exact: true }));
    expect(captureRetry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/ }));
    expect(versionRetry).toHaveBeenCalledTimes(2);
    expect(captureRetry).toHaveBeenCalledTimes(2);

    hooks.version.mockReturnValue({ ...retainedVersion, isFetching: true });
    hooks.capture.mockReturnValue({ ...retainedCapture, isFetching: true });
    view.rerender(widgetForPack(packId));
    expect(screen.getByRole('button', { name: /^Refresh data/ })).toBeDisabled();
    expect(screen.getByText('1d 1h 1m')).toBeVisible();
    expect(screen.getByText(`${fmtNumber(12.5)} ms`)).toBeVisible();
  });

  it('keeps loading and resolved-empty states truthful without inventing capture measurements', async () => {
    hooks.version.mockReturnValue(queryResult(undefined, { isLoading: true }));
    hooks.capture.mockReturnValue(queryResult(undefined, { isLoading: true }));
    const view = renderWidget(widgetForPack(packId));
    expect(view.container.querySelector('[data-data-state="initial"]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('1.4.2')).not.toBeInTheDocument();
    expect(screen.queryByText('Signals/sec')).not.toBeInTheDocument();

    hooks.version.mockReturnValue(queryResult(null));
    hooks.capture.mockReturnValue(queryResult(null));
    view.rerender(widgetForPack(packId));
    expect(screen.getByText('No version data available')).toBeVisible();
    expect(view.container.querySelector('[data-data-state="unavailable"]')).toBeInTheDocument();
    expect(screen.queryByText('Signals/sec')).not.toBeInTheDocument();
    if (packId !== 'classic') {
      await waitFor(() => expect(view.container.querySelector(`[data-status-appearance="${PACK_APPEARANCES[packId]}"]`)).toBeInTheDocument());
    }
  });
});
