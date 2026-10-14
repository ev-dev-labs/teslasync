import { AlertTriangle, CheckCircle2, LockKeyhole } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  RepairImpactPreview,
  RepairPreviewValue,
} from '@/api/hooks/useDataRepair';
import { KVList } from '@/components/data-display';
import { InlineCallout } from '@/components/feedback';
import { Badge, Caption, SectionTitle, Text } from '@/components/ui';
import { formatDateTime } from '@/lib/dateFormat';
import {
  fmtNumber,
  getFormatterPreferences,
  isFiniteNumber,
  subscribeFormatterPreferences,
} from '@/lib/numberFormat';

interface RepairImpactSummaryProps {
  preview: RepairImpactPreview;
}

function fieldLabel(field: string): string {
  return field
    .replace(/_/g, ' ')
    .replace(/^./, (character) => character.toUpperCase());
}

function formatPreviewValue(value: RepairPreviewValue | undefined, exact = false): string {
  if (!value || value.null || value.type === 'null') return '—';
  if (value.type === 'timestamp' && value.timestamp) {
    return exact ? value.timestamp : formatDateTime(value.timestamp);
  }
  if (value.type === 'string') return value.string ?? '—';
  if (value.type === 'int64' || value.type === 'float64') {
    const numeric = value.type === 'int64' ? value.int64 : value.float64;
    if (!isFiniteNumber(numeric)) return '—';
    if (exact) return Object.is(numeric, -0) ? '-0' : String(numeric);
    return fmtNumber(numeric);
  }
  return '—';
}

export function RepairImpactSummary({ preview }: RepairImpactSummaryProps) {
  const { t } = useTranslation();
  useSyncExternalStore(
    subscribeFormatterPreferences,
    getFormatterPreferences,
    getFormatterPreferences,
  );
  const changed = preview.fields_changed ?? [];
  const preserved = preview.fields_preserved ?? [];
  const warnings = preview.warnings ?? [];

  return (
    <div className="space-y-4" data-testid="repair-impact-preview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>
          {t('dataRepair.preview.title', 'Verified impact')}
        </SectionTitle>
        <Badge variant={preview.status === 'ready' ? 'success' : 'info'} size="sm">
          {preview.status === 'ready'
            ? t('dataRepair.preview.ready', 'Ready to apply')
            : t('dataRepair.preview.alreadyApplied', 'Already applied')}
        </Badge>
      </div>

      <KVList
        wrap
        items={changed.map((change) => ({
          label: fieldLabel(change.field),
          value: (
            <span className="block text-end">
              <span>
                {formatPreviewValue(change.before)}
                {' → '}
                {formatPreviewValue(change.after)}
              </span>
              <Caption as="span" className="block break-words">
                {change.field}
                {': '}
                {formatPreviewValue(change.before, true)}
                {' → '}
                {formatPreviewValue(change.after, true)}
              </Caption>
            </span>
          ),
        }))}
        emptyMessage={t('dataRepair.preview.noChanges', 'No database fields would change.')}
      />

      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-3">
        <div className="flex items-center gap-2">
          <LockKeyhole className="h-4 w-4 text-emerald-300" aria-hidden="true" />
          <Text as="p" variant="bodySm" className="font-medium text-[var(--text-primary)]">
            {t('dataRepair.preview.preserved', '{{count}} measured fields stay unchanged', {
              count: preserved.length,
            })}
          </Text>
        </div>
        <Caption className="mt-1">
          {preserved.map((item) => fieldLabel(item.field)).join(', ')}
        </Caption>
      </div>

      {warnings.map((warning) => (
        <InlineCallout key={warning} variant="warning" icon={<AlertTriangle />}>
          {warning}
        </InlineCallout>
      ))}

      <div className="flex items-center gap-2 text-emerald-300">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        <Text as="p" variant="caption" className="text-emerald-300">
          {t(
            'dataRepair.preview.revalidated',
            'The server revalidated the current row, evidence, concurrency pin, and overlap guard.',
          )}
        </Text>
      </div>
    </div>
  );
}
