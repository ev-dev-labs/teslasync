import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { deriveDataState } from '@/api/dataState';
import { StaleRefreshWarning } from './StaleRefreshWarning';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

const NOW = 1_700_000_000_000;
const now = () => NOW;

describe('StaleRefreshWarning — never replaces retained content', () => {
  it('renders nothing when the data is healthy', () => {
    const state = deriveDataState(
      { data: [1], isSuccess: true, dataUpdatedAt: NOW - 1_000 },
      { now },
    );
    const { container } = render(<StaleRefreshWarning state={state} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing during the initial load — that is the skeleton\'s job', () => {
    const state = deriveDataState({ isPending: true, isFetching: true }, { now });
    const { container } = render(<StaleRefreshWarning state={state} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing on an initial failure — that is the page error surface\'s job', () => {
    const state = deriveDataState({ isError: true, error: new Error('down') }, { now });
    const { container } = render(<StaleRefreshWarning state={state} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('warns non-blockingly when a background refresh fails over retained rows', () => {
    const state = deriveDataState(
      { data: [1, 2], isError: true, error: new Error('502'), dataUpdatedAt: NOW - 20_000 },
      { now },
    );
    render(<StaleRefreshWarning state={state} />);

    const notice = screen.getByTestId('stale-refresh-warning');
    expect(notice).toBeInTheDocument();
    // `status`/`polite` — an assertive alert would steal focus from the data
    // the operator is still reading.
    expect(notice).toHaveAttribute('role', 'status');
    expect(notice).toHaveAttribute('aria-live', 'polite');
    expect(notice).toHaveAttribute('data-data-state', 'stale');
    expect(
      screen.getByText(/Previously loaded data remains visible/i),
    ).toBeInTheDocument();
  });

  it('explains the offline case differently from the failure case', () => {
    const state = deriveDataState(
      { data: [1], fetchStatus: 'paused', dataUpdatedAt: NOW - 20_000 },
      { now },
    );
    render(<StaleRefreshWarning state={state} />);
    expect(screen.getByText(/device is offline/i)).toBeInTheDocument();
  });

  it('surfaces partial state without claiming the data is stale', () => {
    const state = deriveDataState(
      { data: [1], isSuccess: true, dataUpdatedAt: NOW },
      { partial: true, now },
    );
    render(<StaleRefreshWarning state={state} />);
    expect(screen.getByTestId('stale-refresh-warning')).toHaveAttribute(
      'data-data-state',
      'partial',
    );
  });

  it('offers a retry that calls refetch', () => {
    const refetch = vi.fn();
    const state = deriveDataState(
      { data: [1], isError: true, error: new Error('502'), refetch, dataUpdatedAt: NOW },
      { now },
    );
    render(<StaleRefreshWarning state={state} />);

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('disables retry while a refresh is already in flight', () => {
    const state = deriveDataState(
      {
        data: [1],
        isError: true,
        error: new Error('502'),
        isFetching: true,
        refetch: vi.fn(),
        dataUpdatedAt: NOW,
      },
      { now },
    );
    render(<StaleRefreshWarning state={state} />);
    expect(screen.getByRole('button', { name: /updating/i })).toBeDisabled();
  });

  it('can suppress the retry control for pages with a global refresh', () => {
    const state = deriveDataState(
      { data: [1], isError: true, error: new Error('502'), refetch: vi.fn(), dataUpdatedAt: NOW },
      { now },
    );
    render(<StaleRefreshWarning state={state} hideRetry />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('accepts a caller-supplied message', () => {
    const state = deriveDataState(
      { data: [1], isError: true, error: new Error('502'), dataUpdatedAt: NOW },
      { now },
    );
    render(<StaleRefreshWarning state={state} message="Drive list is 2 minutes behind." />);
    expect(screen.getByText('Drive list is 2 minutes behind.')).toBeInTheDocument();
  });
});
