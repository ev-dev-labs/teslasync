import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fb?: unknown, opts?: unknown) => {
      let base = typeof fb === 'string' ? fb : key;
      const options = opts && typeof opts === 'object' ? opts as Record<string, unknown> : undefined;
      if (options) base = base.replace(/{{\s*(\w+)\s*}}/g, (_m, name: string) =>
        name in options && options[name] != null ? String(options[name]) : `{{${name}}}`,
      );
      return base;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: unknown }) => <>{children as never}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/api/hooks/useVehicles', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicles')>();
  return { ...actual, useVehicles: vi.fn() };
});
vi.mock('@/api/hooks/useDriving', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useDriving')>();
  return { ...actual, useRegenEfficiency: vi.fn() };
});

const units = vi.hoisted(() => ({
  formatEnergy: vi.fn((value?: number | null) => value == null ? '—' : `${value} Wh`),
}));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => units }));

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

import RegenEfficiencyWidget from './RegenEfficiencyWidget';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useRegenEfficiency } from '@/api/hooks/useDriving';
import type { RegenEfficiencyData } from '@/types/driving';
import type { WidgetProps, WidgetSize } from './types';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';

const mockVehicles = vi.mocked(useVehicles);
const mockRegen = vi.mocked(useRegenEfficiency);
const STANDARD: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };

type RegenQuery = ReturnType<typeof useRegenEfficiency>;

function qr(over: Partial<RegenQuery> = {}): RegenQuery {
  return {
    data: undefined, isLoading: false, isError: false, error: null,
    isFetching: false, isStale: false, dataUpdatedAt: Date.now(), refetch: vi.fn(),
    ...over,
  } as RegenQuery;
}

function makeData(over: Partial<RegenEfficiencyData> = {}): RegenEfficiencyData {
  return {
    vehicleId: 1, totalRegenWh: 1234, totalDriveWh: 5000,
    regenRatio: 24.7, monthlyAvgRegen: 56, freeCharges: 7,
    monthlySummary: [], drives: [], batteryCapacityWh: 75000, capacitySource: 'default',
    ...over,
  };
}

async function renderWidget(size: WidgetSize, props: Partial<WidgetProps> = {}, packId: PackId = 'classic') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={packId}>
          <RegenEfficiencyWidget size={size} {...props} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  if (packId !== 'classic') {
    await waitFor(() => {
      const state = view.container.querySelector('[data-widget-pack]')?.getAttribute('data-data-state');
      if (state !== 'initial' && state !== 'initialFailure') {
        expect(view.container.querySelector(
          `[data-instrument-family="ring"][data-instrument-appearance="${PACK_APPEARANCES[packId]}"]`,
        )).not.toBeNull();
      }
    });
  }
  return view;
}

beforeEach(() => {
  mockVehicles.mockReturnValue({ data: [{ id: 7 }] } as ReturnType<typeof useVehicles>);
  mockRegen.mockReturnValue(qr({ data: makeData() }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe.each(PACK_IDS)('RegenEfficiencyWidget %s', packId => {
  it('keeps one headline and two source-backed stats', async () => {
    const { container } = await renderWidget(STANDARD, {}, packId);

    expect(screen.getByRole('heading', { name: 'Regen braking', level: 3 })).toBeVisible();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();
    expect(screen.getByText('Energy recovered')).toBeInTheDocument();
    expect(screen.getByText('Total recovered')).toBeInTheDocument();
    expect(screen.getByText('1234 Wh')).toBeInTheDocument();
    expect(screen.getByText('Drive energy')).toBeInTheDocument();
    expect(screen.getByText('5000 Wh')).toBeInTheDocument();
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'ok');
    expect(mockRegen).toHaveBeenCalledWith('7', undefined, undefined, undefined, undefined);
    expect(units.formatEnergy).toHaveBeenCalledWith(1234);
    expect(units.formatEnergy).toHaveBeenCalledWith(5000);
  });

  it('keeps one headline and both supporting stats in the compact card', async () => {
    const { container } = await renderWidget(COMPACT, {}, packId);
    expect(screen.getByRole('heading', { name: 'Regen braking', level: 3 })).toBeVisible();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('1234 Wh')).toBeInTheDocument();
    expect(screen.getByText('5000 Wh')).toBeInTheDocument();
    if (packId === 'classic') expect(container.querySelector('[role="meter"]')).toBeNull();
    expect(screen.queryByTestId('regen-efficiency-operational-brief')).toBeNull();
  });

  it('does not scale or fabricate a missing recovery percentage', async () => {
    mockRegen.mockReturnValue(qr({ data: makeData({ regenRatio: undefined as unknown as number }) }));
    const { container } = await renderWidget(STANDARD, {}, packId);

    expect(container.querySelector('[role="meter"]')).toBeNull();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(container.querySelector('[aria-valuenow]')).toBeNull();
    expect(screen.queryByText('2500%')).toBeNull();
  });

  it('keeps whole-number precision and signed source energy', async () => {
    mockRegen.mockReturnValue(qr({ data: makeData({ regenRatio: 0, totalRegenWh: -1234 }) }));
    await renderWidget(STANDARD, {}, packId);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('-1234 Wh')).toBeInTheDocument();
    expect(units.formatEnergy).toHaveBeenCalledWith(5000);
  });

  it('shows a useful empty state and refreshes independently', async () => {
    const refetch = vi.fn();
    mockRegen.mockReturnValue(qr({ data: undefined, refetch }));
    const { container } = await renderWidget(STANDARD, {}, packId);
    expect(screen.getByText('No regen data')).toBeInTheDocument();
    expect(screen.queryByText('0')).toBeNull();
    expect(container.querySelector('[aria-valuenow]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces loading and fatal error states without adding labels or placeholders', async () => {
    mockRegen.mockReturnValue(qr({ isLoading: true, isFetching: true }));
    const { container } = await renderWidget(STANDARD, {}, packId);
    expect(container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', 'true');

    cleanup();
    mockRegen.mockReturnValue(qr({ isError: true, error: new Error('regen down') }));
    await renderWidget(STANDARD, {}, packId);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No regen data')).toBeNull();
  });

  it('uses the explicit vehicle and disables the query without a vehicle', async () => {
    mockVehicles.mockReturnValue({ data: [{ id: 7 }, { id: 9 }] } as ReturnType<typeof useVehicles>);
    await renderWidget(STANDARD, { vehicleId: 42 }, packId);
    expect(mockRegen).toHaveBeenCalledWith('42', undefined, undefined, undefined, undefined);

    cleanup();
    mockVehicles.mockReturnValue({ data: [] } as ReturnType<typeof useVehicles>);
    mockRegen.mockReturnValue(qr({ data: undefined }));
    await renderWidget(STANDARD, {}, packId);
    expect(mockRegen).toHaveBeenCalledWith(undefined, undefined, undefined, undefined, undefined);
    expect(screen.getByText('No regen data')).toBeInTheDocument();
  });

  it('passes the configured range to the regen query', async () => {
    await renderWidget(STANDARD, { vehicleId: 42, config: { timeRange: '90d' } }, packId);
    expect(mockRegen).toHaveBeenCalledWith('42', undefined, undefined, undefined, '90d');
  });

  it.each([
    { isFetching: true, fetchStatus: 'fetching' as const, busy: 'true', stale: false },
    { isError: true, error: new Error('refresh failed'), busy: 'false', stale: true },
    { fetchStatus: 'paused' as const, busy: 'false', stale: true },
  ])('retains content and source trust for $fetchStatus / $isError', async ({ busy, stale, ...state }) => {
    const refetch = vi.fn();
    mockRegen.mockReturnValue(qr({ data: makeData(), refetch, ...state }));
    const { container } = await renderWidget(STANDARD, {}, packId);

    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('1234 Wh')).toBeInTheDocument();
    expect(screen.getByText('5000 Wh')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', busy);
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', stale ? 'stale' : 'ok');
    if (stale) {
      expect(screen.getByTestId('stale-refresh-warning')).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
      expect(refetch).toHaveBeenCalledTimes(1);
    } else {
      expect(screen.queryByTestId('stale-refresh-warning')).toBeNull();
    }
  });

  it('keeps invalid observations unknown instead of reporting measured zero', async () => {
    mockRegen.mockReturnValue(qr({
      data: makeData({ regenRatio: Number.NaN, totalRegenWh: Infinity, totalDriveWh: -Infinity }),
    }));
    const { container } = await renderWidget(STANDARD, {}, packId);

    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText(/NaN|Infinity/)).toBeNull();
    expect(container.querySelector('[aria-valuenow]')).toBeNull();
    expect(units.formatEnergy).not.toHaveBeenCalled();
  });
});
