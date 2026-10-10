import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { deriveDataState } from '@/api/dataState';
import type { SignalEvidenceBundleSource } from '@/api/hooks/useTelemetry';
import type { SignalHistoryResponse, SignalPoint } from '@/types/telemetry';
import { SignalEvidenceSourceList } from './SignalEvidenceSourceList';
import { hasSignalHistory } from '../lib/signalEvidenceAvailability';

function response(signal: string, data: SignalPoint[]): SignalHistoryResponse {
  return { vehicleId: 7, signal, from: '2026-10-06T00:00:00Z', to: '2026-10-06T01:00:00Z', count: data.length, data };
}

function row(signal: string): HTMLElement {
  return screen.getByText(signal).closest('[data-signal-source]') as HTMLElement;
}

describe('complete signal evidence source presentation', () => {
  it('keeps a measured zero ready beside a pending identity without fabricating pending samples', () => {
    const zero = response('Speed', [{ timestamp: '2026-10-06T00:00:00Z', valueNum: 0 }]);
    const sources: SignalEvidenceBundleSource[] = [
      { signal: 'Speed', state: deriveDataState({ data: zero }, { provenance: 'historical' }) },
      { signal: 'Heading', state: deriveDataState({ isPending: true, isLoading: true }) },
    ];
    render(<SignalEvidenceSourceList sources={sources} label="History" />);
    expect(within(row('Speed')).getByText('Ready')).toBeInTheDocument();
    expect(within(row('Speed')).getByText('1 sample(s)')).toBeInTheDocument();
    expect(sources[0].state.data).toBe(zero);
    expect(sources[0].state.data?.data[0].valueNum).toBe(0);
    expect(hasSignalHistory(sources, 'Speed')).toBe(true);
    expect(hasSignalHistory(sources, 'Heading')).toBe(false);
    expect(hasSignalHistory(sources, 'MissingIdentity')).toBe(false);
    expect(within(row('Heading')).getByText('Pending')).toBeInTheDocument();
    expect(within(row('Heading')).getByRole('status', { name: 'Loading Heading' })).toBeInTheDocument();
    expect(within(row('Heading')).queryByText(/sample\(s\)/)).toBeNull();
    expect(within(row('Heading')).queryByText('Unavailable')).toBeNull();
  });

  it('keeps ready evidence alongside initial failure and retries only the failed source', () => {
    const retryReady = vi.fn();
    const retryFailed = vi.fn();
    render(<SignalEvidenceSourceList label="History" sources={[
      { signal: 'Soc', state: deriveDataState({ data: response('Soc', [{ timestamp: '2026-10-06T00:00:00Z', valueNum: 0 }]), refetch: retryReady }) },
      { signal: 'Voltage', state: deriveDataState({ error: new Error('Voltage request failed'), refetch: retryFailed }) },
    ]} />);
    expect(within(row('Soc')).getByText('Ready')).toBeInTheDocument();
    expect(within(row('Voltage')).getByRole('alert')).toHaveTextContent('Voltage request failed');
    expect(within(row('Voltage')).queryByText(/sample\(s\)/)).toBeNull();
    fireEvent.click(within(row('Voltage')).getByRole('button', { name: 'Retry' }));
    expect(retryFailed).toHaveBeenCalledTimes(1);
    expect(retryReady).not.toHaveBeenCalled();
  });

  it('distinguishes resolved empty history from nonnumeric received history', () => {
    const sources: SignalEvidenceBundleSource[] = [
      { signal: 'Empty', state: deriveDataState({ data: response('Empty', []) }, { unavailable: true }) },
      { signal: 'Gear', state: deriveDataState({ data: response('Gear', [{ timestamp: '2026-10-06T00:00:00Z', valueStr: 'Park' }]) }) },
    ];
    render(<SignalEvidenceSourceList label="History" sources={sources} />);
    expect(hasSignalHistory(sources, 'Empty')).toBe(false);
    expect(hasSignalHistory(sources, 'Gear')).toBe(true);
    expect(within(row('Empty')).getByText('Unavailable')).toBeInTheDocument();
    expect(within(row('Empty')).getByText('No data available for this period')).toBeInTheDocument();
    expect(within(row('Empty')).queryByText('0 sample(s)')).toBeNull();
    expect(within(row('Empty')).queryByTestId('stale-refresh-warning')).toBeNull();
    expect(within(row('Gear')).getByText('Ready')).toBeInTheDocument();
    expect(within(row('Gear')).getByText('1 sample(s)')).toBeInTheDocument();
    expect(within(row('Gear')).queryByText('Unavailable')).toBeNull();
  });

  it('preserves the original retained payload and last-success timestamp with source-specific recovery', () => {
    const retry = vi.fn();
    const neighborRetry = vi.fn();
    const retained = response('Speed', [{ timestamp: '2026-10-06T00:00:00Z', valueNum: 0 }]);
    const updatedAt = Date.UTC(2026, 9, 6, 0, 30);
    const state = deriveDataState({ data: retained, dataUpdatedAt: updatedAt, error: new Error('Speed refresh failed'), refetch: retry }, { provenance: 'historical' });
    render(<SignalEvidenceSourceList label="History" sources={[
      { signal: 'Speed', state },
      { signal: 'Heading', state: deriveDataState({ data: response('Heading', [{ timestamp: '2026-10-06T00:00:00Z', valueNum: 90 }]), refetch: neighborRetry }) },
    ]} />);
    expect(state.data).toBe(retained);
    expect(state.updatedAt).toBe(updatedAt);
    expect(state.fatalError).toBeNull();
    expect(within(row('Speed')).getByText('Cached · refresh failed')).toBeInTheDocument();
    expect(within(row('Speed')).getByText(`Last updated: ${new Date(updatedAt).toLocaleString()}`)).toBeInTheDocument();
    expect(within(row('Speed')).getByText('1 sample(s)')).toBeInTheDocument();
    expect(within(row('Heading')).getByText('Ready')).toBeInTheDocument();
    fireEvent.click(within(row('Speed')).getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(neighborRetry).not.toHaveBeenCalled();
    expect(state.data?.data[0].valueNum).toBe(0);
  });

  it('renders all eight normalized identities in hook order, regardless of their outcomes', () => {
    const names = ['Speed', 'Heading', 'Gear', 'Soc', 'Voltage', 'Current', 'Temperature', 'Torque'];
    const sources = names.map((signal, index) => ({
      signal,
      state: index % 3 === 0
        ? deriveDataState({ data: response(signal, [{ timestamp: '2026-10-06T00:00:00Z', valueNum: 0 }]) })
        : index % 3 === 1 ? deriveDataState<SignalHistoryResponse>({ isPending: true })
        : deriveDataState<SignalHistoryResponse>({ error: new Error(`${signal} failed`) }),
    }));
    const { container } = render(<SignalEvidenceSourceList sources={sources} label="History" />);
    expect(Array.from(container.querySelectorAll('[data-signal-source]'), element => element.getAttribute('data-signal-source'))).toEqual(names);
    expect(sources.map(source => source.signal)).toEqual(names);
  });
});
