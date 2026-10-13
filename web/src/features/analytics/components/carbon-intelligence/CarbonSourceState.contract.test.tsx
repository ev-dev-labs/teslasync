import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as canonical from '@/api/dataState';
import { CarbonSectionBody } from './CarbonSectionBody';
import { CarbonSourceRow } from './CarbonSourceRow';
import { carbonQueryState, type CarbonQueryLike } from './queryState';
import type { CarbonQueryState, CarbonQueryStates } from './types';

const NOW = 1_700_000_000_000;
const ORIGINAL_SUCCESS = NOW - 300_000;
const REFRESH_ERROR = new Error('Synthetic carbon refresh failed');
const INITIAL_ERROR = new Error('Synthetic carbon initial load failed');

function query(
  overrides: Partial<CarbonQueryLike & { dataUpdatedAt?: number }> = {},
): CarbonQueryLike & { dataUpdatedAt?: number } {
  return {
    data: { measured: 0 },
    dataUpdatedAt: ORIGINAL_SUCCESS,
    isStale: false,
    isLoading: false,
    isPending: false,
    isSuccess: true,
    isError: false,
    error: null,
    isFetching: false,
    fetchStatus: 'idle',
    ...overrides,
  };
}

function body(state: CarbonQueryState) {
  return (
    <MemoryRouter>
      <CarbonSectionBody state={state} className="h-full" skeletonHeight={176}>
        <output aria-label="Carbon retained measurement">0 kg</output>
      </CarbonSectionBody>
    </MemoryRouter>
  );
}

function row(state: CarbonQueryState, name = 'Selected-period summary') {
  return (
    <CarbonSourceRow
      id="period"
      name={name}
      scope="Synthetic selected calendar period"
      state={state}
    />
  );
}

function reconstructed(state: CarbonQueryState) {
  const derive = vi.spyOn(canonical, 'deriveDataState');
  render(body(state));
  expect(derive).toHaveBeenCalledWith(expect.objectContaining({
    dataUpdatedAt: state.dataUpdatedAt,
    refetch: state.onRetry,
  }));
  const result = derive.mock.results[derive.mock.results.length - 1];
  if (result?.type !== 'return') throw new Error('Canonical reconstruction did not return');
  return result.value;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('carbonQueryState authoritative source success time', () => {
  it('forwards_exact_success_timestamp_and_retry_identity_without_mutating_query', () => {
    const retry = vi.fn();
    const source = Object.freeze(query({ dataUpdatedAt: 1 }));
    const state = carbonQueryState(source, true, retry);
    expect(state).toEqual({
      enabled: true,
      hasData: true,
      dataUpdatedAt: 1,
      isStale: false,
      isLoading: false,
      isResolved: true,
      isFetching: false,
      isPaused: false,
      refreshPaused: false,
      error: null,
      refreshError: null,
      onRetry: retry,
    });
    state.onRetry();
    expect(retry).toHaveBeenCalledExactlyOnceWith();
    expect(source.dataUpdatedAt).toBe(1);
  });

  it.each([
    { name: 'absent', timestamp: undefined },
    { name: 'zero', timestamp: 0 },
    { name: 'negative', timestamp: -1 },
  ])('preserves_unknown_timestamp_for_$name_source_time_without_using_now', ({ timestamp }) => {
    const state = carbonQueryState(query({ dataUpdatedAt: timestamp }), true, vi.fn());
    expect(state).toHaveProperty('dataUpdatedAt', timestamp);
    expect(state.hasData).toBe(true);
    expect(state.isResolved).toBe(true);
  });

  it('retains_original_success_time_and_exact_error_after_refresh_failure', () => {
    const retry = vi.fn();
    const state = carbonQueryState(query({
      isSuccess: false, isError: true, error: REFRESH_ERROR,
    }), true, retry);
    expect(state).toMatchObject({
      dataUpdatedAt: ORIGINAL_SUCCESS, hasData: true, isResolved: true,
      error: null, refreshError: REFRESH_ERROR, isLoading: false,
    });
    expect(state.refreshError).toBe(REFRESH_ERROR);
    expect(state.onRetry).toBe(retry);
  });

  it('retains_original_success_time_while_refresh_is_paused_without_fabricating_error', () => {
    const state = carbonQueryState(query({ fetchStatus: 'paused' }), true, vi.fn());
    expect(state).toMatchObject({
      dataUpdatedAt: ORIGINAL_SUCCESS, hasData: true, isResolved: true,
      refreshPaused: true, isPaused: false, error: null, refreshError: null,
    });
  });

  it('advances_success_time_only_to_actual_source_refresh_timestamp', () => {
    const retry = vi.fn();
    const previous = carbonQueryState(query(), true, retry);
    vi.setSystemTime(NOW + 120_000);
    const inFlight = carbonQueryState(query({
      isFetching: true, fetchStatus: 'fetching',
    }), true, retry);
    const completed = carbonQueryState(query({ dataUpdatedAt: NOW + 60_000 }), true, retry);
    expect(previous.dataUpdatedAt).toBe(ORIGINAL_SUCCESS);
    expect(inFlight.dataUpdatedAt).toBe(ORIGINAL_SUCCESS);
    expect(inFlight.isFetching).toBe(true);
    expect(completed.dataUpdatedAt).toBe(NOW + 60_000);
    expect(completed.isFetching).toBe(false);
    expect(completed.refreshError).toBeNull();
  });

  it.each([
    { name: 'zero', data: 0 },
    { name: 'false', data: false },
    { name: 'null', data: null },
    { name: 'empty_array', data: [] },
  ])('preserves_defined_$name_payload_as_resolved_retained_evidence', ({ data }) => {
    const state = carbonQueryState(query({ data, isSuccess: false }), true, vi.fn());
    expect(state).toMatchObject({
      hasData: true, isResolved: true, isLoading: false,
      dataUpdatedAt: ORIGINAL_SUCCESS,
    });
  });

  it.each([
    {
      name: 'explicit_initial_loading',
      source: query({ data: undefined, isSuccess: false, isLoading: true }),
      enabled: true,
      expected: { hasData: false, isLoading: true, isResolved: false },
    },
    {
      name: 'pending_initial_fetch',
      source: query({ data: undefined, isSuccess: false, isPending: true, fetchStatus: 'fetching' }),
      enabled: true,
      expected: { hasData: false, isLoading: true, isResolved: false },
    },
    {
      name: 'pending_idle_unknown',
      source: query({ data: undefined, isSuccess: false, isPending: true }),
      enabled: true,
      expected: { hasData: false, isLoading: false, isResolved: false },
    },
    {
      name: 'initial_paused',
      source: query({ data: undefined, isSuccess: false, fetchStatus: 'paused' }),
      enabled: true,
      expected: { isPaused: true, refreshPaused: false, isLoading: false, isResolved: false },
    },
    {
      name: 'initial_fatal',
      source: query({ data: undefined, isSuccess: false, isError: true, error: INITIAL_ERROR }),
      enabled: true,
      expected: { error: INITIAL_ERROR, refreshError: null, isResolved: false },
    },
    {
      name: 'disabled_with_retained_error_and_pause',
      source: query({ isError: true, error: REFRESH_ERROR, isFetching: true, fetchStatus: 'paused' }),
      enabled: false,
      expected: {
        enabled: false, hasData: true, isResolved: false, isLoading: false,
        isFetching: false, isPaused: false, refreshPaused: false, error: null, refreshError: null,
      },
    },
    {
      name: 'successful_undefined_response',
      source: query({ data: undefined }),
      enabled: true,
      expected: { hasData: false, isResolved: true, isLoading: false },
    },
  ])('preserves_adapter_partition_$name', ({ source, enabled, expected }) => {
    const state = carbonQueryState(source, enabled, vi.fn());
    expect(state).toMatchObject(expected);
    expect(state.dataUpdatedAt).toBe(ORIGINAL_SUCCESS);
  });
});

describe('CarbonSectionBody canonical timestamp reconstruction', () => {
  it('reconstructs_original_updated_at_and_exact_age_for_retained_refresh_failure', () => {
    const retry = vi.fn();
    const state = carbonQueryState(query({ isError: true, error: REFRESH_ERROR }), true, retry);
    const before = { ...state };
    const source = reconstructed(state);
    expect(source).toMatchObject({
      data: true, hasData: true, status: 'stale', updatedAt: ORIGINAL_SUCCESS,
      ageMs: 300_000, refreshError: REFRESH_ERROR, fatalError: null,
      isRefreshBlocked: false, isRefreshing: false,
    });
    expect(source.refreshError).toBe(REFRESH_ERROR);
    expect(screen.getByLabelText('Carbon retained measurement')).toHaveTextContent('0 kg');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledExactlyOnceWith();
    expect(state).toEqual(before);
  });

  it.each([
    { name: 'paused_only', error: null },
    { name: 'paused_with_real_failure', error: REFRESH_ERROR },
  ])('reconstructs_retained_time_and_error_precedence_for_$name', ({ error }) => {
    const state = carbonQueryState(query({
      fetchStatus: 'paused', isError: error !== null, error,
    }), true, vi.fn());
    const source = reconstructed(state);
    expect(source).toMatchObject({
      status: 'stale', updatedAt: ORIGINAL_SUCCESS, ageMs: 300_000,
      isRefreshBlocked: true, refreshError: error, fatalError: null,
    });
    expect(screen.getByLabelText('Carbon retained measurement')).toHaveTextContent('0 kg');
    expect(screen.getByText(error
      ? 'Refresh failed; the most recently loaded evidence remains visible.'
      : 'The network is unavailable; cached evidence remains visible while refresh is paused.'))
      .toHaveAttribute('aria-live', 'polite');
  });

  it.each([
    { name: 'no_payload_despite_positive_timestamp', source: query({ data: undefined, isSuccess: false }) },
    { name: 'retained_without_timestamp', source: query({ dataUpdatedAt: undefined }) },
    { name: 'retained_zero_timestamp', source: query({ dataUpdatedAt: 0 }) },
    { name: 'retained_negative_timestamp', source: query({ dataUpdatedAt: -1 }) },
  ])('reconstructs_unknown_time_for_$name', ({ source: querySource }) => {
    const source = reconstructed(carbonQueryState(querySource, true, vi.fn()));
    expect(source.updatedAt).toBeNull();
    expect(source.ageMs).toBeNull();
    expect(source.hasData).toBe(querySource.data !== undefined);
    expect(source.status).toBe(querySource.data !== undefined ? 'ok' : 'initial');
  });

  it.each([
    { name: 'smallest_positive_epoch', timestamp: 1, age: NOW - 1 },
    { name: 'one_millisecond_before_now', timestamp: NOW - 1, age: 1 },
    { name: 'exactly_now', timestamp: NOW, age: 0 },
    { name: 'one_millisecond_after_now', timestamp: NOW + 1, age: 0 },
  ])('derives_exact_canonical_age_at_$name', ({ timestamp, age }) => {
    const source = reconstructed(carbonQueryState(query({ dataUpdatedAt: timestamp }), true, vi.fn()));
    expect(source.updatedAt).toBe(timestamp);
    expect(source.ageMs).toBe(age);
    expect(source.status).toBe('ok');
    expect(screen.getByLabelText('Carbon retained measurement')).toHaveTextContent('0 kg');
  });

  it.each([
    {
      name: 'disabled',
      source: query(),
      enabled: false,
      message: 'Select a vehicle to load this vehicle-dependent evidence.',
    },
    {
      name: 'unresolved',
      source: query({ data: undefined, isSuccess: false }),
      enabled: true,
      message: 'Source availability has not resolved yet.',
    },
    {
      name: 'initial_paused',
      source: query({ data: undefined, isSuccess: false, fetchStatus: 'paused' }),
      enabled: true,
      message: 'The query is paused while the network is unavailable; this is not treated as an empty response.',
    },
    {
      name: 'initial_fatal',
      source: query({ data: undefined, isSuccess: false, isError: true, error: INITIAL_ERROR }),
      enabled: true,
      message: 'This source is unavailable. Retry it from the source and scope ledger.',
    },
  ])('preserves_body_$name_replacement_and_own_recovery', ({ source, enabled, message, name }) => {
    const retry = vi.fn();
    render(body(carbonQueryState(source, enabled, retry)));
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.queryByLabelText('Carbon retained measurement')).not.toBeInTheDocument();
    if (name === 'initial_fatal') {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(retry).toHaveBeenCalledExactlyOnceWith();
    } else {
      expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
      expect(retry).not.toHaveBeenCalled();
    }
  });

  it('preserves_initial_loading_geometry_and_ready_zero_content_allocation', () => {
    const loading = carbonQueryState(query({
      data: undefined, isSuccess: false, isLoading: true,
    }), true, vi.fn());
    const view = render(body(loading));
    expect(screen.getByRole('status', { name: 'Loading carbon evidence' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Carbon retained measurement')).not.toBeInTheDocument();
    expect(view.container.firstElementChild).toHaveClass('h-full', 'min-h-0', 'min-w-0');
    view.rerender(body(carbonQueryState(query(), true, vi.fn())));
    expect(screen.queryByRole('status', { name: 'Loading carbon evidence' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Carbon retained measurement')).toHaveTextContent('0 kg');
    expect(screen.getByLabelText('Carbon retained measurement').parentElement)
      .toHaveClass('min-h-0', 'flex-1', 'flex-col');
  });

  it('keeps_retained_body_refreshing_without_advancing_success_time_or_claiming_failure', () => {
    const source = reconstructed(carbonQueryState(query({
      isFetching: true, fetchStatus: 'fetching',
    }), true, vi.fn()));
    expect(source).toMatchObject({
      updatedAt: ORIGINAL_SUCCESS, ageMs: 300_000, isRefreshing: true,
      status: 'ok', refreshError: null, fatalError: null,
    });
    expect(screen.getByLabelText('Carbon retained measurement')).toHaveTextContent('0 kg');
    expect(screen.queryByText(/Refresh failed/)).not.toBeInTheDocument();
  });

  it('preserves_successfully_resolved_undefined_response_without_fabricating_success_time', () => {
    const source = reconstructed(carbonQueryState(query({ data: undefined }), true, vi.fn()));
    expect(source).toMatchObject({ hasData: false, updatedAt: null, ageMs: null });
    expect(screen.getByLabelText('Carbon retained measurement')).toHaveTextContent('0 kg');
    expect(screen.queryByText('Source availability has not resolved yet.')).not.toBeInTheDocument();
  });
});

describe('CarbonSourceRow existing source metadata presentation', () => {
  it('renders_retained_failure_age_and_actual_last_update_without_hiding_warning_or_retry', () => {
    const retry = vi.fn();
    render(row(carbonQueryState(query({ isError: true, error: REFRESH_ERROR }), true, retry)));
    const freshness = screen.getByRole('status', {
      name: 'Data freshness: Error · 5m ago · Source: Selected-period summary',
    });
    expect(freshness).toHaveTextContent('5m ago');
    expect(freshness).toHaveAttribute('title', 'Last updated: 10:08 PM · Source: Selected-period summary');
    expect(screen.getByText('Cached · refresh failed')).toBeInTheDocument();
    expect(screen.getByText('Refresh failed; the most recently loaded evidence remains visible.'))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry refresh' }));
    expect(retry).toHaveBeenCalledExactlyOnceWith();
  });

  it('renders_paused_age_without_claiming_refresh_failure', () => {
    render(row(carbonQueryState(query({ fetchStatus: 'paused' }), true, vi.fn())));
    expect(screen.getByRole('status', {
      name: 'Data freshness: Stale · 5m ago · Source: Selected-period summary',
    })).toHaveTextContent('Stale · 5m ago');
    expect(screen.getByText('Cached · refresh paused')).toBeInTheDocument();
    expect(screen.getByText('The network is unavailable; cached evidence remains visible while refresh is paused.'))
      .toBeInTheDocument();
    expect(screen.queryByText(/refresh failed/i)).not.toBeInTheDocument();
  });

  it('preserves_authoritative_query_staleness_without_inventing_refresh_failure', () => {
    const state = carbonQueryState(query({ isStale: true }), true, vi.fn());
    expect(state.isStale).toBe(true);
    expect(state.dataUpdatedAt).toBe(ORIGINAL_SUCCESS);
    render(row(state));
    expect(screen.getByRole('status', {
      name: 'Data freshness: Stale · 5m ago · Source: Selected-period summary',
    })).toHaveTextContent('Stale · 5m ago');
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.queryByText(/refresh failed|refresh paused/i)).not.toBeInTheDocument();
  });

  it('advances_rendered_age_and_last_update_only_on_actual_successful_refresh', () => {
    const retry = vi.fn();
    const view = render(row(carbonQueryState(query(), true, retry)));
    expect(screen.getByRole('status')).toHaveTextContent('5m ago');
    view.rerender(row(carbonQueryState(query({
      isFetching: true, fetchStatus: 'fetching',
    }), true, retry)));
    expect(screen.getByRole('status')).toHaveAccessibleName(
      'Data freshness: Updating… · 5m ago · Source: Selected-period summary',
    );
    expect(screen.getByRole('status')).toHaveTextContent('updating…');
    expect(screen.getByText('Refreshing cached data')).toBeInTheDocument();
    view.rerender(row(carbonQueryState(query({ dataUpdatedAt: NOW - 60_000 }), true, retry)));
    expect(screen.getByRole('status')).toHaveTextContent('1m ago');
    expect(screen.getByRole('status')).toHaveAttribute(
      'title', 'Last updated: 10:12 PM · Source: Selected-period summary',
    );
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(retry).not.toHaveBeenCalled();
  });

  it('keeps_four_source_timestamps_ages_errors_and_retries_independent_of_aggregate_time', () => {
    const ids: Array<keyof CarbonQueryStates> = ['intensity', 'period', 'lifetime', 'recommendation'];
    const retries = ids.map(() => vi.fn());
    const timestamps = [NOW - 60_000, NOW - 120_000, NOW - 180_000, NOW - 240_000];
    const states = ids.map((id, index) => ({
      id,
      state: carbonQueryState(query({
        dataUpdatedAt: timestamps[index], isError: true, error: REFRESH_ERROR,
      }), true, retries[index]),
    }));
    render(<>{states.map(({ id, state }) => (
      <section key={id} aria-label={`${id} synthetic source`}>
        <CarbonSourceRow id={id} name={id} scope={`Synthetic ${id} scope`} state={state} />
      </section>
    ))}</>);
    for (const [index, { id, state }] of states.entries()) {
      expect(state.dataUpdatedAt).toBe(timestamps[index]);
      const source = within(screen.getByRole('region', { name: `${id} synthetic source` }));
      expect(source.getByRole('status')).toHaveAccessibleName(
        `Data freshness: Error · ${index + 1}m ago · Source: ${id}`,
      );
      expect(source.getByRole('status')).toHaveTextContent(`${index + 1}m ago`);
      expect(source.getByText(`Synthetic ${id} scope`)).toBeInTheDocument();
      fireEvent.click(source.getByRole('button', { name: 'Retry refresh' }));
      for (const [retryIndex, retry] of retries.entries()) {
        expect(retry).toHaveBeenCalledTimes(retryIndex <= index ? 1 : 0);
      }
    }
    const aggregate = canonical.combineDataStates(states.map(({ state }) => canonical.deriveDataState({
      data: true, dataUpdatedAt: state.dataUpdatedAt, error: state.refreshError,
    })));
    expect(aggregate.updatedAt).toBe(NOW - 240_000);
    expect(aggregate.ageMs).toBe(240_000);
    expect(states[0].state.dataUpdatedAt).toBe(NOW - 60_000);
  });

  it.each([
    { name: 'disabled', source: query(), enabled: false, label: 'Vehicle required' },
    { name: 'initial_loading', source: query({ data: undefined, isSuccess: false, isLoading: true }), enabled: true, label: 'Loading' },
    { name: 'initial_paused', source: query({ data: undefined, isSuccess: false, fetchStatus: 'paused' }), enabled: true, label: 'Paused' },
    { name: 'initial_fatal', source: query({ data: undefined, isSuccess: false, isError: true, error: INITIAL_ERROR }), enabled: true, label: 'Failed' },
    { name: 'initial_unknown', source: query({ data: undefined, isSuccess: false }), enabled: true, label: 'Pending' },
    { name: 'ready_without_timestamp', source: query({ dataUpdatedAt: undefined }), enabled: true, label: 'Ready' },
    { name: 'ready_zero_timestamp', source: query({ dataUpdatedAt: 0 }), enabled: true, label: 'Ready' },
    { name: 'ready_negative_timestamp', source: query({ dataUpdatedAt: -1 }), enabled: true, label: 'Ready' },
  ])('preserves_row_$name_label_without_fabricated_age_or_freshness', ({ source, enabled, label, name }) => {
    const retry = vi.fn();
    render(row(carbonQueryState(source, enabled, retry)));
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /Data freshness:/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/ago|just now|up to date/i)).not.toBeInTheDocument();
    if (name === 'initial_fatal') {
      expect(screen.getByText('Selected-period query failed')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(retry).toHaveBeenCalledExactlyOnceWith();
    }
  });

  it.each([
    { name: 'intensity', id: 'intensity', message: 'Intensity query failed' },
    { name: 'period', id: 'period', message: 'Selected-period query failed' },
    { name: 'lifetime', id: 'lifetime', message: 'Lifetime summary query failed' },
    { name: 'recommendation', id: 'recommendation', message: 'Recommendation query failed' },
  ] as const)('preserves_exact_$name_initial_failure_and_source_retry', ({ id, message }) => {
    const retry = vi.fn();
    render(<CarbonSourceRow
      id={id}
      name={id}
      scope={`Synthetic ${id} source`}
      state={carbonQueryState(query({
        data: undefined, isSuccess: false, isError: true, error: INITIAL_ERROR,
      }), true, retry)}
    />);
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: /Data freshness:/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledExactlyOnceWith();
  });
});
