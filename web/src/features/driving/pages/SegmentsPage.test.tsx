import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import type { SegmentSummary } from '@/api/hooks/useSegments';

const state = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  segments: [] as SegmentSummary[],
  selectedIds: [] as Array<number | null>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? '')),
  }),
}));

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: state.vehicleId }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatDistance: (meters: number) => `${meters} m` }),
}));
vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div>Vehicle select</div>,
}));
vi.mock('@/components/layout', () => ({
  PageContainer: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/api/hooks/useSegments', () => ({
  useSegments: () => ({
    data: { segments: state.segments },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSegmentLeaderboard: (id: number | null) => {
    state.selectedIds.push(id);
    return {
      data: id == null ? undefined : {
        segment: { id, name: `Route ${id}` },
        by_time: [],
        by_efficiency: [],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    };
  },
  useSegmentGhost: () => ({
    data: undefined,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import SegmentsPage from './SegmentsPage';

const segment = (id: number): SegmentSummary => ({
  id,
  name: `Route ${id}`,
  start_address: 'Home',
  end_address: 'Office',
  distance_m: 1000,
  attempt_count: 2,
  best_time: null,
  best_efficiency: null,
  latest: null,
});

function renderPage(path = '/segments') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SegmentsPage />
    </MemoryRouter>,
  );
}

describe('SegmentsPage pagination', () => {
  beforeEach(() => {
    state.vehicleId = 7;
    state.segments = Array.from({ length: 25 }, (_, index) => segment(index + 1));
    state.selectedIds = [];
  });

  it('shows twelve segments per page and navigates through every result', () => {
    renderPage();
    const list = screen.getByRole('listbox', { name: 'Route segments' });
    expect(within(list).getAllByRole('option')).toHaveLength(12);
    expect(screen.getByRole('option', { name: 'Open leaderboard for Route 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByText('Showing 1–12 of 25')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(within(list).getAllByRole('option')).toHaveLength(12);
    expect(screen.getByRole('option', { name: 'Open leaderboard for Route 13' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Open leaderboard for Route 1' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Last page' }));
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option', { name: 'Open leaderboard for Route 25' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(screen.getByText('Showing 25–25 of 25')).toBeInTheDocument();
  });

  it('clears the selected leaderboard and ghost when the page changes', () => {
    renderPage();
    fireEvent.click(screen.getByRole('option', { name: 'Open leaderboard for Route 1' }));
    expect(screen.getByRole('option', { name: 'Open leaderboard for Route 1' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('No ranked attempts on this segment yet.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.queryByText('No ranked attempts on this segment yet.')).not.toBeInTheDocument();
    expect(state.selectedIds[state.selectedIds.length - 1]).toBeNull();
  });

  it('honors a shared page URL and clamps it after the result count shrinks', async () => {
    const page = renderPage('/segments?page=3');
    expect(screen.getByRole('option', { name: 'Open leaderboard for Route 25' })).toBeInTheDocument();
    state.segments = Array.from({ length: 13 }, (_, index) => segment(index + 1));
    page.rerender(<MemoryRouter initialEntries={['/segments?page=3']}><SegmentsPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Showing 13–13 of 13')).toBeInTheDocument());
    expect(screen.getByRole('option', { name: 'Open leaderboard for Route 13' })).toBeInTheDocument();
  });

  it('returns to the first page and clears the race when the vehicle changes', async () => {
    const page = renderPage('/segments?page=2');
    fireEvent.click(screen.getByRole('option', { name: 'Open leaderboard for Route 13' }));
    expect(screen.getByText('No ranked attempts on this segment yet.')).toBeInTheDocument();
    state.vehicleId = 8;
    page.rerender(<MemoryRouter initialEntries={['/segments?page=2']}><SegmentsPage /></MemoryRouter>);
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Open leaderboard for Route 1' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.queryByText('No ranked attempts on this segment yet.')).not.toBeInTheDocument();
  });

  it('omits pagination for a single page', () => {
    state.segments = [segment(1)];
    renderPage();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).not.toBeInTheDocument();
  });
});
