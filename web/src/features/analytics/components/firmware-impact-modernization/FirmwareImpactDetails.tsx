import { useTranslation } from 'react-i18next';
import { Minus } from 'lucide-react';
import { LayoutCard } from '@/components/layout/layout-reference';
import { Table, Text, Badge, HelpTooltip } from '@/components/ui';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { formatDateShort } from '@/lib/dateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { FirmwareImpactSummary, ImpactVerdict } from '../../lib/firmwareImpact';
import type { FirmwareImpactState } from './firmwareImpactState';

const VERDICT_BADGE: Record<ImpactVerdict, 'success' | 'danger' | 'neutral' | 'warning'> = {
  better: 'success',
  worse: 'danger',
  noChange: 'neutral',
  insufficient: 'warning',
};
const VERDICT_DEFAULT: Record<ImpactVerdict, string> = {
  better: 'More efficient',
  worse: 'Less efficient',
  noChange: 'No measurable change',
  insufficient: 'Not enough drives',
};

export function FirmwareImpactDetails({
  summary,
  state,
  onRetry,
}: {
  summary: FirmwareImpactSummary;
  state: FirmwareImpactState;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const { fmtScientificNumber, fmtNumber } = useNumberFormatting();
  return (
    <LayoutCard
      title={t('firmwareImpact.detail', 'Version by version')}
      actions={
        <HelpTooltip
          size="sm"
          i18nKey="help.firmwareImpact.detail"
          defaultValue="A verdict needs two things at once: a p-value below 0.05, so the difference is unlikely to be chance, and a Cohen’s d above a floor, so the difference is large enough to care about. Enough drives will make almost any difference statistically significant, which is exactly why the effect-size gate is there."
          ariaLabel={t('help.firmwareImpact.iconLabel', 'More info about the verdicts')}
        />
      }
    >
      {state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={onRetry} />
      ) : state.loading ? (
        <Skeleton height={180} />
      ) : !state.hasInputs ? (
        <EmptyState message={t('firmwareImpact.modernization.waiting', 'Waiting for both drive history and software updates.')} />
      ) : summary.impacts.length === 0 ? (
        <EmptyState /* no-action: version detail is derived from the install comparisons. */
          icon={<Minus className="h-8 w-8" aria-hidden="true" />}
          message={t(
            'firmwareImpact.noDetail',
            'Nothing to compare yet — each update needs drives recorded both before and after it.',
          )}
        />
      ) : (
        <ul className="grid min-w-0 gap-3 lg:grid-cols-2">
          {summary.impacts.map((i) => (
            <li
              key={`${i.version}-${i.installedMs}`}
              className="min-w-0 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
            >
              <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
                <Text variant="body" className="break-words font-medium">{i.version}</Text>
                <Badge variant={VERDICT_BADGE[i.verdict]}>
                  {t(`firmwareImpact.verdict.${i.verdict}`, VERDICT_DEFAULT[i.verdict])}
                </Badge>
                <Text variant="caption">{formatDateShort(i.installedAt)}</Text>
              </div>
              <Table aria-label={i.version}>
                <tbody>
                  <tr><th scope="row"><Text variant="caption">
                    {t('firmwareImpact.before', 'Before')}
                  </Text></th><td className="text-right"><Text variant="bodySm">
                    {t('firmwareImpact.whPerKmN', '{{v}} Wh/km · n={{n}}', {
                      v: i.before.n > 0 ? Math.round(i.before.meanWhPerKm) : '—',
                      n: i.before.n,
                    })}
                  </Text></td></tr>
                  <tr><th scope="row"><Text variant="caption">
                    {t('firmwareImpact.after', 'After')}
                  </Text></th><td className="text-right"><Text variant="bodySm">
                    {t('firmwareImpact.whPerKmN', '{{v}} Wh/km · n={{n}}', {
                      v: i.after.n > 0 ? Math.round(i.after.meanWhPerKm) : '—',
                      n: i.after.n,
                    })}
                  </Text></td></tr>
                  <tr><th scope="row"><Text variant="caption">
                    {t('firmwareImpact.change', 'Change')}
                  </Text></th><td className="text-right"><Text variant="bodySm">
                    {i.before.n > 0 && i.after.n > 0
                      ? `${i.deltaWhPerKm > 0 ? '+' : ''}${Math.round(i.deltaWhPerKm * 10) / 10} Wh/km (${
                        i.deltaShare > 0 ? '+' : ''
                      }${Math.round(i.deltaShare * 1000) / 10}%)`
                      : '—'}
                  </Text></td></tr>
                  <tr><th scope="row"><Text variant="caption">
                    {t('firmwareImpact.stats', 'p · d')}
                  </Text></th><td className="text-right"><Text variant="bodySm">
                    {i.p != null && i.cohensD != null
                      ? `${i.p < 0.001 ? '<0.001' : fmtScientificNumber(i.p, 3)} · ${fmtNumber(Math.abs(i.cohensD))}`
                      : '—'}
                  </Text></td></tr>
                </tbody>
              </Table>
            </li>
          ))}
        </ul>
      )}
    </LayoutCard>
  );
}
