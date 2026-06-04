import { useCallback } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';

/**
 * Wires the URL query string into the
 * `<SavedViewMenu>` contract.
 * Returns the canonical current querystring (no leading '?') and an
 * `apply` callback that replaces it. Pages call `apply('')` to reset to
 * the unfiltered URL when the user clicks the badge's clear button.
 * Why a separate hook: every adopting page would otherwise duplicate the
 * same `location.search.replace(/^\?/, '')` + `setSearchParams(new
 * URLSearchParams(q))` boilerplate.
 */
export function useSavedViewUrl(): {
  currentQuery: string;
  apply: (query: string) => void;
} {
  const location = useLocation();
  const [, setSearchParams] = useSearchParams();

  const currentQuery = location.search.startsWith('?')
    ? location.search.slice(1)
    : location.search;

  const apply = useCallback(
    (query: string) => {
      // setSearchParams accepts a URLSearchParams instance and replaces
      // the entire querystring. An empty string clears all params.
      setSearchParams(new URLSearchParams(query), { replace: false });
    },
    [setSearchParams],
  );

  return { currentQuery, apply };
}
