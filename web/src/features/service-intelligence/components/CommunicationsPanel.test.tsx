import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { serviceReport } from '../pages/ServiceIntelligencePage.closure.fixtures';
import { CommunicationsPanel } from './CommunicationsPanel';

const props = {
  selected: true,
  loading: false,
  error: null,
  communications: serviceReport.communications,
  source: serviceReport.sources[0],
  onRetry: vi.fn(),
};

describe('CommunicationsPanel authoritative versus unavailable evidence', () => {
  it('retains all supplied stale matches, hypothesis and document links without treating them as confirmed faults', () => {
    const second = {
      ...serviceReport.communications[0],
      id: 'second',
      communication_number: 'SB-26-08',
      communication_type: '',
      summary: 'Second supplied bulletin.',
      applicability: 'unlikely' as const,
      confidence: 0,
      hypothesis: 'This publication is unlikely to apply.',
      symptom_matches: [],
      source_document_url: 'https://example.org/bulletin-8',
    };
    render(<CommunicationsPanel {...props} communications={[...props.communications, second]} />);
    expect(screen.getByText('TSB index needs refresh')).toBeInTheDocument();
    expect(screen.getByText('Retained official import remains available.')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole('heading', { name: 'SB-26-07' })).toBeInTheDocument();
    expect(within(rows[1]).getByRole('heading', { name: 'SB-26-08' })).toBeInTheDocument();
    expect(within(rows[0]).getByText('Returned bulletin summary.')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Technical service bulletin')).toBeInTheDocument();
    expect(within(rows[0]).getByTitle('2026-07-02T00:00:00.000Z')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Needs review')).toBeInTheDocument();
    expect(within(rows[0]).getByText('41% confidence')).toBeInTheDocument();
    expect(within(rows[0]).getByText('1 observed symptom match')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Bulletin overlap does not establish a fault.')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Communication type unavailable')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Unlikely')).toBeInTheDocument();
    expect(within(rows[1]).getByText('0% confidence')).toBeInTheDocument();
    for (const [index, url] of [props.communications[0].source_document_url, second.source_document_url].entries()) {
      const link = within(rows[index]).getByRole('link', { name: 'Open official NHTSA document' });
      expect(link).toHaveAttribute('href', url);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('does not reinterpret an unavailable provider as an authoritative empty inventory', () => {
    render(
      <CommunicationsPanel {...props} communications={[]}
        source={{ ...props.source, status: 'unavailable', detail: 'Official retrieval is unavailable, not a negative match.' }} />,
    );
    expect(screen.getByText('Typed TSB source unavailable')).toBeInTheDocument();
    expect(screen.getByText('Official retrieval is unavailable, not a negative match.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review NHTSA datasets' }))
      .toHaveAttribute('href', props.source.source_url);
    expect(screen.queryByText('No communications found')).not.toBeInTheDocument();
  });

  it('shows the authoritative empty explanation only when an available provider returns no matches', () => {
    render(<CommunicationsPanel {...props} communications={[]} source={{ ...props.source, status: 'available' }} />);
    expect(screen.getByText('No communications found')).toBeInTheDocument();
    expect(screen.getByText('The normalized official NHTSA index returned no manufacturer communications for this model year.'))
      .toBeInTheDocument();
    expect(screen.queryByText('Typed TSB source unavailable')).not.toBeInTheDocument();
  });

  it('retains the panel shell but suppresses stale vehicle matches when no vehicle is selected', () => {
    render(<CommunicationsPanel {...props} selected={false} />);
    expect(screen.getByRole('heading', { name: 'Manufacturer communications & TSBs' })).toBeInTheDocument();
    expect(screen.getByText('Select a vehicle')).toBeInTheDocument();
    expect(screen.queryByText('SB-26-07')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open official NHTSA document' })).not.toBeInTheDocument();
  });
});
