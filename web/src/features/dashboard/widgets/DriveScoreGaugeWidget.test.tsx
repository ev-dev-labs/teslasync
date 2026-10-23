import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) => {
      const base = typeof fallback === 'string' ? fallback : key;
      const replacements = opts?.replace;
      return replacements && typeof replacements === 'object'
        ? base.replace(/{{(\w+)}}/g, (_match, name: string) =>
            name in replacements ? String((replacements as Record<string, unknown>)[name]) : `{{${name}}}`,
          )
        : base;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));
vi.mock('@/api/hooks/useDriving', () => ({ useDriveScore: vi.fn() }));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vi.fn() }));

import DriveScoreGaugeWidget, { scoreColor } from './DriveScoreGaugeWidget';
import { useDriveScore } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import type { DriveScore } from '@/types/driving';
import type { WidgetSize } from './types';

const mockUseDriveScore = vi.mocked(useDriveScore);
const mockUseVehicles = vi.mocked(useVehicles);

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function qr(over: Record<string, unknown> = {}) {
  return {
    data: undefined, isLoading: false, error: null, isFetching: false,
    isStale: false, isError: false, dataUpdatedAt: Date.now(), refetch: vi.fn(), ...over,
  };
}

function makeScore(over: Partial<DriveScore> = {}): DriveScore {
  return {
    overall: 87, efficiency: 90, smoothness: 82, speedDiscipline: 75,
    grade: 'B', totalDrives: 12, trend: 'up', ...over,
  };
}

function renderWidget(size: WidgetSize, vehicleId?: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><DriveScoreGaugeWidget size={size} vehicleId={vehicleId} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

const COMPACT: WidgetSize = { cols: 1, rows: 1 };
const STANDARD: WidgetSize = { cols: 1, rows: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  mockUseVehicles.mockReturnValue({ data: [{ id: 1 }] } as any);
  mockUseDriveScore.mockReturnValue(qr({ data: undefined }));
});

describe('scoreColor', () => {
  it('uses the four score tiers and non-finite fallback', () => {
    expect(scoreColor(80)).toBe('#10b981');
    expect(scoreColor(60)).toBe('#22d3ee');
    expect(scoreColor(40)).toBe('#f59e0b');
    expect(scoreColor(39)).toBe('#ef4444');
    expect(scoreColor(Number.NaN)).toBe('#ef4444');
  });
});

it('renders the After-card gauge and three score rows without a fabricated grade', () => {
  mockUseDriveScore.mockReturnValue(qr({ data: makeScore() }));
  renderWidget(STANDARD);

  expect(screen.getByText('87')).toBeInTheDocument();
  expect(screen.getByText('this week')).toBeInTheDocument();
  expect(screen.getByText('Efficiency')).toBeInTheDocument();
  expect(screen.getByText('Smoothness')).toBeInTheDocument();
  expect(screen.getByText('Speed')).toBeInTheDocument();
  expect(screen.queryByText('B')).toBeNull();
  expect(screen.getAllByRole('progressbar')).toHaveLength(3);
});

it('preserves zero readings and shows missing readings as unknown', () => {
  mockUseDriveScore.mockReturnValue(qr({
    data: makeScore({ overall: 0, efficiency: 0, smoothness: undefined }),
  }));
  renderWidget(STANDARD);

  expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText('Smoothness')).toBeInTheDocument();
  expect(screen.queryByText('No score yet')).toBeNull();
});

it('uses the compact After-card layout only for compact size', () => {
  mockUseDriveScore.mockReturnValue(qr({ data: makeScore() }));
  renderWidget(COMPACT);

  expect(screen.getByText('87')).toBeInTheDocument();
  expect(screen.queryByText('Efficiency')).toBeNull();
  expect(screen.queryByText('Smoothness')).toBeNull();
  expect(screen.queryByText('Speed')).toBeNull();
});

it('shows an empty state only when no scored drives are returned', () => {
  mockUseDriveScore.mockReturnValue(qr({
    data: makeScore({ overall: 0, efficiency: 0, smoothness: 0, speedDiscipline: 0, grade: 'F', totalDrives: 0 }),
  }));
  renderWidget(STANDARD);

  const empty = screen.getByText('No score yet');
  expect(empty).toBeInTheDocument();
  expect(empty.closest('[role="status"]')).not.toBeNull();
  expect(screen.queryByRole('meter')).toBeNull();
});

it('does not invent a gauge for a partial response', () => {
  mockUseDriveScore.mockReturnValue(qr({ data: makeScore({ overall: undefined }) }));
  renderWidget(STANDARD);
  expect(screen.queryByRole('meter')).toBeNull();
  expect(screen.getByText('—')).toBeInTheDocument();
});

it('retains cached data and exposes refresh through the freshness dot', () => {
  const refetch = vi.fn();
  mockUseDriveScore.mockReturnValue(qr({
    data: makeScore(), error: new Error('offline'), isError: true, refetch,
  }));
  renderWidget(STANDARD);

  expect(screen.getByText('87')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
  expect(refetch).toHaveBeenCalledTimes(1);
});

it('prefers the explicit vehicle and uses the first vehicle otherwise', () => {
  mockUseVehicles.mockReturnValue({ data: [{ id: 7 }] } as any);
  const { unmount } = renderWidget(STANDARD, 42);
  expect(mockUseDriveScore).toHaveBeenCalledWith('42');
  unmount();
  mockUseVehicles.mockReturnValue({ data: [{ id: 7 }] } as any);
  renderWidget(STANDARD);
  expect(mockUseDriveScore).toHaveBeenCalledWith('7');
});
