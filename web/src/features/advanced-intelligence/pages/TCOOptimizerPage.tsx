import { type FormEvent, useId, useState } from 'react';
import { BadgeDollarSign, Scale } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRunTCOOptimizer } from '@/api/hooks/useAdvancedIntelligence';
import { AlertBanner, EmptyState } from '@/components/feedback';
import { KVList } from '@/components/data-display';
import { deriveDataState, type DataStateSource } from '@/api/dataState';

import { PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Table, Badge, Button, Card, Icon, Input, Text } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useDateFormat } from '@/hooks/useDateFormat';

import { SI } from '@/lib/unitConversion';
import type { TCOOptimizerRequest, TCOOptimizerResponse } from '@/types/advancedIntelligence';
import { EvidencePanel, InsightPanel, MutationError, SiNumberInput } from '../components';
import { formatCurrencyMinor } from '../formatters';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { typography } from '@/lib/tokens';

type TCOForm = {
  [K in keyof Omit<TCOOptimizerRequest, 'vehicle_id' | 'confirmed'>]:
    TCOOptimizerRequest[K] extends number ? number | null : TCOOptimizerRequest[K];
};

function numberDraft(value: string): number | null {
  if (value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export default function TCOOptimizerPage() {
  const { fmtNumber } = useNumberFormatting();
  const { formatDateTime } = useDateFormat();
  const strategyId = useId();
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const mutation = useRunTCOOptimizer();
  const [completed, setCompleted] = useState<{
    result: TCOOptimizerResponse;
    request: TCOOptimizerRequest;
  } | null>(null);
  const [form, setForm] = useState<TCOForm>({
    horizon_s: 3 * 365 * 24 * 60 * 60,
    annual_distance_m: 20000000,
    home_charging_pct: 80,
    public_charging_pct: 20,
    risk_tolerance_pct: 35,
    budget_minor: 1800000,
    currency: 'USD',
  });
  usePageTitle(t('advancedIntelligence.tco.title', 'TCO optimizer'));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!(event.currentTarget instanceof HTMLFormElement) ||
      !event.currentTarget.reportValidity() || vehicleId == null || mutation.isPending ||
      form.horizon_s == null || form.annual_distance_m == null ||
      form.home_charging_pct == null || form.public_charging_pct == null ||
      form.risk_tolerance_pct == null || form.budget_minor == null) return;
    const request: TCOOptimizerRequest = {
      vehicle_id: vehicleId,
      horizon_s: form.horizon_s,
      annual_distance_m: form.annual_distance_m,
      home_charging_pct: form.home_charging_pct,
      public_charging_pct: form.public_charging_pct,
      risk_tolerance_pct: form.risk_tolerance_pct,
      budget_minor: form.budget_minor,
      currency: form.currency,
      confirmed: true,
    };
    mutation.mutate(request, {
      onSuccess: (result) => setCompleted({ result, request }),
    });
  };
  const result = completed?.result;
  const strategies = result?.strategies ?? [];
  const retainedScope = completed != null && (
    result?.vehicle_id !== vehicleId ||
    Object.entries(form).some(([key, value]) =>
      Object.entries(completed.request).some(([submittedKey, submittedValue]) =>
        key === submittedKey && value !== submittedValue))
  );
  const source: DataStateSource<TCOOptimizerResponse> = {
    data: result,
    error: mutation.error,
    isPending: mutation.isPending,
    isLoading: !result && mutation.isPending && !mutation.isPaused,
    isFetching: mutation.isPending && !mutation.isPaused,
    fetchStatus: mutation.isPaused ? 'paused' : mutation.isPending ? 'fetching' : 'idle',
    dataUpdatedAt: result ? Date.parse(result.generated_at) : undefined,
  };
  const dataState = deriveDataState(source, { provenance: 'inferred' });
  const money = (minor: number | null) => {
    if (minor == null || !result?.currency) return '—';
    return formatCurrencyMinor(minor, result.currency, units.unitPrefs.locale);
  };

  return (
    <PageLayout
      title={t('advancedIntelligence.tco.title', 'TCO optimizer')}
      subtitle={t(
        'advancedIntelligence.tco.subtitle',
        'Compare constrained cost, risk, and convenience alternatives on a Pareto-like frontier.',
      )}
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
          <form className="min-w-0 space-y-5" onSubmit={submit} aria-busy={mutation.isPending}>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <SiNumberInput
                label={t('advancedIntelligence.tco.form.horizon', 'Planning horizon (canonical SI)')}
                value={form.horizon_s}
                onChange={(value) => setForm((current) => ({ ...current, horizon_s: value }))}
                siUnit={SI.duration}
                displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                  value: units.formatDuration(form.horizon_s),
                })}
                min={2592000}
                max={315360000}
                required
              />
              <SiNumberInput
                label={t('advancedIntelligence.tco.form.distance', 'Annual distance (canonical SI)')}
                value={form.annual_distance_m}
                onChange={(value) => setForm((current) => ({ ...current, annual_distance_m: value }))}
                siUnit={SI.distance}
                displayHint={t('advancedIntelligence.form.displayEquivalent', 'Display equivalent: {{value}}', {
                  value: units.formatDistance(form.annual_distance_m),
                })}
                min={1000}
                max={1000000000}
                required
              />
              <Input
                type="number"
                label={t('advancedIntelligence.tco.form.home', 'Home charging (%)')}
                value={form.home_charging_pct ?? ''}
                className="min-h-11 md:min-h-10"
                min={0}
                max={100}
                required
                onChange={(event) => {
                  const home = numberDraft(event.target.value);
                  setForm((current) => ({
                    ...current, home_charging_pct: home,
                    public_charging_pct: home == null ? current.public_charging_pct : 100 - home,
                  }));
                }}
              />
              <Input
                type="number"
                label={t('advancedIntelligence.tco.form.public', 'Public charging (%)')}
                value={form.public_charging_pct ?? ''}
                className="min-h-11 md:min-h-10"
                min={0}
                max={100}
                required
                onChange={(event) => {
                  const publicShare = numberDraft(event.target.value);
                  setForm((current) => ({
                    ...current, public_charging_pct: publicShare,
                    home_charging_pct: publicShare == null ? current.home_charging_pct : 100 - publicShare,
                  }));
                }}
              />
              <Input
                type="number"
                label={t('advancedIntelligence.tco.form.risk', 'Risk tolerance (%)')}
                value={form.risk_tolerance_pct ?? ''}
                className="min-h-11 md:min-h-10"
                min={0}
                max={100}
                required
                onChange={(event) => setForm((current) => ({
                  ...current, risk_tolerance_pct: numberDraft(event.target.value),
                }))}
              />
              <Input
                type="number"
                label={t('advancedIntelligence.tco.form.budget', 'Budget (minor units)')}
                value={form.budget_minor ?? ''}
                className="min-h-11 md:min-h-10"
                min={0}
                step={1}
                required
                onChange={(event) => setForm((current) => ({
                  ...current, budget_minor: numberDraft(event.target.value),
                }))}
              />
              <Input
                label={t('advancedIntelligence.tco.form.currency', 'ISO currency code')}
                value={form.currency}
                className="min-h-11 md:min-h-10"
                minLength={3}
                maxLength={3}
                pattern="[A-Za-z]{3}"
                required
                onChange={(event) => setForm((current) => ({
                  ...current, currency: event.target.value.toUpperCase(),
                }))}
              />
            </div>
            <Button
              type="submit"
              loading={mutation.isPending}
              wrapLabel
              className="max-w-full min-h-11 md:min-h-10"
              disabled={vehicleId == null || mutation.isPending}
              icon={<Scale className="h-4 w-4" aria-hidden="true" />}
            >
              {t('advancedIntelligence.tco.form.run', 'Generate confirmed alternatives')}
            </Button>
          </form>
          {vehicleId == null && (
            <Text as="p" variant="bodySm" className="mt-3" role="status">
              {t('common.noVehicleSelected.title', 'No vehicle selected')}
            </Text>
          )}
          <MutationError error={mutation.error} />
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <InsightPanel
          title={t('advancedIntelligence.tco.alternatives.title', 'Pareto-like alternatives')}
          query={result || mutation.isPending || mutation.isPaused || mutation.error ? source : undefined}
          sourceState="empty"
          emptyMessage={t('advancedIntelligence.tco.alternatives.empty', 'Submit constraints to generate supported alternatives.')}
        >
          {result && dataState.status !== 'stale' && (retainedScope || mutation.isPending) && (
            <Text as="p" variant="bodySm" role="status">
              {t('dataSources.staleMessage', 'Previously loaded data remains visible while affected sources recover.')}
            </Text>
          )}
          {completed && (
            <div className="mb-4 min-w-0 space-y-3">
              <Text as="p" variant="caption">
                {t('freshness.lastUpdated', 'Last updated: {{time}}', {
                  time: formatDateTime(completed.result.generated_at),
                })}
              </Text>
              <KVList layout="responsive" wrap items={[
                { id: 'vehicle', label: t('common.vehicle', 'Vehicle'), value: fmtNumber(completed.result.vehicle_id) },
                { id: 'horizon', label: t('advancedIntelligence.tco.form.horizon', 'Planning horizon (canonical SI)'), value: (
                  <div>
                    <Text as="p" variant="bodySm">{fmtNumber(completed.request.horizon_s)} {SI.duration}</Text>
                    <Text as="p" variant="caption">{units.formatDuration(completed.request.horizon_s)}</Text>
                  </div>
                ) },
                { id: 'distance', label: t('advancedIntelligence.tco.form.distance', 'Annual distance (canonical SI)'), value: (
                  <div>
                    <Text as="p" variant="bodySm">{fmtNumber(completed.request.annual_distance_m)} {SI.distance}</Text>
                    <Text as="p" variant="caption">{units.formatDistance(completed.request.annual_distance_m)}</Text>
                  </div>
                ) },
                { id: 'home', label: t('advancedIntelligence.tco.form.home', 'Home charging (%)'), value: fmtNumber(completed.request.home_charging_pct) },
                { id: 'public', label: t('advancedIntelligence.tco.form.public', 'Public charging (%)'), value: fmtNumber(completed.request.public_charging_pct) },
                { id: 'risk', label: t('advancedIntelligence.tco.form.risk', 'Risk tolerance (%)'), value: fmtNumber(completed.request.risk_tolerance_pct) },
                { id: 'budget', label: t('advancedIntelligence.tco.form.budget', 'Budget (minor units)'), value: fmtNumber(completed.request.budget_minor) },
                { id: 'currency', label: t('advancedIntelligence.tco.form.currency', 'ISO currency code'), value: completed.request.currency },
              ]} />
            </div>
          )}
          <div className="grid min-w-0 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {strategies.map((strategy, index) => (
              <Card key={strategy.name} role="article" className="min-w-0 space-y-3 break-words">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2">
                    <Icon icon={BadgeDollarSign} size="lg" className={typography.color.secondary} aria-hidden />
                    <Text as="h3" id={`${strategyId}-${index}`} variant="subhead" className="min-w-0 break-words">{strategy.name}</Text>
                  </div>
                  {strategy.pareto_efficient ? (
                    <Badge variant="success">
                      {t('advancedIntelligence.tco.pareto', 'Pareto-efficient')}
                    </Badge>
                  ) : null}
                </div>
                <Table variant="embedded" aria-labelledby={`${strategyId}-${index}`}><tbody>
                  <tr>
                    <th scope="row" className="text-[var(--text-muted)]">{t('advancedIntelligence.tco.cost', 'Projected cost')}</th>
                    <td>{strategy.projected_cost_minor != null
                      ? money(strategy.projected_cost_minor)
                      : t('advancedIntelligence.unsupported.short', 'Unsupported')}</td>
                  </tr>
                  <tr>
                    <th scope="row" className="text-[var(--text-muted)]">{t('advancedIntelligence.tco.risk', 'Risk score')}</th>
                    <td className="text-end">{strategy.risk_score_pct != null ? `${fmtNumber(strategy.risk_score_pct)}%` : '—'}</td>
                  </tr>
                  <tr>
                    <th scope="row" className="text-[var(--text-muted)]">{t('advancedIntelligence.tco.convenience', 'Convenience')}</th>
                    <td className="text-end">{fmtNumber(strategy.convenience_score_pct)}%</td>
                  </tr>
                  <tr>
                    <th scope="row" className="text-[var(--text-muted)]">{t('advancedIntelligence.tco.mix', 'Home / public mix')}</th>
                    <td className="text-end">{fmtNumber(strategy.home_charging_pct)}% / {fmtNumber(strategy.public_charging_pct)}%</td>
                  </tr>
                  <tr>
                    <th scope="row" className="text-[var(--text-muted)]">{t('advancedIntelligence.tco.budgetStatus', 'Budget status')}</th>
                    <td>{strategy.within_budget == null
                      ? t('advancedIntelligence.unsupported.short', 'Unsupported')
                      : strategy.within_budget
                        ? t('advancedIntelligence.tco.withinBudget', 'Within budget')
                        : t('advancedIntelligence.tco.overBudget', 'Over budget')}</td>
                  </tr>
                </tbody></Table>
                {(strategy.constraints ?? []).map((constraint) => (
                  <Text as="p" variant="caption" className="mt-2" key={constraint}>• {constraint}</Text>
                ))}
              </Card>
            ))}
          </div>
          {result && strategies.length === 0 && (
            <EmptyState message={t('advancedIntelligence.panel.empty', 'No supported data is available.')} />
          )}
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.1}>
        <EvidencePanel
          query={source}
          quality={result?.data_quality}
          evidence={result?.evidence}
          limitations={result?.limitations}
          unsupported={[
            t('advancedIntelligence.tco.unsupported.cost', 'Cost projections without complete charging and maintenance evidence'),
            t('advancedIntelligence.tco.unsupported.purchase', 'Purchases, charging changes, or financial guarantees'),
          ]}
        />
      </FadeIn>
    </PageLayout>
  );
}
