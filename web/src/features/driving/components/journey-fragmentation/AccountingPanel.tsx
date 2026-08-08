import { ClipboardList, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import { GlassPanel, Text } from '@/components/ui';

import { JourneyFragmentationSectionProps } from './_types';

function dateLabel(ms: number | null, timeZone: string): string {
  if (ms == null) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(ms);
  } catch {
    return '—';
  }
}

export function AccountingPanel({ result }: JourneyFragmentationSectionProps) {
  const { t } = useTranslation();
  const rows = [
    [t('journeyFragmentation.accounting.included', 'Included'), result.rowAccounting.included],
    [t('journeyFragmentation.accounting.live', 'Incomplete / live'), result.rowAccounting.incompleteLive],
    [t('journeyFragmentation.accounting.invalidTime', 'Invalid timestamp / order'), result.rowAccounting.invalidTimestampOrder],
    [t('journeyFragmentation.accounting.future', 'Future'), result.rowAccounting.future],
    [t('journeyFragmentation.accounting.invalidDuration', 'Invalid duration'), result.rowAccounting.invalidDuration],
    [t('journeyFragmentation.accounting.excluded', 'Excluded'), result.rowAccounting.excluded],
  ] as const;
  const pairs = [
    [t('journeyFragmentation.accounting.linked', 'Linked'), result.pairAccounting.linked],
    [t('journeyFragmentation.accounting.sourceBoundary', 'Unusable / source boundary'), result.pairAccounting.unusableSourceBoundary],
    [t('journeyFragmentation.accounting.unlocatable', 'Unlocatable endpoint'), result.pairAccounting.unlocatableEndpoint],
    [t('journeyFragmentation.accounting.mismatch', 'Endpoint mismatch'), result.pairAccounting.endpointMismatch],
    [t('journeyFragmentation.accounting.overlap', 'Overlap / negative gap'), result.pairAccounting.overlapNegativeGap],
    [t('journeyFragmentation.accounting.overGap', 'Over selected gap'), result.pairAccounting.overSelectedGap],
  ] as const;
  return (
    <GlassPanel className="space-y-4 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" />
        <div>
          <Text as="h2" variant="panelTitle">{t('journeyFragmentation.accounting.title', 'Evidence and continuity accounting')}</Text>
          <Text as="p" variant="caption" className="mt-1">{t('journeyFragmentation.accounting.subtitle', 'Every returned row and every adjacent pair has one mutually exclusive category.')}</Text>
        </div>
      </div>
      {result.returnedRows === 0 ? (
        <EmptyState icon={<ClipboardList className="h-7 w-7" />} message={t('journeyFragmentation.accounting.empty', 'Accounting will populate when the history request returns rows.')} />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <Text as="p" variant="label" className="mb-2">{t('journeyFragmentation.accounting.rows', 'Returned rows: {{count}}', { count: result.returnedRows })}</Text>
              <div className="grid grid-cols-2 gap-2">{rows.map(([label, value]) => <div key={label} className="rounded-lg bg-white/[0.03] p-2"><Text as="p" variant="caption">{label}</Text><Text as="p" variant="body">{value}</Text></div>)}</div>
            </div>
            <div>
              <Text as="p" variant="label" className="mb-2">{t('journeyFragmentation.accounting.pairs', 'Adjacent pairs: {{count}}', { count: result.pairAccounting.totalAdjacentPairs })}</Text>
              <div className="grid grid-cols-2 gap-2">{pairs.map(([label, value]) => <div key={label} className="rounded-lg bg-white/[0.03] p-2"><Text as="p" variant="caption">{label}</Text><Text as="p" variant="body">{value}</Text></div>)}</div>
            </div>
          </div>
          <Text as="p" variant="caption">
            {t('journeyFragmentation.accounting.span', 'Returned span: {{returnedStart}} – {{returnedEnd}}. Included span: {{includedStart}} – {{includedEnd}}.', {
              returnedStart: dateLabel(result.returnedSpanStartMs, result.timeZone),
              returnedEnd: dateLabel(result.returnedSpanEndMs, result.timeZone),
              includedStart: dateLabel(result.includedSpanStartMs, result.timeZone),
              includedEnd: dateLabel(result.includedSpanEndMs, result.timeZone),
            })}
          </Text>
          <Text as="p" variant="caption">
            {t('journeyFragmentation.accounting.recency', '{{days}} days since the latest included drive; {{activeDays}} active local days and {{activeWeeks}} active local weeks.', {
              days: result.daysSinceLatestIncludedDrive == null ? '—' : result.daysSinceLatestIncludedDrive.toFixed(1),
              activeDays: result.activeDays,
              activeWeeks: result.activeWeeks,
            })}
          </Text>
        </>
      )}
    </GlassPanel>
  );
}
