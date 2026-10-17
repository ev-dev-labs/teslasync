import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { serviceReport } from '../pages/ServiceIntelligencePage.closure.fixtures';
import { CommunicationsPanel } from './CommunicationsPanel';
import { RecallFindingCard } from './RecallFindingCard';
import { BUTTON_BASE } from '@/components/ui';
import userEvent from '@testing-library/user-event';

const props = {
  selected: true,
  loading: false,
  error: null,
  communications: serviceReport.communications,
  source: serviceReport.sources[0],
  onRetry: vi.fn(),
};

// Document links reuse the ghost button chrome with a deliberate
// left-aligned override (justify-start wins over BUTTON_BASE justify-center).
const ghostLinkClasses = [...BUTTON_BASE.split(' ').filter((c) => c !== 'justify-center'), 'justify-start'];

describe('CommunicationsPanel authoritative versus unavailable evidence', () => {
  it('shows unknown source availability rather than authoritative empty and keeps local retry', async () => {
    const onRetry = vi.fn();
    render(<CommunicationsPanel {...props} source={null} communications={[]} onRetry={onRetry} />);
    expect(screen.getByRole('status')).toHaveTextContent('Unknown source');
    expect(screen.queryByText('No communications found')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it.each(['unknown', 'unavailable'] as const)('retains returned bulletins with %s source availability', (status) => {
    render(<CommunicationsPanel {...props}
      source={status === 'unknown' ? null : { ...props.source, status }} />);
    expect(screen.getByText(status === 'unknown' ? 'Unknown source' : 'Typed TSB source unavailable')).toBeInTheDocument();
    expect(screen.getByText('Returned bulletin summary.')).toBeInTheDocument();
    expect(screen.getByText('Bulletin overlap does not establish a fault.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open official NHTSA document' }))
      .toHaveAttribute('href', props.communications[0].source_document_url);
    expect(screen.queryByText('No communications found')).not.toBeInTheDocument();
  });

  it('does not describe an empty stale index as an authoritative negative match', () => {
    render(<CommunicationsPanel {...props} communications={[]} />);
    expect(screen.getByText('TSB index needs refresh')).toBeInTheDocument();
    expect(screen.queryByText('No communications found')).not.toBeInTheDocument();
  });

  it('keeps high recall confidence neutral without weakening published safety warnings', () => {
    render(<RecallFindingCard finding={{
      ...serviceReport.recall_findings[0],
      confidence: 0.95,
      confidence_label: 'high',
      park_it: true,
      park_outside: true,
    }} />);
    expect(screen.getByText('95% confidence')).toHaveClass('text-[var(--text-secondary)]');
    expect(screen.getByText('model year: matched')).toHaveClass('text-[var(--text-secondary)]');
    expect(screen.getByText('Completion unknown')).toHaveClass('text-[var(--text-secondary)]');
    for (const label of ['NHTSA park-it warning', 'NHTSA park-outside warning']) {
      expect(screen.getByText(label)).toHaveClass('text-[var(--semantic-danger)]');
    }
    const link = screen.getByRole('link', { name: 'Open NHTSA campaign' });
    expect(link).toHaveClass(...ghostLinkClasses);
    expect(link).toHaveAttribute('href', serviceReport.recall_findings[0].source_document_url);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('distinguishes applicability from confidence and keeps hypothesis chrome neutral', () => {
    render(<CommunicationsPanel {...props} communications={[
      props.communications[0],
      { ...props.communications[0], id: 'unlikely', applicability: 'unlikely', symptom_matches: [] },
      { ...props.communications[0], id: 'potential', applicability: 'potentially_applicable', symptom_matches: [] },
    ]} />);
    expect(screen.getByText('Needs review')).toHaveClass('text-[var(--semantic-info)]');
    expect(screen.getByText('Unlikely')).toHaveClass('text-[var(--text-secondary)]');
    expect(screen.getByText('Potentially applicable')).toHaveClass('text-[var(--semantic-warning)]');
    for (const confidence of screen.getAllByText('41% confidence')) {
      expect(confidence).toHaveClass('text-[var(--text-secondary)]');
    }
    for (const hypothesis of screen.getAllByText('Applicability hypothesis')) {
      expect(hypothesis.parentElement).toHaveClass('bg-[var(--surface-2)]', 'border-[var(--border-subtle)]');
    }
    for (const link of screen.getAllByRole('link', { name: 'Open official NHTSA document' })) {
      expect(link).toHaveClass(...ghostLinkClasses);
    }
  });

  it('renders recall report dates as calendar publications without inventing an instant', () => {
    render(<RecallFindingCard finding={serviceReport.recall_findings[0]} />);
    expect(screen.getByTitle('2026-07-01')).toHaveTextContent('Jul 1, 2026');
    expect(screen.getByText('Published campaign summary.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open NHTSA campaign' }))
      .toHaveAttribute('href', serviceReport.recall_findings[0].source_document_url);
  });

  it('keeps supplied bulletin content when a publication day is missing or invalid', () => {
    render(<CommunicationsPanel {...props} communications={[
      { ...props.communications[0], published_at: null },
      { ...props.communications[0], id: 'invalid-date', published_at: '2026-02-30' },
    ]} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(within(row).getByText('Returned bulletin summary.')).toBeInTheDocument();
      expect(within(row).getByText('—', { exact: false })).toBeInTheDocument();
      expect(within(row).getByRole('link', { name: 'Open official NHTSA document' })).toBeInTheDocument();
    }
    expect(screen.queryByTitle('2026-02-30')).not.toBeInTheDocument();
  });

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
    expect(within(rows[0]).getByTitle('2026-07-02')).toHaveTextContent('Jul 2, 2026');
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
    expect(screen.getByRole('link', { name: 'Review NHTSA datasets' }))
      .toHaveClass(...ghostLinkClasses);
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
