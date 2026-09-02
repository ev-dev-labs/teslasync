import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { contributingDriveExportRows, FsdDriveAnalyticsPanels } from './FsdDriveAnalyticsPanels';
import { fsdInsights } from './__tests__/fixtures';

const { downloadJSON, downloadRowsAsCSV } = vi.hoisted(() => ({
  downloadJSON: vi.fn(),
  downloadRowsAsCSV: vi.fn(),
}));

vi.mock('@/lib/csvExport', async () => {
  const actual = await vi.importActual<typeof import('@/lib/csvExport')>('@/lib/csvExport');
  return {
    ...actual,
    downloadJSON,
    downloadRowsAsCSV,
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        fallback,
      ),
  }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { distance: 'km' },
    formatDistance: (meters: number | null, options?: { precision?: number }) =>
      meters == null ? '-' : `${(meters / 1000).toFixed(options?.precision ?? 1)} km`,
  }),
}));

const readyState = {
  isLoading: false,
  error: null,
  onRetry: vi.fn(),
  noVehicle: false,
};

beforeEach(() => {
  downloadJSON.mockReset();
  downloadRowsAsCSV.mockReset();
});

describe('FsdDriveAnalyticsPanels', () => {
  it('renders period comparison, attribution, drives, groups, and correlation caveat', () => {
    render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={fsdInsights()} state={readyState} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Change from the previous period')).toBeInTheDocument();
    expect(screen.getByText('Attribution and counter resets')).toBeInTheDocument();
    expect(screen.getByText('Contributing drives')).toBeInTheDocument();
    expect(screen.getByText('Route, time, and firmware comparisons')).toBeInTheDocument();
    expect(screen.getByText('Firmware spotlight')).toBeInTheDocument();
    expect(screen.getByTestId('fsd-firmware-spotlight')).toHaveAttribute('id', 'fsd-firmware-spotlight');
    expect(screen.getByText('Commute supervised identity')).toBeInTheDocument();
    expect(screen.getByTestId('fsd-commute-identity')).toBeInTheDocument();
    expect(screen.getByText('Same-route efficiency comparison')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /2026/ })).toHaveAttribute('href', '/drives/295');
    expect(screen.getAllByText('Home to Office').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2026.20.3').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/correlation, not proof/i).length).toBeGreaterThan(0);
  });

  it('keeps every panel shell visible while loading', () => {
    render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels
          insights={undefined}
          state={{ ...readyState, isLoading: true }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Change from the previous period')).toBeInTheDocument();
    expect(screen.getByText('Attribution and counter resets')).toBeInTheDocument();
    expect(screen.getByText('Contributing drives')).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(7);
  });

  it('explains when period deltas lack comparable trusted coverage', () => {
    const insights = fsdInsights();
    insights.drive_analytics.comparison.fsd_distance_change_m = null;
    insights.drive_analytics.comparison.fsd_share_change_pct_points = null;

    render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={insights} state={readyState} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Periods lack comparable trusted coverage')).toBeInTheDocument();
    expect(screen.getByText('Share periods lack comparable trusted coverage')).toBeInTheDocument();
  });

  it('keeps missing legacy attribution unavailable instead of showing zero', () => {
    const legacy = fsdInsights() as unknown as ReturnType<typeof fsdInsights> & {
      drive_analytics?: undefined;
    };
    delete legacy.drive_analytics;

    render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={legacy} state={readyState} />
      </MemoryRouter>,
    );

    const attribution = screen.getByTestId('fsd-attribution');
    const unknown = within(attribution).getByText('Drive distance unknown').parentElement;
    expect(unknown).not.toBeNull();
    expect(within(unknown as HTMLElement).getByText('Not measured')).toBeInTheDocument();
  });

  it('exports contributing drives as SI CSV and JSON', () => {
    render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={fsdInsights()} state={readyState} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));

    expect(downloadRowsAsCSV).toHaveBeenCalledOnce();
    const csvRows = downloadRowsAsCSV.mock.calls[0][1] as Array<{ fsd_distance_m: number }>;
    expect(csvRows[0]?.fsd_distance_m).toBe(8_000);
    expect(downloadJSON).toHaveBeenCalledOnce();
    const payload = downloadJSON.mock.calls[0][1] as { unit: string; drives: Array<{ distance_m: number }> };
    expect(payload.unit).toBe('meter');
    expect(payload.drives[0]?.distance_m).toBe(10_000);
  });

  it('disables contributing-drive export when nothing is measured', () => {
    render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={undefined} state={readyState} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'CSV' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'JSON' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    expect(downloadRowsAsCSV).not.toHaveBeenCalled();
    expect(downloadJSON).not.toHaveBeenCalled();
  });

  it('shows same-route FSD share before and after the latest firmware pair', () => {
    render(
      <MemoryRouter>
        <FsdDriveAnalyticsPanels insights={fsdInsights()} state={readyState} />
      </MemoryRouter>,
    );

    const spotlight = screen.getByTestId('fsd-firmware-spotlight');
    expect(within(spotlight).getByText(/2026.8.1 vs 2026.20.3/)).toBeInTheDocument();
    expect(within(spotlight).getByText('+40.0 pts')).toBeInTheDocument();
  });
});

describe('contributingDriveExportRows', () => {
  it('keeps SI meters and drops unknown FSD distance', () => {
    const rows = contributingDriveExportRows([
      {
        drive_id: 1,
        started_at: '2026-03-02T17:00:00Z',
        ended_at: '2026-03-02T17:30:00Z',
        start_place: 'Home',
        end_place: 'Office',
        distance_m: 10_000,
        energy_used_wh: 1_800,
        fsd_distance_m: 8_000,
        fsd_share_pct: 80,
        confidence: 'high',
        reset_affected: false,
        firmware_version: '2026.20.3',
        evidence: [],
        evidence_truncated: false,
      },
      {
        drive_id: 2,
        started_at: '2026-03-02T18:00:00Z',
        ended_at: null,
        start_place: null,
        end_place: null,
        distance_m: 5_000,
        energy_used_wh: null,
        fsd_distance_m: null,
        fsd_share_pct: null,
        confidence: 'unknown',
        reset_affected: false,
        firmware_version: null,
        evidence: [],
        evidence_truncated: false,
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      drive_id: 1,
      distance_m: 10_000,
      fsd_distance_m: 8_000,
      firmware_version: '2026.20.3',
    });
  });
});
