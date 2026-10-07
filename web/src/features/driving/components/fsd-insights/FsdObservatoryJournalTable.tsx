import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge, DataTable, Text, type Column } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useUnits } from '@/hooks/useUnits';
import type { FsdObservatoryEvent } from '@/types/fsd';
import { FSD_DEFAULT_PAGE_SIZE, FSD_PAGE_SIZE_OPTIONS } from './useClientPagination';

const pagination = { defaultPageSize: FSD_DEFAULT_PAGE_SIZE, pageSizeOptions: FSD_PAGE_SIZE_OPTIONS };
const confidenceVariants = { high: 'success', estimated: 'info', ambiguous: 'warning', unknown: 'neutral' } as const;

export function FsdObservatoryJournalTable({ events }: { events: FsdObservatoryEvent[] }) {
  const { t } = useTranslation();
  const { formatDistance } = useUnits();
  const { formatDateTime } = useDateFormat();
  const columns = useMemo<Column<FsdObservatoryEvent>[]>(() => [
    {
      key: 'date',
      header: t('fsd.observatory.columns.date', 'Date / time'),
      defaultWidth: 210,
      render: event => event.kind === 'drive' && event.drive_id != null
        ? <Link to={`/drives/${event.drive_id}`} className="text-cyan-300 hover:underline">{formatDateTime(event.at)}</Link>
        : formatDateTime(event.at),
    },
    {
      key: 'route',
      header: t('fsd.observatory.columns.route', 'Route'),
      defaultWidth: 280,
      render: event => event.route_label ?? (event.kind === 'reset' ? '—' : t('fsd.observatory.unlabelledRoute', 'Unlabelled route')),
    },
    {
      key: 'reportedFsd',
      header: t('fsd.observatory.columns.reportedFsd', 'Reported FSD'),
      align: 'right',
      defaultWidth: 150,
      render: event => event.kind === 'reset' ? '—' : (
        <span data-testid="fsd-observatory-drive-fsd" className="tabular-nums">
          {event.fsd_distance_m == null
            ? t('fsd.notMeasured', 'Not measured')
            : `${event.confidence === 'high' ? '' : '~'}${formatDistance(event.fsd_distance_m)}`}
        </span>
      ),
    },
    {
      key: 'confidence',
      header: t('fsd.observatory.columns.confidence', 'Evidence'),
      defaultWidth: 150,
      render: event => event.kind === 'reset'
        ? <Badge variant="warning" size="sm">{t('fsd.observatory.resetBadge', 'Counter reset')}</Badge>
        : <Badge variant={confidenceVariants[event.confidence ?? 'unknown']} size="sm">
            {event.confidence === 'high'
              ? t('fsd.drive.confidence.high', 'High')
              : event.confidence === 'estimated'
                ? t('fsd.drive.confidence.estimated', 'Estimated')
                : event.confidence === 'ambiguous'
                  ? t('fsd.drive.confidence.ambiguous', 'Ambiguous')
                  : t('fsd.drive.confidence.unknown', 'Unknown')}
          </Badge>,
    },
    {
      key: 'firmware',
      header: t('fsd.observatory.columns.firmware', 'Firmware'),
      defaultWidth: 160,
      render: event => event.firmware_version ?? t('fsd.observatory.unknownFirmware', 'Unknown firmware'),
    },
    {
      key: 'notes',
      header: t('fsd.observatory.columns.notes', 'Notes'),
      defaultWidth: 330,
      render: event => event.kind === 'reset'
        ? <Text as="span" variant="bodySm" data-testid="fsd-observatory-reset">
            {t('fsd.observatory.resetHint', 'Break in the stitch — not travelled FSD{{field}}.', {
              field: event.field ? ` (${event.field})` : '',
            })}
          </Text>
        : event.approximate ? t('fsd.observatory.approximate', 'Approximate counter increase') : '—',
    },
  ], [t, formatDistance, formatDateTime]);

  return (
    <div data-testid="fsd-observatory-timeline" className="min-w-0">
      <DataTable
        tableId="fsd:observatory-journal"
        name={t('fsd.observatory.timeline', 'Stitched journal')}
        caption={t('fsd.observatory.timeline', 'Stitched journal')}
        variant="embedded"
        density="compact"
        columns={columns}
        data={events}
        keyExtractor={event => [event.kind, event.at, event.drive_id ?? '', event.field ?? ''].join(':')}
        pagination={pagination}
        maxHeight={480}
      />
    </div>
  );
}
