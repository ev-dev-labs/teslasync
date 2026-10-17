import { useState } from 'react';
import { Activity, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useComponentSurvival } from '@/api/hooks/useAdvancedIntelligence';
import { CHART_COLORS } from '@/components/charts';
import { MetricBar, StatStrip } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';

import { PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Button, Card, Icon, Pagination, Text } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';

import { EvidencePanel, InsightPanel } from '../components';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDateFormat } from '@/hooks/useDateFormat';
import { typography } from '@/lib/tokens';

const PAGE_SIZE = 12;
// BuildComponentSurvival evaluates probability at 365 days, independently of its percentile horizons.
const MODEL_HORIZON_DAYS = 365;

export default function ComponentSurvivalPage() {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const componentLabel = (value: string) => {
    switch (value) {
      case 'hv_battery': return t('advancedIntelligence.survival.components.hv_battery', 'High-voltage battery');
      case 'tires': return t('advancedIntelligence.survival.components.tires', 'Tires');
      case 'brakes': return t('advancedIntelligence.survival.components.brakes', 'Brakes');
      case 'charging_system': return t('advancedIntelligence.survival.components.charging_system', 'Charging system');
      default: return value;
    }
  };
  const interventionLabel = (value: string) => {
    switch (value) {
      case 'complete battery inspection': return t('advancedIntelligence.survival.interventions.battery', 'Complete battery inspection');
      case 'complete tire inspection and alignment': return t('advancedIntelligence.survival.interventions.tires', 'Complete tire inspection and alignment');
      case 'complete brake inspection': return t('advancedIntelligence.survival.interventions.brakes', 'Complete brake inspection');
      case 'inspect charging equipment and inlet': return t('advancedIntelligence.survival.interventions.charging', 'Inspect charging equipment and inlet');
      default: return value;
    }
  };
  const qualityLabel = (value: string) => {
    switch (value) {
      case 'sufficient': return t('advancedIntelligence.brief.quality.sufficient', 'Sufficient evidence');
      case 'limited': return t('advancedIntelligence.brief.quality.limited', 'Limited evidence');
      case 'insufficient': return t('advancedIntelligence.brief.quality.insufficient', 'Insufficient evidence');
      default: return value;
    }
  };
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const { formatDateTime } = useDateFormat();
  const [pagination, setPagination] = useState({ vehicleId, page: 1 });
  const page = pagination.vehicleId === vehicleId ? pagination.page : 1;
  if (pagination.vehicleId !== vehicleId) {
    setPagination({ vehicleId, page: 1 });
  }
  const query = useComponentSurvival(vehicleId, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const items = query.data?.items ?? [];
  const emptyMessage = vehicleId == null
    ? t('advancedIntelligence.vehicle.empty', 'Select a vehicle to load intelligence.')
    : t('advancedIntelligence.survival.empty', 'No component survival estimates are available.');
  usePageTitle(t('advancedIntelligence.survival.title', 'Component survival'));

  return (
    <PageLayout
      title={t('advancedIntelligence.survival.title', 'Component survival')}
      subtitle={t(
        'advancedIntelligence.survival.subtitle',
        'Review probabilistic service horizons, competing risks, and intervention sensitivity.',
      )}
    >
      <AlertBanner
        variant="info"
        icon={<Icon icon={Wrench} size="lg" aria-hidden={true} />}
        title={t('advancedIntelligence.survival.notice.title', 'Probabilistic maintenance guidance')}
      >
        {t(
          'advancedIntelligence.survival.notice.body',
          'Horizons are uncertainty bands from observed exposure, not guaranteed failure dates or diagnoses.',
        )}
      </AlertBanner>

      <FadeIn>
        <InsightPanel
          query={vehicleId != null ? query : undefined}
          title={t('advancedIntelligence.survival.cards.title', 'Component survival cards')}
          empty={items.length === 0}
          emptyMessage={emptyMessage}
        >
          <div className="grid min-w-0 gap-6 @5xl:grid-cols-2">
            {items.map((item) => (
              <article key={item.component} className="min-w-0 break-words">
                <Card>
                <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 max-w-full items-center gap-2">
                    <Icon icon={Activity} size="lg" className={typography.color.secondary} aria-hidden={true} />
                    <Text as="h3" variant="subhead" className="min-w-0 break-words">{componentLabel(item.component)}</Text>
                  </div>
                  <Badge variant={item.data_quality.status === 'sufficient' ? 'success' : 'warning'}>
                    {qualityLabel(item.data_quality.status)}
                  </Badge>
                </div>
                <StatStrip variant="embedded"
                  period={{
                    kind: 'snapshot',
                    observedAt: item.generated_at || null,
                    label: t('advancedIntelligence.brief.generated', 'Result generated: {{date}}', {
                      date: formatDateTime(item.generated_at),
                    }),
                    provenance: t('advancedIntelligence.survival.notice.body',
                      'Horizons are uncertainty bands from observed exposure, not guaranteed failure dates or diagnoses.'),
                  }}
                  metrics={[
                    {
                      metricId: 'percent', occurrenceId: 'survival-probability',
                      rawValue: item.survival_probability_pct,
                      label: t('advancedIntelligence.survival.probability', 'Survival probability'),
                      context: `${t('advancedIntelligence.resilience.horizon', 'Modeled survival horizon')}: ${t(
                        'operations.scope.days', '{{count}} days', { count: MODEL_HORIZON_DAYS },
                      )}`,
                      display: { formatter: raw => ({ value: fmtNumber(raw), unit: '%' }) },
                    },
                    {
                      metricId: 'duration', occurrenceId: 'p10', rawValue: item.horizon_p10_s,
                      label: t('advancedIntelligence.survival.p10', 'P10 horizon'),
                      display: { formatter: raw => ({ value: units.formatDuration(raw), unit: '' }) },
                    },
                    {
                      metricId: 'duration', occurrenceId: 'p50', rawValue: item.horizon_p50_s,
                      label: t('advancedIntelligence.survival.p50', 'P50 horizon'),
                      display: { formatter: raw => ({ value: units.formatDuration(raw), unit: '' }) },
                    },
                    {
                      metricId: 'duration', occurrenceId: 'p90', rawValue: item.horizon_p90_s,
                      label: t('advancedIntelligence.survival.p90', 'P90 horizon'),
                      display: { formatter: raw => ({ value: units.formatDuration(raw), unit: '' }) },
                    },
                  ]}
                />
                <div className="mt-5 space-y-3">
                  <Text as="h4" variant="label">
                    {t('advancedIntelligence.survival.risks.title', 'Competing risks')}
                  </Text>
                  {(item.competing_risks ?? []).length > 0 ? item.competing_risks.map((risk) => (
                    risk.probability_pct != null ? (
                      <MetricBar
                        key={risk.risk}
                        label={`${componentLabel(risk.risk)} · ${t('advancedIntelligence.survival.evidenceCount', '{{count}} evidence', { count: risk.evidence_count })}`}
                        value={risk.probability_pct}
                        max={100}
                        color={CHART_COLORS[0]}
                        fill="solid"
                        sublabel={`${fmtNumber(risk.probability_pct)}%`}
                      />
                    ) : (
                      <div key={risk.risk} className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2">
                        <Text as="span" variant="bodySm" className="min-w-0 break-words">
                          {componentLabel(risk.risk)} · {t('advancedIntelligence.survival.evidenceCount', '{{count}} evidence', { count: risk.evidence_count })}
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
                <div className="mt-5 min-w-0 rounded-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-3">
                  <Text as="p" variant="label">
                    {t('advancedIntelligence.survival.intervention', 'Intervention sensitivity')}
                  </Text>
                  <Text as="p" variant="bodySm">
                    {interventionLabel(item.intervention_sensitivity.intervention)}: {fmtNumber(
                      item.intervention_sensitivity.assumed_hazard_delta_pct,
                    )}% · {t('advancedIntelligence.survival.adjustedP50', 'adjusted P50 {{value}}', {
                      value: units.formatDuration(item.intervention_sensitivity.adjusted_p50_s),
                    })}
                  </Text>
                </div>
                </Card>
              </article>
            ))}
          </div>
        </InsightPanel>
          {items.length === 0 && page > 1 ? (
            <Button variant="secondary" onClick={() => setPagination({ vehicleId, page: 1 })}>
              {t('pagination.first', 'First page')}
            </Button>
          ) : null}
          {(query.data?.total ?? 0) > PAGE_SIZE ? (
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={query.data?.total ?? 0}
              onPageChange={nextPage => setPagination({ vehicleId, page: nextPage })}
            />
          ) : null}
      </FadeIn>

      <FadeIn delay={0.05}>
        <InsightPanel
          query={vehicleId != null ? query : undefined}
          title={t('advancedIntelligence.evidence.title', 'Evidence, quality, and limitations')}
          empty={items.length === 0}
          emptyMessage={emptyMessage}
        >
          <div className="space-y-6">
            {items.map(item => (
              <section key={item.component} aria-label={componentLabel(item.component)} className="min-w-0 space-y-3 break-words">
                <Text as="p" variant="subhead">{componentLabel(item.component)}</Text>
                <Text as="p" variant="caption">
                  {t('advancedIntelligence.brief.generated', 'Result generated: {{date}}', {
                    date: formatDateTime(item.generated_at),
                  })}
                </Text>
                <EvidencePanel
                  quality={item.data_quality}
                  evidence={item.evidence}
                  limitations={item.limitations}
                />
              </section>
            ))}
          </div>
        </InsightPanel>
        <Card className="mt-6 space-y-2">
          <Text as="h3" variant="label">
            {t('advancedIntelligence.unsupported.title', 'Explicitly unsupported')}
          </Text>
          <Text as="p" variant="bodySm">
            {t('advancedIntelligence.survival.unsupported.failureDate', 'A guaranteed failure date')}
          </Text>
          <Text as="p" variant="bodySm">
            {t('advancedIntelligence.survival.unsupported.repair', 'Automatic diagnosis or repair authorization')}
          </Text>
        </Card>
      </FadeIn>
    </PageLayout>
  );
}
