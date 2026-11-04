import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { DriveFsdInsight } from '@/types/fsd';
import { SupervisedDrivingPanel } from './SupervisedDrivingPanel';
import { formatDateTime } from '@/lib/dateFormat';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ locale: 'de-DE', settings: { tz_display_default: 'user', timezone_user: 'America/Los_Angeles' } }),
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: null }),
}));

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
    formatDistance: (meters: number | null) => meters == null ? '-' : `${(meters / 1000).toFixed(2)} km`,
  }),
}));

const insight: DriveFsdInsight = {
  drive_id: 295,
  started_at: '2026-03-03T10:00:00Z',
  ended_at: '2026-03-03T11:00:00Z',
  start_place: 'Home',
  end_place: 'Office',
  distance_m: 10_000,
  energy_used_wh: 1_800,
  fsd_distance_m: 7_200,
  fsd_share_pct: 72,
  confidence: 'high',
  reset_affected: false,
  firmware_version: '2026.20.3',
  evidence_truncated: false,
  evidence: [{
    start_at: '2026-03-03T10:10:00Z',
    end_at: '2026-03-03T10:40:00Z',
    fsd_distance_m: 7_200,
    confidence: 'high',
    approximate: true,
  }],
};

describe('SupervisedDrivingPanel', () => {
  it('BUG3 keeps firmware and insight links neutral and row icons on their label baseline', () => {
    render(<MemoryRouter><SupervisedDrivingPanel insight={insight} isLoading={false} /></MemoryRouter>);
    for (const link of screen.getAllByRole('link')) {
      expect(link).not.toHaveClass('text-[var(--theme-primary)]');
    }
    for (const name of ['Reported distance', 'Share of drive', 'Evidence window']) {
      const header = screen.getByRole('rowheader', { name });
      expect(header.querySelector('svg')?.parentElement).toHaveClass('inline-flex', 'items-center');
    }
  });
  it('retries failed evidence independently and recovers through active loading', () => {
    const onRetry = vi.fn();
    const panel = (isLoading: boolean, error?: Error, data?: DriveFsdInsight) => (
      <MemoryRouter>
        <SupervisedDrivingPanel insight={data} isLoading={isLoading} error={error} onRetry={onRetry} />
      </MemoryRouter>
    );
    const { rerender } = render(panel(false, new Error('FSD unavailable')));
    fireEvent.click(screen.getByRole('button', { name: 'Retry supervised-driving evidence' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByText(/The rest of this drive remains available/)).toBeInTheDocument();

    rerender(panel(true));
    expect(screen.getByText('Supervised driving')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry supervised-driving evidence' })).toBeNull();
    expect(screen.queryByText('Unknown')).toBeNull();

    rerender(panel(false, undefined, insight));
    expect(screen.getByText('7.20 km')).toBeInTheDocument();
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });

  it('renders successful empty evidence as unknown and confirmed zero as zero', () => {
    const { rerender } = render(
      <MemoryRouter><SupervisedDrivingPanel insight={undefined} isLoading={false} /></MemoryRouter>,
    );
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByRole('button')).toBeNull();
    rerender(
      <MemoryRouter><SupervisedDrivingPanel insight={{ ...insight, fsd_distance_m: 0, fsd_share_pct: 0, evidence: [] }} isLoading={false} /></MemoryRouter>,
    );
    expect(screen.getByText('0.00 km')).toBeInTheDocument();
    expect(screen.getByText('0.00%')).toBeInTheDocument();
    expect(screen.getByText('No positive counter increase')).toBeInTheDocument();
  });

  it.each(['2026-04-02T00:30:00Z', 'invalid', ''])('honors saved date preferences for evidence %s', (start_at) => {
    const { container } = render(
      <MemoryRouter><SupervisedDrivingPanel insight={{ ...insight, evidence: [{ ...insight.evidence[0], start_at, end_at: '2026-04-02T08:30:00Z' }] }} isLoading={false} /></MemoryRouter>,
    );
    if (!start_at) {
      expect(screen.getByText('No positive counter increase')).toBeInTheDocument();
      return;
    }
    const times = container.querySelectorAll('time');
    expect(times[0]).toHaveTextContent(formatDateTime(start_at, { locale: 'de-DE', tz: 'America/Los_Angeles' }));
    expect(times[0]).toHaveAttribute('datetime', start_at);
    expect(times[0]).toHaveAttribute('title', start_at);
    expect(times[1]).toHaveTextContent('2. Apr. 2026');
  });

  it('renders reported distance, share, confidence, evidence, and the FSD link', () => {
    render(
      <MemoryRouter>
        <SupervisedDrivingPanel insight={insight} isLoading={false} />
      </MemoryRouter>,
    );

    expect(screen.getByText('High confidence')).toBeInTheDocument();
    expect(screen.getByText('7.20 km')).toBeInTheDocument();
    expect(screen.getByText('72.00%')).toBeInTheDocument();
    expect(screen.getByText(/do not identify exact FSD-active road segments/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /After firmware 2026.20.3/ })).toHaveAttribute(
      'href',
      '/fsd#fsd-firmware-spotlight',
    );
    expect(screen.getByText(/correlation, not proof the update caused a change/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open FSD insights/ })).toHaveAttribute('href', '/fsd');
  });

  it('keeps missing evidence unknown instead of rendering zero', () => {
    render(
      <MemoryRouter>
        <SupervisedDrivingPanel
          insight={{
            ...insight,
            fsd_distance_m: null,
            fsd_share_pct: null,
            confidence: 'unknown',
            firmware_version: null,
            evidence_truncated: false,
            evidence: [],
          }}
          isLoading={false}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.getByText(/distinguish zero FSD use from missing data/)).toBeInTheDocument();
  });

  it('discloses when route evidence is capped', () => {
    render(
      <MemoryRouter>
        <SupervisedDrivingPanel
          insight={{ ...insight, evidence_truncated: true }}
          isLoading={false}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Route evidence limited')).toBeInTheDocument();
    expect(screen.getByText(/first 512 coalesced intervals/i)).toBeInTheDocument();
  });

  it('labels an ongoing drive without pretending its final FSD evidence is known', () => {
    render(
      <MemoryRouter>
        <SupervisedDrivingPanel
          insight={undefined}
          isLoading={false}
          isOngoing
        />
      </MemoryRouter>,
    );

    expect(screen.getAllByText('In progress')).not.toHaveLength(0);
    expect(screen.getByText(/In progress · Not measured/)).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
  });
});
