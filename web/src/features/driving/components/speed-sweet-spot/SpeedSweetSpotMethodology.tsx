import {
  CalendarRange, Database, Gauge, Info, Route, Scale, ScatterChart,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import {
  Badge, GlassPanel, MetricLabel, MetricValue, PanelTitle, Text,
} from '@/components/ui';
import { formatDayKey } from '@/lib/dateFormat';
import { fmtInt } from '@/lib/numberFormat';
import {
  DEFAULT_BUCKET_KPH,
  DEFAULT_MIN_DRIVES_PER_BUCKET,
  MIN_ELIGIBLE_DISTANCE_M,
  MIN_ELIGIBLE_DURATION_S,
  type SweetSpotResult,
} from '../../lib/speedSweetSpot';
import { SpeedSweetSpotSectionBody } from './SpeedSweetSpotSectionBody';
import type { SpeedSweetSpotSectionState } from './types';
import { useSpeedSweetSpotDisplay } from './useSpeedSweetSpotDisplay';

interface SpeedSweetSpotMethodologyProps {
  summary: SweetSpotResult;
  start: string;
  end: string;
  windowLimit: number;
  state: SpeedSweetSpotSectionState;
}

export function SpeedSweetSpotMethodology(
  { summary, start, end, windowLimit, state }: SpeedSweetSpotMethodologyProps,
) {
  const { t } = useTranslation();
  const { unitPrefs } = useSpeedSweetSpotDisplay();
  const dateOptions = { locale: unitPrefs.locale, style: 'long' as const };
  const windowLabel = t(
    'sweetSpot.method.windowLabel',
    '{{start}} – {{end}} selected window',
    {
      start: formatDayKey(start, dateOptions),
      end: formatDayKey(end, dateOptions),
    },
  );
  const coverage = [
    {
      value: fmtInt(summary.observed),
      label: t('sweetSpot.method.returned', 'Rows returned'),
    },
    {
      value: fmtInt(summary.eligible),
      label: t('sweetSpot.method.eligible', 'Eligible drives'),
    },
    {
      value: fmtInt(summary.excluded),
      label: t('sweetSpot.method.excluded', 'Excluded drives'),
    },
  ];
  const methods = [
    {
      icon: <Route className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'sweetSpot.method.eligibility',
        'Eligibility requires positive measured energy and average speed, at least {{distance}} km, and at least {{minutes}} minutes.',
        {
          distance: MIN_ELIGIBLE_DISTANCE_M / 1_000,
          minutes: MIN_ELIGIBLE_DURATION_S / 60,
        },
      ),
    },
    {
      icon: <Gauge className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'sweetSpot.method.buckets',
        'Whole-drive average speed is grouped into {{width}} km/h half-open bands; at least {{count}} drives qualify a band.',
        {
          width: DEFAULT_BUCKET_KPH,
          count: DEFAULT_MIN_DRIVES_PER_BUCKET,
        },
      ),
    },
    {
      icon: <Scale className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'sweetSpot.method.weighting',
        'Band, monthly, and overall consumption use total energy ÷ total distance, not an average of drive-level ratios.',
      ),
    },
    {
      icon: <CalendarRange className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'sweetSpot.method.monthly',
        'Monthly average speed is total eligible distance ÷ total eligible duration. Drives with malformed dates stay in non-calendar aggregates.',
      ),
    },
    {
      icon: <ScatterChart className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'sweetSpot.method.scatter',
        'The scatter shows at most {{limit}} evenly spaced chronological points, including the endpoints; all eligible drives feed every aggregate.',
        { limit: summary.scatterLimit },
      ),
    },
    {
      icon: <Info className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'sweetSpot.method.scope',
        'This is whole-drive average-speed evidence, not instantaneous cruising speed and not a recommended road speed.',
      ),
    },
    {
      icon: <Database className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'sweetSpot.method.confounders',
        'Route, weather, elevation, HVAC, traffic, and trip length can confound the association. The observed gap is descriptive, not causal and not a savings forecast.',
      ),
    },
  ];

  return (
    <GlassPanel
      className="p-5 sm:p-6"
      role="region"
      aria-label={t('sweetSpot.sections.method', 'Coverage and methodology')}
      data-testid="speed-sweet-spot-method"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <Database className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('sweetSpot.method.title', 'Coverage & methodology')}
        </PanelTitle>
        <Badge variant={summary.historyCapReached ? 'warning' : 'neutral'} dot>
          {summary.historyCapReached
            ? t('sweetSpot.method.capReached', '{{limit}}-row cap reached', {
                limit: fmtInt(windowLimit),
              })
            : t('sweetSpot.method.belowCap', 'Observed window below API cap')}
        </Badge>
      </div>
      <Text as="p" variant="caption" className="mt-1">{windowLabel}</Text>
      <SpeedSweetSpotSectionBody state={state} className="mt-4 min-h-72">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
          <div>
            <div className="grid grid-cols-3 gap-2">
              {coverage.map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl bg-[var(--surface-2)] p-3"
                >
                  <MetricValue>{item.value}</MetricValue>
                  <MetricLabel>{item.label}</MetricLabel>
                </div>
              ))}
            </div>
            {summary.observed === 0 ? (
              <EmptyState /* no-action: coverage follows the selected server window. */
                className="py-6"
                icon={<Info className="h-7 w-7" aria-hidden="true" />}
                message={t(
                  'sweetSpot.method.empty',
                  'Coverage will appear when the selected window returns drives.',
                )}
              />
            ) : null}
            <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-3">
              <Text as="p" variant="caption">
                {summary.historyCapReached
                  ? t(
                      'sweetSpot.method.capped',
                      'The request returned {{limit}} rows, so this describes the observed selected-window subset; additional drives in the date range may not be represented.',
                      { limit: fmtInt(windowLimit) },
                    )
                  : t(
                      'sweetSpot.method.window',
                      'This describes all {{count}} rows returned for the selected window, up to the {{limit}}-row API limit.',
                      {
                        count: summary.observed,
                        limit: fmtInt(windowLimit),
                      },
                    )}
              </Text>
            </div>
          </div>
          <ul className="space-y-3">
            {methods.map((method) => (
              <li
                key={method.text}
                className="flex items-start gap-2 text-[var(--text-secondary)]"
              >
                <span className="mt-0.5 shrink-0 text-cyan-300">{method.icon}</span>
                <Text as="span" variant="bodySm">{method.text}</Text>
              </li>
            ))}
          </ul>
        </div>
      </SpeedSweetSpotSectionBody>
    </GlassPanel>
  );
}
