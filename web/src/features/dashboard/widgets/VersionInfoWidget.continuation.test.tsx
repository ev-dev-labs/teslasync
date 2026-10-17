import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { queryResult, renderWidget } from '../components/continuation-dashboard-2/testSupport';
import VersionInfoWidget from './VersionInfoWidget';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';

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

beforeEach(() => {
  vi.clearAllMocks();
  hooks.version.mockReturnValue(queryResult(version));
  hooks.capture.mockReturnValue(queryResult({ signals_per_sec: 0, messages_today: 0, bytes_processed: 0, avg_processing_latency_ms: 0 }));
});

describe('version and capture source independence', () => {
  it('retains capture measurements while version fails and retries only the failed source from its own boundary', () => {
    const retry = vi.fn();
    const captureRetry = vi.fn();
    hooks.version.mockReturnValue(queryResult(undefined, { isError: true, error: new Error('Version offline'), refetch: retry }));
    hooks.capture.mockReturnValue(queryResult({ signals_per_sec: 23, messages_today: 456 }, { refetch: captureRetry }));
    const { container } = renderWidget(<VersionInfoWidget size={{ cols: 4, rows: 4 }} />);
    expect(container.querySelector('[data-data-state="partial"]')).toBeInTheDocument();
    expect(screen.getByText('Version information could not be loaded.')).toBeVisible();
    expect(screen.getByText('Signals/sec')).toBeVisible();
    expect(screen.getByText(fmtNumber(23))).toBeVisible();
    expect(screen.getByText(fmtInt(456))).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(captureRetry).not.toHaveBeenCalled();
  });

  it('keeps unknown capture metric sections and version evidence when capture fails', () => {
    hooks.capture.mockReturnValue(queryResult(undefined, { isError: true, error: new Error('Capture offline') }));
    renderWidget(<VersionInfoWidget size={{ cols: 4, rows: 4 }} />);
    expect(screen.getByText('1.4.2')).toBeVisible();
    expect(screen.getByText('abcdef0')).toBeVisible();
    expect(screen.getByText('1d 1h 1m')).toBeVisible();
    for (const label of ['Signals/sec', 'Messages today', 'Bytes processed', 'Avg latency']) {
      const caption = screen.getByText(label);
      expect(caption).toBeVisible();
      expect(caption.closest('[data-stat-card]')?.textContent ?? caption.parentElement?.parentElement?.textContent).toContain('—');
    }
    expect(screen.getByRole('alert')).toBeVisible();
  });

  it.each([true, false])('keeps unknown version initial without hiding capture data when isLoading is %s', (isLoading) => {
    hooks.version.mockReturnValue(queryResult(undefined, { isLoading }));
    hooks.capture.mockReturnValue(queryResult({ signals_per_sec: 23, messages_today: 456 }));
    renderWidget(<VersionInfoWidget size={{ cols: 2, rows: 4 }} />);
    expect(screen.getByRole('status', { name: 'Loading Version info' })).toBeVisible();
    expect(screen.getByText(fmtNumber(23))).toBeVisible();
    expect(screen.queryByText('Go version')).not.toBeInTheDocument();
  });

  it('uses responsive wrapping definitions without dropping long build strings or preferred details', () => {
    hooks.version.mockReturnValue(queryResult({ ...version, build_date: 'A deliberately long complete deployment build timestamp', go_version: 'go1.25.0-with-build-metadata' }));
    renderWidget(<VersionInfoWidget size={{ cols: 2, rows: 4 }} />);
    const date = screen.getByText('Build date').parentElement;
    expect(date?.querySelector('dd')).toHaveTextContent('A deliberately long complete deployment build timestamp');
    expect(date?.querySelector('dd')).not.toHaveClass('truncate');
    expect(screen.getByText('go1.25.0-with-build-metadata')).toBeVisible();
  });

  it('keeps compact version identity independent of an irrelevant capture failure', () => {
    hooks.capture.mockReturnValue(queryResult(undefined, { isError: true, error: new Error('Capture offline') }));
    renderWidget(<VersionInfoWidget size={{ cols: 1, rows: 2 }} />);
    expect(screen.getByText('1.4.2')).toBeVisible();
    expect(screen.getByText('abcdef0')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Signals/sec')).not.toBeInTheDocument();
    expect(within(screen.getByRole('heading', { name: 'Version info' }).parentElement!).queryByText('Capture offline')).not.toBeInTheDocument();
  });
});
