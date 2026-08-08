import {
  BatteryMedium,
  CalendarRange,
  CircleSlash2,
  Database,
  FlaskConical,
  MapPinned,
  Percent,
  Route,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { GlassPanel, Heading, PanelTitle, Text } from '@/components/ui';
import type { RangeBufferResult } from '../../lib/rangeBuffer';

interface RangeBufferMethodologyProps {
  result: RangeBufferResult;
  startDate: string;
  endDate: string;
}

export function RangeBufferMethodology({
  result,
  startDate,
  endDate,
}: RangeBufferMethodologyProps) {
  const { t } = useTranslation();
  const items = [
    {
      key: 'arrival',
      icon: <BatteryMedium className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'rangeBuffer.method.arrivalTitle',
        'Arrival definition',
      ),
      body: t(
        'rangeBuffer.method.arrivalBody',
        'One observation is a completed drive with parseable start/end order, completion at or before the frozen clock, and finite end SoC from 0% through 100%.',
      ),
    },
    {
      key: 'window',
      icon: <CalendarRange className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'rangeBuffer.method.windowTitle',
        'Vehicle-local date window',
      ),
      body: t(
        'rangeBuffer.method.windowBody',
        'The selected {{start}} through {{end}} calendar window becomes a half-open drive-start filter in {{timeZone}}. Profiles use completion time in the same timezone, so a drive starting near the end boundary can complete just outside the final local day.',
        {
          start: startDate,
          end: endDate,
          timeZone: result.timeZone,
        },
      ),
    },
    {
      key: 'percentiles',
      icon: <Percent className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'rangeBuffer.method.percentileTitle',
        'Observed percentiles',
      ),
      body: t(
        'rangeBuffer.method.percentileBody',
        'p10, p25, median, p75, and p90 use linear interpolation over included drive arrivals. They are drive-weighted historical summaries, not probability forecasts.',
      ),
    },
    {
      key: 'threshold',
      icon: <CircleSlash2 className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'rangeBuffer.method.thresholdTitle',
        'Planning threshold',
      ),
      body: t(
        'rangeBuffer.method.thresholdBody',
        'Below-threshold means strictly less than {{threshold}}%. The selector is a descriptive planning lens, not a battery safety limit or charging recommendation.',
        { threshold: result.config.thresholdPct },
      ),
    },
    {
      key: 'destination',
      icon: <MapPinned className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'rangeBuffer.method.destinationTitle',
        'Destination support',
      ),
      body: t(
        'rangeBuffer.method.destinationBody',
        'Trimmed case-insensitive end addresses are preferred; otherwise endpoint coordinates are rounded to three decimals. A profile needs at least {{count}} included arrivals.',
        { count: result.config.minDestinationSamples },
      ),
    },
    {
      key: 'distance',
      icon: <Route className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'rangeBuffer.method.distanceTitle',
        'SI distance context',
      ),
      body: t(
        'rangeBuffer.method.distanceBody',
        'Distance bands are computed from canonical meters and converted only at display. Start-to-end SoC drop excludes rows that increased during the drive; neither association establishes cause.',
      ),
    },
    {
      key: 'support',
      icon: <FlaskConical className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'rangeBuffer.method.supportTitle',
        'Support, not confidence',
      ),
      body: t(
        'rangeBuffer.method.supportBody',
        'Support combines returned sample volume, active local days, active local weeks, and recency. It measures evidence breadth only and is not a calibrated confidence interval.',
      ),
    },
    {
      key: 'scope',
      icon: <Database className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'rangeBuffer.method.scopeTitle',
        'Scope and omitted inputs',
      ),
      body: t(
        'rangeBuffer.method.scopeBody',
        'The request is capped at {{limit}} rows. Planned route, rated range, weather, elevation, traffic, charging access, driver intent, and battery health are not modeled.',
        { limit: result.config.historyLimit },
      ),
    },
  ];

  return (
    <section data-testid="range-buffer-methodology">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <FlaskConical
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'rangeBuffer.method.title',
            'Methodology and limitations',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'rangeBuffer.method.subtitle',
            'Definitions, calendar semantics, support rules, accounting, and interpretation limits.',
          )}
        </Text>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {items.map((item) => (
            <article
              key={item.key}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4"
            >
              <div className="mb-2 flex items-center gap-2 text-cyan-300">
                {item.icon}
                <Heading level="sub">{item.title}</Heading>
              </div>
              <Text as="p" variant="bodySm">
                {item.body}
              </Text>
            </article>
          ))}
        </div>
        <AlertBanner className="mt-4" variant="warning">
          <Text as="p" variant="caption">
            {t(
              'rangeBuffer.method.notice',
              'Use this page only to inspect returned historical arrival evidence; it does not predict whether a future trip will have enough range.',
            )}
          </Text>
        </AlertBanner>
      </GlassPanel>
    </section>
  );
}
