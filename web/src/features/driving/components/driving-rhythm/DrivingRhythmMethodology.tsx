import {
  CalendarRange,
  Clock3,
  Database,
  Gauge,
  Info,
  Ruler,
  ShieldCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  Badge,
  GlassPanel,
  PanelTitle,
  Text,
} from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { formatDayKey } from '@/lib/dateFormat';
import { fmtInt } from '@/lib/numberFormat';

import type { DrivingRhythm } from '../../lib/drivingRhythm';
import { DrivingRhythmSectionBody } from './DrivingRhythmSectionBody';
import { RhythmCoverageSummary } from './RhythmCoverageSummary';
import type { DrivingRhythmSectionState } from './types';

interface DrivingRhythmMethodologyProps {
  summary: DrivingRhythm;
  start: string;
  end: string;
  windowLimit: number;
  state: DrivingRhythmSectionState;
}

export function DrivingRhythmMethodology({
  summary,
  start,
  end,
  windowLimit,
  state,
}: DrivingRhythmMethodologyProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const dateOptions = {
    locale: unitPrefs.locale,
    style: 'long' as const,
  };
  const methods = [
    {
      icon: <CalendarRange className="h-4 w-4" aria-hidden="true" />,
      text: summary.timeZoneFallback
        ? t(
            'rhythm.method.timezoneFallback',
            'The requested local timezone was invalid, so UTC is used for every weekday, hour, day, and month grouping.',
          )
        : t(
            'rhythm.method.timeSemantics',
            'The API applies the selected date-only bounds in UTC. Returned instants are then grouped consistently by weekday, hour, day, and month in {{timezone}}.',
            { timezone: summary.timeZone },
          ),
    },
    {
      icon: <Clock3 className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'rhythm.method.timestampRules',
        'Blank or malformed starts are invalid; valid starts after the page’s frozen analysis clock are counted as future and excluded.',
      ),
    },
    {
      icon: <Gauge className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'rhythm.method.predictability',
        'Predictability is 100 minus normalized Shannon entropy across 24 local start hours. Overall and monthly scores require at least {{count}} valid starts.',
        { count: summary.minPredictabilityDrives },
      ),
    },
    {
      icon: <ShieldCheck className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'rhythm.method.consistency',
        'Typical departures use a circular median so midnight-adjacent times stay close. Median circular deviation requires {{count}} starts on that weekday.',
        { count: summary.minConsistencyDrives },
      ),
    },
    {
      icon: <Ruler className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'rhythm.method.distance',
        'Distance stays in canonical SI meters in the model. Only finite non-negative values feed distance totals, and display conversion follows your unit preference.',
      ),
    },
    {
      icon: <Info className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'rhythm.method.scope',
        'These are descriptive departure patterns. They do not identify causes or predict a specific future trip.',
      ),
    },
  ];

  return (
    <GlassPanel
      className="p-5 sm:p-6"
      role="region"
      aria-label={t(
        'rhythm.sections.method',
        'Coverage and methodology',
      )}
      data-testid="driving-rhythm-method"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <Database className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('rhythm.method.title', 'Coverage & methodology')}
        </PanelTitle>
        <Badge variant={summary.historyCapReached ? 'warning' : 'neutral'} dot>
          {summary.historyCapReached
            ? t('rhythm.method.capReached', '{{limit}}-row cap reached', {
                limit: fmtInt(windowLimit),
              })
            : t('rhythm.method.belowCap', 'Returned window below API cap')}
        </Badge>
      </div>
      <Text as="p" variant="caption" className="mt-1">
        {t(
          'rhythm.method.windowLabel',
          '{{start}} – {{end}} selected date scope',
          {
            start: formatDayKey(start, dateOptions),
            end: formatDayKey(end, dateOptions),
          },
        )}
      </Text>

      <DrivingRhythmSectionBody state={state} className="mt-4 min-h-72">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
          <RhythmCoverageSummary
            summary={summary}
            windowLimit={windowLimit}
          />
          <ul className="space-y-3">
            {methods.map((method) => (
              <li
                key={method.text}
                className="flex items-start gap-2"
              >
                <span className="mt-0.5 shrink-0 text-cyan-300">
                  {method.icon}
                </span>
                <Text as="span" variant="bodySm">
                  {method.text}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      </DrivingRhythmSectionBody>
    </GlassPanel>
  );
}
