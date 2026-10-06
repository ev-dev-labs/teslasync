import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { deriveDataState } from '@/api/dataState';
import { EvidenceSourceNotice } from './EvidenceSourceNotice';

describe('EvidenceSourceNotice', () => {
  it('exposes the aggregate-source limitation without inventing per-signal freshness on fresh evidence', () => {
    render(<EvidenceSourceNotice
      state={deriveDataState({ data: [{ signal: 'Soc' }] }, { provenance: 'historical' })}
      label="Signal history"
      hasChosenSignal
    />);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('This source does not provide per-signal freshness or individual failure details.');
  });

  it('keeps the existing retained-source retry and failure explanation independent of other sources', () => {
    const retry = vi.fn();
    render(<EvidenceSourceNotice
      state={deriveDataState({
        data: [{ signal: 'Soc' }],
        error: new Error('aggregate refresh failure'),
        refetch: retry,
      }, { provenance: 'historical' })}
      label="Signal history"
      hasChosenSignal
    />);
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByText('Some signal histories could not be refreshed. Available evidence remains visible.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('does not imply a selected history source before a focal signal has been chosen', () => {
    render(<EvidenceSourceNotice
      state={deriveDataState({ data: undefined })}
      label="Signal history"
      hasChosenSignal={false}
    />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
  });

  it('preserves the shared offline explanation when a retained refresh error is also present', () => {
    render(<EvidenceSourceNotice
      state={deriveDataState({
        data: [{ signal: 'Soc' }],
        error: new Error('previous refresh failed'),
        fetchStatus: 'paused',
      })}
      label="Signal history"
      hasChosenSignal
    />);
    expect(screen.getByText('The device is offline, so this section is showing the last values it received.')).toBeInTheDocument();
    expect(screen.queryByText('Some signal histories could not be refreshed. Available evidence remains visible.')).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toBeInTheDocument();
  });
});
