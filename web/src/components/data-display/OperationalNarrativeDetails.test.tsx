import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { OperationalNarrative } from '@/types/operationalNarrative';
import { OperationalNarrativeDetails } from './OperationalNarrativeDetails';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
    i18n: { language: 'en-US' },
  }),
}));

const narrative: OperationalNarrative = {
  whatChanged: 'Charging reliability fell below the operating baseline.',
  whyItMatters: 'An interrupted session can leave the vehicle below its departure target.',
  confidence: {
    label: 'high',
    score: 0.91,
    basis: ['Three direct charging-session records support the finding.'],
  },
  likelyCause: null,
  recommendedResponse: 'Review the most recent interrupted session.',
  limitations: ['Charger-side diagnostics are not available.'],
  evidence: [
    {
      id: 'charge-42',
      summary: 'Session ended before the configured target.',
      observedAt: '2026-02-20T10:00:00Z',
      provenance: {
        source: 'Charging history',
        recordId: '42',
      },
    },
  ],
  provenance: [
    {
      source: 'Charging history',
      method: 'Compared completed sessions in the selected window.',
    },
  ],
};

describe('OperationalNarrativeDetails', () => {
  it('renders the complete decision-support contract with semantic provenance', () => {
    render(<OperationalNarrativeDetails narrative={narrative} />);
    const region = screen.getByRole('region', { name: 'Decision narrative' });

    expect(within(region).getByText('What changed')).toBeInTheDocument();
    expect(within(region).getByText(narrative.whatChanged)).toBeInTheDocument();
    expect(within(region).getByText('Why it matters')).toBeInTheDocument();
    expect(within(region).getByText('High · 91%')).toBeInTheDocument();
    expect(
      within(region).getByText('Cause is not established by the available evidence.'),
    ).toBeInTheDocument();
    expect(
      within(region).getByText('Review the most recent interrupted session.'),
    ).toBeInTheDocument();
    expect(within(region).getByText('Record 42', { exact: false })).toBeInTheDocument();
    expect(
      within(region).getByText(
        'Compared completed sessions in the selected window.',
        { exact: false },
      ),
    ).toBeInTheDocument();
  });

  it('states unavailable evidence and provenance instead of inventing content', () => {
    render(
      <OperationalNarrativeDetails
        narrative={{
          ...narrative,
          confidence: { label: 'not_scored', score: null, basis: [] },
          limitations: [],
          evidence: [],
          provenance: [],
        }}
      />,
    );

    expect(screen.getByText('Not scored')).toBeInTheDocument();
    expect(screen.getByText('No confidence basis was supplied.')).toBeInTheDocument();
    expect(screen.getByText('No supporting records were supplied.')).toBeInTheDocument();
    const details = screen.getByRole('region', {
      name: 'How this was calculated',
    });
    expect(
      within(details).getAllByText('Not supplied by this analysis.'),
    ).toHaveLength(5);
    expect(
      within(details).getByText('No additional exclusions were supplied.'),
    ).toBeInTheDocument();
  });
});
