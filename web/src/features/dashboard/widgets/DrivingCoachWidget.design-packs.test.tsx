import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DrivingCoachData } from '@/types/driving';
import DrivingCoachWidget from './DrivingCoachWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES } from './designPacks/types';
import type { WidgetSize } from './types';

const { useDrivingCoachMock, useVehiclesMock, refetch } = vi.hoisted(() => ({
  useDrivingCoachMock: vi.fn(),
  useVehiclesMock: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('@/api/hooks/useDriving', () => ({
  useDrivingCoach: (...args: unknown[]) => useDrivingCoachMock(...args),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => useVehiclesMock(),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      return text.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

function coachData(): DrivingCoachData {
  return {
    overall_score: 82,
    efficiency_wh_km: 200,
    best_efficiency_wh_km: 150,
    total_drives_analyzed: 12,
    style_breakdown: {},
    patterns: { hard_accel_pct: 0, hard_brake_pct: null, highway_pct: 0, short_trip_pct: 0, cold_start_pct: 0 },
    weekly_trend: [],
    per_drive_scores: [],
    recommendations: [
      { category: 'Smooth acceleration', tip: 'Ease off the accelerator pedal', impact: 'high' },
      { category: 'Efficiency', tip: 'Maintain a steady pace', impact: 'medium' },
      { category: 'Review', tip: 'Compare recent drives', impact: 'low' },
      { category: 'Fourth recommendation', tip: 'Outside the existing three-tip cap', impact: 'low' },
    ],
  };
}

function queryResult(data: DrivingCoachData | undefined = coachData()) {
  return {
    data,
    isLoading: false,
    error: null as Error | null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch,
  };
}

function widget(packId: string, size: WidgetSize = { cols: 2, rows: 2 }, vehicleId = 42) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <DrivingCoachWidget size={size} vehicleId={vehicleId} />
      </PackBoundary>
    </MemoryRouter>
  );
}

async function expectPresentation(container: HTMLElement, appearance: string) {
  await waitFor(() => expect(
    container.querySelector(`[data-widget-family="list"][data-widget-appearance="${appearance}"]`),
  ).not.toBeNull());
}

beforeEach(() => {
  vi.clearAllMocks();
  useVehiclesMock.mockReturnValue({ data: [{ id: 7 }] });
  useDrivingCoachMock.mockReturnValue(queryResult());
});

describe.each(Object.entries(PACK_APPEARANCES))('Driving coach %s (%s)', (packId, appearance) => {
  it('uses the real recommendation headline, remaining tips and refresh action without a fabricated score', async () => {
    const { container } = render(widget(packId));
    await expectPresentation(container, appearance);

    expect(screen.getByRole('heading', { name: 'Driving coach', level: 3 })).toBeVisible();
    expect(screen.getByText('Suggestion')).toBeVisible();
    expect(screen.getByText('Smooth acceleration')).toBeVisible();
    expect(screen.getByText('Ease off the accelerator pedal')).toBeVisible();
    expect(screen.getByText('Efficiency')).toBeVisible();
    expect(screen.getByText('Maintain a steady pace')).toBeVisible();
    expect(screen.getByText('Review')).toBeVisible();
    expect(screen.getByText('Compare recent drives')).toBeVisible();
    expect(screen.queryByText('Fourth recommendation')).not.toBeInTheDocument();
    expect(screen.queryByText(/Potential savings|\/ 100/)).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(container.querySelector('[data-widget-family="list"] svg.lucide-lightbulb')).not.toBeNull();
    expect(useDrivingCoachMock).toHaveBeenCalledTimes(1);
    expect(useDrivingCoachMock).toHaveBeenCalledWith('42');
    expect(useVehiclesMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('preserves the compact single-tip branch', async () => {
    const { container } = render(widget(packId, { cols: 1, rows: 1 }));
    await expectPresentation(container, appearance);
    expect(screen.getByText('Smooth acceleration')).toBeVisible();
    expect(screen.getByText('Ease off the accelerator pedal')).toBeVisible();
    expect(screen.queryByText('Efficiency')).not.toBeInTheDocument();
    expect(screen.queryByText('Review')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Driving coach', level: 3 })).toBeVisible();
  });

  it('keeps the empty source visible without illustrative advice or a zero reading', async () => {
    useDrivingCoachMock.mockReturnValue(queryResult({ ...coachData(), recommendations: [] }));
    const { container } = render(widget(packId));
    await expectPresentation(container, appearance);
    expect(screen.getByText('No tips available')).toBeVisible();
    expect(screen.queryByText('Suggestion')).not.toBeInTheDocument();
    expect(screen.queryByText('Smooth acceleration')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });
});

it('preserves the complete Classic body before and after production pack selection', async () => {
  const view = render(widget('classic'));
  expect(view.container.querySelector('[data-widget-appearance]')).toBeNull();
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
  expect(screen.queryByText('Suggestion')).not.toBeInTheDocument();

  for (const [packId, appearance] of Object.entries(PACK_APPEARANCES)) {
    view.rerender(widget(packId));
    await expectPresentation(view.container, appearance);
    expect(screen.getByText('Smooth acceleration')).toBeVisible();
    expect(screen.getByText('Compare recent drives')).toBeVisible();
  }

  view.rerender(widget('classic'));
  expect(view.container.querySelector('[data-widget-appearance]')).toBeNull();
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
  expect(screen.getByText('Ease off the accelerator pedal')).toBeVisible();
  expect(screen.getByText('Maintain a steady pace')).toBeVisible();
  expect(screen.getByText('Compare recent drives')).toBeVisible();
  expect(screen.queryByText('Fourth recommendation')).not.toBeInTheDocument();
});

it('uses the original Classic compact recovery for an unknown pack', () => {
  const { container } = render(widget('unrecognized-pack', { cols: 1, rows: 1 }));
  expect(container.querySelector('[data-widget-pack="classic"]')).not.toBeNull();
  expect(container.querySelector('[data-widget-appearance]')).toBeNull();
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  expect(screen.getByText('Smooth acceleration')).toBeVisible();
  expect(screen.queryByText('Efficiency')).not.toBeInTheDocument();
});

it.each(Object.entries(PACK_APPEARANCES))('%s retains the selected vehicle and all tips with a nonblocking warning after a failed refresh', async (packId, appearance) => {
  useDrivingCoachMock.mockReturnValue({
    ...queryResult(),
    error: new Error('Coach refresh failed'),
    isError: true,
    isStale: true,
  });
  const { container } = render(widget(packId, { cols: 2, rows: 2 }, 9));
  await expectPresentation(container, appearance);
  expect(container.querySelector('[data-data-state="stale"]')).not.toBeNull();
  expect(screen.getByText('Smooth acceleration')).toBeVisible();
  expect(screen.getByText('Compare recent drives')).toBeVisible();
  expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('Previously loaded data remains visible');
  expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
  expect(useDrivingCoachMock).toHaveBeenCalledWith('9');
  fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
  expect(refetch).toHaveBeenCalledOnce();
});

it.each(Object.entries(PACK_APPEARANCES))('%s shows missing coach data honestly in a compact production presentation', async (packId, appearance) => {
  useDrivingCoachMock.mockReturnValue({ ...queryResult(), data: undefined, dataUpdatedAt: 0 });
  const { container } = render(widget(packId, { cols: 1, rows: 1 }));
  await expectPresentation(container, appearance);
  expect(screen.getByText('No tips available')).toBeVisible();
  expect(screen.queryByText('0')).not.toBeInTheDocument();
  expect(screen.queryByText('Suggestion')).not.toBeInTheDocument();
});

it.each(Object.entries(PACK_APPEARANCES))('%s retains the recommendations but prevents a second refresh while a request is in flight', async (packId, appearance) => {
  useDrivingCoachMock.mockReturnValue({ ...queryResult(), isFetching: true });
  const { container } = render(widget(packId));
  await expectPresentation(container, appearance);
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(screen.getByText('Smooth acceleration')).toBeVisible();
  expect(screen.getByText('Compare recent drives')).toBeVisible();
  const refresh = screen.getByRole('button', { name: /refresh/i });
  expect(refresh).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(refresh);
  expect(refetch).not.toHaveBeenCalled();
});

it.each(Object.entries(PACK_APPEARANCES))('%s keeps the source shell busy during initial loading and exposes retry on fatal failure', async (packId) => {
  useDrivingCoachMock.mockReturnValue({ ...queryResult(), data: undefined, isLoading: true, dataUpdatedAt: 0 });
  const view = render(widget(packId));
  expect(view.container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(screen.getByRole('heading', { name: 'Driving coach', level: 3 })).toBeVisible();
  expect(screen.queryByText('Smooth acceleration')).not.toBeInTheDocument();

  useDrivingCoachMock.mockReturnValue({
    ...queryResult(),
    data: undefined,
    error: new Error('Coach unavailable'),
    isError: true,
    dataUpdatedAt: 0,
  });
  view.rerender(widget(packId));
  expect(await screen.findByText("Can't reach server")).toBeVisible();
  expect(screen.queryByText('Suggestion')).not.toBeInTheDocument();
  expect(screen.queryByText('Smooth acceleration')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /try again|retry/i }));
  expect(refetch).toHaveBeenCalledOnce();
});
