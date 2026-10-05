import type { ReactNode } from 'react';
import { QueryError } from '@/components/feedback';

/** Presence, not truthiness of individual metrics, owns refresh preservation. */
export function statisticsSourcePhase(hasData: boolean, loading: boolean, error: unknown) {
  if (hasData) return error ? 'retained' : 'ready';
  if (loading) return 'loading';
  return error ? 'error' : 'empty';
}

interface StatisticsSourceProps {
  hasData: boolean;
  loading: boolean;
  error?: Error | null;
  onRetry?: () => void;
  skeleton: ReactNode;
  empty: ReactNode;
  /** Loaded source can still lack the minimum records needed for its chart. */
  emptyWhen?: boolean;
  children: ReactNode;
}

/** Used inside a persistent card; a failed refresh never replaces its data. */
export function StatisticsSource({
  hasData, loading, error, onRetry, skeleton, empty, emptyWhen = false, children,
}: StatisticsSourceProps) {
  const phase = statisticsSourcePhase(hasData, loading, error);
  if (phase === 'loading') return <>{skeleton}</>;
  if (phase === 'error') return <QueryError error={error} onRetry={onRetry} />;
  if (phase === 'empty') return <>{empty}</>;
  return (
    <>
      {phase === 'retained' && <QueryError error={error} onRetry={onRetry} compact />}
      {emptyWhen ? empty : children}
    </>
  );
}
