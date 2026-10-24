import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

const mockVehicles = vi.mocked(useVehicles);
const mockRegen = vi.mocked(useRegenEfficiency);
const STANDARD: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };

function qr(over: Record<string, unknown> = {}): never {
  return {
    data: undefined, isLoading: false, isError: false, error: null,
    isFetching: false, isStale: false, dataUpdatedAt: Date.now(), refetch: vi.fn(),
    ...over,
  } as never;
}

function makeData(over: Partial<RegenEfficiencyData> = {}): RegenEfficiencyData {
  return {
    vehicleId: 1, totalRegenWh: 1234, totalDriveWh: 5000,
    regenRatio: 24.7, monthlyAvgRegen: 56, freeCharges: 7,
    monthlySummary: [], drives: [], batteryCapacityWh: 75000, capacitySource: 'default',
    ...over,
  };
}

function renderWidget(size: WidgetSize, props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RegenEfficiencyWidget size={size} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockVehicles.mockReturnValue({ data: [{ id: 7 }] } as never);
  mockRegen.mockReturnValue(qr({ data: makeData() }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RegenEfficiencyWidget redesign', () => {
  it('matches the After card with one headline and two source-backed stats', () => {
    renderWidget(STANDARD);

    expect(screen.getByRole('heading', { name: 'Regen braking', level: 3 })).toBeVisible();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();
    expect(screen.getByText('Energy recovered')).toBeInTheDocument();
    expect(screen.getByText('Total recovered')).toBeInTheDocument();
    expect(screen.getByText('1234 Wh')).toBeInTheDocument();
    expect(screen.getByText('Drive energy')).toBeInTheDocument();
    expect(screen.getByText('5000 Wh')).toBeInTheDocument();
  });

  it('uses the compact card and keeps no duplicate gauge or evidence footer', () => {
    const { container } = renderWidget(COMPACT);
    expect(screen.getByRole('heading', { name: 'Regen braking', level: 3 })).toBeVisible();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(container.querySelector('[role="meter"]')).toBeNull();
    expect(screen.queryByTestId('regen-efficiency-operational-brief')).toBeNull();
  });

  it('does not scale or fabricate a missing recovery percentage', () => {
    mockRegen.mockReturnValue(qr({ data: makeData({ regenRatio: undefined as unknown as number }) }));
    const { container } = renderWidget(STANDARD);

    expect(container.querySelector('[role="meter"]')).toBeNull();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('2500%')).toBeNull();
  });

  it('keeps whole-number precision and signed source energy', () => {
    mockRegen.mockReturnValue(qr({ data: makeData({ regenRatio: 0, totalRegenWh: -1234 }) }));
    renderWidget(STANDARD);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('-1234 Wh')).toBeInTheDocument();
    expect(units.formatEnergy).toHaveBeenCalledWith(5000);
  });

  it('shows a useful empty state and refreshes independently', () => {
    const refetch = vi.fn();
    mockRegen.mockReturnValue(qr({ data: undefined, refetch }));
    renderWidget(STANDARD);
    expect(screen.getByText('No regen data')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces loading and fatal error states without adding labels or placeholders', () => {
    mockRegen.mockReturnValue(qr({ isLoading: true, isFetching: true }));
    const { container } = renderWidget(STANDARD);
    expect(container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();

    cleanup();
    mockRegen.mockReturnValue(qr({ isError: true, error: new Error('regen down') }));
    renderWidget(STANDARD);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No regen data')).toBeNull();
  });

  it('uses the explicit vehicle and disables the query without a vehicle', () => {
    mockVehicles.mockReturnValue({ data: [{ id: 7 }, { id: 9 }] } as never);
    renderWidget(STANDARD, { vehicleId: 42 });
    expect(mockRegen).toHaveBeenCalledWith('42');

    cleanup();
    mockVehicles.mockReturnValue({ data: [] } as never);
    mockRegen.mockReturnValue(qr({ data: undefined }));
    renderWidget(STANDARD);
    expect(mockRegen).toHaveBeenCalledWith(undefined);
    expect(screen.getByText('No regen data')).toBeInTheDocument();
  });
});
