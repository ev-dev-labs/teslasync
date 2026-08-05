import { type FormEvent, useState } from 'react';
import { BadgeDollarSign, Scale } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRunTCOOptimizer } from '@/api/hooks/useAdvancedIntelligence';
import { AlertBanner } from '@/components/feedback';
import { VehicleSelect } from '@/components/forms';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Button, Input, Text } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { SI } from '@/lib/unitConversion';
import type { TCOOptimizerRequest } from '@/types/advancedIntelligence';
import { EvidencePanel, InsightPanel, MutationError, SiNumberInput } from '../components';
import { formatCurrencyMinor } from '../formatters';

type TCOForm = Omit<TCOOptimizerRequest, 'vehicle_id' | 'confirmed'>;

export default function TCOOptimizerPage() {
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const mutation = useRunTCOOptimizer();
  const [form, setForm] = useState<TCOForm>({
    horizon_s: 3 * 365 * 24 * 60 * 60,
    annual_distance_m: 20000000,
    home_charging_pct: 80,
    public_charging_pct: 20,
    risk_tolerance_pct: 35,
    budget_minor: 1800000,
    currency: 'USD',
  });
  usePageTitle(t('advancedIntelligence.tco.title', 'TCO Optimizer'));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (vehicleId == null) return;
    mutation.mutate({ ...form, vehicle_id: vehicleId, confirmed: true });
  };
  const result = mutation.data;
  const money = (minor: number | null) => {
    if (minor == null || !result?.currency) return '—';
    return formatCurrencyMinor(minor, result.currency, units.unitPrefs.locale);
  };

  return (
    <PageContainer
      title={t('advancedIntelligence.tco.title', 'TCO Optimizer')}
      subtitle={t(
        'advancedIntelligence.tco.subtitle',
        'Compare constrained cost, risk, and convenience alternatives on a Pareto-like frontier.',
      )}
      actions={<VehicleSelect withIcon />}
    >
      <AlertBanner
        variant="info"
        title={t('advancedIntelligence.tco.notice.title', 'Optimization uses supported costs only')}
      >
        {t(
          'advancedIntelligence.tco.notice.body',
          'Projected cost remains unsupported when charging channels or maintenance evidence are incomplete; no zero is fabricated.',
        )}
      </AlertBanner>

      <FadeIn>
        <InsightPanel
          title={t('advancedIntelligence.tco.form.title', 'Optimization constraints')}
          description={t(
            'advancedIntelligence.tco.form.subtitle',
            'Charging shares must total 100 percent. Budget is entered in currency minor units.',
          )}
        >
          <form className="space-y-5" onSubmit={submit}>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <SiNumberInput
                label={t('advancedIntelligence.tco.form.horizon', 'Planning horizon (canonical SI)')}
                value={form.horizon_s}
                onChange={(value) => setForm((current) => ({ ...current, horizon_s: value ?? 0 }))}
                siUnit={SI.duration}
                displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                  value: units.formatDuration(form.horizon_s),
                })}
                min={2592000}
                required
              />
              <SiNumberInput
                label={t('advancedIntelligence.tco.form.distance', 'Annual distance (canonical SI)')}
                value={form.annual_distance_m}
                onChange={(value) => setForm((current) => ({ ...current, annual_distance_m: value ?? 0 }))}
                siUnit={SI.distance}
                displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                  value: units.formatDistance(form.annual_distance_m),
                })}
                min={1000}
                required
              />
              <Input
                type="number"
                label={t('advancedIntelligence.tco.form.home', 'Home charging (%)')}
                value={form.home_charging_pct}
                min={0}
                max={100}
                required
                onChange={(event) => {
                  const home = Number(event.target.value);
                  setForm((current) => ({
                    ...current, home_charging_pct: home, public_charging_pct: 100 - home,
                  }));
                }}
              />
              <Input
                type="number"
                label={t('advancedIntelligence.tco.form.public', 'Public charging (%)')}
                value={form.public_charging_pct}
                min={0}
                max={100}
                required
                onChange={(event) => {
                  const publicShare = Number(event.target.value);
                  setForm((current) => ({
                    ...current, public_charging_pct: publicShare, home_charging_pct: 100 - publicShare,
                  }));
                }}
              />
              <Input
                type="number"
                label={t('advancedIntelligence.tco.form.risk', 'Risk tolerance (%)')}
                value={form.risk_tolerance_pct}
                min={0}
                max={100}
                required
                onChange={(event) => setForm((current) => ({
                  ...current, risk_tolerance_pct: Number(event.target.value),
                }))}
              />
              <Input
                type="number"
                label={t('advancedIntelligence.tco.form.budget', 'Budget (minor units)')}
                value={form.budget_minor}
                min={0}
                step={1}
                required
                onChange={(event) => setForm((current) => ({
                  ...current, budget_minor: Number(event.target.value),
                }))}
              />
              <Input
                label={t('advancedIntelligence.tco.form.currency', 'ISO currency code')}
                value={form.currency}
                minLength={3}
                maxLength={3}
                required
                onChange={(event) => setForm((current) => ({
                  ...current, currency: event.target.value.toUpperCase(),
                }))}
              />
            </div>
            <Button
              type="submit"
              loading={mutation.isPending}
              disabled={vehicleId == null || mutation.isPending}
              icon={<Scale className="h-4 w-4" aria-hidden="true" />}
            >
              {t('advancedIntelligence.tco.form.run', 'Generate confirmed alternatives')}
            </Button>
          </form>
          <MutationError error={mutation.error} />
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <InsightPanel
          title={t('advancedIntelligence.tco.alternatives.title', 'Pareto-like alternatives')}
          empty={!result || result.strategies.length === 0}
          emptyMessage={t('advancedIntelligence.tco.alternatives.empty', 'Submit constraints to generate supported alternatives.')}
        >
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {(result?.strategies ?? []).map((strategy) => (
              <article key={strategy.name} className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <BadgeDollarSign className="h-5 w-5 text-cyan-300" aria-hidden="true" />
                    <Text as="h3" variant="subhead">{strategy.name}</Text>
                  </div>
                  {strategy.pareto_efficient ? (
                    <Badge variant="success">
                      {t('advancedIntelligence.tco.pareto', 'Pareto-efficient')}
                    </Badge>
                  ) : null}
                </div>
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-[var(--text-muted)]">{t('advancedIntelligence.tco.cost', 'Projected cost')}</dt>
                    <dd>{strategy.projected_cost_minor != null
                      ? money(strategy.projected_cost_minor)
                      : t('advancedIntelligence.unsupported.short', 'Unsupported')}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[var(--text-muted)]">{t('advancedIntelligence.tco.risk', 'Risk score')}</dt>
                    <dd>{strategy.risk_score_pct != null ? `${fmtNumber(strategy.risk_score_pct, 1)}%` : '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[var(--text-muted)]">{t('advancedIntelligence.tco.convenience', 'Convenience')}</dt>
                    <dd>{fmtNumber(strategy.convenience_score_pct, 1)}%</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[var(--text-muted)]">{t('advancedIntelligence.tco.mix', 'Home / public mix')}</dt>
                    <dd>{fmtNumber(strategy.home_charging_pct, 0)}% / {fmtNumber(strategy.public_charging_pct, 0)}%</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[var(--text-muted)]">{t('advancedIntelligence.tco.budgetStatus', 'Budget status')}</dt>
                    <dd>{strategy.within_budget == null
                      ? t('advancedIntelligence.unsupported.short', 'Unsupported')
                      : strategy.within_budget
                        ? t('advancedIntelligence.tco.withinBudget', 'Within budget')
                        : t('advancedIntelligence.tco.overBudget', 'Over budget')}</dd>
                  </div>
                </dl>
                {(strategy.constraints ?? []).map((constraint) => (
                  <Text as="p" variant="caption" className="mt-2" key={constraint}>• {constraint}</Text>
                ))}
              </article>
            ))}
          </div>
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.1}>
        <EvidencePanel
          quality={result?.data_quality}
          evidence={result?.evidence}
          limitations={result?.limitations}
          unsupported={[
            t('advancedIntelligence.tco.unsupported.cost', 'Cost projections without complete charging and maintenance evidence'),
            t('advancedIntelligence.tco.unsupported.purchase', 'Purchases, charging changes, or financial guarantees'),
          ]}
        />
      </FadeIn>
    </PageContainer>
  );
}
