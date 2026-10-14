import { ClipboardList, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import { GlassPanel, Text } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';

import { JourneyFragmentationSectionProps } from './_types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { PendingEvidence } from './PendingEvidence';

export function AccountingPanel({ result, state, loading = false }: JourneyFragmentationSectionProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { formatDateTime } = useDateFormat();
  const dateLabel = (ms: number | null) =>
    formatDateTime(ms == null ? null : new Date(ms), { tz: result.timeZone });
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
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
        <div>
          <Text as="h2" variant="panelTitle">{t('journeyFragmentation.accounting.title', 'Evidence and continuity accounting')}</Text>
          <Text as="p" variant="caption" className="mt-1">{t('journeyFragmentation.accounting.subtitle', 'Every returned row and every adjacent pair has one mutually exclusive category.')}</Text>
        </div>
      </div>
      {state && !state.hasData ? <PendingEvidence state={state} loading={loading} /> : result.returnedRows === 0 ? (
        <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */ icon={<ClipboardList className="h-7 w-7" />} message={t('journeyFragmentation.accounting.empty', 'Accounting will populate when the history request returns rows.')} />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <Text as="p" variant="label" className="mb-2">{t('journeyFragmentation.accounting.rows', 'Returned rows: {{count}}', { count: result.returnedRows, replace: { count: fmtInt(result.returnedRows) } })}</Text>
              <div className="grid grid-cols-2 gap-2">{rows.map(([label, value]) => <div key={label} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-2"><Text as="p" variant="caption">{label}</Text><Text as="p" variant="body">{fmtInt(value)}</Text></div>)}</div>
            </div>
            <div>
              <Text as="p" variant="label" className="mb-2">{t('journeyFragmentation.accounting.pairs', 'Adjacent pairs: {{count}}', { count: result.pairAccounting.totalAdjacentPairs, replace: { count: fmtInt(result.pairAccounting.totalAdjacentPairs) } })}</Text>
              <div className="grid grid-cols-2 gap-2">{pairs.map(([label, value]) => <div key={label} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-2"><Text as="p" variant="caption">{label}</Text><Text as="p" variant="body">{fmtInt(value)}</Text></div>)}</div>
            </div>
          </div>
          <Text as="p" variant="caption">
            {t('journeyFragmentation.accounting.span', 'Returned span: {{returnedStart}} – {{returnedEnd}}. Included span: {{includedStart}} – {{includedEnd}}.', {
              returnedStart: dateLabel(result.returnedSpanStartMs),
              returnedEnd: dateLabel(result.returnedSpanEndMs),
              includedStart: dateLabel(result.includedSpanStartMs),
              includedEnd: dateLabel(result.includedSpanEndMs),
            })}
          </Text>
          <Text as="p" variant="caption">
            {t('journeyFragmentation.accounting.recency', '{{days}} days since the latest included drive; {{activeDays}} active local days and {{activeWeeks}} active local weeks.', {
              days: result.daysSinceLatestIncludedDrive == null ? '—' : fmtNumber(result.daysSinceLatestIncludedDrive),
              activeDays: fmtInt(result.activeDays),
              activeWeeks: fmtInt(result.activeWeeks),
            })}
          </Text>
        </>
      )}
    </GlassPanel>
  );
}
