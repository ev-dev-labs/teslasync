import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CalculationDetails } from './CalculationDetails';
import { severityTokens, typography } from '@/lib/tokens';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

describe('CalculationDetails', () => {
  it('keeps normalized exclusions in source order using the existing warning foreground', () => {
    const exclusions = [
      '  Observation time is unknown.  ',
      'Scope is limited to the selected analysis window.',
      'Observation time is unknown.',
      '',
      '  ',
      'Charger-side diagnostics are not available.',
    ];
    render(
      <CalculationDetails
        exclusions={exclusions}
        className="calculation-context"
      />,
    );

    const region = screen.getByRole('region', {
      name: 'How this was calculated',
    });
    expect(region).toHaveClass('calculation-context');
    const entries = within(region).getAllByRole('listitem');
    expect(entries.map((entry) => entry.textContent)).toEqual([
      'Observation time is unknown.',
      'Scope is limited to the selected analysis window.',
      'Charger-side diagnostics are not available.',
    ]);
    for (const entry of entries) {
      const text = within(entry).getByText(entry.textContent ?? '');
      expect(text.tagName).toBe('SPAN');
      expect(text).toHaveClass(severityTokens.warn.fg);
      expect(text).not.toHaveClass('text-amber-300');
    }
    expect(
      within(region).getAllByText('Not supplied by this analysis.'),
    ).toHaveLength(5);
    expect(exclusions[0]).toBe('  Observation time is unknown.  ');
    expect(exclusions).toHaveLength(6);
  });

  it('keeps unknown and blank-exclusion fallbacks muted instead of warning-colored', () => {
    render(<CalculationDetails exclusions={['', '   ']} />);

    const region = screen.getByRole('region', {
      name: 'How this was calculated',
    });
    expect(within(region).queryByRole('list')).not.toBeInTheDocument();
    const unknowns = within(region).getAllByText('Not supplied by this analysis.');
    const empty = within(region).getByText('No additional exclusions were supplied.');
    for (const text of [...unknowns, empty]) {
      expect(text).toHaveClass(typography.color.muted);
      expect(text).not.toHaveClass(severityTokens.warn.fg);
    }
  });

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
