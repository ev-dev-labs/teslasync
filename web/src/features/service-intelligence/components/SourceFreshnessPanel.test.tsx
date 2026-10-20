import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { serviceReport } from '../pages/ServiceIntelligencePage.closure.fixtures';
import { SourceFreshnessPanel } from './SourceFreshnessPanel';

const props = {
  selected: true,
  loading: false,
  error: null,
  sources: serviceReport.sources,
  onRetry: vi.fn(),
};

describe('SourceFreshnessPanel supplied source evidence', () => {
  it('keeps server ordering, stale cache provenance and unavailable maintenance metadata independently visible', () => {
    render(<SourceFreshnessPanel {...props} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Official communications index')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Stale')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Normalized cache')).toBeInTheDocument();
    expect(within(rows[0]).getByText('1 records')).toBeInTheDocument();
    expect(within(rows[0]).getByTitle('2026-07-02T10:00:00.000Z')).toBeInTheDocument();
    expect(within(rows[0]).getByTitle('2026-08-05T08:00:00.000Z')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Maintenance evidence source')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Unavailable')).toBeInTheDocument();
    expect(within(rows[1]).getByText('0 records')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Maintenance retrieval is unavailable; absence is not completion evidence.'))
      .toBeInTheDocument();
    expect(within(rows[1]).queryByText('Normalized cache')).not.toBeInTheDocument();
    expect(within(rows[1]).queryByText('Available')).not.toBeInTheDocument();
    expect(within(rows[1]).getByText('—')).toBeInTheDocument();
    expect(within(rows[1]).getByTitle('2026-08-05T08:00:00.000Z')).toBeInTheDocument();
    for (const [index, source] of props.sources.entries()) {
      const row = within(rows[index]);
      expect(row.getByText(/Checked/)).toBeInTheDocument();
      expect(row.getByText(/Fetched/)).toBeInTheDocument();
      const link = row.getByRole('link', { name: 'Open source' });
      expect(link).toHaveAttribute('href', source.source_url);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('preserves the source shell and truthful empty metadata state without fabricating a freshness timestamp', () => {
    render(<SourceFreshnessPanel {...props} sources={[]} />);
    expect(screen.getByRole('heading', { name: 'Source freshness' })).toBeInTheDocument();
    expect(screen.getByText('No source metadata')).toBeInTheDocument();
    expect(screen.getByText('Source freshness metadata is not available yet.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open source' })).not.toBeInTheDocument();
    expect(screen.queryByText('Available')).not.toBeInTheDocument();
  });
});
