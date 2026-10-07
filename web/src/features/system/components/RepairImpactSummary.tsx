import { AlertTriangle, CheckCircle2, LockKeyhole } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type {
  RepairImpactPreview,
  RepairPreviewValue,
} from '@/api/hooks/useDataRepair';
import { KVList } from '@/components/data-display';
import { InlineCallout } from '@/components/feedback';
import { Badge, Caption, SectionTitle, Text } from '@/components/ui';
import { formatDateTime } from '@/lib/dateFormat';

interface RepairImpactSummaryProps {
  preview: RepairImpactPreview;
}

function fieldLabel(field: string): string {
  return field
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatPreviewValue(value: RepairPreviewValue | undefined): string {
  if (!value || value.null || value.type === 'null') return '—';
  if (value.timestamp) return formatDateTime(value.timestamp);
  if (value.string != null) return value.string;
  if (value.int64 != null) return new Intl.NumberFormat().format(value.int64);
  if (value.float64 != null) {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value.float64);
  }
  return '—';
}

export function RepairImpactSummary({ preview }: RepairImpactSummaryProps) {
  const { t } = useTranslation();
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
        items={changed.map((change) => ({
          label: fieldLabel(change.field),
          value: (
            <span className="text-right">
              {formatPreviewValue(change.before)}
              {' → '}
              {formatPreviewValue(change.after)}
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
