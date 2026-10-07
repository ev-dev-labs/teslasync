import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EvidenceLimitationsPanel } from './EvidenceLimitationsPanel';
import type { ServiceIntelligenceEvidenceBundle } from '@/api/hooks/useServiceIntelligence';

describe('Service evidence remains domain-owned', () => {
  it('retains interpretation limits and the supplied disclaimer even when the evidence inventory is genuinely empty', () => {
    render(
      <EvidenceLimitationsPanel selected loading={false} error={null}
        evidence={{
          schema_version: '1',
          items: [],
          limitations: ['No returned maintenance record confirms campaign completion.'],
          disclaimer: 'An empty evidence inventory is not a clean bill of health.',
        }}
        onRetry={vi.fn()} />,
    );
    expect(screen.getByRole('heading', { name: 'Evidence & limitations' })).toBeInTheDocument();
    expect(screen.getByText('0 items')).toBeInTheDocument();
    expect(screen.getByText('No returned maintenance record confirms campaign completion.')).toBeInTheDocument();
    expect(screen.getByText('An empty evidence inventory is not a clean bill of health.')).toBeInTheDocument();
    expect(screen.queryByText('No evidence bundle')).not.toBeInTheDocument();
  });

  it('preserves supplied evidence order, links, limitations and disclaimer without inferring diagnosis', () => {
    const evidence: ServiceIntelligenceEvidenceBundle = {
      schema_version: '1',
      items: [
        { id: 'later', kind: 'signal_history', title: 'First supplied evidence', summary: 'Observed overlap, not a finding of fault.', source_name: 'Historical signals', source_document_url: 'https://example.org/first', observed_at: '2026-08-02', confidence: 0.2, finding_id: null },
        { id: 'earlier', kind: 'recall', title: 'Second supplied evidence', summary: 'Published campaign, completion unknown.', source_name: 'Official publication', source_document_url: 'https://example.org/second', observed_at: '2026-07-01', confidence: 0.9, finding_id: 'campaign' },
      ],
      limitations: ['Completion requires confirmation.', 'Observed overlap does not establish cause.'],
      disclaimer: 'Confirm with a qualified technician.',
    };
    render(<EvidenceLimitationsPanel selected loading={false} error={null} evidence={evidence} onRetry={vi.fn()} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('First supplied evidence');
    expect(rows[1]).toHaveTextContent('Second supplied evidence');
    expect(within(rows[0]).getByRole('link', { name: 'Open evidence source' })).toHaveAttribute('href', 'https://example.org/first');
    expect(within(rows[1]).getByRole('link', { name: 'Open evidence source' })).toHaveAttribute('href', 'https://example.org/second');
    expect(screen.getByText(evidence.limitations[0])).toBeInTheDocument();
    expect(screen.getByText(evidence.limitations[1])).toBeInTheDocument();
    expect(screen.getByText(evidence.disclaimer)).toBeInTheDocument();
    expect(screen.getByText('Observed overlap, not a finding of fault.')).toBeInTheDocument();
    expect(screen.getByText('Published campaign, completion unknown.')).toBeInTheDocument();
  });
});
