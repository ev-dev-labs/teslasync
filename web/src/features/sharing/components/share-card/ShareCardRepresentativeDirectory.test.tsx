import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadCSV, downloadJSON } from '@/lib/csvExport';
import { setColumnLayout } from '@/lib/columnOrderStore';
import { analyzeShareCard, type ShareCardRepresentativeDrive } from '../../lib/shareCard';
import { ShareCardRepresentativeDirectory } from './ShareCardRepresentativeDirectory';
import type { ShareCardDisplay, ShareCardQueryState } from './types';

vi.mock('@/lib/csvExport', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/csvExport')>(),
  downloadCSV: vi.fn(),
  downloadJSON: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, options?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? '')),
    i18n: { language: 'en' },
  }),
}));

const tableId = 'share-card:representative-drives';
const populated: ShareCardRepresentativeDrive = {
  rank: 1, id: 42, timestamp: '2026-10-01T12:00:00Z', localDay: '2026-10-01',
  distanceM: 1609.344, durationS: 600, energyWh: 250.5,
  efficiencyWhPerKm: 155.653, maxSpeedMps: 20, hasRouteLabels: true,
};
const state: ShareCardQueryState = {
  enabled: true, hasData: true, isInitialLoading: false, isInitialPaused: false,
  initialError: null, isResolved: true, isRefreshing: false,
  cachedRefreshError: null, cachedRefreshPaused: false, onRetry: vi.fn(),
};
const format = (unit: string) => (value: number | null | undefined) =>
  value == null ? '—' : `${value} ${unit}`;
const display: ShareCardDisplay = {
  distanceUnit: 'mi', durationUnit: 'min', energyUnit: 'kWh',
  formatNumber: format(''), formatDistance: (value) => value == null ? '—' : `${value / 1609.344} mi`,
  formatDuration: (value) => value == null ? '—' : `${value / 60} min`,
  formatEnergy: (value) => value == null ? '—' : `${value / 1000} kWh`,
  formatEfficiency: format('Wh/km'), formatSpeed: format('m/s'),
  formatTemperature: format('C'), formatPercent: format('%'), formatMonth: (month) => month,
  distanceValue: (value) => value / 1609.344, durationValue: (value) => value / 60,
  energyValue: (value) => value / 1000,
};

function renderDirectory(representatives: readonly ShareCardRepresentativeDrive[]) {
  const analysis = analyzeShareCard([], {
    startLabel: '2026-10-01', endLabel: '2026-10-02',
    startInstant: '2026-10-01T00:00:00Z', endInstantExclusive: '2026-10-03T00:00:00Z',
    timezone: 'UTC',
  });
  return render(<ShareCardRepresentativeDirectory
    analysis={{ ...analysis, representatives }} state={state} display={display}
  />);
}

async function exportDirectory(format: 'CSV' | 'JSON') {
  fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
  fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(format) }));
  await waitFor(() => expect(format === 'JSON' ? downloadJSON : downloadCSV).toHaveBeenCalledOnce());
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

const observers: { element: Element; callback: ResizeObserverCallback }[] = [];
function resize(width: number) {
  act(() => observers.forEach(({ element, callback }) => callback(
    [{ target: element, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver,
  )));
}
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-mode');
});

describe('ShareCardRepresentativeDirectory complete mobile details', () => {
  it.each(['light', 'dark'])('keeps all fields reachable by keyboard in %s mode without changing desktop columns', async mode => {
    document.documentElement.setAttribute('data-mode', mode);
    observers.length = 0;
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) { observers.push({ element, callback: this.callback }); }
      unobserve() {}
      disconnect() {}
    });
    const user = userEvent.setup();
    const view = renderDirectory([populated, {
      ...populated, id: 43, rank: 2, durationS: null, energyWh: 0, hasRouteLabels: false,
    }]);
    resize(1280);
    expect(screen.getAllByRole('columnheader')).toHaveLength(7);
    resize(375);
    expect(view.container.querySelector('[data-mobile-table]')).toBeInTheDocument();
    const trigger = screen.getAllByRole('button', { name: 'Quick view' })[0];
    trigger.focus();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog');
    for (const label of ['Rank', 'Vehicle-local day', 'Distance', 'Duration', 'Energy', 'Efficiency', 'Route labels']) {
      expect(within(dialog).getByText(label)).toBeInTheDocument();
    }
    for (const value of ['#1', '1 mi', '10 min', '0.2505 kWh', '155.653 Wh/km', 'Present · withheld']) {
      expect(within(dialog).getByText(value)).toBeInTheDocument();
    }
    expect(dialog).not.toHaveTextContent(populated.timestamp);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    screen.getAllByRole('button', { name: 'Quick view' })[1].focus();
    await user.keyboard(' ');
    expect(within(screen.getByRole('dialog')).getByText('—')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('0 kWh')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await exportDirectory('JSON');
    expect(vi.mocked(downloadJSON).mock.calls[0][1]).toHaveLength(2);
    resize(1280);
    expect(screen.getAllByRole('columnheader')).toHaveLength(7);
  });
});

describe('ShareCardRepresentativeDirectory caller-owned exports', () => {
  it('exports precise SI keys and values, explicit missing nulls and measured zeros without private fields', async () => {
    renderDirectory([
      populated,
      { ...populated, id: 43, rank: 2, distanceM: null, durationS: null, energyWh: null,
        efficiencyWhPerKm: null, hasRouteLabels: false },
      { ...populated, id: 44, rank: 3, distanceM: 0, durationS: 0, energyWh: 0,
        efficiencyWhPerKm: 0, hasRouteLabels: false },
    ]);
    expect(screen.getByText('1 mi')).toBeInTheDocument();
    expect(screen.getByText('10 min')).toBeInTheDocument();
    expect(screen.getByText('0.2505 kWh')).toBeInTheDocument();
    await exportDirectory('JSON');
    expect(downloadJSON).toHaveBeenCalledWith(expect.any(String), [
      { rank: 1, local_day: '2026-10-01', distance_m: 1609.344, duration_s: 600,
        energy_wh: 250.5, efficiency_wh_per_km: 155.653, has_route_labels: true },
      { rank: 2, local_day: '2026-10-01', distance_m: null, duration_s: null,
        energy_wh: null, efficiency_wh_per_km: null, has_route_labels: false },
      { rank: 3, local_day: '2026-10-01', distance_m: 0, duration_s: 0,
        energy_wh: 0, efficiency_wh_per_km: 0, has_route_labels: false },
    ]);
  });

  it('retains readable CSV units, rank and privacy disclosures for populated and missing data', async () => {
    renderDirectory([populated, {
      ...populated, id: 43, rank: 2, distanceM: null, durationS: null,
      energyWh: null, efficiencyWhPerKm: null, hasRouteLabels: false,
    }]);
    await exportDirectory('CSV');
    expect(downloadCSV).toHaveBeenCalledWith(expect.any(String),
      'Rank,Vehicle-local day,Distance,Duration,Energy,Efficiency,Route labels\r\n'
      + '#1,2026-10-01,1 mi,10 min,0.2505 kWh,155.653 Wh/km,Present · withheld\r\n'
      + '#2,2026-10-01,—,—,—,—,Not recorded');
  });

  it('honors saved CSV column order and visibility without treating mobile columns as export scope', async () => {
    setColumnLayout(tableId, { order: ['energy', 'day', 'rank'], hidden: ['route'] });
    renderDirectory([populated]);
    await exportDirectory('CSV');
    expect(downloadCSV).toHaveBeenCalledWith(expect.any(String),
      'Energy,Vehicle-local day,Rank,Distance,Duration,Efficiency\r\n'
      + '0.2505 kWh,2026-10-01,#1,1 mi,10 min,155.653 Wh/km');
  });

  it('retains matching-loaded scope and does not export absent source rows', async () => {
    renderDirectory([populated]);
    expect(screen.getByText('Exports include only matching loaded rows, or selected loaded rows.')).toBeInTheDocument();
    await exportDirectory('JSON');
    expect(vi.mocked(downloadJSON).mock.calls[0][1]).toHaveLength(1);
    expect(downloadCSV).not.toHaveBeenCalled();
  });

  it('preserves the resolved empty directory without an export action', () => {
    renderDirectory([]);
    expect(screen.getByText('No eligible drive can be ranked for this selected window.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export list' })).not.toBeInTheDocument();
  });
});
