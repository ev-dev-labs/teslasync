import { useState } from 'react';
import { Activity, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useComponentSurvival } from '@/api/hooks/useAdvancedIntelligence';
import { CHART_COLORS } from '@/components/charts';
import { MetricBar, StatCard } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Pagination, Text } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { EvidencePanel, InsightPanel } from '../components';

const PAGE_SIZE = 12;

export default function ComponentSurvivalPage() {
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const [page, setPage] = useState(1);
  const query = useComponentSurvival(vehicleId, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const items = query.data?.items ?? [];
  const representative = items[0] ?? null;
  usePageTitle(t('advancedIntelligence.survival.title', 'Component Survival'));

  return (
    <PageContainer
      title={t('advancedIntelligence.survival.title', 'Component Survival')}
      subtitle={t(
        'advancedIntelligence.survival.subtitle',
        'Review probabilistic service horizons, competing risks, and intervention sensitivity.',
      )}
      actions={<VehicleSelect withIcon />}
      loading={vehicleId != null && query.isLoading}
      error={query.error instanceof Error ? query.error : null}
    >
      <AlertBanner
        variant="info"
        icon={<Wrench className="h-5 w-5" aria-hidden="true" />}
        title={t('advancedIntelligence.survival.notice.title', 'Probabilistic maintenance guidance')}
      >
        {t(
          'advancedIntelligence.survival.notice.body',
          'Horizons are uncertainty bands from observed exposure, not guaranteed failure dates or diagnoses.',
        )}
      </AlertBanner>

      <FadeIn>
        <InsightPanel
          title={t('advancedIntelligence.survival.cards.title', 'Component survival cards')}
          empty={items.length === 0}
          emptyMessage={vehicleId == null
            ? t('advancedIntelligence.vehicle.empty', 'Select a vehicle to load intelligence.')
            : t('advancedIntelligence.survival.empty', 'No component survival estimates are available.')}
        >
          <div className="grid gap-5 xl:grid-cols-2">
            {items.map((item) => (
              <article key={item.component} className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Activity className="h-5 w-5 text-cyan-300" aria-hidden="true" />
                    <Text as="h3" variant="subhead">{item.component}</Text>
                  </div>
                  <Badge variant={item.data_quality.status === 'sufficient' ? 'success' : 'warning'}>
                    {item.data_quality.status}
                  </Badge>
                </div>
                <Grid cols={{ default: 1, sm: 2 }} gap={3}>
                  <StatCard
                    label={t('advancedIntelligence.survival.probability', 'Survival probability')}
                    value={item.survival_probability_pct != null
                      ? `${fmtNumber(item.survival_probability_pct, 1)}%` : null}
                  />
                  <StatCard
                    label={t('advancedIntelligence.survival.p10', 'P10 horizon')}
                    value={units.formatDuration(item.horizon_p10_s)}
                  />
                  <StatCard
                    label={t('advancedIntelligence.survival.p50', 'P50 horizon')}
                    value={units.formatDuration(item.horizon_p50_s)}
                  />
                  <StatCard
                    label={t('advancedIntelligence.survival.p90', 'P90 horizon')}
                    value={units.formatDuration(item.horizon_p90_s)}
                  />
                </Grid>
                <div className="mt-5 space-y-3">
                  <Text as="h4" variant="label">
                    {t('advancedIntelligence.survival.risks.title', 'Competing risks')}
                  </Text>
                  {(item.competing_risks ?? []).length > 0 ? item.competing_risks.map((risk) => (
                    risk.probability_pct != null ? (
                      <MetricBar
                        key={risk.risk}
                        label={`${risk.risk} · ${t('advancedIntelligence.survival.evidenceCount', '{{count}} evidence', { count: risk.evidence_count })}`}
                        value={risk.probability_pct}
                        max={100}
                        color={CHART_COLORS[0]}
                        sublabel={`${fmtNumber(risk.probability_pct, 1)}%`}
                      />
                    ) : (
                      <div key={risk.risk} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2">
                        <Text as="span" variant="bodySm">
                          {risk.risk} · {t('advancedIntelligence.survival.evidenceCount', '{{count}} evidence', { count: risk.evidence_count })}
                        </Text>
                        <Text as="span" variant="bodySm" color="muted">
                          {t('advancedIntelligence.survival.risks.unsupported', 'Unsupported')}
                        </Text>
                      </div>
                    )
                  )) : (
                    <Text as="p" variant="bodySm">
                      {t('advancedIntelligence.survival.risks.empty', 'Competing-risk estimates are unsupported.')}
                    </Text>
                  )}
                </div>
                <div className="mt-5 rounded-lg border border-cyan-400/15 bg-cyan-400/[0.04] p-3">
                  <Text as="p" variant="label">
                    {t('advancedIntelligence.survival.intervention', 'Intervention sensitivity')}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {item.intervention_sensitivity.intervention}: {fmtNumber(
                      item.intervention_sensitivity.assumed_hazard_delta_pct, 1,
                    )}% · {t('advancedIntelligence.survival.adjustedP50', 'adjusted P50 {{value}}', {
                      value: units.formatDuration(item.intervention_sensitivity.adjusted_p50_s),
                    })}
                  </Text>
                </div>
              </article>
            ))}
          </div>
          {(query.data?.total ?? 0) > PAGE_SIZE ? (
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={query.data?.total ?? 0}
              onPageChange={setPage}
            />
          ) : null}
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <EvidencePanel
          quality={representative?.data_quality}
          evidence={representative?.evidence}
          limitations={representative?.limitations}
          unsupported={[
            t('advancedIntelligence.survival.unsupported.failureDate', 'A guaranteed failure date'),
            t('advancedIntelligence.survival.unsupported.repair', 'Automatic diagnosis or repair authorization'),
          ]}
        />
      </FadeIn>
    </PageContainer>
  );
}
