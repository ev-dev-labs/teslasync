import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { fsdInsights } from './__tests__/fixtures';
import { FsdCommuteExperimentPanel } from './FsdCommuteExperimentPanel';
import { neonColorMap, typography } from '@/lib/tokens';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        fallback,
      ),
  }),
}));

describe('FsdCommuteExperimentPanel', () => {
  it('frames firmware + commute as a same-route experiment', () => {
    render(
      <MemoryRouter>
        <FsdCommuteExperimentPanel
          insights={fsdInsights()}
          state={{ isLoading: false, error: null, onRetry: vi.fn(), noVehicle: false }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('fsd-commute-experiment')).toBeInTheDocument();
    expect(screen.getByText('Same-route experiment')).toBeInTheDocument();
    expect(screen.getAllByText('Changed').length).toBeGreaterThan(0);
    expect(screen.getByTestId('fsd-commute-experiment').querySelector('h3 svg'))
      .toHaveClass(typography.color.muted);
    expect(screen.getByText(/Same geofence, same window/))
      .not.toHaveClass(neonColorMap.amber.text);
    expect(screen.getByText(/days with no counter/)).toHaveClass(neonColorMap.amber.text);
  });

  it('keeps an unavailable control-route explanation neutral without inventing a warning', () => {
    render(
      <MemoryRouter>
        <FsdCommuteExperimentPanel
          insights={undefined}
          state={{ isLoading: false, error: null, onRetry: vi.fn(), noVehicle: false }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Month-over-month share without a control route/))
      .not.toHaveClass(neonColorMap.amber.text);
    expect(screen.queryByText(/days with no counter/)).not.toBeInTheDocument();
    expect(screen.getByText(/Need the same commute window on two firmware versions/))
      .toBeInTheDocument();
  });
});
