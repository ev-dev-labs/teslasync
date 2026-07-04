/**
 * DLQ Inspector — status / KPI band.
 *
 * Renders a full-width, responsive metric band summarising the current
 * DLQ state (reflows 2 → 3 → 6 columns as the viewport widens) plus an
 * AlertBanner when `replay_enabled` is false so an operator immediately
 * sees that the replay button below will return HTTP 403 instead of
 * publishing.
 *
 * Every metric is derived from the single `useDLQList()` payload — the
 * band stays visible even on error (values degrade to "—") so it never
 * gates the rest of the page behind one `{data && …}`.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, Database, Inbox, Power, ShieldCheck, Tags } from 'lucide-react';

import { StatCard } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { fmtInt, formatBytes } from '@/lib/numberFormat';
import type { DLQEntrySummary, DLQListResponse } from '@/types/admin-diagnostics';

interface StatusHeaderProps {
  data: DLQListResponse | undefined;
  loading: boolean;
  error?: unknown;
}

/** Stable empty reference so the memo below isn't invalidated every render. */
const EMPTY_ENTRIES: DLQEntrySummary[] = [];

export function StatusHeader({ data, loading, error }: StatusHeaderProps) {
  const { t } = useTranslation();

  // Derive every KPI from the single payload once per data/label change — the
  // filter / Set / reduce shouldn't re-run when an unrelated parent state
  // (drawer open, banner dismiss) re-renders this band.
  const { count, replayable, blocked, distinctReasons, totalBytes } = useMemo(() => {
    const entries = data?.entries ?? EMPTY_ENTRIES;
    const total = data?.count ?? entries.length;
    const replay = entries.filter((e) => e.replayable).length;
    return {
      count: total,
      replayable: replay,
      // Clamp so a stale `count` that lags a fresher `entries` list can never
      // render a negative "blocked" tally.
      blocked: Math.max(0, total - replay),
      distinctReasons: new Set(
        entries.map((e) => e.parsed_reason?.trim() || t('admin.dlq.reasons.unknown', 'unknown')),
      ).size,
      totalBytes: entries.reduce((sum, e) => sum + (e.raw_payload_size ?? 0), 0),
    };
  }, [data, t]);

  // Only trust replay_enabled once the payload has actually loaded; an
  // indeterminate (undefined) payload must not flash the "replay disabled"
  // warning that promises replays will return HTTP 403.
  const hasData = data != null;
  const enabled = data?.replay_enabled ?? false;

  // On a fetch error the band stays visible but shows honest placeholders
  // rather than a misleading "0" — the recoverable error UI lives in the
  // entries / reasons panels below.
  const dash = '—';
  const num = (v: number) => (error ? dash : fmtInt(v));

  return (
    <section aria-label={t('admin.dlq.stats.aria', 'Dead-letter queue summary')} className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6">
        <StatCard
          label={t('admin.dlq.stats.total', 'Total entries')}
          value={num(count)}
          icon={<Inbox className="h-5 w-5" aria-hidden="true" />}
          sublabel={t('admin.dlq.stats.totalSub', 'in dead-letter queue')}
          loading={loading}
        />
        <StatCard
          label={t('admin.dlq.stats.replayable', 'Replayable')}
          value={num(replayable)}
          icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
          sublabel={t('admin.dlq.stats.replayableSub', 'parsed with source topic')}
          loading={loading}
        />
        <StatCard
          label={t('admin.dlq.stats.blocked', 'Blocked')}
          value={num(blocked)}
          icon={<Ban className="h-5 w-5" aria-hidden="true" />}
          sublabel={t('admin.dlq.stats.blockedSub', 'no replay target')}
          loading={loading}
        />
        <StatCard
          label={t('admin.dlq.stats.reasons', 'Distinct reasons')}
          value={num(distinctReasons)}
          icon={<Tags className="h-5 w-5" aria-hidden="true" />}
          sublabel={t('admin.dlq.stats.reasonsSub', 'unique failure causes')}
          loading={loading}
        />
        <StatCard
          label={t('admin.dlq.stats.payload', 'Total payload')}
          value={error ? dash : formatBytes(totalBytes)}
          icon={<Database className="h-5 w-5" aria-hidden="true" />}
          sublabel={t('admin.dlq.stats.payloadSub', 'raw bytes queued')}
          loading={loading}
        />
        <StatCard
          label={t('admin.dlq.stats.replayMode', 'Replay mode')}
          value={
            error
              ? dash
              : enabled
                ? t('admin.dlq.stats.enabled', 'Enabled')
                : t('admin.dlq.stats.disabled', 'Disabled')
          }
          icon={<Power className="h-5 w-5" aria-hidden="true" />}
          sublabel={t('admin.dlq.stats.replayModeSub', 'DLQ_REPLAY_ENABLED env')}
          loading={loading}
        />
      </div>

      {!loading && !error && hasData && !enabled && (
        <AlertBanner
          variant="warning"
          title={t('admin.dlq.banners.disabledTitle', 'DLQ replay is disabled')}
        >
          {t(
            'admin.dlq.banners.disabledMessage',
            'The DLQ_REPLAY_ENABLED env flag is not set on this server. Replay attempts will return HTTP 403 and be logged as result="disabled".',
          )}
        </AlertBanner>
      )}
    </section>
  );
}
