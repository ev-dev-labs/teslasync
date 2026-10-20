import { Eye } from 'lucide-react';
import { Currency } from '@/components/data-display';
import { Button, Text, type Column } from '@/components/ui';
import { formatDateTime, formatDayKey } from '@/lib/dateFormat';
import type { DateFormatter } from '@/hooks/useDateFormat';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import type { DistanceFormatter, ServiceRecord } from './maintenanceModel';

/** Calendar-only service dates are business days, not midnight UTC instants. */
export function formatMaintenanceDate(
  value: string | Date | null | undefined,
  formatInstant: DateFormatter,
  locale: string,
): string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? formatDayKey(value, { locale })
    : formatInstant(value);
}

/** Keep column/filter/persistence identities and render-boundary SI formatting.
 * DataTable still owns exports, sort/value filters and saved column controls. */
export function buildServiceColumns(
  t: (key: string, fallback: string) => string,
  formatDistance: DistanceFormatter,
  onPreview: (record: ServiceRecord) => void,
  formatServiceDate: DateFormatter = formatDateTime,
): Column<ServiceRecord>[] {
  return [
    {
      key: 'date',
      header: t('maintenance.col.date', 'Date'),
      sortable: true,
      render: record => <Text variant="body">{formatServiceDate(record.date)}</Text>,
    },
    {
      key: 'description',
      header: t('maintenance.col.description', 'Description'),
      filterValue: record => record.description || null,
      render: record => (
        <Text as="span" variant="body" className="block break-words">
          {record.description || '—'}
        </Text>
      ),
    },
    {
      key: 'mileage',
      header: t('maintenance.col.mileage', 'Mileage'),
      align: 'right',
      sortable: true,
      filterValue: record => record.mileage ?? null,
      filterValueLabel: (_value, record) => formatDistance(record.mileage),
      render: record => <Text as="span" size="sm" className="tabular-nums">{formatDistance(record.mileage)}</Text>,
    },
    {
      key: 'cost',
      header: t('maintenance.col.cost', 'Cost'),
      align: 'right',
      sortable: true,
      render: record => <Currency value={record.cost} className={cn(typography.size.sm, 'tabular-nums')} />,
    },
    {
      key: 'provider',
      header: t('maintenance.col.provider', 'Provider'),
      filterValue: record => record.provider || null,
      render: record => <Text as="span" size="sm" color="secondary">{record.provider || '—'}</Text>,
    },
    {
      key: 'actions',
      header: '',
      visibleOnMobile: true,
      align: 'right',
      render: record => (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11 min-w-11 p-0 md:min-h-9 md:min-w-9"
          aria-label={t('maintenance.inspectRecord', 'Inspect service record')}
          onClick={() => onPreview(record)}
        >
          <Eye className="h-4 w-4" aria-hidden="true" />
        </Button>
      ),
    },
  ];
}
