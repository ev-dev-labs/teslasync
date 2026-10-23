import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SignalCatalogRow, SignalsCatalogResponse, SignalObservation } from '@/types/signals';
import type { WidgetSize } from './types';

const { catalogMock, observationsMock, vehiclesMock } = vi.hoisted(() => ({
  catalogMock: vi.fn(),
  observationsMock: vi.fn(),
  vehiclesMock: vi.fn(),
}));

vi.mock('@/api/hooks/useTelemetry', () => ({
  useSignalCatalog: () => catalogMock(),
  useSignalObservations: (id: unknown) => observationsMock(id),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => vehiclesMock(),
}));
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const { createInstance } = await vi.importActual<typeof import('i18next')>('i18next');
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } });
  return { ...actual, useTranslation: () => ({ t: i18n.getFixedT('en'), i18n }) };
});
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatTime: (value: unknown) => String(value) }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: false, durationMs: 250 }),
}));

import SignalCatalogWidget from './SignalCatalogWidget';

const NOW = '2026-07-05T12:00:00.000Z';
const makeEntry = (over: Partial<SignalCatalogRow> = {}): SignalCatalogRow => ({
  field: 'BatteryLevel',
  value_kind: 'ValueKindFloat',
  destination: 'battery',
  last_seen_at: null,
  sample_count_total: null,
  vehicle_count: null,
  ...over,
});
const envelope = (signals: SignalCatalogRow[]): SignalsCatalogResponse => ({ signals, generated_at: NOW });
const STANDARD: WidgetSize = { cols: 2, rows: 4 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };

function setCatalog(over: {
  data?: SignalsCatalogResponse;
  isLoading?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  dataUpdatedAt?: number;
  refetch?: () => void;
} = {}) {
  catalogMock.mockReturnValue({
    data: undefined,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.parse(NOW),
    refetch: vi.fn(),
    ...over,
  });
}
function renderWidget(size = STANDARD, vehicleId?: number) {
  return render(<MemoryRouter><SignalCatalogWidget size={size} vehicleId={vehicleId} /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vehiclesMock.mockReturnValue({ data: [{ id: 7, display_name: 'Car' }] });
  observationsMock.mockReturnValue({ data: [] as SignalObservation[] });
  setCatalog({ data: envelope([makeEntry()]) });
});

describe('SignalCatalogWidget After redesign', () => {
  it('renders category rows with served counts and no invented units or descriptions', () => {
    setCatalog({ data: envelope([
      makeEntry({ destination: 'battery', sample_count_total: 1200000, vehicle_count: 2 }),
      makeEntry({ field: 'ChargeRate', destination: 'battery', sample_count_total: 100000 }),
    ]) });
    renderWidget();

    expect(screen.getByText('battery')).toBeInTheDocument();
    expect(screen.getAllByText('2 signals')).not.toHaveLength(0);
    expect(screen.getByText('1,300,000 obs')).toBeInTheDocument();
    expect(screen.queryByText('%')).not.toBeInTheDocument();
    expect(screen.queryByText('Unit and description are not provided by this catalog.')).not.toBeInTheDocument();
  });

  it('uses unknown observation copy when aggregate totals are absent', () => {
    setCatalog({ data: envelope([makeEntry({ destination: 'drive', sample_count_total: null })]) });
    renderWidget();
    expect(screen.getByText('drive')).toBeInTheDocument();
    expect(screen.getByText('Observations unavailable')).toBeInTheDocument();
  });

  it('searches identities and destinations while keeping category presentation', () => {
    setCatalog({ data: envelope([
      makeEntry({ field: 'BatteryLevel', destination: 'battery', value_kind: 'ValueKindFloat' }),
      makeEntry({ field: 'VehicleSpeed', destination: 'drive', value_kind: 'ValueKindDouble' }),
    ]) });
    renderWidget();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search signals' }), { target: { value: 'drive' } });
    expect(screen.getByText('drive')).toBeInTheDocument();
    expect(screen.queryByText('battery')).not.toBeInTheDocument();
  });

  it('shows honest empty, compact, and initial error states', () => {
    const empty = renderWidget();
    setCatalog({ data: envelope([]) });
    empty.rerender(<MemoryRouter><SignalCatalogWidget size={STANDARD} /></MemoryRouter>);
    expect(screen.getByText('No signals in catalog')).toBeInTheDocument();

    setCatalog({ data: envelope([makeEntry(), makeEntry({ field: 'VehicleSpeed' })]) });
    empty.rerender(<MemoryRouter><SignalCatalogWidget size={COMPACT} /></MemoryRouter>);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Signals available')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows catalog source failure and preserves manual refresh', () => {
    const refetch = vi.fn();
    setCatalog({ isError: true, data: undefined, refetch });
    renderWidget();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Refresh/i })).toBeInTheDocument();
  });

  it('uses a footer total and Browse link to the signals workspace', () => {
    setCatalog({ data: envelope([
      makeEntry({ destination: 'battery' }),
      makeEntry({ destination: 'drive', field: 'VehicleSpeed' }),
    ]) });
    renderWidget();
    expect(screen.getByText('2 signals')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Browse/i })).toHaveAttribute('href', '/signals');
  });
});
