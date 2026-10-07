import {
  Binary,
  CalendarDays,
  CircleSlash2,
  Clock3,
  FlaskConical,
  GitBranch,
  MapPinned,
  Route,
  Sigma,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AlertBanner } from '@/components/feedback';
import { GlassPanel, Heading, PanelTitle, Text } from '@/components/ui';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import type { DestinationTransitionResult } from '../../lib/destinationTransitions';
interface DestinationTransitionsMethodologyProps {
  model: DestinationTransitionResult;
  locale: string;
  timeZone: string;
}
export function DestinationTransitionsMethodology({
  model,
  locale,
  timeZone,
}: DestinationTransitionsMethodologyProps) {
  const { t } = useTranslation();
  const maxGap = model.config.maxContinuityGapMs == null
    ? t(
        'destinationTransitions.method.noMaxGap',
        'No elapsed-time maximum is configured; endpoint continuity and non-overlap define adjacency.',
      )
    : t(
        'destinationTransitions.method.maxGap',
        'Pairs beyond the configured {{hours}}-hour gap are excluded.',
        {
          hours: fmtNumber(
            model.config.maxContinuityGapMs / 3_600_000,
            1,
            locale,
          ),
        },
      );
  const items = [
    {
      key: 'order',
      icon: <GitBranch className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'destinationTransitions.method.orderTitle',
        'First-order description',
      ),
      body: t(
        'destinationTransitions.method.orderBody',
        'Each accepted edge uses only the previous included drive’s end destination and the current included drive’s end destination. Higher-order history is not modeled.',
      ),
    },
    {
      key: 'continuity',
      icon: <Route className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'destinationTransitions.method.continuityTitle',
        'Endpoint continuity',
      ),
      body: t(
        'destinationTransitions.method.continuityBody',
        'Adjacent rows connect only when normalized addresses match or valid coordinates are within {{meters}} m, and the current start does not overlap the previous end. {{maxGap}}',
        {
          meters: fmtNumber(model.config.gpsToleranceM, 0, locale),
          maxGap,
        },
      ),
    },
    {
      key: 'boundaries',
      icon: <CircleSlash2 className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'destinationTransitions.method.boundariesTitle',
        'Sequence boundaries',
      ),
      body: t(
        'destinationTransitions.method.boundariesBody',
        'Incomplete, invalid, future, nonpositive-duration, and unknown-end rows remain chronological boundaries whenever their start can be placed. An unplaceable start creates a source-order boundary while unrelated placed segments remain analyzable. The model never bridges over a known unusable row.',
      ),
    },
    {
      key: 'shares',
      icon: <Binary className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'destinationTransitions.method.sharesTitle',
        'Observed shares and information',
      ),
      body: t(
        'destinationTransitions.method.sharesBody',
        'An edge share is its accepted count divided by all accepted outgoing transitions from that origin. Empirical information content is −log₂(share), an in-sample rarity description.',
      ),
    },
    {
      key: 'entropy',
      icon: <Sigma className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'destinationTransitions.method.entropyTitle',
        'Entropy and concentration',
      ),
      body: t(
        'destinationTransitions.method.entropyBody',
        'For each origin, concentration = 1 − entropy ÷ log₂(distinct observed successors); a one-successor row equals 1. The global 0–100 index weights row concentration by outgoing count, while support remains separate.',
      ),
    },
    {
      key: 'support',
      icon: <FlaskConical className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'destinationTransitions.method.supportTitle',
        'Support gate and ingredients',
      ),
      body: t(
        'destinationTransitions.method.supportBody',
        'An origin needs at least {{count}} outgoing transitions. Volume, day, and week ingredients reach 1 at {{volume}}, {{days}}, and {{weeks}}; recurrence = max(0, outgoing − distinct successors) ÷ max(1, outgoing − 1). Thin is below the gate or below index 35; developing is 35–69; strong is 70–100.',
        { count: model.config.minSupportedOriginTransitions, volume: model.config.strongOriginTransitions, days: model.config.strongOriginActiveDays, weeks: model.config.strongOriginActiveWeeks },
      ),
    },
    {
      key: 'calendar',
      icon: <CalendarDays className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'destinationTransitions.method.calendarTitle',
        'Vehicle-local calendar and cap',
      ),
      body: t(
        'destinationTransitions.method.calendarBody',
        'Hour, weekday, date, week, and month use {{timeZone}}. Multiple drives on one local day remain separate visits. Only the latest {{limit}} returned rows are requested.',
        { timeZone, limit: fmtInt(model.config.historyLimit) },
      ),
    },
    {
      key: 'locations',
      icon: <MapPinned className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'destinationTransitions.method.locationsTitle',
        'Location normalization risk',
      ),
      body: t(
        'destinationTransitions.method.locationsBody',
        'Addresses are normalized before rounded GPS fallback. Address edits, missing coordinates, and GPS tolerance can split one real place or merge nearby places.',
      ),
    },
    {
      key: 'limits',
      icon: <Clock3 className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'destinationTransitions.method.limitsTitle',
        'Inputs and interpretation limits',
      ),
      body: t(
        'destinationTransitions.method.limitsBody',
        'No driver identity, calendar, traffic, intent, or current live location is used. The latest insight requires the actual latest row to qualify. Results are not a calibrated future likelihood, personal forecast, recommendation, or guarantee.',
      ),
    },
  ];
  return (
    <section data-testid="destination-methodology">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('destinationTransitions.method.title', 'Methodology and limitations')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'destinationTransitions.method.subtitle',
            'Definitions, continuity rules, descriptive formulas, evidence gates, calendar scope, and omitted inputs.',
          )}
        </Text>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <article
              key={item.key}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4"
            >
              <div className="mb-2 flex items-center gap-2 text-cyan-300">
                {item.icon}
                <Heading level="sub">{item.title}</Heading>
              </div>
              <Text as="p" variant="bodySm">{item.body}</Text>
            </article>
          ))}
        </div>
        <AlertBanner className="mt-4" variant="warning">
          <Text as="p" variant="caption">
            {t(
              'destinationTransitions.method.notice',
              'Use this workspace only as returned historical evidence; no future destination is promised.',
            )}
          </Text>
        </AlertBanner>
      </GlassPanel>
    </section>
  );
}
