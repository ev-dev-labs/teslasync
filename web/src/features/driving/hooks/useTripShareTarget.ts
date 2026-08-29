import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  consumeTripSharePayload,
  parseTripShareDestination,
  type ParsedTripShareDestination,
} from '@/lib/tripShareTarget';

export type TripShareImportStatus =
  | 'idle'
  | 'loading'
  | 'coordinates'
  | 'text'
  | 'error';

export function useTripShareTarget(
  onImport: (destination: ParsedTripShareDestination) => void,
): TripShareImportStatus {
  const [searchParams, setSearchParams] = useSearchParams();
  const consumption = useRef<Promise<ParsedTripShareDestination | null> | null>(null);
  const [status, setStatus] = useState<TripShareImportStatus>('idle');

  useEffect(() => {
    const marker = searchParams.get('share_target');
    if (!marker) {
      consumption.current = null;
      return;
    }

    const clearMarker = () => {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('share_target');
      setSearchParams(nextParams, { replace: true });
    };

    if (marker === 'empty' || typeof window.caches === 'undefined') {
      setStatus('error');
      clearMarker();
      return;
    }

    let cancelled = false;
    setStatus('loading');
    const pending =
      consumption.current
      ?? consumeTripSharePayload(window.caches).then((payload) =>
        payload ? parseTripShareDestination(payload) : null,
      );
    consumption.current = pending;

    void pending
      .then((parsed) => {
        if (cancelled) return;
        if (!parsed) {
          setStatus('error');
          return;
        }
        onImport(parsed);
        setStatus(parsed.location ? 'coordinates' : 'text');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      })
      .finally(() => {
        if (!cancelled) clearMarker();
      });

    return () => {
      cancelled = true;
    };
  }, [onImport, searchParams, setSearchParams]);

  return status;
}
