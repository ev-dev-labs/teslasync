import { BookOpen, FlaskConical } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { Heading, Text } from '@/components/ui';

import { ChargeAdvisorSection } from './ChargeAdvisorSection';
import type { ChargeAdvisorComponentProps } from './types';

export function ChargeAdvisorMethodology({ analysis, state }: ChargeAdvisorComponentProps) {
  const { t } = useTranslation();
  const items = [
    {
      key: 'drop',
      title: t('chargeAdvisor.method.dropTitle', 'Drive-associated SoC drop'),
      body: t(
        'chargeAdvisor.method.dropBody',
        'Completed drives need valid order, duration, and SoC. Positive start-minus-end SoC drops are summed by vehicle-local calendar day; they are not total energy use.',
      ),
    },
    {
      key: 'calendar',
      title: t('chargeAdvisor.method.calendarTitle', 'Exact local calendar'),
      body: t(
        'chargeAdvisor.method.calendarBody',
        'IANA timezone date, weekday, hour, and week parts are explicit. Every calendar occurrence in the 180-day window contributes to weekday denominators, including zero-driving dates.',
      ),
    },
    {
      key: 'scenarios',
      title: t('chargeAdvisor.method.scenarioTitle', 'Tomorrow-first scenarios'),
      body: t(
        'chargeAdvisor.method.scenarioBody',
        'Seven complete local days start tomorrow from the observed current SoC. Calendar-day mean and calendar-day p75 paths include zero-use days and are historical-use scenarios, not calibrated outcomes.',
      ),
    },
    {
      key: 'omitted',
      title: t('chargeAdvisor.method.omittedTitle', 'Omitted inputs'),
      body: t(
        'chargeAdvisor.method.omittedBody',
        'Planned trips, destination or navigation, weather, passengers, HVAC, driver identity, route changes, and electricity rates are not modeled.',
      ),
    },
  ];

  return (
    <ChargeAdvisorSection
      title={t('chargeAdvisor.method.title', 'Methodology and limitations')}
      subtitle={t(
        'chargeAdvisor.method.subtitle',
        'Definitions, gates, provenance, and the limits of this descriptive planning view.',
      )}
      icon={<FlaskConical className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
      state={state}
      dependency="both"
      dataTestId="charge-advisor-methodology"
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <article key={item.key} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
            <div className="mb-2 flex items-center gap-2 text-cyan-300">
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              <Heading level="sub">{item.title}</Heading>
            </div>
            <Text as="p" variant="caption" className="mt-4">
              {t('chargeAdvisor.method.timeZone', 'Calendar calculations use {{timeZone}}.', {
                timeZone: analysis.timeZone,
              })}
            </Text>
            <Text as="p" variant="bodySm">{item.body}</Text>
          </article>
        ))}
      </div>
      <AlertBanner className="mt-4" variant="info">
        <Text as="p" variant="caption">
          {t(
            'chargeAdvisor.method.notice',
            'Use the result as historical evidence for planning. It does not establish a battery operating limit, a health diagnosis, or a promised outcome.',
          )}
        </Text>
      </AlertBanner>
    </ChargeAdvisorSection>
  );
}
