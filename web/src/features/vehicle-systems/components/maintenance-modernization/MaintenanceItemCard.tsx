import { useTranslation } from 'react-i18next';
import { Clock, Gauge, Tag } from 'lucide-react';
import { Accordion, Badge, Subhead, Text } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { formatDate, formatDateTime } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import {
  clampPct, computeProgress, progressFillClass, statusFromPct,
  type DistanceFormatter, type MaintenanceItem,
} from './maintenanceModel';
import { MaintenanceStatusBadge } from './MaintenanceStatusBadge';
import { STATUS_BADGES } from './maintenancePresentation';

/** Full item content inside one owning section surface, not nested card chrome.
 * Source metadata remains reachable through the shared disclosure control. */
export function MaintenanceItemCard({
  item,
  formatDistance,
}: {
  item: MaintenanceItem;
  formatDistance: DistanceFormatter;
}) {
  const { t } = useTranslation();
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const pct = clampPct(computeProgress(item));
  const status = item.status === 'completed' ? 'completed' : statusFromPct(pct);
  const sourceStatus = STATUS_BADGES[item.status];
  const fields = [
    { key: 'id', label: t('maintenance.details.id', 'Item ID'), value: fmtInt(item.id) },
    { key: 'vehicle_id', label: t('entityContext.vehicle', 'Vehicle'), value: fmtInt(item.vehicle_id) },
    {
      key: 'status',
      label: t('maintenance.details.sourceStatus', 'Source status'),
      value: t(sourceStatus.labelKey, sourceStatus.fallback),
    },
    {
      key: 'current_mileage',
      label: t('maintenance.col.mileage', 'Mileage'),
      value: item.current_mileage != null ? formatDistance(item.current_mileage) : '—',
    },
    {
      key: 'due_date',
      label: t('maintenance.due', 'Due'),
      value: item.due_date ? formatDate(item.due_date) : '—',
    },
    {
      key: 'last_service_date',
      label: t('maintenance.details.lastDate', 'Last service date'),
      value: item.last_service_date ? formatDate(item.last_service_date) : '—',
    },
    {
      key: 'due_mileage',
      label: t('maintenance.details.dueDistance', 'Due odometer'),
      value: item.due_mileage != null ? formatDistance(item.due_mileage) : '—',
    },
    {
      key: 'last_service_mileage',
      label: t('maintenance.details.lastDistance', 'Last service odometer'),
      value: item.last_service_mileage != null ? formatDistance(item.last_service_mileage) : '—',
    },
    {
      key: 'interval_miles',
      label: t('maintenance.details.distanceInterval', 'Distance interval'),
      value: item.interval_miles != null ? formatDistance(item.interval_miles) : '—',
    },
    {
      key: 'interval_months',
      label: t('maintenance.details.monthInterval', 'Month interval'),
      value: item.interval_months != null ? fmtNumber(item.interval_months) : '—',
    },
    {
      key: 'created_at',
      label: t('maintenance.details.createdAt', 'Created'),
      value: item.created_at ? formatDateTime(item.created_at) : '—',
    },
  ];

  return (
    <article data-maintenance-item={item.id} className="flex min-w-0 flex-col gap-3 border-b border-[var(--border-subtle)] py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="neutral" size="sm">
          <Tag className="mr-1 h-3 w-3" aria-hidden="true" />
          {item.category}
        </Badge>
        <MaintenanceStatusBadge status={status} />
      </div>
      <Subhead className="break-words text-[var(--text-primary)]">{item.name}</Subhead>
      <Text as="p" variant="caption" className="break-words">{item.description}</Text>

      {status !== 'completed' && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
            <span className="tabular-nums">{fmtNumber(pct)}%</span>
            <span>
              {item.due_date
                ? `${t('maintenance.due', 'Due')}: ${formatDate(item.due_date)}`
                : item.due_mileage
                  ? `${t('maintenance.due', 'Due')}: ${formatDistance(item.due_mileage)}`
                  : null}
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('maintenance.itemProgress', '{{name}} service progress', { name: item.name })}
            className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]"
          >
            <div
              className={cn('h-full rounded-full motion-safe:transition-all motion-safe:duration-slow', progressFillClass(pct))}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-4 text-xs text-[var(--text-secondary)]">
        {item.current_mileage > 0 && (
          <span className="flex items-center gap-1">
            <Gauge className="h-3 w-3" aria-hidden="true" />
            {formatDistance(item.current_mileage)}
          </span>
        )}
        {item.last_service_date && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden="true" />
            {formatDate(item.last_service_date)}
          </span>
        )}
      </div>
      <Accordion title={t('maintenance.details.title', 'Service interval and metadata')}>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fields.map(field => (
            <div key={field.key} className="min-w-0">
              <Text as="dt" variant="caption">{field.label}</Text>
              <Text as="dd" variant="bodySm" className="break-words tabular-nums">{field.value}</Text>
            </div>
          ))}
        </dl>
      </Accordion>
    </article>
  );
}
