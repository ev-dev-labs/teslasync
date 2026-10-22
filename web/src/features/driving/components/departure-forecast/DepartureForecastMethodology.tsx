import {
  CalendarRange,
  CarFront,
  CircleSlash2,
  CloudSun,
  FlaskConical,
  MapPinOff,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { GlassPanel, Heading, PanelTitle, Text } from '@/components/ui';
import { toIsoString } from '@/lib/dateFormat';

import type { DepartureForecast } from '../../lib/departureForecast';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { departureDateTime } from './labels';

interface DepartureForecastMethodologyProps {
  forecast: DepartureForecast;
  locale: string;
  timeZone: string;
  timeZoneProvenance?: string;
}

export function DepartureForecastMethodology({
  forecast,
  locale,
  timeZone,
  timeZoneProvenance,
}: DepartureForecastMethodologyProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const items = [
    {
      key: 'snapshot',
      icon: <CalendarRange className="h-5 w-5" aria-hidden="true" />,
      title: t('departure.method.snapshotTitle', 'Fixed model snapshot'),
      body: <>
        {t('departure.brief.snapshotAnchor', 'Model snapshot anchor: ')}
        <time dateTime={toIsoString(forecast.nowMs) ?? undefined}>
          {departureDateTime(forecast.nowMs, locale, timeZone)}
        </time>
        {'. '}
        {t(
          'departure.method.snapshotBody',
          'The clock is captured when this page mounts and stays fixed while it remains mounted, including history refreshes and vehicle or timezone changes. The lookback, next-24-hour horizon, “in” times, and planning marker use that anchor, not the current clock or the history fetch time. Refreshed rows can change the estimates without advancing the anchor.',
        )}
      </>,
    },
    {
      key: 'model',
      icon: <FlaskConical className="h-5 w-5" aria-hidden="true" />,
      title: t('departure.method.modelTitle', 'Model and shrinkage'),
      body: t(
        'departure.method.calendarModelBody',
        'Each local weekday-hour is a Poisson event cell with a Gamma prior (α {{alpha}}, β {{beta}}). The rate is (recorded departures + α) / (model-assumed calendar opportunities + β), and likelihood is 1 − exp(−rate). Outputs are modeled estimates, not calibrated probabilities.',
        {
          alpha: fmtNumber(forecast.config.priorAlpha, undefined, locale),
          beta: fmtNumber(forecast.config.priorBeta, undefined, locale),
        },
      ),
    },
    {
      key: 'opportunity',
      icon: <CalendarRange className="h-5 w-5" aria-hidden="true" />,
      title: t('departure.method.opportunityTitle', 'Model-assumed calendar opportunity'),
      body: t(
        'departure.method.opportunityBody',
        'The denominator counts matching local-hour boundaries from the hour containing the earliest included returned drive start through the fixed model anchor, including elapsed gaps. Span days and weeks measure elapsed time, not observed recording coverage. Zero-event weeks mean no included returned starts; they do not prove inactivity. No telemetry uptime, completeness, or monitoring coverage metadata is available to this model.',
      ),
    },
    {
      key: 'window',
      icon: <CalendarRange className="h-5 w-5" aria-hidden="true" />,
      title: t('departure.method.windowTitle', 'Returned evidence window'),
      body: t(
        'departure.method.windowBody',
        'The model filters the newest rows returned by /drives to an absolute {{days}}-day lookback. A {{limit}}-row response can be capped and is not guaranteed lifetime history.',
        {
          days: fmtInt(forecast.config.windowDays, locale),
          limit: fmtInt(forecast.config.historyLimit, locale),
        },
      ),
    },
    {
      key: 'timezone',
      icon: <CarFront className="h-5 w-5" aria-hidden="true" />,
      title: t('departure.method.timezoneTitle', 'Vehicle-local calendar'),
      body: <>
        {timeZoneProvenance}{' '}
        {t(
        'departure.method.modelTimezoneBody',
        'Bucketing, weekday support, DST boundaries, half-hour offsets, and upcoming slots use your selected time zone.',
        )}
      </>,
    },
    {
      key: 'events',
      icon: <MapPinOff className="h-5 w-5" aria-hidden="true" />,
      title: t('departure.method.eventsTitle', 'Departure event definition'),
      body: t(
        'departure.method.eventsBody',
        'Every recorded drive start counts as a departure by design. Multiple trips on one local day are separate events; the model does not infer a unique driver or destination.',
      ),
    },
    {
      key: 'inputs',
      icon: <CloudSun className="h-5 w-5" aria-hidden="true" />,
      title: t('departure.method.inputsTitle', 'Inputs not modeled'),
      body: t(
        'departure.method.inputsBody',
        'No calendar, destination, geofence, weather, battery temperature, state of charge, charging plan, traffic, or driver-identity input is used.',
      ),
    },
    {
      key: 'limits',
      icon: <CircleSlash2 className="h-5 w-5" aria-hidden="true" />,
      title: t('departure.method.limitsTitle', 'No command or guarantee'),
      body: t(
        'departure.method.limitsBody',
        'The 20-minute planning marker is illustrative and appears only with enough descriptive support. It does not schedule climate, wake, charge, navigate, or command the vehicle.',
      ),
    },
  ];

  return (
    <section data-testid="departure-methodology">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <FlaskConical
            className="h-4 w-4 text-[var(--text-secondary)]"
            aria-hidden="true"
          />
          {t('departure.method.title', 'Methodology and limitations')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'departure.method.subtitle',
            'What the forecast learns, what it excludes, and how to interpret every estimate.',
          )}
        </Text>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <article
              key={item.key}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4"
            >
              <div className="mb-2 flex items-center gap-2 text-[var(--text-secondary)]">
                {item.icon}
                <Heading level="sub">{item.title}</Heading>
              </div>
              <Text as="p" variant="bodySm">
                {item.body}
              </Text>
            </article>
          ))}
        </div>
        <AlertBanner className="mt-4 border-[var(--border-subtle)] bg-[var(--surface-2)]" variant="warning">
          <Text as="p" variant="caption">
            {t(
              'departure.method.notice',
              'Planning aid only: no automation is created, and no departure is promised.',
            )}
          </Text>
        </AlertBanner>
      </GlassPanel>
    </section>
  );
}
