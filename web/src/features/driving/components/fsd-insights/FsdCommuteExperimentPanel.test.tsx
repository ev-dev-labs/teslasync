import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { fsdInsights } from './__tests__/fixtures';
import { FsdCommuteExperimentPanel } from './FsdCommuteExperimentPanel';

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
  });
});
