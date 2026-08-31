import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { DriveFsdInsight } from '@/types/fsd';
import { SupervisedDrivingPanel } from './SupervisedDrivingPanel';

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
    formatDistance: (meters: number | null) => meters == null ? '-' : `${meters / 1000} km`,
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
  it('renders reported distance, share, confidence, evidence, and the FSD link', () => {
    render(
      <MemoryRouter>
        <SupervisedDrivingPanel insight={insight} isLoading={false} />
      </MemoryRouter>,
    );

    expect(screen.getByText('High confidence')).toBeInTheDocument();
    expect(screen.getByText('7.2 km')).toBeInTheDocument();
    expect(screen.getByText('72.0%')).toBeInTheDocument();
    expect(screen.getByText(/do not identify exact FSD-active road segments/)).toBeInTheDocument();
    expect(screen.getByText(/Firmware: 2026.20.3/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open FSD Insights/ })).toHaveAttribute('href', '/fsd');
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
