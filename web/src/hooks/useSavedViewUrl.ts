import { useCallback, useMemo } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';

/**
 * Wires the URL query string into the `<SavedViewMenu>` contract.
 *
 * Returns the canonical current querystring (no leading '?') and an
 * `apply` callback that replaces it wholesale. Pages call `apply('')` to
 * reset to the unfiltered URL when the user clicks the badge's clear
 * button.
 *
 * `currentQuery` is normalised through `URLSearchParams` rather than a bare
 * `replace(/^\?/, '')` so that two equivalent-but-differently-encoded URLs
 * (e.g. `?tag=a%20b` and `?tag=a+b`) collapse to one canonical string. The
 * menu detects the active view with `view.query === currentQuery`; because a
 * saved view stores whatever `currentQuery` was when it was created, an
 * un-normalised value would miss the match whenever the address bar later
 * carried a different-but-equivalent encoding. `URLSearchParams` preserves
 * key order and duplicate keys, so only encoding is canonicalised.
 *
 * Why a separate hook: every adopting page would otherwise duplicate the
 * same normalisation + `setSearchParams(new URLSearchParams(q))` boilerplate.
 */
export function useSavedViewUrl(): {
  currentQuery: string;
  apply: (query: string) => void;
} {
  const location = useLocation();
  const [, setSearchParams] = useSearchParams();

  // URLSearchParams also strips a leading '?', so a plain `''` search and a
  // bare `'?'` both collapse to the empty string.
  const currentQuery = useMemo(
    () => new URLSearchParams(location.search).toString(),
    [location.search],
  );

  const apply = useCallback(
    (query: string) => {
      // setSearchParams accepts a URLSearchParams instance and replaces
      // the entire querystring. An empty string clears all params; the
      // constructor tolerates an optional leading '?' on `query`.
      setSearchParams(new URLSearchParams(query), { replace: false });
    },
    [setSearchParams],
  );

  // Stable object identity while the URL is unchanged keeps memoised
  // consumers (and any future dependency-array usage) from re-rendering.
  return useMemo(() => ({ currentQuery, apply }), [currentQuery, apply]);
}
