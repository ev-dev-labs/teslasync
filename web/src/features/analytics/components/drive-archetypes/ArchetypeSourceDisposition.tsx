import { ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Grid } from '@/components/layout';
import {
  Badge,
  GlassPanel,
  MetricLabel,
  MetricValue,
  PanelTitle,
  Text,
} from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import { ArchetypeSectionBody } from './ArchetypeSectionBody';
import type { ArchetypeSectionProps } from './types';

export function ArchetypeSourceDisposition({
  summary,
  state,
}: ArchetypeSectionProps) {
  const { t } = useTranslation();
  const source = summary.source;
  const dispositions = [
    [t('archetypes.source.invalidRow', 'Invalid row'), source.invalidRowRows],
    [t('archetypes.source.invalidId', 'Invalid drive ID'), source.invalidIdRows],
    [t('archetypes.source.duplicate', 'Duplicate drive ID'), source.duplicateDriveRows],
    [t('archetypes.source.missingStart', 'Missing start time'), source.missingStartRows],
    [t('archetypes.source.invalidStart', 'Invalid start time'), source.invalidStartRows],
    [t('archetypes.source.invalidDistance', 'Invalid distance'), source.invalidDistanceRows],
    [t('archetypes.source.shortDistance', 'Below distance floor'), source.shortDistanceRows],
    [t('archetypes.source.missingEnergy', 'Missing energy'), source.missingEnergyRows],
    [t('archetypes.source.invalidEnergy', 'Invalid energy'), source.invalidEnergyRows],
    [t('archetypes.source.missingSpeed', 'Missing average speed'), source.missingSpeedRows],
    [t('archetypes.source.invalidSpeed', 'Invalid average speed'), source.invalidSpeedRows],
    [t('archetypes.source.observedTemp', 'Eligible · measured temperature'), source.eligibleObservedTempRows],
    [t('archetypes.source.imputedTemp', 'Eligible · imputed temperature'), source.eligibleImputedTempRows],
  ] as const;

  return (
    <section data-testid="drive-archetypes-source">
      <GlassPanel className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            <PanelTitle className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
              {t('archetypes.source.title', 'Source eligibility disposition')}
            </PanelTitle>
            <Text as="p" variant="caption" className="mt-1">
              {t(
                'archetypes.source.subtitle',
                'Every returned row receives exactly one terminal disposition.',
              )}
            </Text>
          </div>
          <Badge variant="info">
            {t('archetypes.source.returnedBadge', '{{count}} returned', {
              count: source.returnedRows,
            })}
          </Badge>
        </div>
        <ArchetypeSectionBody summary={summary} state={state} requirement="resolved">
          <Grid cols={{ default: 1, sm: 2, lg: 3, xl: 4 }} gap={3}>
            {dispositions.map(([label, count], index) => (
              <div
                key={label}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
              >
                <MetricLabel>{label}</MetricLabel>
                <div className="mt-1 flex items-end justify-between gap-2">
                  <MetricValue>{fmtInt(count)}</MetricValue>
                  <Badge variant={index >= dispositions.length - 2 ? 'success' : 'neutral'}>
                    {index >= dispositions.length - 2
                      ? t('archetypes.source.eligible', 'Eligible')
                      : t('archetypes.source.excluded', 'Excluded')}
                  </Badge>
                </div>
              </div>
            ))}
          </Grid>
        </ArchetypeSectionBody>
      </GlassPanel>
    </section>
  );
}
