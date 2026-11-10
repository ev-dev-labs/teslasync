import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
import { COLOR } from '@/lib/colors';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';

const mockUseDriveScore = vi.mocked(useDriveScore);
const mockUseVehicles = vi.mocked(useVehicles);

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

type ScoreQuery = ReturnType<typeof useDriveScore>;

function qr(over: Partial<ScoreQuery> = {}): ScoreQuery {
  return {
    data: undefined, isLoading: false, error: null, isFetching: false,
    isStale: false, isError: false, dataUpdatedAt: Date.now(), refetch: vi.fn(), ...over,
  } as ScoreQuery;
}

function makeScore(over: Partial<DriveScore> = {}): DriveScore {
  return {
    overall: 87, efficiency: 90, smoothness: 82, speedDiscipline: 75,
    grade: 'B', totalDrives: 12, trend: 'up', ...over,
  };
}

function renderWidget(size: WidgetSize, vehicleId?: number, packId: PackId = 'classic') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const content = (pack: PackId) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PackBoundary requestedPackId={pack}>
          <DriveScoreGaugeWidget size={size} vehicleId={vehicleId} />
        </PackBoundary>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(content(packId));
  return { ...view, switchPack: (pack: PackId) => view.rerender(content(pack)) };
}

async function expectPresentation(container: HTMLElement, packId: PackId) {
  expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
  if (packId === 'classic') {
    expect(container.querySelector('[data-instrument-family]')).toBeNull();
  } else {
    await waitFor(() => expect(container.querySelector('[data-instrument-family="ring"]'))
      .toHaveAttribute('data-instrument-appearance', PACK_APPEARANCES[packId]));
  }
}

const COMPACT: WidgetSize = { cols: 1, rows: 1 };
const STANDARD: WidgetSize = { cols: 1, rows: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  mockUseVehicles.mockReturnValue({ data: [{ id: 1 }] } as ReturnType<typeof useVehicles>);
  mockUseDriveScore.mockReturnValue(qr({ data: undefined }));
});

describe('scoreColor', () => {
  it('uses the four score tiers and non-finite fallback', () => {
    expect(scoreColor(80)).toBe(COLOR.GOOD);
    expect(scoreColor(60)).toBe(COLOR.CYAN);
    expect(scoreColor(40)).toBe(COLOR.WARN);
    expect(scoreColor(39)).toBe(COLOR.BAD);
    expect(scoreColor(Number.NaN)).toBe(COLOR.BAD);
  });
});

describe.each(PACK_IDS)('DriveScoreGaugeWidget %s', packId => {
  async function renderForPack(size: WidgetSize, vehicleId?: number) {
    const view = renderWidget(size, vehicleId, packId);
    await expectPresentation(view.container, packId);
    return view;
  }

  it('retains the score, weekly context and three score rows without a fabricated grade', async () => {
    mockUseDriveScore.mockReturnValue(qr({ data: makeScore() }));
    await renderForPack(STANDARD);

    expect(screen.getByText('87')).toBeInTheDocument();
    expect(screen.getByText('this week')).toBeInTheDocument();
    expect(screen.getByText('Efficiency')).toBeInTheDocument();
    expect(screen.getByText('Smoothness')).toBeInTheDocument();
    expect(screen.getByText('Speed')).toBeInTheDocument();
    expect(screen.queryByText('B')).toBeNull();
    for (const [label, value] of [['Efficiency', '90'], ['Smoothness', '82'], ['Speed', '75']]) {
      const row = screen.getByRole('progressbar', { name: label });
      expect(row).toHaveAttribute('aria-valuenow', value);
      expect(row).toHaveAttribute('aria-valuemax', '100');
      expect(within(row).getByText(`${value}.00`)).toBeInTheDocument();
    }
    if (packId !== 'classic') expect(screen.getByText('/100')).toBeInTheDocument();
  });

  it('preserves zero readings and shows missing readings as unknown', async () => {
    mockUseDriveScore.mockReturnValue(qr({
      data: makeScore({ overall: 0, efficiency: 0, smoothness: undefined }),
    }));
    await renderForPack(STANDARD);

    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Smoothness')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Efficiency' })).toHaveAttribute('aria-valuenow', '0');
    const unknown = screen.getByRole('progressbar', { name: 'Smoothness' });
    expect(unknown).not.toHaveAttribute('aria-valuenow');
    expect(within(unknown).getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('No score yet')).toBeNull();
  });

  it('uses the compact layout without adding score rows', async () => {
    mockUseDriveScore.mockReturnValue(qr({ data: makeScore() }));
    await renderForPack(COMPACT);

    expect(screen.getByText('87')).toBeInTheDocument();
    expect(screen.queryByText('Efficiency')).toBeNull();
    expect(screen.queryByText('Smoothness')).toBeNull();
    expect(screen.queryByText('Speed')).toBeNull();
  });

  it.each([0, -1, undefined, Number.NaN])('shows an empty state when scored drive count is %s', totalDrives => {
    mockUseDriveScore.mockReturnValue(qr({
      data: makeScore({ overall: 0, efficiency: 0, smoothness: 0, speedDiscipline: 0, grade: 'F', totalDrives }),
    }));
    renderWidget(STANDARD, undefined, packId);

    const empty = screen.getByText('No score yet');
    expect(empty).toBeInTheDocument();
    expect(empty.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.queryByText('0')).toBeNull();
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY])('does not invent a gauge for an unknown overall score %s', async overall => {
    mockUseDriveScore.mockReturnValue(qr({ data: makeScore({ overall }) }));
    await renderForPack(STANDARD);
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByRole('progressbar', { name: 'Efficiency' })).toHaveAttribute('aria-valuenow', '90');
    expect(screen.queryByText(/NaN|Infinity/)).toBeNull();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('retains cached data, its warning and refresh through the freshness dot', async () => {
    const refetch = vi.fn();
    mockUseDriveScore.mockReturnValue(qr({
      data: makeScore(), error: new Error('offline'), isError: true, refetch,
    }));
    const { container } = await renderForPack(STANDARD);

    expect(screen.getByText('87')).toBeInTheDocument();
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'stale');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows loading instead of a fabricated empty score', () => {
    mockUseDriveScore.mockReturnValue(qr({ isLoading: true, isFetching: true, dataUpdatedAt: 0 }));
    const { container } = renderWidget(STANDARD, undefined, packId);
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('No score yet')).toBeNull();
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it('keeps initial errors retryable without claiming an empty score', () => {
    const refetch = vi.fn();
    mockUseDriveScore.mockReturnValue(qr({ isError: true, error: new Error('request failed'), dataUpdatedAt: 0, refetch }));
    const { container } = renderWidget(STANDARD, undefined, packId);
    expect(container.querySelector('[data-data-state]')).toHaveAttribute('data-data-state', 'initialFailure');
    expect(screen.queryByText('No score yet')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('keeps a retained score visible while refreshing', async () => {
    mockUseDriveScore.mockReturnValue(qr({ data: makeScore(), isFetching: true }));
    const { container } = await renderForPack(STANDARD);
    expect(screen.getByText('87')).toBeInTheDocument();
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('stale-refresh-warning')).toBeNull();
  });

  it('prefers the explicit vehicle and uses the first vehicle otherwise', () => {
    mockUseVehicles.mockReturnValue({ data: [{ id: 7 }] } as ReturnType<typeof useVehicles>);
    const { unmount } = renderWidget(STANDARD, 42, packId);
    expect(mockUseDriveScore).toHaveBeenCalledWith('42');
    unmount();
    mockUseVehicles.mockReturnValue({ data: [{ id: 7 }] } as ReturnType<typeof useVehicles>);
    renderWidget(STANDARD, undefined, packId);
    expect(mockUseDriveScore).toHaveBeenCalledWith('7');
  });
});

it('preserves the selected vehicle, retained score and refresh callback when switching packs', async () => {
  const refetch = vi.fn();
  mockUseDriveScore.mockReturnValue(qr({ data: makeScore(), error: new Error('refresh failed'), isError: true, refetch }));
  const view = renderWidget(STANDARD, 42);
  for (const packId of PACK_IDS) {
    view.switchPack(packId);
    await expectPresentation(view.container, packId);
    expect(screen.getByText('87')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(mockUseDriveScore).toHaveBeenLastCalledWith('42');
  }
  fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
  expect(refetch).toHaveBeenCalledOnce();
});
