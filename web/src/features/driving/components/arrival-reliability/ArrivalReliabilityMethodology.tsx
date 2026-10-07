import {
  CalendarRange,
  CarFront,
  CircleSlash2,
  CloudSun,
  FlaskConical,
  MapPinned,
  Route,
  Sigma,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { GlassPanel, Heading, PanelTitle, Text } from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import type { ArrivalReliabilityResult } from '../../lib/arrivalReliability';

interface ArrivalReliabilityMethodologyProps {
  analysis: ArrivalReliabilityResult;
  timeZone: string;
}

export function ArrivalReliabilityMethodology({
  analysis,
  timeZone,
}: ArrivalReliabilityMethodologyProps) {
  const { t } = useTranslation();
  const items = [
    {
      key: 'allowance',
      icon: <CalendarRange className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'arrivalReliability.method.allowanceTitle',
        'Observed route allowance',
      ),
      body: t(
        'arrivalReliability.method.allowanceBody',
        'For each supported route, allowance = route p50 + max(5 minutes, 10% of route p50). The displayed share is the in-sample fraction at or below that threshold.',
      ),
    },
    {
      key: 'index',
      icon: <Sigma className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'arrivalReliability.method.indexTitle',
        'Timing consistency index',
      ),
      body: t(
        'arrivalReliability.method.indexBody',
        'Index = 100 × [0.65 × observed within-allowance share + 0.35 × exp(−scaled MAD ÷ summary p50)]. It is descriptive and does not establish future outcomes or causes.',
      ),
    },
    {
      key: 'spread',
      icon: <FlaskConical className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'arrivalReliability.method.spreadTitle',
        'Robust spread and percentiles',
      ),
      body: t(
        'arrivalReliability.method.spreadBody',
        'Scaled MAD = 1.4826 × median(|duration − route p50|). p10, p50, p90, and p90 minus p50 are observed historical evidence, not an arrival promise.',
      ),
    },
    {
      key: 'normalization',
      icon: <Route className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'arrivalReliability.method.normalizationTitle',
        'Route-normalized profiles',
      ),
      body: t(
        'arrivalReliability.method.normalizationBody',
        'Each profile sample is 100 × drive duration ÷ that route p50, capped at 1,000, then averaged by sample. A value of 100 matches the route median; unequal support can leave residual route-mix effects.',
      ),
    },
    {
      key: 'timezone',
      icon: <CarFront className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'arrivalReliability.method.timezoneTitle',
        'Vehicle-local calendar',
      ),
      body: t(
        'arrivalReliability.method.timezoneBody',
        'Hour, weekday, date, week, and month use {{timeZone}}. Multiple drives on one local day count as separate observations.',
        { timeZone },
      ),
    },
    {
      key: 'matching',
      icon: <MapPinned className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'arrivalReliability.method.matchingTitle',
        'Directional route matching',
      ),
      body: t(
        'arrivalReliability.method.matchingBody',
        'Normalized addresses are preferred; otherwise coordinates are rounded to three decimals. Address changes or rounding can split or merge real places, and reverse travel is a different route.',
      ),
    },
    {
      key: 'support',
      icon: <CircleSlash2 className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'arrivalReliability.method.supportTitle',
        'Sample gates and support',
      ),
      body: t(
        'arrivalReliability.method.supportBody',
        'Routes and route-windows need at least {{routeSamples}} and {{windowSamples}} samples. Route support = 100 × (0.45 × volume + 0.30 × active days + 0.25 × active weeks), separate from timing consistency.',
        {
          routeSamples: fmtInt(analysis.config.minRouteSamples),
          windowSamples: fmtInt(analysis.config.minWindowSamples),
        },
      ),
    },
    {
      key: 'limits',
      icon: <CloudSun className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'arrivalReliability.method.limitsTitle',
        'Inputs and interpretation limits',
      ),
      body: t(
        'arrivalReliability.method.limitsBody',
        'The newest returned history is limited to {{limit}} rows. No traffic, weather, calendar target, promised arrival, driver identity, or driver intent is modeled; no holdout calibration has been performed.',
        { limit: fmtInt(analysis.config.historyLimit) },
      ),
    },
  ];

  return (
    <section data-testid="arrival-methodology">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t(
            'arrivalReliability.method.title',
            'Methodology and limitations',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'arrivalReliability.method.subtitle',
            'Definitions, formulas, support gates, route grouping, and omitted inputs.',
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
              'arrivalReliability.method.notice',
              'Use these results only as returned historical evidence; no arrival outcome is promised.',
            )}
          </Text>
        </AlertBanner>
      </GlassPanel>
    </section>
  );
}
