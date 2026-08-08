import {
  BatteryMedium,
  CalendarClock,
  CircleSlash2,
  Database,
  Filter,
  FlaskConical,
  Gauge,
  Sigma,
  TrendingDown,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import {
  GlassPanel,
  Heading,
  PanelTitle,
  Text,
} from '@/components/ui';
import type { PackCapacityResult } from '../../lib/packCapacity';

interface PackCapacityMethodologyProps {
  result: PackCapacityResult;
}

export function PackCapacityMethodology({
  result,
}: PackCapacityMethodologyProps) {
  const { t } = useTranslation();
  const items = [
    {
      key: 'eligibility',
      icon: <Database className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'packCapacity.method.eligibilityTitle',
        'Explicit completion',
      ),
      body: t(
        'packCapacity.method.eligibilityBody',
        'A session needs canonical start and completion timestamps in valid order, with completion no later than the frozen analysis clock. Duration never substitutes for a missing completion.',
      ),
    },
    {
      key: 'soc',
      icon: <Gauge className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'packCapacity.method.socTitle',
        'SoC endpoints',
      ),
      body: t(
        'packCapacity.method.socBody',
        'Start and end SoC must both be finite values from 0% through 100%, with a positive gain of at least the selected {{window}} percentage points.',
        { window: result.config.minSocWindowPct },
      ),
    },
    {
      key: 'energy',
      icon: <BatteryMedium className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'packCapacity.method.energyTitle',
        'SI energy evidence',
      ),
      body: t(
        'packCapacity.method.energyBody',
        'Positive session energy is read in watt-hours. Implied full-pack capacity equals energy added divided by SoC gain as a fraction and must remain within {{min}}–{{max}} Wh.',
        {
          min: result.config.minPlausibleWh,
          max: result.config.maxPlausibleWh,
        },
      ),
    },
    {
      key: 'uncertainty',
      icon: <Sigma className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'packCapacity.method.uncertaintyTitle',
        'Measurement uncertainty',
      ),
      body: t(
        'packCapacity.method.uncertaintyBody',
        'Each measurement sigma combines {{soc}} percentage-point endpoint quantization with {{energy}} relative energy-meter uncertainty. Narrower SoC windows therefore carry less influence.',
        {
          soc: result.config.socSigmaPct,
          energy: result.config.energyRelativeSigma,
        },
      ),
    },
    {
      key: 'filter',
      icon: <Filter className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'packCapacity.method.filterTitle',
        'Scalar Kalman filter',
      ),
      body: t(
        'packCapacity.method.filterBody',
        'The posterior uses each measurement variance plus random-walk process variance of {{noise}} Wh per square-root day. Prior, innovation, gain, and posterior are retained for inspection.',
        { noise: result.config.processNoiseWhPerSqrtDay },
      ),
    },
    {
      key: 'fit',
      icon: <TrendingDown className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'packCapacity.method.fitTitle',
        'Gated linear description',
      ),
      body: t(
        'packCapacity.method.fitBody',
        'Annualized linear change is withheld until there are at least {{observations}} filtered observations spanning {{days}} days and {{months}} active months.',
        {
          observations: result.config.minFitObservations,
          days: result.config.minFitSpanDays,
          months: result.config.minFitMonths,
        },
      ),
    },
    {
      key: 'duplicates',
      icon: <CircleSlash2 className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'packCapacity.method.duplicatesTitle',
        'Duplicate and overlap rejection',
      ),
      body: t(
        'packCapacity.method.duplicatesBody',
        'Candidates are ordered deterministically. Repeated session identifiers and intervals beginning before the prior accepted completion are classified out rather than double-counted.',
      ),
    },
    {
      key: 'calendar',
      icon: <CalendarClock className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'packCapacity.method.calendarTitle',
        'Vehicle-local calendar',
      ),
      body: t(
        'packCapacity.method.calendarBody',
        'Months, active days, and active weeks use {{timeZone}}. The analysis clock is frozen when the page mounts so future classification and recency do not drift.',
        { timeZone: result.timeZone },
      ),
    },
    {
      key: 'scope',
      icon: <Database className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'packCapacity.method.scopeTitle',
        'Capped historical scope',
      ),
      body: t(
        'packCapacity.method.scopeBody',
        'The canonical charging endpoint is requested with a {{limit}}-row cap. If the cap is reached, older history may be omitted; chart and directory caps never change summary calculations.',
        { limit: result.config.historyLimit },
      ),
    },
    {
      key: 'limits',
      icon: <FlaskConical className="h-5 w-5" aria-hidden="true" />,
      title: t(
        'packCapacity.method.limitsTitle',
        'Unmodeled factors',
      ),
      body: t(
        'packCapacity.method.limitsBody',
        'Gross-versus-usable buffers, thermal conditioning, charging losses, balancing, firmware changes, cell chemistry, calibration drift, and laboratory capacity tests are not modeled.',
      ),
    },
  ];

  return (
    <section data-testid="pack-capacity-methodology">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <FlaskConical
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'packCapacity.method.title',
            'Methodology and interpretation limits',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'packCapacity.method.subtitle',
            'Eligibility, uncertainty, filtering, fit gates, accounting, calendar semantics, and explicit non-claims.',
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
              'packCapacity.method.notice',
              'Use this workspace to inspect implied capacity from returned charging evidence only. It does not measure battery health, damage, degradation, safety, warranty condition, or remaining life, and it does not prescribe charging behavior.',
            )}
          </Text>
        </AlertBanner>
      </GlassPanel>
    </section>
  );
}
