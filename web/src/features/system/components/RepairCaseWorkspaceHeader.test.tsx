import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps } from 'react';
import type { RepairCaseStats } from '@/api/hooks/useRepairCaseStats';
import { deriveDataState } from '@/api/dataState';
import { formatDateTime } from '@/lib/dateFormat';
import { RepairCaseWorkspaceHeader } from './RepairCaseWorkspaceHeader';

const statistics: RepairCaseStats = {
  total: 12, open: 4, in_review: 2, applied: 1, dismissed: 1,
  quarantined: 3, restored: 0, resolved: 1, drive: 8, charging: 4,
  last_scan_at: '2026-08-25T10:02:00Z',
};

function renderHeader(overrides: Partial<ComponentProps<typeof RepairCaseWorkspaceHeader>> = {}) {
  const props: ComponentProps<typeof RepairCaseWorkspaceHeader> = {
    statistics, statisticsLoading: false, statisticsBusy: false,
    statisticsError: null, scanPending: false, canWrite: true,
    onScan: vi.fn(), onRetryStatistics: vi.fn(), ...overrides,
  };
  return {
    ...render(<MemoryRouter><RepairCaseWorkspaceHeader {...props} /></MemoryRouter>),
    props,
  };
}

describe('RepairCaseWorkspaceHeader neutral chrome and preservation', () => {
  it('uses actual paused state and retained metadata without manufacturing an error', () => {
    const retry = vi.fn();
    const state = deriveDataState({
      data: statistics, fetchStatus: 'paused', dataUpdatedAt: 1234, refetch: retry,
    });
    const { props, rerender } = renderHeader({ statisticsState: state });
    expect(screen.getByText('Refresh paused')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('data-refresh-blocked', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(screen.getByText('Retained source')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Repair case metrics' })).getByText('4')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(props.onRetryStatistics).not.toHaveBeenCalled();
    rerender(<MemoryRouter><RepairCaseWorkspaceHeader {...props} statisticsState={deriveDataState({
      data: statistics, fetchStatus: 'idle', dataUpdatedAt: 2345, refetch: retry,
    })} /></MemoryRouter>);
    expect(screen.getByText('Monitoring')).toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.queryByText('Retained source')).not.toBeInTheDocument();
  });

  it('keeps paused initial metrics unknown rather than loading or reporting zeros', () => {
    renderHeader({
      statistics: undefined,
      statisticsState: deriveDataState({ fetchStatus: 'paused', isPending: true }),
    });
    expect(screen.getByText('Refresh paused')).toBeInTheDocument();
    const metrics = within(screen.getByRole('region', { name: 'Repair case metrics' }));
    expect(metrics.getByText('No metric values are available yet.')).toBeInTheDocument();
    expect(metrics.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
  });

  it('retains authoritative zero metrics through refresh failure and successful recovery', () => {
    const data = { ...statistics, open: 0, in_review: 0, quarantined: 0 };
    const retry = vi.fn();
    const { props, rerender } = renderHeader({
      statisticsState: deriveDataState({
        data, error: new Error('Synthetic refresh failure'), dataUpdatedAt: 1234, refetch: retry,
      }),
    });
    expect(screen.getByText('Retained metrics')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Repair case metrics' })).getAllByText('0')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(props.onScan).not.toHaveBeenCalled();
    rerender(<MemoryRouter><RepairCaseWorkspaceHeader {...props} statisticsState={deriveDataState({
      data, dataUpdatedAt: 2345, refetch: retry,
    })} /></MemoryRouter>);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByText('Monitoring')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Repair case metrics' })).getAllByText('0')).toHaveLength(4);
  });

  it('uses neutral theme roles for decorative chrome without changing responsive layout', () => {
    const { container } = renderHeader();
    const icon = container.querySelector('.lucide-activity');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(icon).toHaveClass('h-5', 'w-5');
    expect(icon?.parentElement).toHaveClass(
      'h-11', 'w-11', 'shrink-0', 'rounded-shape-xl',
      'border-[var(--border-subtle)]', 'bg-[var(--surface-2)]', 'text-[var(--text-secondary)]',
    );
    expect(icon?.parentElement?.className).not.toMatch(/cyan|gradient|shadow|glow|neon/);
    expect(container.querySelector('[class*="bg-gradient"]')).toBeNull();
    expect(container.firstElementChild).toHaveClass('relative', 'overflow-hidden', 'p-0');
    expect(icon?.parentElement?.parentElement?.parentElement).toHaveClass(
      'flex-col', 'gap-5', 'p-5', 'sm:p-6', 'xl:flex-row', 'xl:items-center', 'xl:justify-between',
    );
  });

  it('preserves the title, operator-review caveat, source scope and all metric roles', () => {
    renderHeader();
    expect(screen.getByRole('heading', { name: 'Integrity command center' }))
      .toHaveAttribute('id', 'repair-case-workspace-title');
    expect(screen.getByText(
      'Continuous detection creates durable, assignable cases. No repair is applied without operator review.',
    )).toBeInTheDocument();
    const metrics = within(screen.getByRole('region', { name: 'Repair case metrics' }));
    for (const label of ['Open cases', 'In review', 'Quarantined', 'Active cases']) {
      expect(metrics.getByText(label)).toBeInTheDocument();
    }
    for (const value of ['4', '2', '3', '6']) {
      expect(metrics.getByText(value)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(screen.getAllByText(
      'Repair case statistics response; separate from the filtered queue and diagnosis scan.',
    ).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Source observation time not supplied').length).toBeGreaterThan(0);
    expect(screen.getByText(`Last scan: ${formatDateTime(statistics.last_scan_at!)}`)).toBeInTheDocument();
  });

  it.each([
    { label: 'Monitoring', tone: 'success', overrides: {} },
    { label: 'Refreshing', tone: 'info', overrides: { statisticsBusy: true } },
    { label: 'Loading', tone: 'neutral', overrides: { statistics: undefined, statisticsLoading: true } },
    { label: 'Metrics unavailable', tone: 'neutral', overrides: { statistics: undefined } },
    { label: 'Metrics unavailable', tone: 'danger', overrides: { statistics: undefined, statisticsError: new Error('Metrics failed') } },
    { label: 'Retained metrics', tone: 'warning', overrides: { statisticsError: new Error('Refresh failed') } },
  ])('preserves $label with its existing $tone status semantics', ({ label, tone, overrides }) => {
    renderHeader(overrides);
    expect(screen.getByText(label)).toHaveClass(
      tone === 'neutral' ? 'text-[var(--text-secondary)]' : `text-[var(--semantic-${tone})]`,
    );
    expect(screen.getByRole('region', { name: 'Repair case metrics' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run integrity scan' })).toBeInTheDocument();
  });

  it('retains metric readings, scan provenance and independent retry after a refresh failure', () => {
    const { props } = renderHeader({ statisticsError: new Error('Refresh failed') });
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute('role', 'status');
    expect(screen.getByText(
      'Previously loaded data remains visible while affected sources recover.',
    )).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(screen.getByText('Retained source')).toBeInTheDocument();
    expect(screen.getByText(`Last scan: ${formatDateTime(statistics.last_scan_at!)}`)).toBeInTheDocument();
    const metrics = within(screen.getByRole('region', { name: 'Repair case metrics' }));
    expect(metrics.getByText('4')).toBeInTheDocument();
    expect(metrics.getByText('6')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(props.onRetryStatistics).toHaveBeenCalledOnce();
    expect(props.onScan).not.toHaveBeenCalled();
  });

  it('keeps the metric shell unknown and offers retry on an initial failure', () => {
    const { props } = renderHeader({ statistics: undefined, statisticsError: new Error('Metrics failed') });
    expect(screen.queryByTestId('stale-refresh-warning')).toBeNull();
    const metrics = within(screen.getByRole('region', { name: 'Repair case metrics' }));
    expect(metrics.getByText('No metric values are available yet.')).toBeInTheDocument();
    expect(metrics.queryByText('0')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(props.onRetryStatistics).toHaveBeenCalledOnce();
    expect(props.onScan).not.toHaveBeenCalled();
  });

  it('distinguishes absent statistics, authoritative zeros and an absent completed scan', () => {
    const { rerender, props } = renderHeader({ statistics: undefined });
    expect(within(screen.getByRole('region', { name: 'Repair case metrics' })).getByText('No metric values are available yet.')).toBeInTheDocument();
    expect(screen.queryByText('No completed scan recorded yet')).toBeNull();
    rerender(<MemoryRouter><RepairCaseWorkspaceHeader {...props} statistics={{
      ...statistics, open: 0, in_review: 0, quarantined: 0, last_scan_at: null,
    }} /></MemoryRouter>);
    expect(within(screen.getByRole('region', { name: 'Repair case metrics' })).getAllByText('0')).toHaveLength(4);
    expect(screen.getByText('No completed scan recorded yet')).toBeInTheDocument();
  });

  it('preserves the explicit scan action, primary emphasis and read-only reason', () => {
    const { props, rerender } = renderHeader();
    const scan = screen.getByRole('button', { name: 'Run integrity scan' });
    expect(scan).toHaveClass('min-h-11', 'shrink-0', 'bg-[var(--theme-primary)]');
    expect(scan).toBeEnabled();
    expect(props.onScan).not.toHaveBeenCalled();
    fireEvent.click(scan);
    expect(props.onScan).toHaveBeenCalledOnce();
    rerender(<MemoryRouter><RepairCaseWorkspaceHeader {...props} canWrite={false} writeBlockReason="Historical scope is read-only" /></MemoryRouter>);
    expect(scan).toBeDisabled();
    expect(scan).toHaveAttribute('title', 'Historical scope is read-only');
    fireEvent.click(scan);
    expect(props.onScan).toHaveBeenCalledOnce();
    expect(props.onRetryStatistics).not.toHaveBeenCalled();
  });

  it('preserves pending scan feedback and prevents duplicate activation', () => {
    const { props } = renderHeader({ scanPending: true });
    const scan = screen.getByRole('button', { name: 'Run integrity scan' });
    expect(scan).toBeDisabled();
    expect(scan).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(scan);
    expect(props.onScan).not.toHaveBeenCalled();
  });
});
