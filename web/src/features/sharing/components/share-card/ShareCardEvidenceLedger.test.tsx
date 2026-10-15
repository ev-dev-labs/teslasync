import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { request } from '@/api/client';
import { useDrives, drivingKeys } from '@/api/hooks/useDriving';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { analyzeShareCard } from '../../lib/shareCard';
import { ShareCardEvidenceLedger } from './ShareCardEvidenceLedger';
import { shareCardQueryState } from './queryState';
import type { ShareCardDisplay } from './types';

vi.mock('@/api/client', () => ({ request: vi.fn() }));
vi.mock('@/api/hooks/_toastHelpers', () => ({ useMutationToast: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}));
vi.mock('../operationalbrief-all/ShareCardBrief', () => ({
  ShareCardBrief: ({ metrics }: { metrics: readonly StatMetric[] }) => (
    <dl>{metrics.map((metric) => (
      <div key={metric.occurrenceId}>
        <dt>{metric.label}</dt>
        <dd data-testid={`metric-${metric.occurrenceId}`}>{metric.rawValue ?? 'unknown'}</dd>
      </div>
    ))}</dl>
  ),
}));

const window = {
  startLabel: '2026-10-01', endLabel: '2026-10-02',
  startInstant: '2026-10-01T00:00:00Z', endInstantExclusive: '2026-10-03T00:00:00Z',
  timezone: 'UTC',
};
const options = { start: window.startInstant, end: window.endInstantExclusive, limit: 1000 };
const format = (value: number | null | undefined) => value == null ? 'unknown' : String(value);
const display: ShareCardDisplay = {
  distanceUnit: 'km', durationUnit: 's', energyUnit: 'Wh',
  formatNumber: format, formatDistance: format, formatDuration: format, formatEnergy: format,
  formatSpeed: format, formatTemperature: format, formatEfficiency: format, formatPercent: format,
  formatMonth: (value) => value, distanceValue: (value) => value,
  durationValue: (value) => value, energyValue: (value) => value,
};
const emptyMessage = 'The drive endpoint returned a valid empty array for this selected window.';
const retainedMessage = 'Cached evidence remains visible, but the refresh failed.';

function Ledger() {
  const query = useDrives('7', options);
  return (
    <ShareCardEvidenceLedger
      analysis={analyzeShareCard(query.data ?? [], window)}
      state={shareCardQueryState(query, true, () => { void query.refetch(); })}
      display={display}
    />
  );
}

let client: QueryClient;
beforeEach(() => {
  vi.mocked(request).mockReset();
  onlineManager.setOnline(true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => {
  client.clear();
  onlineManager.setOnline(true);
});
function mount() {
  return render(<QueryClientProvider client={client}><Ledger /></QueryClientProvider>);
}
async function refresh() {
  await act(async () => {
    await client.refetchQueries({ queryKey: drivingKeys.drives('7', options) });
  });
}

describe('ShareCardEvidenceLedger typed response boundary', () => {
  it('keeps active loading unknown until the request returns', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(request).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    mount();
    expect(screen.getByRole('status', { name: 'Loading share card evidence' })).toBeInTheDocument();
    expect(screen.getByTestId('metric-returned')).toHaveTextContent('unknown');
    expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();
    await act(async () => { resolve([]); });
    expect(await screen.findByText(emptyMessage)).toBeInTheDocument();
    expect(screen.getByTestId('metric-returned')).toHaveTextContent('0');
  });

  it('does not infer emptiness from a paused query without data', () => {
    onlineManager.setOnline(false);
    mount();
    expect(screen.getByText('The initial query is paused while the network is unavailable; no empty response is inferred.')).toBeInTheDocument();
    expect(screen.getByTestId('metric-returned')).toHaveTextContent('unknown');
    expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([[], null])('preserves successful empty and intentional null compatibility (%j)', async (response) => {
    vi.mocked(request).mockResolvedValueOnce(response);
    mount();
    expect(await screen.findByText(emptyMessage)).toBeInTheDocument();
    expect(screen.getByTestId('metric-returned')).toHaveTextContent('0');
    expect(screen.getByTestId('metric-distance')).toHaveTextContent('unknown');
    expect(client.getQueryData(drivingKeys.drives('7', options))).toEqual([]);
  });

  it.each([{}, { drives: [] }, 'invalid', 0, undefined])('rejects malformed success instead of authoritative empty (%j)', async (response) => {
    vi.mocked(request).mockResolvedValueOnce(response);
    mount();
    expect(await screen.findByText('Selected-window drive evidence is unavailable.')).toBeInTheDocument();
    expect(screen.getByTestId('metric-returned')).toHaveTextContent('unknown');
    expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();
    expect(client.getQueryData(drivingKeys.drives('7', options))).toBeUndefined();
    expect(client.getQueryState(drivingKeys.drives('7', options))?.error?.message).toBe(
      'Invalid drive history response: expected an array',
    );
    vi.mocked(request).mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry evidence query' }));
    expect(await screen.findByText(emptyMessage)).toBeInTheDocument();
  });

  it('leaves row qualification to the evidence model without dropping returned rows', async () => {
    const rows = [null, { id: 'invalid' }];
    vi.mocked(request).mockResolvedValueOnce(rows);
    mount();
    expect(await screen.findByText(
      'Rows were returned, but none passed identity and selected-window timestamp validation.',
    )).toBeInTheDocument();
    expect(screen.getByTestId('metric-returned')).toHaveTextContent('2');
    expect(screen.getByTestId('metric-eligible')).toHaveTextContent('0');
    expect(client.getQueryData(drivingKeys.drives('7', options))).toEqual(rows);
    expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();
  });

  it('preserves measured zero and valid cached rows through malformed refresh, then recovers', async () => {
    const rows = [{
      id: 1, startTs: '2026-10-01T12:00:00Z',
      distanceM: 0, durationS: 0, energyUsedWh: 0,
    }];
    vi.mocked(request).mockResolvedValueOnce(rows);
    mount();
    await waitFor(() => expect(screen.getByTestId('metric-eligible')).toHaveTextContent('1'));
    expect(screen.getByTestId('metric-distance')).toHaveTextContent('0');
    expect(screen.getByTestId('metric-duration')).toHaveTextContent('0');
    expect(screen.getByTestId('metric-energy')).toHaveTextContent('0');
    vi.mocked(request).mockResolvedValueOnce({ drives: [] });
    await refresh();
    expect(await screen.findByText(retainedMessage)).toBeInTheDocument();
    expect(screen.getByTestId('metric-returned')).toHaveTextContent('1');
    expect(screen.getByTestId('metric-distance')).toHaveTextContent('0');
    expect(client.getQueryData(drivingKeys.drives('7', options))).toEqual(rows);
    expect(screen.queryByText(emptyMessage)).not.toBeInTheDocument();
    vi.mocked(request).mockRejectedValueOnce(new Error('Network unavailable'));
    await refresh();
    expect(await screen.findByText(retainedMessage)).toBeInTheDocument();
    expect(screen.getByTestId('metric-returned')).toHaveTextContent('1');
    expect(client.getQueryData(drivingKeys.drives('7', options))).toEqual(rows);
    vi.mocked(request).mockResolvedValueOnce([]);
    await refresh();
    expect(await screen.findByText(emptyMessage)).toBeInTheDocument();
    expect(screen.queryByText(retainedMessage)).not.toBeInTheDocument();
    expect(screen.getByTestId('metric-returned')).toHaveTextContent('0');
  });
});
