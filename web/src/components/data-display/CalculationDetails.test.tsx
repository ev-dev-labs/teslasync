import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CalculationDetails } from './CalculationDetails';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

describe('CalculationDetails', () => {
  it('presents normalized provenance without duplicating values', () => {
    render(
      <CalculationDetails
        methods={['Deterministic aggregation', 'Deterministic aggregation']}
        sources={['Charging history', 'Vehicle signals']}
        period="Last 30 days"
        coverage="96% of expected samples"
        version="battery-health-v2"
        exclusions={['Sessions shorter than five minutes']}
      />,
    );

    const region = screen.getByRole('region', {
      name: 'How this was calculated',
    });
    expect(
      within(region).getByText('Deterministic aggregation'),
    ).toBeInTheDocument();
    expect(
      within(region).getByText('Charging history · Vehicle signals'),
    ).toBeInTheDocument();
    expect(within(region).getByText('Last 30 days')).toBeInTheDocument();
    expect(
      within(region).getByText('96% of expected samples'),
    ).toBeInTheDocument();
    expect(within(region).getByText('battery-health-v2')).toBeInTheDocument();
    expect(
      within(region).getByText('Sessions shorter than five minutes'),
    ).toBeInTheDocument();
  });

  it('states unavailable metadata instead of fabricating provenance', () => {
    render(<CalculationDetails />);

    const region = screen.getByRole('region', {
      name: 'How this was calculated',
    });
    expect(
      within(region).getAllByText('Not supplied by this analysis.'),
    ).toHaveLength(5);
    expect(
      within(region).getByText('No additional exclusions were supplied.'),
    ).toBeInTheDocument();
  });
});
