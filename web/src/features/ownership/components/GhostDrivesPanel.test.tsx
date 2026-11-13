/**
 * GhostDrivesPanel — behaviour coverage.
 *
 * The data hook (`useGhostDrives`) is mocked and driven per test; shared UI
 * (OwnershipPanel, DataTable, Badge, AlertBanner, Button) is REAL so the
 * render-boundary wiring is genuinely exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

function renderPanel(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

vi.mock('@/api/hooks/useOwnership', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useOwnership')>(
    '@/api/hooks/useOwnership',
  );
  return { ...actual, useGhostDrives: vi.fn() };
});

import { useGhostDrives } from '@/api/hooks/useOwnership';
import { GhostDrivesPanel } from './GhostDrivesPanel';
import { formatDateTime } from '@/lib/dateFormat';
import { formatPct, formatSpan } from '../formatters';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { expectAppDesignDataMode, matchesAppDesignCss, setAppDesignTestProfile } from '@/components/feedback/appDesignCss.test-utils';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';

const mockGhosts = useGhostDrives as unknown as ReturnType<typeof vi.fn>;

const ghosts = [
  {
    drive_id: 7,
    started_at: '2026-09-01T21:14:00Z',
    distance_m: 18200,
    duration_s: 1500,
    cluster_id: 0,
    score: 82.5,
    confidence_pct: 41,
    distance_ratio: 2.4,
    reason: 'unattributed drive, 41% confidence, 2.4× typical distance',
  },
  {
    drive_id: 9,
    started_at: '2026-09-02T08:02:00Z',
    distance_m: 9400,
    duration_s: 900,
    cluster_id: 1,
    score: 63.0,
    confidence_pct: 66,
    distance_ratio: 1.3,
    reason: 'unattributed drive, 66% confidence',
  },
];

const report = { vehicle_id: 42, scanned: 24, ghosts };

function idle(extra = {}) {
  return {
    data: undefined, isLoading: false, isFetching: false, error: null,
    refetch: vi.fn(), ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGhosts.mockReturnValue(idle());
});

describe('GhostDrivesPanel', () => {
  it('owns the real score-column track and warning fill for every design without changing raw scores or actions', () => {
    mockGhosts.mockReturnValue(idle({ data: report }));
    const onLabel = vi.fn();
    const { container } = renderPanel(<GhostDrivesPanel vehicleId={42} windowDays={90} onLabel={onLabel} />);
    const tracks = [...container.querySelectorAll<HTMLElement>('[data-metric-track]')];
    expect(tracks).toHaveLength(2);
    for (const [index, track] of tracks.entries()) {
      expect(track).toHaveAttribute('data-app-part', 'metric');
      expect(track).toHaveAttribute('data-app-metric', 'bar');
      expect(track).toHaveClass('h-1.5', 'w-full', 'overflow-hidden', 'rounded-full', 'bg-[var(--surface-2)]');
      expect(track.parentElement).toHaveClass('flex', 'min-w-[7rem]', 'items-center', 'gap-2');
      expect(track.firstElementChild).toHaveAttribute('data-metric-fill');
      expect(track.firstElementChild).toHaveClass('h-full', 'rounded-full', 'bg-[var(--semantic-warning)]');
      expect(track.firstElementChild).toHaveStyle({ width: `${ghosts[index].score}%` });
      expect(track.nextElementSibling).toHaveTextContent(fmtNumber(ghosts[index].score));
      expect(track.nextElementSibling).toHaveAttribute('data-app-variant', index === 0 ? 'warning' : 'info');
      expect(track).not.toHaveAttribute('role');
      expect(track).not.toHaveAttribute('aria-valuenow');
      expect(matchesAppDesignCss(track, '[data-metric-track]')).toEqual([]);
    }
    container.setAttribute('data-app-design-preview', '');
    for (const pack of PACK_IDS) {
      setAppDesignTestProfile(container, pack);
      const release = observeAppDesignScopes(container);
      try {
        for (const track of tracks) {
          expectAppDesignDataMode(track, getAppDesignAttributes(pack)['data-app-data'], '[data-metric-track]');
          const fill = track.firstElementChild!;
          const selected = matchesAppDesignCss(fill, '[data-metric-fill]');
          expect(selected.length).toBeGreaterThan(0);
          for (const { declarations } of selected) {
            expect(declarations).toEqual({ 'box-sizing': 'border-box', 'min-inline-size': '0' });
          }
          for (const { declarations } of matchesAppDesignCss(track, '[data-metric-track]')) {
            expect(Object.keys(declarations)).toEqual(['outline', 'outline-offset']);
          }
          expect(track).not.toHaveAttribute('role');
        }
        expect(tracks.map(track => (track.firstElementChild as HTMLElement).style.width)).toEqual(['82.5%', '63%']);
      } finally { release(); }
    }
    fireEvent.click(screen.getAllByRole('button', { name: 'Label' })[0]);
    expect(onLabel).toHaveBeenCalledWith(7);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it.each([
    { score: 0, width: '0%', tone: 'info' },
    { score: -25, width: '0%', tone: 'info' },
    { score: 125, width: '100%', tone: 'warning' },
    { score: 79.99, width: '79.99%', tone: 'info' },
    { score: 80, width: '80%', tone: 'warning' },
    { score: null, width: '0%', tone: 'info' },
    { score: undefined, width: '', tone: 'info' },
    { score: NaN, width: '', tone: 'info' },
    { score: Infinity, width: '100%', tone: 'warning' },
    { score: -Infinity, width: '0%', tone: 'info' },
  ])('preserves the original width, raw readout and tone for score=$score', ({ score, width, tone }) => {
    mockGhosts.mockReturnValue(idle({ data: { ...report, ghosts: [{ ...ghosts[0], score }] } }));
    const { container } = renderPanel(<GhostDrivesPanel vehicleId={42} windowDays={90} onLabel={vi.fn()} />);
    const track = container.querySelector('[data-metric-track]')!;
    expect((track.firstElementChild as HTMLElement).style.width).toBe(width);
    expect(track.nextElementSibling).toHaveTextContent(fmtNumber(score));
    expect(track.nextElementSibling).toHaveAttribute('data-app-variant', tone);
    expect(track).not.toHaveAttribute('aria-valuenow');
  });

  it('keeps widget-only and incomplete boundaries neutral, using the nearest complete profile only', () => {
    mockGhosts.mockReturnValue(idle({ data: report }));
    const panel = <GhostDrivesPanel vehicleId={42} windowDays={90} onLabel={vi.fn()} />;
    const { container } = renderPanel(<>
      <section data-widget-pack="v1">{panel}</section>
      <section data-app-design-preview {...getAppDesignAttributes('v1')}>
        {panel}
        <section data-app-design-preview data-app-design-pack="v2">
          {panel}
          <section data-app-design-preview {...getAppDesignAttributes('v3')}>{panel}</section>
        </section>
      </section>
    </>);
    const tracks = [...container.querySelectorAll('[data-metric-track]')];
    expect(tracks).toHaveLength(8);
    const release = observeAppDesignScopes(container);
    try {
      for (const index of [0, 1, 4, 5]) {
        for (const node of [tracks[index], tracks[index].firstElementChild!]) {
          expect(node).not.toHaveAttribute('data-app-design-owner');
          expect(matchesAppDesignCss(node, '[data-metric-')).toEqual([]);
        }
      }
      expectAppDesignDataMode(tracks[2], 'instrument', '[data-metric-track]');
      expectAppDesignDataMode(tracks[6], 'ledger', '[data-metric-track]');
    } finally { release(); }
  });

  it('passes vehicle and window through to the scan query', () => {
    renderPanel(<GhostDrivesPanel vehicleId={42} windowDays={30} onLabel={vi.fn()} />);
    expect(mockGhosts).toHaveBeenCalledWith(42, 30);
  });

  it('reports a clear window when nothing is flagged', () => {
    mockGhosts.mockReturnValue(idle({ data: { vehicle_id: 42, scanned: 24, ghosts: [] } }));
    renderPanel(<GhostDrivesPanel vehicleId={42} windowDays={90} onLabel={vi.fn()} />);
    expect(screen.getByText('Ghost-driver alerts')).toBeInTheDocument();
    expect(screen.getByText(/No unknown-driver activity/)).toBeInTheDocument();
  });

  it('raises the alert banner and lists flagged drives with reasons', () => {
    mockGhosts.mockReturnValue(idle({ data: report }));
    renderPanel(<GhostDrivesPanel vehicleId={42} windowDays={90} onLabel={vi.fn()} />);
    expect(screen.getByText('2 of 24 drives look like someone else')).toBeInTheDocument();
    expect(screen.getByText('2 flagged')).toBeInTheDocument();
    expect(screen.getByText('#7')).toBeInTheDocument();
    expect(
      screen.getByText('unattributed drive, 41% confidence, 2.4× typical distance'),
    ).toBeInTheDocument();
  });

  it('routes the label action back to the caller with the drive id', () => {
    mockGhosts.mockReturnValue(idle({ data: report }));
    const onLabel = vi.fn();
    renderPanel(<GhostDrivesPanel vehicleId={42} windowDays={90} onLabel={onLabel} />);
    fireEvent.click(screen.getAllByText('Label')[0]);
    expect(onLabel).toHaveBeenCalledWith(7);
  });

  it('surfaces scan failures without crashing the panel', () => {
    mockGhosts.mockReturnValue(idle({ error: new Error('boom'), isError: true, status: 'error' }));
    renderPanel(<GhostDrivesPanel vehicleId={42} windowDays={90} onLabel={vi.fn()} />);
    expect(screen.getByText('Ghost-driver alerts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('requires a selected vehicle instead of claiming a clear window', () => {
    renderPanel(<GhostDrivesPanel vehicleId={null} windowDays={90} onLabel={vi.fn()} />);
    expect(mockGhosts).toHaveBeenCalledWith(null, 90);
    expect(screen.getByText('No vehicle selected')).toBeInTheDocument();
    expect(screen.queryByText(/No unknown-driver activity/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Label' })).not.toBeInTheDocument();
  });

  it.each([0, undefined])('does not infer coverage from scanned=%s', (scanned) => {
    mockGhosts.mockReturnValue(idle({ data: { vehicle_id: 42, scanned, ghosts: [] } }));
    renderPanel(<GhostDrivesPanel vehicleId={42} windowDays={90} onLabel={vi.fn()} />);
    expect(screen.getByText('No drives with sufficient telemetry in this window.')).toBeInTheDocument();
    expect(screen.queryByText(/No unknown-driver activity/)).not.toBeInTheDocument();
  });

  it('keeps unresolved scans loading rather than presenting a clear window', () => {
    mockGhosts.mockReturnValue(idle({ isLoading: true, status: 'pending', fetchStatus: 'fetching' }));
    renderPanel(<GhostDrivesPanel vehicleId={42} windowDays={90} onLabel={vi.fn()} />);
    expect(screen.getByText('Ghost-driver alerts')).toBeInTheDocument();
    expect(screen.queryByText(/No unknown-driver activity/)).not.toBeInTheDocument();
    expect(screen.queryByText('No drives with sufficient telemetry in this window.')).not.toBeInTheDocument();
  });

  it('keeps an initial paused scan distinct from an empty response', () => {
    mockGhosts.mockReturnValue(idle({ status: 'pending', fetchStatus: 'paused', isPaused: true }));
    renderPanel(<GhostDrivesPanel vehicleId={42} windowDays={90} onLabel={vi.fn()} />);
    expect(screen.getByText(/initial query is paused/)).toBeInTheDocument();
    expect(screen.queryByText(/No unknown-driver activity/)).not.toBeInTheDocument();
  });

  it('retains flagged drives on a refresh failure and retries that source', () => {
    const refetch = vi.fn();
    mockGhosts.mockReturnValue(idle({
      data: report, error: new Error('refresh failed'), isError: true, status: 'error', refetch,
    }));
    renderPanel(<GhostDrivesPanel vehicleId={42} windowDays={90} onLabel={vi.fn()} />);
    expect(screen.getByText('#7')).toBeInTheDocument();
    expect(screen.getByText(/Previously loaded data remains visible/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it.each([
    ['Ghost score', 'score'],
    ['Deviation', 'distance_ratio'],
  ] as const)('sorts %s by raw numbers in both directions without changing source rows', (header, field) => {
    const rows = [
      { ...ghosts[0], drive_id: 30, [field]: 9.001 },
      { ...ghosts[1], drive_id: 10, [field]: 100 },
      { ...ghosts[0], drive_id: 20, [field]: 9.004 },
    ];
    mockGhosts.mockReturnValue(idle({ data: { ...report, ghosts: rows } }));
    const onLabel = vi.fn();
    renderPanel(<GhostDrivesPanel vehicleId={42} windowDays={90} onLabel={onLabel} />);
    const ids = () => screen.getAllByRole('row').slice(1).map(row =>
      within(row).getByText(/^#\d+$/).textContent,
    );
    expect(ids()).toEqual(['#30', '#10', '#20']);
    fireEvent.click(screen.getByRole('button', { name: header }));
    expect(ids()).toEqual(['#10', '#20', '#30']);
    expect(screen.getByRole('columnheader', { name: header })).toHaveAttribute('aria-sort', 'descending');
    fireEvent.click(screen.getByRole('button', { name: header }));
    expect(ids()).toEqual(['#30', '#20', '#10']);
    expect(screen.getByRole('columnheader', { name: header })).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(within(screen.getAllByRole('row')[2]).getByRole('button', { name: 'Label' }));
    expect(onLabel).toHaveBeenCalledWith(20);
    expect(rows.map(row => row.drive_id)).toEqual([30, 10, 20]);
  });

  it('exposes all original mobile fields through Quick view and labels the same drive', () => {
    const dimensions = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 375, height: 300, top: 0, left: 0, right: 375, bottom: 300, x: 0, y: 0,
      toJSON: () => ({}),
    });
    const originalObserver = globalThis.ResizeObserver;
    class MobileResizeObserver implements ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = MobileResizeObserver;
    try {
      const { result: units } = renderHook(() => useUnits());
      mockGhosts.mockReturnValue(idle({ data: report }));
      const onLabel = vi.fn();
      renderPanel(<GhostDrivesPanel vehicleId={42} windowDays={90} onLabel={onLabel} />);
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      fireEvent.click(screen.getAllByRole('button', { name: 'Label' })[0]);
      expect(onLabel).toHaveBeenLastCalledWith(7);
      fireEvent.click(screen.getAllByRole('button', { name: 'Quick view' })[0]);
      const detail = within(screen.getByRole('dialog'));
      for (const heading of ['Drive', 'Ghost score', 'Trip', 'Deviation', 'Why flagged', 'Actions']) {
        expect(detail.getByText(heading)).toBeInTheDocument();
      }
      expect(detail.getByText('#7')).toBeInTheDocument();
      expect(detail.getByText(formatDateTime(ghosts[0].started_at))).toBeInTheDocument();
      expect(detail.getByText(units.current.formatDistance(ghosts[0].distance_m))).toBeInTheDocument();
      expect(detail.getByText(formatSpan(ghosts[0].duration_s))).toBeInTheDocument();
      const score = detail.getByText(fmtNumber(ghosts[0].score));
      expect(score.previousElementSibling).toHaveAttribute('data-metric-track');
      expect(score.previousElementSibling?.firstElementChild).toHaveAttribute('data-metric-fill');
      expect(score.previousElementSibling?.firstElementChild).toHaveStyle({ width: '82.5%' });
      expect(detail.getByText(`${fmtNumber(ghosts[0].distance_ratio)}× typical`)).toBeInTheDocument();
      expect(detail.getByText(`${formatPct(ghosts[0].confidence_pct)} confidence`)).toBeInTheDocument();
      expect(detail.getByText(ghosts[0].reason)).toBeInTheDocument();
      fireEvent.click(detail.getByRole('button', { name: 'Label' }));
      expect(onLabel).toHaveBeenLastCalledWith(7);
    } finally {
      dimensions.mockRestore();
      globalThis.ResizeObserver = originalObserver;
    }
  });
});
