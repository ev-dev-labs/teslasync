import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import type { DataQuality, Evidence } from '@/types/advancedIntelligence';
import { EvidencePanel } from './EvidencePanel';

const quality: DataQuality = {
  status: 'limited', sample_count: 0, coverage_pct: 0,
  window_start: '2026-01-15T00:30:00Z', window_end: null,
  reasons: ['Synthetic observation gap.'],
};
const evidence: Evidence[] = [{
  source: 'synthetic-ledger', summary: 'Synthetic retained observation.',
  sample_count: 0, observed_at: quality.window_start,
}];
const payload = { quality, evidence, limitations: ['Synthetic uncertainty.'] };
const clients: QueryClient[] = [];

afterEach(() => {
  cleanup();
  clients.forEach(client => client.clear());
  clients.length = 0;
});

function panel(query?: DataStateSource<unknown>) {
  return <EvidencePanel query={query} quality={quality} evidence={evidence}
    limitations={payload.limitations} unsupported={['No identity attribution.']} />;
}

function expectShells() {
  expect(screen.getByRole('heading', { name: 'Evidence, quality, and limitations' })).toBeVisible();
  for (const name of ['Data quality', 'Evidence sources', 'Limitations']) {
    expect(screen.getByRole('region', { name })).toBeVisible();
  }
  expect(screen.getByText('Explicitly unsupported')).toBeVisible();
  expect(screen.getByText('• No identity attribution.')).toBeVisible();
}

describe('EvidencePanel source trust', () => {
  it.each([
    { phase: 'initial fetching', query: { isLoading: true, fetchStatus: 'fetching' as const } },
    { phase: 'pending fetching', query: { isPending: true, fetchStatus: 'fetching' as const } },
    { phase: 'initial paused', query: { isPending: true, fetchStatus: 'paused' as const } },
    { phase: 'unresolved idle', query: { isPending: true, fetchStatus: 'idle' as const } },
    { phase: 'initial fatal', query: { error: new Error('Synthetic initial failure'), isError: true } },
    { phase: 'success flag without payload', query: { isSuccess: true, fetchStatus: 'idle' as const } },
  ])('keeps every shell and static disclosure but makes no result claims during $phase', ({ query }) => {
    render(panel({ ...query, refetch: vi.fn() }));
    expectShells();
    expect(screen.queryByText('Limited evidence')).not.toBeInTheDocument();
    expect(screen.queryByText('synthetic-ledger')).not.toBeInTheDocument();
    expect(screen.queryByText('• Synthetic uncertainty.')).not.toBeInTheDocument();
    expect(screen.queryByText('Quality metadata is unsupported.')).not.toBeInTheDocument();
    expect(screen.queryByText('No supporting evidence was returned.')).not.toBeInTheDocument();
    expect(screen.queryByText('No additional limitations were returned.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry|refresh/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    if (query.fetchStatus === 'fetching') {
      for (const name of ['Data quality', 'Evidence sources', 'Limitations']) {
        expect(screen.getByRole('status', { name: `Loading ${name}` })).toBeVisible();
      }
    } else {
      expect(screen.getAllByText('Unknown')).toHaveLength(3);
    }
  });

  it('only selects returned-empty messages after an actual payload exists', () => {
    const view = render(<EvidencePanel query={{ isPending: true }} unsupported={['No identity attribution.']} />);
    expectShells();
    expect(screen.queryByText('No supporting evidence was returned.')).not.toBeInTheDocument();
    view.rerender(<EvidencePanel query={{ data: { items: [] }, isSuccess: true }}
      unsupported={['No identity attribution.']} />);
    expectShells();
    expect(screen.getByText('Quality metadata is unsupported.')).toBeVisible();
    expect(screen.getByText('No supporting evidence was returned.')).toBeVisible();
    expect(screen.getByText('No additional limitations were returned.')).toBeVisible();
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
  });

  it.each([
    { phase: 'populated', state: {} },
    { phase: 'background refresh', state: { isFetching: true, fetchStatus: 'fetching' as const } },
    { phase: 'retained error', state: { isError: true, error: new Error('Synthetic refresh failure') } },
    { phase: 'retained paused', state: { fetchStatus: 'paused' as const } },
  ])('preserves source values and static disclosures during $phase without duplicating parent recovery', ({ state }) => {
    render(panel({ data: payload, dataUpdatedAt: Date.parse('2026-01-15T00:31:00Z'), ...state }));
    expectShells();
    const qualitySection = within(screen.getByRole('region', { name: 'Data quality' }));
    expect(qualitySection.getByText('Limited evidence')).toBeVisible();
    expect(qualitySection.getByText('0')).toBeVisible();
    expect(qualitySection.getByText('0.00%')).toBeVisible();
    expect(qualitySection.getByText('• Synthetic observation gap.')).toBeVisible();
    expect(screen.getByText('synthetic-ledger')).toBeVisible();
    expect(screen.getByText('Synthetic retained observation.')).toBeVisible();
    expect(screen.getByText(/0 samples/)).toBeVisible();
    expect(screen.getByText('• Synthetic uncertainty.')).toBeVisible();
    expect(screen.queryByRole('button', { name: /retry|refresh/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(quality.sample_count).toBe(0);
    expect(evidence[0].observed_at).toBe('2026-01-15T00:30:00Z');
  });

  it.each([
    { phase: 'refresh error', state: { error: new Error('Synthetic empty refresh failure') } },
    { phase: 'paused refresh', state: { fetchStatus: 'paused' as const } },
  ])('retains authoritative empty metadata during $phase', ({ state }) => {
    render(<EvidencePanel query={{ data: { items: [] }, ...state }} quality={null}
      evidence={[]} limitations={[]} unsupported={['No identity attribution.']} />);
    expectShells();
    expect(screen.getByText('Quality metadata is unsupported.')).toBeVisible();
    expect(screen.getByText('No supporting evidence was returned.')).toBeVisible();
    expect(screen.getByText('No additional limitations were returned.')).toBeVisible();
  });

  it('keeps the original query-free populated and absent-prop consumer behavior', () => {
    const view = render(panel());
    expectShells();
    expect(screen.getByText('synthetic-ledger')).toBeVisible();
    view.rerender(<EvidencePanel quality={null} evidence={null} limitations={null} unsupported={null} />);
    for (const name of ['Data quality', 'Evidence sources', 'Limitations']) {
      expect(screen.getByRole('region', { name })).toBeVisible();
    }
    expect(screen.getByText('Quality metadata is unsupported.')).toBeVisible();
    expect(screen.getByText('No supporting evidence was returned.')).toBeVisible();
    expect(screen.getByText('No additional limitations were returned.')).toBeVisible();
  });

  it('follows a real query rejection retry retained refresh failure and recovery without fabricated readiness', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    clients.push(client);
    let rejectRequest = true;
    const read = vi.fn(async () => {
      if (rejectRequest) throw new Error('Synthetic request failure');
      return payload;
    });
    function Subject() {
      const query = useQuery({ queryKey: ['synthetic-evidence-trust'], queryFn: read });
      return <EvidencePanel query={query} quality={query.data?.quality} evidence={query.data?.evidence}
        limitations={query.data?.limitations} unsupported={['No identity attribution.']} />;
    }
    render(<QueryClientProvider client={client}><Subject /></QueryClientProvider>);
    const sourceRoot = screen.getByRole('region', { name: 'Data quality' }).parentElement;
    await waitFor(() => expect(client.getQueryState(['synthetic-evidence-trust'])?.status).toBe('error'));
    await waitFor(() => expect(sourceRoot).toHaveAttribute('data-source-status', 'initialFailure'));
    expectShells();
    expect(screen.getAllByText('Unknown')).toHaveLength(3);
    expect(client.getQueryData(['synthetic-evidence-trust'])).toBeUndefined();
    rejectRequest = false;
    await act(async () => { await client.refetchQueries({ queryKey: ['synthetic-evidence-trust'] }); });
    expect(client.getQueryState(['synthetic-evidence-trust'])?.status).toBe('success');
    expect(client.getQueryData(['synthetic-evidence-trust'])).toBe(payload);
    // The cache settles before its batched observer notification reaches React.
    await waitFor(() => {
      expect(screen.getByText('synthetic-ledger')).toBeVisible();
      expect(sourceRoot).toHaveAttribute('data-source-status', 'ok');
    });
    const successfulAt = client.getQueryState(['synthetic-evidence-trust'])?.dataUpdatedAt;
    expect(successfulAt).toBeGreaterThan(0);
    rejectRequest = true;
    await act(async () => { await client.refetchQueries({ queryKey: ['synthetic-evidence-trust'] }); });
    expect(client.getQueryState(['synthetic-evidence-trust'])?.status).toBe('error');
    await waitFor(() => {
      expect(screen.getByText('synthetic-ledger')).toBeVisible();
      expect(sourceRoot).toHaveAttribute('data-source-status', 'stale');
    });
    expect(client.getQueryData(['synthetic-evidence-trust'])).toBe(payload);
    expect(client.getQueryState(['synthetic-evidence-trust'])?.dataUpdatedAt).toBe(successfulAt);
    rejectRequest = false;
    await act(async () => { await client.refetchQueries({ queryKey: ['synthetic-evidence-trust'] }); });
    expect(read).toHaveBeenCalledTimes(4);
    expect(client.getQueryState(['synthetic-evidence-trust'])?.status).toBe('success');
    expect(client.getQueryData(['synthetic-evidence-trust'])).toBe(payload);
    await waitFor(() => {
      expect(screen.getByText('• Synthetic uncertainty.')).toBeVisible();
      expect(sourceRoot).toHaveAttribute('data-source-status', 'ok');
    });
  });
});
