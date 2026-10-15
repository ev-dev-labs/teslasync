import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShareCardSectionBody } from './ShareCardSectionBody';
import { shareCardQueryState } from './queryState';
import type { ShareCardQueryState } from './types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en' },
  }),
}));

function state(overrides: Partial<ShareCardQueryState> = {}): ShareCardQueryState {
  return {
    enabled: true, hasData: true, isInitialLoading: false, isInitialPaused: false,
    initialError: null, isResolved: true, isRefreshing: false,
    cachedRefreshError: null, cachedRefreshPaused: false, onRetry: vi.fn(),
    ...overrides,
  };
}

describe('ShareCardSectionBody specialist SourceContent slots', () => {
  it.each([
    [state({ enabled: false, hasData: false, isResolved: false }), 'Select a vehicle to load this selected-window evidence.'],
    [state({ hasData: false, isResolved: false, isInitialPaused: true }), 'The initial query is paused while the network is unavailable; no empty response is inferred.'],
    [state({ hasData: false, isResolved: false }), 'Source availability has not resolved yet.'],
  ])('preserves prerequisite, paused and unresolved copy instead of generic empty evidence', (source, message) => {
    const { container } = render(<ShareCardSectionBody state={source}><p>Measured evidence</p></ShareCardSectionBody>);
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(container.querySelector('[data-empty-state]')).toBeInTheDocument();
    expect(screen.queryByText('Measured evidence')).not.toBeInTheDocument();
  });

  it('preserves caller-sized loading geometry and its localized accessible name', () => {
    render(
      <ShareCardSectionBody state={state({ hasData: false, isResolved: false, isInitialLoading: true })} skeletonHeight={320}>
        <p>Measured evidence</p>
      </ShareCardSectionBody>,
    );
    expect(screen.getByRole('status', { name: 'Loading share card evidence' })).toBeInTheDocument();
    expect(screen.queryByText('Measured evidence')).not.toBeInTheDocument();
    expect(screen.queryByText('Source availability has not resolved yet.')).not.toBeInTheDocument();
  });

  it('retains explicit retry wording and callback on fatal errors', () => {
    const onRetry = vi.fn();
    render(<ShareCardSectionBody state={state({ hasData: false, isResolved: false, initialError: new Error('offline'), onRetry })}>
      <p>Measured evidence</p>
    </ShareCardSectionBody>);
    fireEvent.click(screen.getByRole('button', { name: 'Retry evidence query' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByText('Selected-window drive evidence is unavailable.')).toBeInTheDocument();
    expect(screen.queryByText('Measured evidence')).not.toBeInTheDocument();
  });

  it.each([
    [{ cachedRefreshError: new Error('refresh failed') }, 'Cached evidence remains visible, but the refresh failed.'],
    [{ cachedRefreshPaused: true }, 'Cached evidence remains visible while its refresh is paused.'],
    [{ isRefreshing: true }, 'Cached evidence is visible while a refresh is in progress.'],
  ])('keeps usable children and source-specific retained notices', (flags, message) => {
    render(<ShareCardSectionBody state={state(flags)} showCachedStatus><p>Measured evidence</p></ShareCardSectionBody>);
    expect(screen.getByText('Measured evidence')).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it('treats a resolved empty array as retained source data, not a prerequisite or unresolved body', () => {
    const source = shareCardQueryState({
      data: [], isLoading: false, isPending: false, isSuccess: true, isError: false,
      error: null, isFetching: false, fetchStatus: 'idle',
    }, true, vi.fn());
    render(<ShareCardSectionBody state={source}><p>Valid empty array disclosure</p></ShareCardSectionBody>);
    expect(screen.getByText('Valid empty array disclosure')).toBeInTheDocument();
    expect(screen.queryByText('Source availability has not resolved yet.')).not.toBeInTheDocument();
  });
});
