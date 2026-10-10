import { useEffect, useRef, useState } from 'react';
import type { DataStateSource } from '@/api/dataState';

interface RetainedMutation<TData, TInputs> {
  data?: TData;
  variables?: TInputs;
  error: unknown;
  isPending: boolean;
  isPaused?: boolean;
  reset?: () => void;
}

interface PublishedMutation<TData, TInputs> {
  data: TData;
  inputs: TInputs | undefined;
}

interface PublicationState<TData, TInputs, TScope> {
  scopeId: TScope | null;
  published: PublishedMutation<TData, TInputs> | undefined;
  blockedData: TData | undefined;
  submitted: { variables: TInputs; inputs: TInputs } | undefined;
}

/**
 * Mutation observers discard data on their next request. Keep the successful
 * raw response and its submitted inputs together, not the currently edited form.
 * Scope selectors must identify the same primitive key on requests and replies.
 */
export function useRetainedMutation<TData, TInputs, TScope extends string | number>(
  mutation: RetainedMutation<TData, TInputs>,
  scopeId: TScope | null,
  scope: {
    data: (data: TData) => TScope;
    inputs: (inputs: TInputs) => TScope;
  },
) {
  const [state, setState] = useState<PublicationState<TData, TInputs, TScope>>({
    scopeId, published: undefined, blockedData: undefined, submitted: undefined,
  });
  const previousScope = useRef(scopeId);
  const { reset } = mutation;

  // Detaching the observer prevents a late old-scope request from republishing.
  // The render guard below also clears the view before this effect runs.
  useEffect(() => {
    if (previousScope.current !== scopeId) {
      previousScope.current = scopeId;
      reset?.();
    }
  }, [scopeId, reset]);

  let current = state;
  if (state.scopeId !== scopeId) {
    current = { scopeId, published: undefined, blockedData: mutation.data, submitted: undefined };
    setState(current);
  }

  const requestMatches = scopeId != null
    && (mutation.variables == null || scope.inputs(mutation.variables) === scopeId);
  if (requestMatches && mutation.variables != null
    && mutation.variables !== current.submitted?.variables) {
    current = {
      ...current,
      submitted: { variables: mutation.variables, inputs: structuredClone(mutation.variables) },
    };
    setState(current);
  }
  const data = mutation.data;
  if (requestMatches && !mutation.isPending && data != null && scope.data(data) === scopeId
    && data !== current.blockedData
    && (data !== current.published?.data
      || (mutation.error == null && current.submitted?.inputs !== current.published?.inputs))) {
    current = {
      ...current,
      published: {
        data,
        inputs: current.submitted?.inputs,
      },
    };
    setState(current);
  }

  const pending = requestMatches && mutation.isPending;
  const error = requestMatches ? mutation.error : null;
  const source: DataStateSource<TData> = {
    data: current.published?.data,
    error,
    isError: error != null,
    isLoading: pending && current.published == null,
    isFetching: pending && !mutation.isPaused,
    fetchStatus: pending ? mutation.isPaused ? 'paused' : 'fetching' : 'idle',
  };

  return { result: current.published?.data, published: current.published, pending, error, source };
}
