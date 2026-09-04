import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FsdObservatoryPanel } from './FsdObservatoryPanel';
import { fsdInsights } from './__tests__/fixtures';
import type { FsdSectionState } from './types';

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

const readyState: FsdSectionState = {
  isLoading: false,
  error: null,
  onRetry: vi.fn(),
  noVehicle: false,
};

function renderPanel(node: ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FsdObservatoryPanel', () => {
  it('renders the stitched journal without claiming engagement segments', () => {
    renderPanel(<FsdObservatoryPanel insights={fsdInsights()} state={readyState} />);

    const panel = screen.getByTestId('fsd-observatory');
    expect(within(panel).getByText('FSD observatory')).toBeInTheDocument();
    expect(within(panel).getByText(/reset-safe counter change/i)).toBeInTheDocument();
    expect(within(panel).getByText('14.0 km')).toBeInTheDocument();
    expect(within(panel).getByText('1.0 km')).toBeInTheDocument();
    expect(within(panel).getByText('5.0 km')).toBeInTheDocument();
    expect(panel.textContent).not.toMatch(/FSD-active/i);
    expect(panel.textContent).not.toMatch(/exact engagement/i);

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs).toContain('/drives/295');
    expect(screen.getByTestId('fsd-observatory-reset')).toHaveTextContent('not travelled FSD');
    expect(screen.getAllByText('Not measured').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Home to Office').length).toBeGreaterThan(0);
    expect(screen.getByText('1 unknown')).toBeInTheDocument();
  });

  it('keeps missing stitched FSD as an em dash instead of zero', () => {
    const insights = fsdInsights();
    insights.drive_analytics.observatory.totals.stitched_fsd_distance_m = null;
    insights.drive_analytics.observatory.totals.ambiguous_fsd_distance_m = null;
    insights.drive_analytics.observatory.timeline = [{
      kind: 'drive',
      at: '2026-03-02T17:00:00Z',
      end_at: '2026-03-02T17:30:00Z',
      drive_id: 295,
      route_key: 'place:home:office',
      route_label: 'Home to Office',
      firmware_version: null,
      fsd_distance_m: null,
      driving_distance_m: 10_000,
      confidence: 'unknown',
      reset_break: false,
      approximate: false,
      field: null,
    }];

    renderPanel(<FsdObservatoryPanel insights={insights} state={readyState} />);

    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByTestId('fsd-observatory-drive-fsd')).toHaveTextContent('Not measured');
    expect(screen.queryByText('0.0 km')).not.toBeInTheDocument();
  });

  it('keeps the observatory shell visible while loading', () => {
    renderPanel(
      <FsdObservatoryPanel
        insights={undefined}
        state={{ ...readyState, isLoading: true }}
      />,
    );

    expect(screen.getByTestId('fsd-observatory')).toBeInTheDocument();
    expect(screen.getByText('FSD observatory')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
