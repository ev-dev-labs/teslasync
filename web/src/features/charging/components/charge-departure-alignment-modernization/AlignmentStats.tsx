import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StatStrip, type StatMetric } from '@/components/data-display/stat-reference';
import { Badge, HelpTooltip } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { ChargeDepartureAlignmentSummary } from '../../lib/chargeDepartureAlignment';

interface Props {
  summary: ChargeDepartureAlignmentSummary | undefined;
  loading: boolean;
  retained: boolean;
  missingReason: string;
  historyContext: ReactNode;
}

/** Counts describe loaded records, not a lifetime aggregate. Duration inputs stay SI seconds. */
export function AlignmentStats({ summary, loading, retained, missingReason, historyContext }: Props) {
  const { t } = useTranslation();
  const { precision, locale } = useNumberFormatting();
  const hasPairs = summary != null && summary.pairedCount > 0;
  const noPairs = t('chargeDepartureAlignment.noPairs', 'No paired sessions to show yet.');
  const marginHelp = t(
    'help.chargeDepartureAlignment.avgMargin',
    'The realized safety buffer: how much charge was still left when the paired drive finished. A low average does not itself mean anything went wrong — it only describes what happened, not what was intended.',
  );
  const misalignedHelp = t(
    'help.chargeDepartureAlignment.misaligned',
    'Share of pairings that tripped at least one heuristic (a tight margin, a very long or already-full dwell, far more energy added than that trip used, or an inconsistent SoC reading). Each is circumstantial on its own.',
  );
  const percentDisplay = { precision, units: { locale } };
  const countDisplay = { precision: 0, units: { locale } };
  const metrics: StatMetric[] = [
    {
      metricId: 'duration', occurrenceId: 'alignment-avg-dwell',
      label: t('chargeDepartureAlignment.avgDwell', 'Avg. Dwell Time'),
      rawValue: hasPairs ? summary.avgDwellS : undefined,
      display: { durationStyle: 'roundedMinutes', units: { locale } },
      missingReason: summary ? noPairs : missingReason,
      context: t('chargeDepartureAlignment.avgDwellHint', 'from charge end to next drive'),
    },
    {
      metricId: 'percent', occurrenceId: 'alignment-avg-margin',
      label: t('chargeDepartureAlignment.avgMargin', 'Avg. Readiness Margin'),
      rawValue: summary?.avgReadinessMarginPct,
      display: percentDisplay, description: marginHelp,
      missingReason: summary ? t(
        'chargeDepartureAlignment.modernization.missingMargin',
        'No paired drive has a recorded end SoC.',
      ) : missingReason,
      context: t('chargeDepartureAlignment.avgMarginHint', 'SoC left once that drive ended'),
    },
    {
      metricId: 'percent', occurrenceId: 'alignment-misaligned-rate',
      label: t('chargeDepartureAlignment.misaligned', 'Misaligned Rate'),
      rawValue: hasPairs ? summary.misalignedRatePct : undefined,
      display: percentDisplay, description: misalignedHelp,
      missingReason: summary ? noPairs : missingReason,
      context: (
        <div className="space-y-1">
          <span className="block">{t('chargeDepartureAlignment.misalignedHint', '{{n}} of {{total}} paired sessions', {
            n: summary?.misalignedCount ?? '—', total: summary?.pairedCount ?? '—',
          })}</span>
          {hasPairs && <Badge variant={summary.misalignedRatePct >= 40 ? 'warning' : 'success'} size="sm">
            {t('chargeDepartureAlignment.modernization.heuristic', 'Heuristic flags, not confirmed faults')}
          </Badge>}
        </div>
      ),
    },
    {
      metricId: 'count', occurrenceId: 'alignment-paired',
      label: t('chargeDepartureAlignment.paired', 'Paired Sessions'),
      rawValue: summary?.pairedCount, display: countDisplay, missingReason,
      context: t('chargeDepartureAlignment.pairedHint', 'of {{n}} ended charges within 24h of a drive', {
        n: summary?.totalEndedCharges ?? '—',
      }),
    },
  ];

  return (
    <StatStrip
      id="charge-departure-alignment-summary"
      title={t('chargeDepartureAlignment.kpis', 'Charge departure alignment metrics')}
      metrics={metrics}
      loading={loading}
      retained={retained}
      className="w-full min-w-0"
      period={{
        kind: 'unknown',
        label: t('chargeDepartureAlignment.modernization.period', 'Loaded charge and drive history'),
        reason: t(
          'chargeDepartureAlignment.modernization.scope',
          'Selected vehicle · up to 1,000 charges and 1,000 drives from the existing queries. These are loaded records, not complete lifetime coverage; the workspace date range does not filter this model.',
        ),
      }}
      secondary={
        <div className="space-y-3">
          {historyContext}
          <div className="flex flex-wrap items-center gap-2">
            <span>{t(
              'chargeDepartureAlignment.modernization.inference',
              'Dwell is derived from recorded timestamps; readiness margin is the recorded drive-end SoC. Pairing and flags are model-derived, not measurements of charging intent.',
            )}</span>
            <HelpTooltip i18nKey="help.chargeDepartureAlignment.avgMargin" defaultValue={marginHelp}
              ariaLabel={t('chargeDepartureAlignment.avgMargin', 'Avg. Readiness Margin')} />
            <HelpTooltip i18nKey="help.chargeDepartureAlignment.misaligned" defaultValue={misalignedHelp}
              ariaLabel={t('chargeDepartureAlignment.misaligned', 'Misaligned Rate')} />
          </div>
        </div>
      }
    />
  );
}
