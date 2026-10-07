import { CalendarClock, Eye, Moon, Thermometer } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import {
  Badge,
  DataTable,
  GlassPanel,
  PanelTitle,
  Text,
  type Column,
} from '@/components/ui';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import type { ValidSleepDrainEvent } from '../../lib/sleepEfficiencyAnalysis';
import { eventRecencyLabel } from './labels';
import { SleepEfficiencySectionBody } from './SleepEfficiencySectionBody';
import type {
  SleepEfficiencyFormatters,
  SleepEfficiencySectionProps,
} from './types';

type DrainEventDirectoryProps =
  SleepEfficiencySectionProps
  & Pick<SleepEfficiencyFormatters, 'formatTemperature'>;

export function DrainEventDirectory({
  analysis,
  state,
  formatTemperature,
}: DrainEventDirectoryProps) {
  const { t } = useTranslation();
  const rows = useMemo(
    () => [...analysis.events.directory],
    [analysis.events.directory],
  );
  const columns = useMemo<Column<ValidSleepDrainEvent>[]>(
    () => [
      {
        key: 'start',
        header: t('sleep.eventDirectory.start', 'Start'),
        visibleOnMobile: true,
        render: (event) => (
          <div>
            <Text variant="bodySm">{formatDateTime(event.startDate)}</Text>
            <Text variant="caption">
              {eventRecencyLabel(t, event.recency)}
            </Text>
          </div>
        ),
      },
      {
        key: 'end',
        header: t('sleep.eventDirectory.end', 'End'),
        render: (event) => (
          <Text variant="bodySm">{formatDateTime(event.endDate)}</Text>
        ),
      },
      {
        key: 'duration',
        header: t('sleep.eventDirectory.duration', 'Duration'),
        align: 'right',
        visibleOnMobile: true,
        render: (event) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {t('sleep.eventDirectory.hours', '{{value}} h', {
              value: fmtNumber(event.durationHours),
            })}
          </Text>
        ),
      },
      {
        key: 'battery',
        header: t(
          'sleep.eventDirectory.battery',
          'Battery start → end',
        ),
        align: 'right',
        render: (event) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {t(
              'sleep.eventDirectory.batteryValue',
              '{{start}}% → {{end}}%',
              {
                start: fmtNumber(event.startBattery),
                end: fmtNumber(event.endBattery),
              },
            )}
          </Text>
        ),
      },
      {
        key: 'loss',
        header: t('sleep.eventDirectory.loss', 'Battery lost'),
        align: 'right',
        render: (event) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {t('sleep.eventDirectory.percent', '{{value}}%', {
              value: fmtNumber(event.batteryLost),
            })}
          </Text>
        ),
      },
      {
        key: 'rate',
        header: t('sleep.eventDirectory.rate', 'Drain rate'),
        align: 'right',
        render: (event) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {t('sleep.eventDirectory.rateValue', '{{value}}%/hr', {
              value: fmtNumber(event.drainRate),
            })}
          </Text>
        ),
      },
      {
        key: 'sentry',
        header: t('sleep.eventDirectory.sentry', 'Sentry'),
        render: (event) => (
          <Badge
            variant={event.sentryMode ? 'warning' : 'info'}
            size="sm"
          >
            {event.sentryMode ? (
              <Eye className="h-3 w-3" aria-hidden="true" />
            ) : (
              <Moon className="h-3 w-3" aria-hidden="true" />
            )}
            {event.sentryMode
              ? t('sleep.eventDirectory.on', 'On')
              : t('sleep.eventDirectory.off', 'Off')}
          </Badge>
        ),
      },
      {
        key: 'temperature',
        header: t(
          'sleep.eventDirectory.temperature',
          'Outside temperature',
        ),
        render: (event) => (
          <Text
            variant="bodySm"
            className="flex items-center gap-1 font-mono tabular-nums"
          >
            <Thermometer className="h-3 w-3" aria-hidden="true" />
            {event.outsideTempC != null
              ? formatTemperature(event.outsideTempC)
              : '—'}
          </Text>
        ),
      },
    ],
    [formatTemperature, t],
  );

  return (
    <section data-testid="sleep-efficiency-event-directory">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <CalendarClock
            className="h-4 w-4 text-purple-300"
            aria-hidden="true"
          />
          {t(
            'sleep.eventDirectory.title',
            'Recent drain-event directory',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'sleep.eventDirectory.subtitle',
            'Events are validated, deduplicated, future-checked against the frozen clock, and sorted newest first.',
          )}
        </Text>
        <SleepEfficiencySectionBody state={state} skeletonHeight={280}>
          {rows.length > 0 ? (
            <DataTable<ValidSleepDrainEvent>
              tableId="battery:sleep-drain-events"
              columns={columns}
              data={rows}
              keyExtractor={(event) => event.id}
              mobileColumns={['start', 'duration']}
              density="compact"
              pagination
              emptyMessage={t(
                'sleep.eventDirectory.empty',
                'No validated drain events',
              )}
            />
          ) : (
            // no-action: event reconstruction is backend evidence and cannot be created from this view
            <EmptyState
              className="py-8"
              icon={<CalendarClock className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'sleep.eventDirectory.emptyDetail',
                'No event passed timestamp, future, duration, battery, and duplicate validation.',
              )}
            />
          )}
        </SleepEfficiencySectionBody>
      </GlassPanel>
    </section>
  );
}
