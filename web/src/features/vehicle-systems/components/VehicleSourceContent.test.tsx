import type { ReactElement } from 'react';
import { fireEvent, render as renderTesting, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { deriveDataState, type DataStateSource } from '@/api/dataState';
import { VehicleSourceContent } from './VehicleSourceContent';
import { VehicleSourcePause } from './VehicleSourcePause';

interface Snapshot {
  pressure: number | null;
  locked: boolean | null;
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
    i18n: { language: 'en' },
  }),
}));

function source(overrides: DataStateSource<Snapshot> = {}) {
  return deriveDataState<Snapshot>({ isSuccess: true, ...overrides }, {
    provenance: 'historical',
  });
}

function render(ui: ReactElement) {
  return renderTesting(ui, { wrapper: MemoryRouter });
}

describe('vehicle source presentation preserves independent domain bodies', () => {
  it('does not infer an empty response from an initial offline pause and keeps a source-local retry', () => {
    const retry = vi.fn();
    const view = render(<VehicleSourcePause label="Climate" retained={false} onRetry={retry}
      message="Climate loading is paused; no empty response is inferred." />);
    expect(screen.getByText('Climate loading is paused; no empty response is inferred.')).toBeInTheDocument();
    expect(screen.queryByText(/Previously loaded data/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalledTimes(1);
    view.rerender(<VehicleSourcePause label="Climate" retained onRetry={retry}
      message="Climate loading is paused; no empty response is inferred." />);
    expect(screen.getByRole('status')).toHaveTextContent(/Previously loaded data remains visible/);
  });

  it('replaces only a fatal source and retries its read without hiding a neighbor', () => {
    const retry = vi.fn();
    render(
      <>
        <VehicleSourceContent
          source={source({ isError: true, error: new Error('Unavailable'), refetch: retry })}
          label="Pressure history"
        >
          <p>Unavailable pressure body</p>
        </VehicleSourceContent>
        <VehicleSourceContent source={source({ data: { pressure: 0, locked: false } })} label="Security">
          <p>Security remains usable</p>
        </VehicleSourceContent>
      </>,
    );
    expect(screen.queryByText('Unavailable pressure body')).not.toBeInTheDocument();
    expect(screen.getByText('Security remains usable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it.each(['refresh-error', 'paused'] as const)('retains real zero and false during %s', mode => {
    const retry = vi.fn();
    const retained = source({
      data: { pressure: 0, locked: false },
      refetch: retry,
      ...(mode === 'paused'
        ? { fetchStatus: 'paused' as const }
        : { isError: true, error: new Error('Refresh failure') }),
    });
    render(
      <VehicleSourceContent source={retained} label="Security">
        <p>Measured pressure: {retained.data?.pressure}</p>
        <p>Measured locked: {String(retained.data?.locked)}</p>
      </VehicleSourceContent>,
    );
    expect(screen.getByText('Measured pressure: 0')).toBeInTheDocument();
    expect(screen.getByText('Measured locked: false')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/Previously loaded data remains visible/);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('leaves specialist prerequisites and unresolved loading with their callers', () => {
    const retry = vi.fn();
    const view = render(
      <VehicleSourceContent enabled={false}
        source={source({ isError: true, error: new Error('Disabled source'), refetch: retry })}
        label="Climate"
      >
        <p>Select a vehicle before loading climate</p>
      </VehicleSourceContent>,
    );
    expect(screen.getByText('Select a vehicle before loading climate')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
    view.rerender(
      <VehicleSourceContent source={source({ isPending: true })} label="Climate">
        <p>Waiting for independent climate evidence</p>
      </VehicleSourceContent>,
    );
    expect(screen.getByText('Waiting for independent climate evidence')).toBeInTheDocument();
    expect(retry).not.toHaveBeenCalled();
  });

  it('does not turn missing observations into zero or disabled state', () => {
    const unknown = source({ data: { pressure: null, locked: null } });
    render(
      <VehicleSourceContent source={unknown} label="Pressure">
        <p>Pressure: {unknown.data?.pressure ?? 'unknown'}</p>
        <p>Locked: {unknown.data?.locked == null ? 'unknown' : String(unknown.data.locked)}</p>
      </VehicleSourceContent>,
    );
    expect(screen.getByText('Pressure: unknown')).toBeInTheDocument();
    expect(screen.getByText('Locked: unknown')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
