import { useEffect, useState } from 'react';

export function usePrivateReviewExpiry(expiresAt: string | undefined, refetch: () => void) {
  const [clock, setClock] = useState(Date.now);
  const expiry = expiresAt ? Date.parse(expiresAt) : 0;
  useEffect(() => {
    const wait = expiry - Date.now();
    if (!Number.isFinite(wait) || wait <= 0) return;
    const timer = window.setTimeout(() => {
      setClock(Date.now());
      if (Date.now() >= expiry) refetch();
    }, Math.min(wait + 1, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [clock, expiry, refetch]);
  return expiry > Math.max(clock, Date.now());
}
