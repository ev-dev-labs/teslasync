import { CalendarRange } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import { Grid, LayoutCard } from '@/components/layout';
import { Badge, Table, Text } from '@/components/ui';


import type { OdometerMilestoneResult, PaceScenario } from '../../lib/odometerMilestones';
import { MilestoneSectionBody } from './MilestoneSectionBody';
import type { MilestoneSectionState } from './types';
import { useOdometerMilestoneDisplay } from './useOdometerMilestoneDisplay';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

const SCENARIO_COLUMNS = { default: 1, lg: 3 } as const;

interface PaceForecastScenariosProps {
  summary: OdometerMilestoneResult;
  state: MilestoneSectionState;
}

export function PaceForecastScenarios({
  summary,
  state,
}: PaceForecastScenariosProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatDateMs, formatDistanceKm } =
    useOdometerMilestoneDisplay();

  function titleOf(scenario: PaceScenario): string {
    if (scenario.id === 'trailing30') {
      return t('milestones.scenarios.trailing30', 'Trailing 30 days');
    }
    if (scenario.id === 'trailing90') {
      return t('milestones.scenarios.trailing90', 'Trailing 90 days');
    }
    return t(
      'milestones.scenarios.observedHistory',
      'Full observed history',
    );
  }

  return (
    <section
      aria-label={t(
        'milestones.sections.scenarios',
        'Pace and forecast scenarios',
      )}
      data-testid="milestone-scenarios"
    >
      <LayoutCard title={t('milestones.scenarios.title', 'Pace & forecast scenarios')}
        description={t(
            'milestones.scenarios.subtitle',
            'Each projection divides eligible distance by its actual observed span through this page’s frozen as-of time.',
          )}
      >
        <MilestoneSectionBody state={state}>
          {summary.accounting.eligibleRows === 0 ? (
            <EmptyState
              icon={<CalendarRange className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'milestones.scenarios.empty',
                'No eligible drives are available to evaluate pace scenarios.',
              )}
              actionTo={{
                label: t('milestones.actions.browseDrives', 'Browse drives'),
                to: '/drives',
              }}
            />
          ) : (
            <Grid cols={SCENARIO_COLUMNS} gap={3}>
              {summary.paceScenarios.map((scenario) => (
                <article
                  key={scenario.id}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <Text weight="semibold" color="primary">
                      {titleOf(scenario)}
                    </Text>
                    <Badge
                      variant={scenario.supported ? 'success' : 'warning'}
                    >
                      {scenario.supported
                        ? t('milestones.scenarios.supported', 'Supported')
                        : t(
                            'milestones.scenarios.insufficient',
                            'Insufficient evidence',
                          )}
                    </Badge>
                  </div>
                  <Table className="mt-4" aria-label={titleOf(scenario)}>
                    <tbody>
                    {[
                      {
                        key: 'samples',
                        label: t(
                          'milestones.scenarios.samples',
                          'Eligible samples',
                        ),
                        value: t(
                          'milestones.scenarios.driveValue',
                          '{{count}} drives',
                          { count: scenario.sampleCount },
                        ),
                      },
                      {
                        key: 'span',
                        label: t(
                          'milestones.scenarios.observedDays',
                          'Observed span',
                        ),
                        value:
                          scenario.observedDays != null
                            ? t(
                                'milestones.scenarios.dayValue',
                                '{{days}} days',
                                {
                                  days: fmtNumber(
                                    scenario.observedDays,
                                  ),
                                },
                              )
                            : '—',
                      },
                      {
                        key: 'distance',
                        label: t(
                          'milestones.scenarios.distance',
                          'Eligible distance',
                        ),
                        value: formatDistanceKm(scenario.distanceKm),
                      },
                      {
                        key: 'pace',
                        label: t(
                          'milestones.scenarios.distancePerDay',
                          'Distance / day',
                        ),
                        value:
                          scenario.paceKmPerDay != null
                            ? formatDistanceKm(
                                scenario.paceKmPerDay,
                              )
                            : '—',
                      },
                      {
                        key: 'eta',
                        label: t(
                          'milestones.scenarios.nextEta',
                          'Next-milestone ETA',
                        ),
                        value:
                          scenario.nextMilestoneEtaMs != null
                            ? formatDateMs(
                                scenario.nextMilestoneEtaMs,
                              )
                            : scenario.supported
                              ? t(
                                  'milestones.scenarios.outOfRange',
                                  'Beyond forecast horizon',
                                )
                              : '—',
                      },
                    ].map((item) => (
                      <tr
                        key={item.key}
                      >
                        <th scope="row"><Text variant="caption">
                          {item.label}
                        </Text></th>
                        <td className="text-right">
                        <Text
                          size="xs"
                          weight="medium"
                          color="secondary"
                          className="text-right tabular-nums"
                        >
                          {item.value}
                        </Text>
                        </td>
                      </tr>
                    ))}
                    </tbody>
                  </Table>
                </article>
              ))}
            </Grid>
          )}
          <Text variant="caption" className="mt-4 block">
            {t(
              'milestones.scenarios.caveat',
              'Scenarios are sensitivity checks, not promises of future driving.',
            )}
          </Text>
        </MilestoneSectionBody>
      </LayoutCard>
    </section>
  );
}
