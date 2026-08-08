import {
  CheckCircle2,
  CircleDashed,
  CopyX,
  DatabaseZap,
  ShieldAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { Grid } from '@/components/layout';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
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
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <DatabaseZap
            className="h-4 w-4 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          {t('carbon.coverage.title', 'Curve source accounting and completeness')}
        </PanelTitle>
        <CarbonSectionBody state={states.intensity}>
          <Grid cols={{ default: 1, sm: 2, xl: 5 }} gap={3}>
            <MetricCard
              label={t('carbon.coverage.returned', 'Rows returned')}
              value={display.formatNumber(source.returnedRows, 0)}
              subtitle={t('carbon.coverage.expected', '24 expected clock-hours')}
              icon={<DatabaseZap className="h-5 w-5" aria-hidden="true" />}
              color="blue"
            />
            <MetricCard
              label={t('carbon.coverage.unique', 'Valid unique hours')}
              value={display.formatNumber(source.validUniqueHours, 0)}
              subtitle={t(
                'carbon.coverage.uniqueHint',
                'Canonical rows used in analysis',
              )}
              icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
              color="green"
            />
            <MetricCard
              label={t('carbon.coverage.invalidHours', 'Invalid hour rows')}
              value={display.formatNumber(source.invalidHourRows, 0)}
              subtitle={t('carbon.coverage.hourRange', 'Required integer 0–23')}
              icon={<ShieldAlert className="h-5 w-5" aria-hidden="true" />}
              color={source.invalidHourRows > 0 ? 'red' : 'green'}
            />
            <MetricCard
              label={t('carbon.coverage.invalidIntensity', 'Invalid intensity rows')}
              value={display.formatNumber(source.invalidIntensityRows, 0)}
              subtitle={t(
                'carbon.coverage.intensityRule',
                'Required finite non-negative value',
              )}
              icon={<ShieldAlert className="h-5 w-5" aria-hidden="true" />}
              color={source.invalidIntensityRows > 0 ? 'red' : 'green'}
            />
            <MetricCard
              label={t('carbon.coverage.duplicates', 'Duplicate hour rows')}
              value={display.formatNumber(source.duplicateHourRows, 0)}
              subtitle={t(
                'carbon.coverage.duplicateRule',
                'First valid row retained deterministically',
              )}
              icon={<CopyX className="h-5 w-5" aria-hidden="true" />}
              color={source.duplicateHourRows > 0 ? 'red' : 'green'}
            />
          </Grid>
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
      </GlassPanel>
    </section>
  );
}
