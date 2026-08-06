/**
 * SignalGapFreshnessPanel — the freshness gauge and worst-offender list.
 *
 * A `ProgressRing` renders the overall freshness score (share of signals still
 * arriving within the aging window); below it, the signals that have gone
 * quiet longest are listed so operators can triage gaps at a glance. Owns its
 * own loading / empty / error / no-vehicle states.
 */

import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Gauge } from 'lucide-react';

import { GlassPanel, PanelTitle, Text, Caption } from '@/components/ui';
import { ProgressRing } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';

import { GAP_BUCKET_COLORS, formatStaleness } from '../signalGapUtils';
import type { SignalGapAnalysis } from '../hooks/useSignalGapAnalysis';

interface SignalGapFreshnessPanelProps {
  analysis: SignalGapAnalysis;
  hasVehicle: boolean;
}

function freshnessColor(pct: number): string {
  if (pct >= 80) return GAP_BUCKET_COLORS.active;
  if (pct >= 50) return GAP_BUCKET_COLORS.aging;
  return GAP_BUCKET_COLORS.stale;
}

export function SignalGapFreshnessPanel({ analysis, hasVehicle }: SignalGapFreshnessPanelProps) {
  const { t } = useTranslation();
  const { query, buckets, freshnessPct, topStale } = analysis;
  const receiving = buckets.active + buckets.aging;
  const neverCount = buckets.never;

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('signalGap.freshnessTitle', 'Freshness')}
      </PanelTitle>

      {!hasVehicle ? (
        <EmptyState
          icon={<Gauge className="h-8 w-8" />}
          message={t('signalGap.selectVehiclePrompt', 'Select a vehicle to inspect its signal freshness.')}
          actionTo={{ label: t('signalGap.manageVehicles', 'Manage vehicles'), to: '/vehicles' }}
        />
      ) : query.isLoading ? (
        <Skeleton height={260} />
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => query.refetch()} />
      ) : buckets.total === 0 ? (
        // no-action: transient — this vehicle is selected but hasn't streamed a single signal yet; resolves on its own once telemetry arrives.
        <EmptyState
          icon={<Gauge className="h-8 w-8" />}
          message={t('signalGap.noData', 'No signal data available')}
        />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-col items-center gap-2">
            <ProgressRing
              value={freshnessPct}
              max={100}
              size={140}
              strokeWidth={10}
              color={freshnessColor(freshnessPct)}
              centerLabel={`${freshnessPct}%`}
              centerSubLabel={t('signalGap.fresh', 'fresh')}
            />
            <Text variant="bodySm" className="text-center">
              {t('signalGap.receivingSummary', '{{receiving}} of {{total}} signals arriving', {
                receiving,
                total: buckets.total,
              })}
            </Text>
          </div>

          <div className="space-y-2">
            <Caption>{t('signalGap.topStaleTitle', 'Top stale signals')}</Caption>
            {topStale.length === 0 ? (
              neverCount > 0 ? (
                // A signal with no timestamp has *never* reported, so it is
                // never a "stale offender" (it has no staleness to rank) and
                // is excluded from `topStale`. Guard against the freshness
                // gauge reading < 100% while this banner would otherwise
                // falsely reassure that everything is arriving on time.
                <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
                  <AlertTriangle className="h-4 w-4 text-amber-300" aria-hidden="true" />
                  <Text variant="bodySm">
                    {t('signalGap.neverReported', '{{never}} signals have never reported.', {
                      never: neverCount,
                    })}
                  </Text>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                  <Text variant="bodySm">
                    {t('signalGap.allFresh', 'All signals are arriving on time.')}
                  </Text>
                </div>
              )
            ) : (
              <ul className="space-y-1.5">
                {topStale.map((row) => (
                  <li
                    key={row.name}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] px-3 py-2"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-300" aria-hidden="true" />
                      <Text variant="code" className="truncate">
                        {row.name}
                      </Text>
                    </span>
                    <Text variant="bodySm" className="shrink-0 tabular-nums text-rose-300">
                      {formatStaleness(row.staleness)}
                    </Text>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </GlassPanel>
  );
}
