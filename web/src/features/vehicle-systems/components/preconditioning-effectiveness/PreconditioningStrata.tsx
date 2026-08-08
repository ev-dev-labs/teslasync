import { Flame, Snowflake } from 'lucide-react';
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
import { fmtInt, fmtPercent } from '@/lib/numberFormat';
import type { PreconditioningSummary } from '../../lib/preconditioningEffectiveness';
import {
  preconditioningEvidenceLabel,
  preconditioningEvidenceVariant,
  preconditioningRegimeLabel,
} from './labels';
import { PreconditioningSectionBody } from './PreconditioningSectionBody';
import type {
  PreconditioningQueryState,
  TemperatureDeltaFormatter,
} from './types';

interface PreconditioningStrataProps {
  summary: PreconditioningSummary;
  state: PreconditioningQueryState;
  formatDelta: TemperatureDeltaFormatter;
}

export function PreconditioningStrata({
  summary,
  state,
  formatDelta,
}: PreconditioningStrataProps) {
  const { t } = useTranslation();

  return (
    <section data-testid="preconditioning-strata">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Snowflake className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('preconditioningEffectiveness.strata.title', 'Hot and cold strata')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'preconditioningEffectiveness.strata.subtitle',
            'Initial signed cabin-to-target direction defines the stratum; comparative values remain withheld wherever either group is absent.',
          )}
        </Text>
        <PreconditioningSectionBody
          summary={summary}
          state={state}
          requirement="classified"
        >
          <Grid cols={{ default: 1, xl: 2 }} gap={3}>
            {summary.strata.map((row) => {
              const published = row.evidence !== 'none';
              return (
                <article
                  key={row.regime}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {row.regime === 'hot'
                        ? <Flame className="h-5 w-5 text-amber-300" aria-hidden="true" />
                        : <Snowflake className="h-5 w-5 text-cyan-300" aria-hidden="true" />}
                      <Text as="h3" variant="label">
                        {preconditioningRegimeLabel(t, row.regime)}
                      </Text>
                    </div>
                    <Badge variant={preconditioningEvidenceVariant(row.evidence)}>
                      {preconditioningEvidenceLabel(t, row.evidence)}
                    </Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div>
                      <MetricLabel>{t('preconditioningEffectiveness.strata.activeCount', 'HVAC-active count')}</MetricLabel>
                      <MetricValue className="mt-1">{fmtInt(row.conditionedCount)}</MetricValue>
                    </div>
                    <div>
                      <MetricLabel>{t('preconditioningEffectiveness.strata.controlCount', 'Explicit-off count')}</MetricLabel>
                      <MetricValue className="mt-1">{fmtInt(row.unconditionedCount)}</MetricValue>
                    </div>
                    <div>
                      <MetricLabel>{t('preconditioningEffectiveness.strata.readiness', 'Readiness difference')}</MetricLabel>
                      <MetricValue className="mt-1">
                        {published
                          ? formatDelta(row.startDeltaAdvantageC, { signed: true })
                          : '—'}
                      </MetricValue>
                    </div>
                    <div>
                      <MetricLabel>{t('preconditioningEffectiveness.strata.improvement', 'Improvement difference')}</MetricLabel>
                      <MetricValue className="mt-1">
                        {published
                          ? formatDelta(row.improvementLiftC, { signed: true })
                          : '—'}
                      </MetricValue>
                    </div>
                  </div>
                  <Text as="p" variant="caption" className="mt-4">
                    {published
                      ? t(
                          'preconditioningEffectiveness.strata.confidence',
                          '{{confidence}} combined confidence from balance {{balance}} and volume {{volume}}.',
                          {
                            confidence: fmtPercent(row.confidence * 100, 0),
                            balance: fmtPercent(row.balanceConfidence * 100, 0),
                            volume: fmtPercent(row.volumeConfidence * 100, 0),
                          },
                        )
                      : t(
                          'preconditioningEffectiveness.strata.withheld',
                          'Insufficient support: both observational groups are required in this stratum.',
                        )}
                  </Text>
                </article>
              );
            })}
          </Grid>
        </PreconditioningSectionBody>
      </GlassPanel>
    </section>
  );
}
