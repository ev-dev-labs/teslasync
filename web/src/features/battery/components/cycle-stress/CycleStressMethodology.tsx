import {
  Activity,
  BatteryCharging,
  CalendarClock,
  CircleSlash2,
  Database,
  FlaskConical,
  GitBranch,
  ShieldCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import {
  GlassPanel,
  Heading,
  PanelTitle,
  Text,
} from '@/components/ui';
import type { CycleStressResult } from '../../lib/cycleStress';

interface CycleStressMethodologyProps {
  result: CycleStressResult;
}

export function CycleStressMethodology({
  result,
}: CycleStressMethodologyProps) {
  const { t } = useTranslation();
  const items = [
    {
      key: 'eligibility',
      icon: <Database className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'cycleStress.method.eligibilityTitle',
        'Endpoint eligibility',
      ),
      body: t(
        'cycleStress.method.eligibilityBody',
        'A row needs explicit start and end timestamps in valid order, an end at or before the frozen analysis clock, and two finite SoC values from 0% through 100%. Duration never substitutes for a missing end.',
      ),
    },
    {
      key: 'direction',
      icon: <BatteryCharging className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'cycleStress.method.directionTitle',
        'Direction rules',
      ),
      body: t(
        'cycleStress.method.directionBody',
        'Accepted drives must show a net SoC drop greater than 0.05 percentage points; accepted charging sessions must show a net gain greater than that threshold. Zero, tiny, and direction-reversed changes are classified out.',
      ),
    },
    {
      key: 'overlap',
      icon: <CircleSlash2 className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'cycleStress.method.overlapTitle',
        'Overlap rejection',
      ),
      body: t(
        'cycleStress.method.overlapBody',
        'Candidate intervals are ordered by start, then end, source, and returned-row position. An interval beginning before the prior accepted interval ends is rejected rather than interleaved into an impossible chronology.',
      ),
    },
    {
      key: 'continuity',
      icon: <GitBranch className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'cycleStress.method.continuityTitle',
        'Conservative continuity',
      ),
      body: t(
        'cycleStress.method.continuityBody',
        'A new segment begins after more than {{days}} days without an accepted interval or when adjacent endpoint SoC differs by more than {{jump}} percentage points. Cycles never cross those boundaries.',
        {
          days: result.config.maxContinuityGapS / 86_400,
          jump: result.config.maxBoundaryJumpPct,
        },
      ),
    },
    {
      key: 'rainflow',
      icon: <Activity className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'cycleStress.method.rainflowTitle',
        'Turning points and rainflow',
      ),
      body: t(
        'cycleStress.method.rainflowBody',
        'Within each segment, monotone interior observations are reduced to local extrema. A stack-based range-closure rule emits closed ranges at count 1 and unresolved segment-edge ranges at count 0.5.',
      ),
    },
    {
      key: 'metrics',
      icon: <FlaskConical className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'cycleStress.method.metricsTitle',
        'Descriptive metrics',
      ),
      body: t(
        'cycleStress.method.metricsBody',
        'Equivalent full cycles sum count x depth fraction. The depth-weighted index sums count x depth fraction raised to exponent {{exponent}}. The exponent is illustrative and selectable; it is not a Tesla or cell-manufacturer damage curve.',
        { exponent: result.config.exponent },
      ),
    },
    {
      key: 'calendar',
      icon: <CalendarClock className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'cycleStress.method.calendarTitle',
        'Vehicle-local calendar',
      ),
      body: t(
        'cycleStress.method.calendarBody',
        'Cycle closure months, active days, and active weeks use {{timeZone}}. The analysis clock is frozen when the page mounts so future-row classification does not drift during the session.',
        { timeZone: result.timeZone },
      ),
    },
    {
      key: 'support',
      icon: <ShieldCheck className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'cycleStress.method.supportTitle',
        'Support, not confidence',
      ),
      body: t(
        'cycleStress.method.supportBody',
        'The support index combines interval volume, weighted-cycle volume, active weeks, recency, and represented source types. It describes evidence breadth, not statistical confidence or pack condition.',
      ),
    },
    {
      key: 'scope',
      icon: <Database className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'cycleStress.method.scopeTitle',
        'Capped historical scope',
      ),
      body: t(
        'cycleStress.method.scopeBody',
        'Drive and charging histories are each capped at {{limit}} rows and can cover different periods. Older rows may be omitted when either cap is reached; no claim is extrapolated beyond returned evidence.',
        { limit: result.config.historyLimit },
      ),
    },
    {
      key: 'limits',
      icon: <FlaskConical className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'cycleStress.method.limitsTitle',
        'Unmodeled factors',
      ),
      body: t(
        'cycleStress.method.limitsBody',
        'Cell chemistry, pack capacity, temperature, current, power, dwell time, charge rate, balancing, firmware, calendar aging, and laboratory degradation measurements are not modeled.',
      ),
    },
  ];

  return (
    <section data-testid="cycle-stress-methodology">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <FlaskConical
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'cycleStress.method.title',
            'Methodology and interpretation limits',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'cycleStress.method.subtitle',
            'Eligibility, accounting, continuity, rainflow definitions, calendar semantics, and explicit non-claims.',
          )}
        </Text>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
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
              'cycleStress.method.notice',
              'Use this workspace to inspect reconstructed historical SoC ranges only. It does not measure battery health, damage, degradation, safety, warranty status, or remaining life, and it does not prescribe charging behavior.',
            )}
          </Text>
        </AlertBanner>
      </GlassPanel>
    </section>
  );
}
