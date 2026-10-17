import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@/i18n';
import { MobileReferenceState } from './MobileReferenceState';
import { MobileGridReference } from './MobileGridReference';
import { referenceCallbacks, referenceModel } from './testFixtures';

afterEach(cleanup);
describe('mobile states and retained-data behavior', () => {
  it('renders exactly three same-group loading placeholders', () => {
    const { container } = render(<MobileReferenceState state={{ kind: 'loading' }} callbacks={referenceCallbacks()} />);
    expect(container.querySelectorAll('[data-grid-skeleton]')).toHaveLength(3);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });
  it('Clear and Retry belong to the caller, including pending retry disabling', () => {
    const callbacks = referenceCallbacks();
    const { rerender } = render(<MobileReferenceState state={{ kind: 'noMatch', query: 'xyz' }} callbacks={callbacks} />);
    expect(screen.getByText('Nothing matches “xyz”')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(callbacks.onClear).toHaveBeenCalledTimes(1);
    rerender(<MobileReferenceState state={{ kind: 'error', message: 'Synthetic error', retained: false }} callbacks={callbacks} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(callbacks.onRetry).toHaveBeenCalledTimes(1);
    rerender(<MobileReferenceState state={{ kind: 'error', message: 'Synthetic error', retained: true, retrying: true }} callbacks={callbacks} />);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
  });
  it('retains rows for a refresh failure but never invents a singleton summary', () => {
    const model = referenceModel();
    const { container, rerender } = render(<MobileGridReference model={{ ...model,
      state: { kind: 'error', message: 'Refresh failed', retained: true } }}
      callbacks={referenceCallbacks()} desktop={<div>Frozen desktop slot</div>} />);
    expect(container.querySelectorAll('[data-card]')).toHaveLength(1);
    expect(container.querySelector('[data-group-summary]')).toBeNull();
    expect(screen.getByText('Frozen desktop slot')).toBeInTheDocument();
    rerender(<MobileGridReference model={{ ...model,
      state: { kind: 'error', message: 'Initial failure', retained: false } }}
      callbacks={referenceCallbacks()} desktop={<div>Frozen desktop slot</div>} />);
    expect(container.querySelector('[data-card]')).toBeNull();
    expect(container.querySelector('.mgr-group')).toBeInTheDocument();
  });
});
