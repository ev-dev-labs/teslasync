import { act, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationalNarrative } from '@/types/operationalNarrative';
import { OperationalNarrativeDetails } from './OperationalNarrativeDetails';
import { setGlobalPrecision } from '@/lib/numberFormat';
import { severityTokens } from '@/lib/tokens';

beforeEach(() => setGlobalPrecision(2));

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
  it('preserves authored limitation strings and order in both warning-role lists', () => {
    const limitations = [
      'Scope is limited to the selected analysis window.',
      'Observation time is unknown.',
      '  Charger-side diagnostics are not available.  ',
    ];
    render(
      <OperationalNarrativeDetails
        narrative={{ ...narrative, limitations }}
        className="narrative-context"
      />,
    );

    const region = screen.getByRole('region', { name: 'Decision narrative' });
    expect(region).toHaveClass('narrative-context');
    const heading = within(region).getByText('Limitations');
    const entries = Array.from(
      heading.parentElement?.querySelectorAll('p') ?? [],
    ).slice(1);
    expect(entries.map((entry) => entry.textContent)).toEqual(limitations);
    for (const entry of entries) {
      expect(entry).toHaveClass(severityTokens.warn.fg);
      expect(entry).not.toHaveClass('text-amber-300');
    }

    const calculation = within(region).getByRole('region', {
      name: 'How this was calculated',
    });
    const exclusions = within(calculation).getAllByRole('listitem');
    expect(exclusions.map((entry) => entry.textContent)).toEqual(
      limitations.map((limitation) => limitation.trim()),
    );
    for (const entry of exclusions) {
      expect(within(entry).getByText(entry.textContent ?? '')).toHaveClass(
        severityTokens.warn.fg,
      );
    }
    expect(within(region).getByText(narrative.whatChanged)).toBeInTheDocument();
    expect(
      within(region).getByText(narrative.whyItMatters ?? ''),
    ).toBeInTheDocument();
    expect(
      within(region).getByText(narrative.evidence[0].summary),
    ).toBeInTheDocument();
    expect(
      within(region).getByText('Cause is not established by the available evidence.'),
    ).toBeInTheDocument();
    expect(limitations[2]).toBe('  Charger-side diagnostics are not available.  ');
  });

  it('updates confidence for a mounted narrative while record IDs and authored strings stay intact', () => {
    render(<OperationalNarrativeDetails narrative={narrative} />);
    act(() => setGlobalPrecision(3));
    expect(screen.getByText('High · 91.000%')).toBeInTheDocument();
    expect(screen.getByText('Record 42', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(narrative.whatChanged)).toBeInTheDocument();
  });
  it('renders the complete decision-support contract with semantic provenance', () => {
    render(<OperationalNarrativeDetails narrative={narrative} />);
    const region = screen.getByRole('region', { name: 'Decision narrative' });

    expect(within(region).getByText('What changed')).toBeInTheDocument();
    expect(within(region).getByText(narrative.whatChanged)).toBeInTheDocument();
    expect(within(region).getByText('Why it matters')).toBeInTheDocument();
    expect(within(region).getByText('High · 91.00%')).toBeInTheDocument();
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
