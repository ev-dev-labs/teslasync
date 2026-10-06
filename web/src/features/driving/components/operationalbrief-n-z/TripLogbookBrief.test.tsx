import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Drive } from '@/types/driving';
import type { UnitPref } from '@/lib/unitConversion';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import type { CategoryMap } from '../../lib/tripLogbook';
import TripLogbookPage from '../../pages/TripLogbookPage';
import { makeBriefDrive as drive } from './drivingBrief.fixtures';

const h = vi.hoisted(() => ({
  drives: undefined as Drive[] | undefined,
  categories: {} as CategoryMap,
  loading: false,
  success: true,
  setCategory: vi.fn(),
  setCategories: vi.fn(),
  setRatePerKm: vi.fn(),
  refetch: vi.fn(),
  units: {
    distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
    energy: 'kWh', duration: 'h', power: 'kW', precision: 2, locale: 'en-US',
  } as UnitPref,
}));
vi.mock('@/api/hooks/useDriving', () => ({
  useDrives: () => ({
    data: h.drives, isLoading: h.loading, isPending: h.loading, isSuccess: h.success,
    isError: false, error: null, isFetching: h.loading, dataUpdatedAt: h.drives ? 1 : 0,
    refetch: h.refetch,
  }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({ vehicleId: 7 }) }));
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({ start: '2026-07-01', end: '2026-07-31' }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: h.units,
    formatDistance: (raw: number) => `${convertDistanceFromSI(raw, h.units.distance).toFixed(2)} ${h.units.distance}`,
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$', formatCurrency: (raw: number) => `$${raw.toFixed(2)}` }),
}));
vi.mock('../../hooks/useTripLogbook', () => ({
  useTripLogbook: () => ({
    categories: h.categories, ratesPerKm: { business: 0.5, commute: 0.2, personal: 0 },
    setCategory: h.setCategory, setCategories: h.setCategories, setRatePerKm: h.setRatePerKm,
  }),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={client}>
    <TripLogbookPage />
  </QueryClientProvider></MemoryRouter>);
}
function value(id: string) {
  return screen.getByTestId('trip-logbook-brief')
    .querySelector(`[data-operational-metric="${id}"] [data-operational-value]`);
}
beforeEach(() => {
  vi.clearAllMocks();
  h.drives = Array.from({ length: 50 }, (_, index) => drive(index + 1));
  h.categories = {};
  h.loading = false;
  h.success = true;
  h.units = { ...h.units, distance: 'km' };
});

describe('TripLogbook — operational summary preserves classifications and reimbursement', () => {
  it('renders exact unclassified 50/total 50 with real measured category zeros', () => {
    renderPage();
    expect(value('unclassified')).toHaveTextContent('50/50');
    expect(value('business-distance')).toHaveTextContent('0.00 km');
    expect(value('business-amount')).toHaveTextContent('$0.00');
    expect(value('business-count')).toHaveTextContent('0');
    expect(screen.getByRole('combobox', { name: 'Filter by category' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Reimbursement rate for Business' })).toBeInTheDocument();
  });

  it('retains each category distance, currency amount and drive count independently', () => {
    h.drives = [drive(1, 1000), drive(2, 2000), drive(3, 3000)];
    h.categories = { 1: 'business', 2: 'commute', 3: 'personal' };
    renderPage();
    expect(value('business-distance')).toHaveTextContent('1.00 km');
    expect(value('business-amount')).toHaveTextContent('$0.50');
    expect(value('business-count')).toHaveTextContent('1');
    expect(value('commute-distance')).toHaveTextContent('2.00 km');
    expect(value('commute-amount')).toHaveTextContent('$0.40');
    expect(value('personal-distance')).toHaveTextContent('3.00 km');
    expect(value('personal-amount')).toHaveTextContent('$0.00');
    expect(value('unclassified')).toHaveTextContent('0/3');
    fireEvent.click(within(screen.getByTestId('trip-logbook-brief')).getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getAllByText('Existing reimbursement rate × drive distance; rates remain stored per kilometre.')).toHaveLength(3);
  });

  it('keeps rate editing and category table filtering without changing summary denominators', () => {
    renderPage();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Reimbursement rate for Business' }), { target: { value: '0.75' } });
    expect(h.setRatePerKm).toHaveBeenCalledWith('business', 0.75);
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by category' }), { target: { value: 'business' } });
    expect(value('unclassified')).toHaveTextContent('50/50');
    expect(screen.getByText('No drives in this category yet.')).toBeInTheDocument();
  });

  it('keeps loading metrics unresolved rather than misrepresenting an unavailable source as zero drives', () => {
    h.drives = undefined;
    h.loading = true;
    h.success = false;
    renderPage();
    const brief = screen.getByTestId('trip-logbook-brief');
    expect(brief).toHaveAttribute('aria-busy', 'true');
    expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(brief.querySelector('[data-operational-metric="unclassified"]')).toHaveAttribute('data-value-state', 'missing');
  });
});
