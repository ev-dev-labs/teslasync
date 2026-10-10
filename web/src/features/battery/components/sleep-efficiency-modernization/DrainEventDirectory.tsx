import { CalendarClock, Eye, Moon, Thermometer } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { LayoutCard } from '@/components/layout/layout-reference';
import { Badge, DataTable, Text, type Column } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { formatDateTime } from '@/lib/dateFormat';
import type { ValidSleepDrainEvent } from '../../lib/sleepEfficiencyAnalysis';
import { eventRecencyLabel } from '../sleep-efficiency/labels';
import { SleepEfficiencySectionBody } from '../sleep-efficiency/SleepEfficiencySectionBody';
import type { SleepEfficiencyFormatters, SleepEfficiencySectionProps } from '../sleep-efficiency';

type Props = SleepEfficiencySectionProps & Pick<SleepEfficiencyFormatters, 'formatTemperature'>;

export function DrainEventDirectory({ analysis, state, formatTemperature }: Props) {
  const { t } = useTranslation();
  const { fmtNumber } = useNumberFormatting();
  const rows = useMemo(() => [...analysis.events.directory], [analysis.events.directory]);
  const duration = (event: ValidSleepDrainEvent) =>
    t('sleep.eventDirectory.hours', '{{value}} h', { value: fmtNumber(event.durationHours) });
  const battery = (event: ValidSleepDrainEvent) =>
    t('sleep.eventDirectory.batteryValue', '{{start}}% → {{end}}%', {
      start: fmtNumber(event.startBattery), end: fmtNumber(event.endBattery),
    });
  const loss = (event: ValidSleepDrainEvent) =>
    t('sleep.eventDirectory.percent', '{{value}}%', { value: fmtNumber(event.batteryLost) });
  const rate = (event: ValidSleepDrainEvent) =>
    t('sleep.eventDirectory.rateValue', '{{value}}%/hr', { value: fmtNumber(event.drainRate) });
  const sentry = (event: ValidSleepDrainEvent) => event.sentryMode
    ? t('sleep.eventDirectory.on', 'On') : t('sleep.eventDirectory.off', 'Off');
  const temperature = (event: ValidSleepDrainEvent) => event.outsideTempC != null
    ? formatTemperature(event.outsideTempC) : '—';
  const columns: Column<ValidSleepDrainEvent>[] = [
    {
      key: 'start', header: t('sleep.eventDirectory.start', 'Start'), visibleOnMobile: true,
      render: event => (
        <div>
          <Text variant="bodySm">{formatDateTime(event.startDate)}</Text>
          <Text variant="caption">{eventRecencyLabel(t, event.recency)}</Text>
        </div>
      ),
    },
    {
      key: 'end', header: t('sleep.eventDirectory.end', 'End'),
      render: event => <Text variant="bodySm">{formatDateTime(event.endDate)}</Text>,
    },
    {
      key: 'duration', header: t('sleep.eventDirectory.duration', 'Duration'), align: 'right', visibleOnMobile: true,
      render: event => <Text variant="bodySm" className="font-mono tabular-nums">{duration(event)}</Text>,
    },
    {
      key: 'battery', header: t('sleep.eventDirectory.battery', 'Battery start → end'), align: 'right',
      render: event => <Text variant="bodySm" className="font-mono tabular-nums">{battery(event)}</Text>,
    },
    {
      key: 'loss', header: t('sleep.eventDirectory.loss', 'Battery lost'), align: 'right',
      render: event => <Text variant="bodySm" className="font-mono tabular-nums">{loss(event)}</Text>,
    },
    {
      key: 'rate', header: t('sleep.eventDirectory.rate', 'Drain rate'), align: 'right',
      render: event => <Text variant="bodySm" className="font-mono tabular-nums">{rate(event)}</Text>,
    },
    {
      key: 'sentry',
      filterValue: event => event.sentryMode ?? null,
      filterValueLabel: (_, event) => sentry(event),
      header: t('sleep.eventDirectory.sentry', 'Sentry'),
      render: event => (
        <Badge variant={event.sentryMode ? 'warning' : 'info'} size="sm">
          {event.sentryMode ? <Eye className="h-3 w-3" aria-hidden="true" /> : <Moon className="h-3 w-3" aria-hidden="true" />}
          {sentry(event)}
        </Badge>
      ),
    },
    {
      key: 'temperature', align: 'right',
      filterValue: event => event.outsideTempC ?? null,
      filterValueLabel: (_, event) => temperature(event),
      header: t('sleep.eventDirectory.temperature', 'Outside temperature'),
      render: event => (
        <Text variant="bodySm" className="flex items-center gap-1 font-mono tabular-nums">
          <Thermometer className="h-3 w-3" aria-hidden="true" />{temperature(event)}
        </Text>
      ),
    },
  ];
  return (
    <section data-testid="sleep-efficiency-event-directory">
      <LayoutCard title={t('sleep.eventDirectory.title', 'Recent drain-event directory')}>
        <Text as="p" variant="caption">
          {t('sleep.eventDirectory.subtitle', 'Events are validated, deduplicated, future-checked against the frozen clock, and sorted newest first.')}
        </Text>
        <SleepEfficiencySectionBody state={state} skeletonHeight={280}>
          {rows.length > 0 ? (
            <DataTable<ValidSleepDrainEvent>
              variant="embedded"
              enableValueFilters
              tableId="battery:sleep-drain-events"
              columns={columns}
              data={rows}
              keyExtractor={event => event.id}
              mobileColumns={['start', 'duration']}
              density="compact"
              pagination
              mobilePresentation={{
                roles: { start: 'title', duration: 'primary', end: 'meta', battery: 'meta', loss: 'meta', rate: 'meta', sentry: 'badge', temperature: 'meta' },
                displayValue: (event, key) => {
                  switch (key) {
                    case 'start': return formatDateTime(event.startDate);
                    case 'end': return formatDateTime(event.endDate);
                    case 'duration': return duration(event);
                    case 'battery': return battery(event);
                    case 'loss': return loss(event);
                    case 'rate': return rate(event);
                    case 'sentry': return sentry(event);
                    case 'temperature': return temperature(event);
                    default: return '—';
                  }
                },
              }}
              emptyMessage={t('sleep.eventDirectory.empty', 'No validated drain events')}
            />
          ) : (
            <EmptyState
              // no-action: no source event passed validation; workspace scope controls remain available and cannot repair invalid evidence.
              className="py-8"
              icon={<CalendarClock className="h-8 w-8" aria-hidden="true" />}
              message={t('sleep.eventDirectory.emptyDetail', 'No event passed timestamp, future, duration, battery, and duplicate validation.')}
            />
          )}
        </SleepEfficiencySectionBody>
      </LayoutCard>
    </section>
  );
}
