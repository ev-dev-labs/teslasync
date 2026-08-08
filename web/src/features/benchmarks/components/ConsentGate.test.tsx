import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
});

