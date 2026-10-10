import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { deriveDataState } from '@/api/dataState';
import type { BenchmarkPrivacyStatus } from '@/api/hooks/useBenchmarks';
import { ConsentGate } from './ConsentGate';

describe('ConsentGate', () => {
  it('requires explicit acknowledgement before opt-in', () => {
    const onConsent = vi.fn();
    const onAcknowledgedChange = vi.fn();
    const { rerender } = render(
      <ConsentGate
        optedIn={false}
        acknowledged={false}
        pending={false}
        error={null}
        onAcknowledgedChange={onAcknowledgedChange}
        onConsent={onConsent}
      />,
    );
    expect(screen.getByRole('button', { name: 'Opt in' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onAcknowledgedChange).toHaveBeenCalledWith(true);

    rerender(
      <ConsentGate
        optedIn={false}
        acknowledged
        pending={false}
        error={null}
        onAcknowledgedChange={onAcknowledgedChange}
        onConsent={onConsent}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opt in' }));
    expect(onConsent).toHaveBeenCalledTimes(1);
  });

  it('states that stable refreshes do not spend budget', () => {
    render(
      <ConsentGate
        optedIn
        acknowledged={false}
        pending={false}
        error={null}
        onAcknowledgedChange={vi.fn()}
        onConsent={vi.fn()}
      />,
    );
    expect(screen.getByText(/Refreshes reuse a stable release/i)).toBeInTheDocument();
  });

  it('the entire acknowledgement and action stays inside the source boundary on initial failure', () => {
    const onConsent = vi.fn();
    const retry = vi.fn();
    const source = deriveDataState<BenchmarkPrivacyStatus>({
      error: new Error('status failed'), refetch: retry,
    });
    const { container } = render(
      <MemoryRouter>
        <ConsentGate optedIn={false} acknowledged pending={false} error={null}
          onAcknowledgedChange={vi.fn()} onConsent={onConsent} source={source} />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-card]')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Opt in' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(onConsent).not.toHaveBeenCalled();
  });

  it('loading consent does not expose an opt-in action or a mutation error', () => {
    const source = deriveDataState<BenchmarkPrivacyStatus>({ isLoading: true });
    render(
      <ConsentGate optedIn={false} acknowledged pending={false} error={new Error('old mutation')}
        onAcknowledgedChange={vi.fn()} onConsent={vi.fn()} source={source} />,
    );
    expect(screen.getByRole('status', { name: 'Loading Private participation' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Opt in' })).not.toBeInTheDocument();
    expect(screen.queryByText(/old mutation/)).not.toBeInTheDocument();
  });

  it('pending consent remains disabled and shows its original mutation failure', () => {
    render(
      <ConsentGate optedIn={false} acknowledged pending error={new Error('consent denied')}
        onAcknowledgedChange={vi.fn()} onConsent={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Opt in' })).toBeDisabled();
    expect(screen.getByText(/consent denied/)).toBeInTheDocument();
    expect(screen.getByText(/Raw trips, locations and VINs are never submitted/)).toBeInTheDocument();
  });
});
