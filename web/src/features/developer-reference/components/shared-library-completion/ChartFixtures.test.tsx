import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@/components/ui/ThemeProvider';
import { ChartFixtures } from './ChartFixtures';
import { completionCopy as c } from './completionCopy';
import { completeChartRows, plottedChartRows } from './fixtureData';

const downloadCSV = vi.hoisted(() => vi.fn());
vi.mock('@/lib/csvExport', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/csvExport')>(),
  downloadCSV,
}));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  downloadCSV.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('prepared canonical ChartCard fixture', () => {
  it('retains all 12 observations in the actual alternative while the plot uses four', async () => {
    await act(async () => { render(<ThemeProvider><MemoryRouter><ChartFixtures /></MemoryRouter></ThemeProvider>); });
    expect(completeChartRows).toHaveLength(12);
    expect(plottedChartRows).toHaveLength(4);
    expect(screen.getAllByRole('heading', { name: c.chartName })).toHaveLength(1);
    const table = screen.getByRole('table', { name: `${c.chartName} — data table` });
    expect(within(table).getAllByRole('row')).toHaveLength(13);
    expect(within(table).getByText(c.unknown)).toBeInTheDocument();
    expect(within(table).getByText('0')).toBeInTheDocument();
    expect(within(table).getByText('2026-08-12')).toBeInTheDocument();
    expect(screen.getByText('Showing 4 of 12 observations for display.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: c.chartAction }));
    expect(screen.getByText(c.chartActionResult)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export chart' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download data as CSV' }));
    expect(downloadCSV).toHaveBeenCalledOnce();
    expect(downloadCSV.mock.calls[0][0]).toBe('shared-completion-prepared-evidence');
    const csv = downloadCSV.mock.calls[0][1] as string;
    completeChartRows.forEach(row => expect(csv).toContain(row.date));
    expect(csv).toContain('2026-08-01,0');
    expect(csv).toContain('2026-08-03,');
  });

  it('retains data during refresh error and recovers the canonical empty state', async () => {
    await act(async () => { render(<ThemeProvider><MemoryRouter><ChartFixtures /></MemoryRouter></ThemeProvider>); });
    fireEvent.click(screen.getByRole('button', { name: 'Retained after refresh error' }));
    expect(screen.getByText(c.sourceRetained)).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: c.chartRetry }));
    expect(screen.queryByText(c.sourceRetained)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Empty' }));
    expect(screen.getByText(c.chartEmpty)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: c.chartTitle })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: c.chartRetry }));
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});
