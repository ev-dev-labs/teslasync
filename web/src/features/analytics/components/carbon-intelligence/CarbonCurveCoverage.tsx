import {
  CheckCircle2,
  CircleDashed,
  CopyX,
  DatabaseZap,
  ShieldAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { StatStrip } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { LayoutCard } from '@/components/layout';
import { Text } from '@/components/ui';
import { CarbonSectionBody } from './CarbonSectionBody';
import type { CarbonSectionProps } from './types';

export function CarbonCurveCoverage({
  analysis,
  states,
  display,
}: CarbonSectionProps) {
  const { t } = useTranslation();
  const source = analysis.curve.source;

  return (
    <section
      data-testid="carbon-curve-coverage"
      aria-label={t(
        'carbon.coverage.aria',
        'Grid intensity model source completeness',
      )}
    >
      <LayoutCard
        title={t('carbon.coverage.title', 'Curve source accounting and completeness')}
        actions={<DatabaseZap className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />}
      >
        <CarbonSectionBody state={states.intensity}>
          <StatStrip
            id="carbon-curve-coverage-metrics"
            variant="embedded"
            period={{ kind: 'unknown', label: t('carbon.source.intensityScope', 'Built-in, admin-editable static 24-hour model') }}
            metrics={[
              {
                metricId: 'text', occurrenceId: 'carbon-coverage-returned',
                label: t('carbon.coverage.returned', 'Rows returned'),
                rawValue: display.formatNumber(source.returnedRows),
                context: <><DatabaseZap className="h-5 w-5" aria-hidden="true" />{t('carbon.coverage.expected', '24 expected clock-hours')}</>,
              },
              {
                metricId: 'text', occurrenceId: 'carbon-coverage-unique',
                label: t('carbon.coverage.unique', 'Valid unique hours'),
                rawValue: display.formatNumber(source.validUniqueHours),
                context: <><CheckCircle2 className="h-5 w-5" aria-hidden="true" />{t('carbon.coverage.uniqueHint', 'Canonical rows used in analysis')}</>,
              },
              {
                metricId: 'text', occurrenceId: 'carbon-coverage-invalid-hours',
                label: t('carbon.coverage.invalidHours', 'Invalid hour rows'),
                rawValue: display.formatNumber(source.invalidHourRows),
                context: <><ShieldAlert className="h-5 w-5" aria-hidden="true" />{t('carbon.coverage.hourRange', 'Required integer 0–23')}</>,
              },
              {
                metricId: 'text', occurrenceId: 'carbon-coverage-invalid-intensity',
                label: t('carbon.coverage.invalidIntensity', 'Invalid intensity rows'),
                rawValue: display.formatNumber(source.invalidIntensityRows),
                context: <><ShieldAlert className="h-5 w-5" aria-hidden="true" />{t('carbon.coverage.intensityRule', 'Required finite non-negative value')}</>,
              },
              {
                metricId: 'text', occurrenceId: 'carbon-coverage-duplicates',
                label: t('carbon.coverage.duplicates', 'Duplicate hour rows'),
                rawValue: display.formatNumber(source.duplicateHourRows),
                context: <><CopyX className="h-5 w-5" aria-hidden="true" />{t('carbon.coverage.duplicateRule', 'First valid row retained deterministically')}</>,
              },
            ]}
          />
          {source.coverageComplete ? (
            <AlertBanner className="mt-4" variant="success">
              {t(
                'carbon.coverage.complete',
                'Coverage is complete: exactly one valid row exists for every backend/model clock-hour.',
              )}
            </AlertBanner>
          ) : (
            <AlertBanner
              className="mt-4"
              variant="warning"
              icon={<CircleDashed className="h-4 w-4" />}
            >
              <Text as="p" variant="caption">
                {source.missingHours.length > 0
                  ? t(
                    'carbon.coverage.missing',
                    'Missing backend/model clock-hours: {{hours}}.',
                    {
                      hours: source.missingHours
                        .map((hour) => display.formatHour(hour))
                        .join(', '),
                    },
                  )
                  : t(
                    'carbon.coverage.incomplete',
                    'Coverage is incomplete because invalid or duplicate rows were returned.',
                  )}
              </Text>
            </AlertBanner>
          )}
        </CarbonSectionBody>
      </LayoutCard>
    </section>
  );
}
