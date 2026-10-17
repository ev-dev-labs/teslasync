import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Observation-age helpers for evidence text ("Last real observation 2m ago")
 * and readiness fields. Header and card freshness use the shared
 * `<FreshnessDot>` instead.
 */

type TFunc = (key: string, fallback: string, opts?: Record<string, unknown>) => string;

function computeAge(timestamp: string | null | undefined): number | null {
  if (!timestamp) return null;
  const parsed = new Date(timestamp).getTime();
  if (!Number.isFinite(parsed)) return null;
  const ms = Date.now() - parsed;
  return Math.max(0, Math.floor(ms / 1000));
}

function formatAge(age: number | null, t: TFunc): string {
  if (age === null) return '—';
  // relative-time: observation age inside evidence sentences, not a freshness indicator
  if (age < 10) return t('freshness.justNow', 'just now');
  if (age < 60) return t('freshness.seconds', '{{s}}s ago', { s: age });
  if (age < 3600) return t('freshness.minutes', '{{m}}m ago', { m: Math.floor(age / 60) });
  return t('freshness.hours', '{{h}}h ago', { h: Math.floor(age / 3600) });
}

function useAgeTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, [active]);
}

/**
 * Hook to check if a timestamp is stale (useful for warning banners).
 * Returns the boolean stale/offline flags plus a ready-to-render, i18n-aware
 * relative-age label. A missing or unparseable timestamp is reported as
 * neither stale nor offline, with an em-dash label (never `NaN`).
 */
export function useIsStale(
  timestamp: string | null | undefined,
  staleThreshold = 120,
  offlineThreshold = 600,
): { isStale: boolean; isOffline: boolean; ageLabel: string } {
  const { t } = useTranslation();
  const age = computeAge(timestamp);
  useAgeTick(age !== null);

  const isStale = age !== null && age >= staleThreshold;
  const isOffline = age !== null && age >= offlineThreshold;
  const ageLabel = formatAge(age, t);

  return { isStale, isOffline, ageLabel };
}
