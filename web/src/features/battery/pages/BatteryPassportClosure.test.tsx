import type { ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BatteryPassport, BatteryPassportVerifyResponse } from '@/api/hooks/useBatteryPassport';
import { ToastProvider } from '@/components/feedback';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';

const NOW = Date.parse('2026-08-08T12:00:00Z');
const h = vi.hoisted(() => ({
  passport: vi.fn(), verify: vi.fn(), retry: vi.fn(),
  createUrl: vi.fn(), revokeUrl: vi.fn(),
}));
vi.mock('@/api/hooks/useBatteryPassport', () => ({
  useBatteryPassport: h.passport, useVerifyPassport: h.verify,
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: 7, vehicle: null, vehicles: [], setVehicleId: vi.fn() }),
}));
vi.mock('@/lib/timezone', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/timezone')>(),
  useTimezone: () => 'America/Los_Angeles',
}));
vi.mock('@/components/motion', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/motion')>();
  return { ...actual, FadeIn: ({ children }: ComponentProps<typeof actual.FadeIn>) => <>{children}</> };
});

import BatteryPassportPage from './BatteryPassportPage';

const certificate: BatteryPassport = {
  vehicle_id: 7, vin_masked: 'TEST********1234', issued_at: '2026-08-08T10:00:00Z',
  first_observed_at: null, soh_pct: 91.2, capacity_kwh: 68.4, original_capacity_kwh: 75,
  equivalent_full_cycles: 0, fast_charge_ratio: 0, avg_charge_limit_pct: 0,
  thermal_exposure: { cold_pct: 10, nominal_pct: 80, hot_pct: 10 }, health_grade: 'B',
  degradation_trend: Array.from({ length: 37 }, (_, index) => ({
    date: new Date(Date.parse('2026-06-01T00:00:00Z') + index * 86400000).toISOString().slice(0, 10),
    soh_pct: 95 - index / 10,
  })),
  recommendations: Array.from({ length: 19 }, (_, index) =>
    `Returned rule ${index + 1}: retained descriptive evidence, not a prescription; preserve every word and its server order.`),
  provenance_hash: 'a'.repeat(64),
};
const verification: BatteryPassportVerifyResponse = {
  valid: true, expected_hash: 'a'.repeat(64), provided_hash: 'a'.repeat(64),
};
function query<T>(data: T | undefined, error: Error | null = null) {
  return {
    data, error, isLoading: false, isFetching: false, isPending: false,
    isSuccess: data !== undefined && error == null, isError: error != null,
    fetchStatus: 'idle' as const, refetch: h.retry,
    dataUpdatedAt: data === undefined ? 0 : NOW,
  };
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Tree() {
    return <QueryClientProvider client={client}><MemoryRouter initialEntries={['/battery-passport']}>
      <ToastProvider><BatteryPassportPage /></ToastProvider>
    </MemoryRouter></QueryClientProvider>;
  }
  const view = render(<Tree />);
  return { ...view, update: () => view.rerender(<Tree />) };
}
function metric(label: string): HTMLElement {
  const node = within(screen.getByTestId('battery-passport-kpis')).getByText(label).closest('[data-operational-metric]');
  if (!(node instanceof HTMLElement)) throw new Error(`Missing actual metric: ${label}`);
  return node;
}
function trendRows(): string[][] {
  const table = within(screen.getByTestId('battery-passport-trend-timeline')).getByRole('table', { hidden: true });
  return within(table).getAllByRole('row', { hidden: true }).slice(1).map(row =>
    within(row).getAllByRole('cell', { hidden: true }).map(cell => cell.textContent ?? ''));
}
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      if (typeof reader.result !== 'string') reject(new Error('Expected certificate text'));
      else resolve(reader.result);
    };
    reader.readAsText(blob);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setGlobalPrecision(2);
  setGlobalLocale('en-US');
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  h.passport.mockReturnValue(query(certificate));
  h.verify.mockReturnValue(query(verification));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Battery Passport bounded closure — actual evidence and export', () => {
  it('keeps genuine zero proxies and zero SoH distinct from missing fields and the explicit unknown sentinel', () => {
    h.passport.mockReturnValue(query({ ...certificate, soh_pct: 0, health_grade: 'F' }));
    const view = mount();
    for (const label of ['Certificate-reported SoH', 'Fast-charge session share', 'Average charge-end SoC proxy']) {
      expect(metric(label)).toHaveAttribute('data-value-state', 'value');
      expect(metric(label).querySelector('[data-operational-value]')).toHaveTextContent('0.00%');
    }
    expect(metric('EFC proxy').querySelector('[data-operational-value]')).toHaveTextContent('0.00');
    h.passport.mockReturnValue(query({
      ...certificate, soh_pct: 0, health_grade: 'N/A',
      equivalent_full_cycles: undefined, fast_charge_ratio: undefined,
    }));
    view.update();
    for (const label of ['Certificate-reported SoH', 'Fast-charge session share', 'EFC proxy']) {
      expect(metric(label)).toHaveAttribute('data-value-state', 'missing');
      expect(metric(label).querySelector('[data-operational-value]')).toHaveTextContent('—');
    }
    expect(metric('Average charge-end SoC proxy')).toHaveAttribute('data-value-state', 'value');
    expect(metric('Average charge-end SoC proxy').querySelector('[data-operational-value]')).toHaveTextContent('0.00%');
    expect(trendRows()).toHaveLength(37);
  });

  it('exports every canonical raw fact and row after certificate and verification refresh failures without exporting diagnostic filtering', async () => {
    // Mirrors model the request client's convenience fields. Duplicate and
    // future valid wire points remain in JSON even though diagnostics omit them.
    const raw: BatteryPassport & { vehicleId: number; provenanceHash: string } = {
      ...certificate, vehicleId: 999, provenanceHash: 'wrong mirror',
      degradation_trend: [
        ...certificate.degradation_trend,
        { date: '2026-06-01', soh_pct: 88 },
        { date: '2026-08-09', soh_pct: 90 },
      ],
    };
    const snapshot = structuredClone(raw);
    h.passport.mockReturnValue(query(raw));
    const view = mount();
    const beforeRows = trendRows();
    expect(beforeRows).toHaveLength(37);
    expect(beforeRows[0]).toEqual(['2026-06-01', '95.00%']);
    expect(beforeRows[beforeRows.length - 1]).toEqual(['2026-07-07', '91.40%']);
    h.passport.mockReturnValue(query(raw, new Error('certificate refresh failed')));
    h.verify.mockReturnValue(query(verification, new Error('verification refresh failed')));
    view.update();
    expect(trendRows()).toEqual(beforeRows);
    const recommendations = within(screen.getByTestId('battery-passport-recommendations'));
    const items = recommendations.getAllByRole('listitem');
    expect(items).toHaveLength(19);
    items.forEach((item, index) => expect(within(item).getByText(certificate.recommendations[index])).toBeInTheDocument());
    const diagnostics = within(screen.getByTestId('battery-passport-verification-diagnostics'));
    expect(diagnostics.getByText('Verification unavailable')).toBeInTheDocument();
    expect(diagnostics.queryByText('Current digest match')).not.toBeInTheDocument();
    expect(diagnostics.getAllByText(`${'a'.repeat(16)}…`)).toHaveLength(2);
    expect(screen.getByText('Certificate refresh failed. Showing the most recently loaded certificate without changing its facts.'))
      .toBeInTheDocument();
    h.createUrl.mockReturnValue('blob:certificate-test-only');
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = h.createUrl;
      static revokeObjectURL = h.revokeUrl;
    });
    const clicks: Array<{ filename: string; href: string; attached: boolean }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ filename: this.download, href: this.href, attached: document.body.contains(this) });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export certificate' }));
    const blob: unknown = h.createUrl.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    if (!(blob instanceof Blob)) throw new Error('Actual certificate Blob was not passed to the boundary');
    const exported: unknown = JSON.parse(await readBlob(blob));
    expect(exported).toEqual({
      ...certificate, degradation_trend: raw.degradation_trend,
    });
    expect(clicks).toEqual([{
      filename: 'battery-passport-7-aaaaaaaaaaaa.json', href: 'blob:certificate-test-only', attached: true,
    }]);
    expect(h.revokeUrl).toHaveBeenCalledWith('blob:certificate-test-only');
    expect(document.querySelector('a[download]')).toBeNull();
    expect(raw).toEqual(snapshot);
    expect(h.passport).toHaveBeenLastCalledWith('7');
    expect(h.verify).toHaveBeenLastCalledWith('7', 'a'.repeat(64));
  });

  it('keeps the previous mismatch hashes and all evidence interactive while verification alone refetches', () => {
    const view = mount();
    const before = trendRows();
    h.verify.mockReturnValue({
      ...query({ valid: false, expected_hash: 'b'.repeat(64), provided_hash: 'a'.repeat(64) }),
      isFetching: true, fetchStatus: 'fetching',
    });
    view.update();
    const diagnostics = within(screen.getByTestId('battery-passport-verification-diagnostics'));
    expect(diagnostics.getByText('Refreshing verification — previous result did not match')).toBeInTheDocument();
    expect(diagnostics.getByText(`${'b'.repeat(16)}…`)).toBeInTheDocument();
    expect(diagnostics.getByText(`${'a'.repeat(16)}…`)).toBeInTheDocument();
    expect(diagnostics.queryByText('Digest mismatch')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export certificate' })).toBeEnabled();
    expect(trendRows()).toEqual(before);
    expect(within(screen.getByTestId('battery-passport-recommendations')).getAllByRole('listitem')).toHaveLength(19);
    expect(h.retry).not.toHaveBeenCalled();
  });

  it('opens complete source and binding details through the real narrow-table row action', async () => {
    class NarrowResizeObserver {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([{ target, contentRect: { width: 375, height: 280 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', NarrowResizeObserver);
    mount();
    const fieldDirectory = screen.getByTestId('battery-passport-field-directory');
    const mobile = await waitFor(() => {
      const node = fieldDirectory.querySelector('[data-mobile-table]');
      if (!(node instanceof HTMLElement)) throw new Error('Actual mobile field controller is not mounted');
      return node;
    });
    fireEvent.click(within(mobile).getByRole('button', { name: /thermal_exposure\.hot_pct/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByText('thermal_exposure.hot_pct').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('10.00')).toBeInTheDocument();
    expect(within(dialog).getByText('Share of drives whose average ambient reading was above 30°C.')).toBeInTheDocument();
    expect(within(dialog).getByText('Not bound')).toBeInTheDocument();
    const footer = dialog.querySelector('[data-modal-footer]');
    if (!(footer instanceof HTMLElement)) throw new Error('Actual details close action is missing');
    fireEvent.click(within(footer).getByRole('button', { name: 'Close', exact: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trendRows()).toHaveLength(37);
    expect(screen.getByRole('button', { name: 'Export certificate' })).toBeEnabled();
  });
});
