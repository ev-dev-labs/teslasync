import { type FormEvent, useId, useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useFederatedModelCards,
  useStartFederatedRound,
} from '@/api/hooks/useAdvancedIntelligence';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { AlertBanner } from '@/components/feedback';

import { PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Table, Badge, Button, ConfirmDialog, Input, Pagination, Select, Text } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';

import { EvidencePanel, InsightPanel, MutationError } from '../components';
import { formatEfficiencyFromSI } from '../formatters';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { AnalysisBrief } from '../components/operationalbrief-all/AnalysisBrief';

const PAGE_SIZE = 12;

interface RoundForm {
  model_name: string;
  model_version: string;
  task: string;
  epsilon: number;
  epsilon_budget: number;
  expected_version: number;
}

const initialForm = (): RoundForm => ({
  model_name: '', model_version: 'v1', task: 'efficiency',
  epsilon: 0.1, epsilon_budget: 2, expected_version: 0,
});

export default function FederatedLearningStudioPage() {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const cardId = useId();
  const [scope, setScope] = useState(vehicleId);
  const [page, setPage] = useState(1);
  const [review, setReview] = useState<(RoundForm & { vehicle_id: number }) | null>(null);
  const [form, setForm] = useState<RoundForm>(initialForm);
  if (scope !== vehicleId) {
    setScope(vehicleId);
    setPage(1);
    setForm(initialForm());
    setReview(null);
  }
  const query = useFederatedModelCards(vehicleId, PAGE_SIZE, (scope === vehicleId ? page - 1 : 0) * PAGE_SIZE);
  const mutation = useStartFederatedRound();
  const mutationError = mutation.variables?.vehicle_id === vehicleId ? mutation.error : null;
  const roundResult = mutation.data?.model_card.vehicle_id === vehicleId ? mutation.data : undefined;
  const cards = query.data?.items ?? [];
  const summaryMetrics: readonly StatMetric[] = [
    { occurrenceId: 'epsilon-budget', metricId: 'ratio', rawValue: query.data?.total_epsilon_budget,
      label: t('advancedIntelligence.federated.budget.total', 'Total epsilon budget'),
      description: t('advancedIntelligence.federated.brief.total', 'Returned subject-scoped privacy budget in dimensionless epsilon, not a percentage.') },
    { occurrenceId: 'epsilon-spent', metricId: 'ratio', rawValue: query.data?.total_epsilon_spent,
      label: t('advancedIntelligence.federated.budget.spent', 'Epsilon spent'),
      description: t('advancedIntelligence.federated.brief.spent', 'Returned local aggregate privacy spend for this subject and vehicle.') },
    { occurrenceId: 'epsilon-remaining', metricId: 'ratio', rawValue: query.data
      ? Math.max(0, query.data.total_epsilon_budget - query.data.total_epsilon_spent) : null,
      label: t('advancedIntelligence.federated.budget.remaining', 'Epsilon remaining'),
      description: t('advancedIntelligence.federated.brief.remaining', 'Existing budget minus spend, floored at zero; unresolved budget is not zero remaining.') },
  ];
  usePageTitle(t('advancedIntelligence.federated.title', 'Federated learning studio'));

  const requestConfirmation = (event: FormEvent) => {
    event.preventDefault();
    if (vehicleId != null && !mutation.isPending) setReview({ ...form, vehicle_id: vehicleId });
  };

  const confirmRound = () => {
    if (!review || review.vehicle_id !== vehicleId || mutation.isPending) return;
    mutation.mutate(
      { ...review, confirmed: true },
      { onSuccess: () => setReview((current) => current === review ? null : current) },
    );
  };

  return (
    <PageLayout
      title={t('advancedIntelligence.federated.title', 'Federated learning studio')}
      subtitle={t(
        'advancedIntelligence.federated.subtitle',
        'Manage subject-scoped local aggregate model rounds within explicit privacy budgets.',
      )}
    >
      <AlertBanner
        variant="info"
        icon={<LockKeyhole className="h-5 w-5" aria-hidden="true" />}
        title={t('advancedIntelligence.federated.privacy.title', 'Raw vehicle data never leaves this instance')}
      >
        {query.data?.privacy_statement ?? t(
          'advancedIntelligence.federated.privacy.body',
          'Rounds use local aggregates only. No raw trips, locations, video, command payloads, or gradients are uploaded.',
        )}
      </AlertBanner>

      <FadeIn>
        <AnalysisBrief
          id="advanced-intelligence-federated-brief"
          query={vehicleId != null ? query : undefined}
          title={t('advancedIntelligence.federated.budget.title', 'Subject privacy budget')}
          description={t('advancedIntelligence.federated.brief.description', 'Subject-scoped local privacy accounting, independent of the paginated model-card count and proposed next round.')}
          metrics={summaryMetrics}
          vehicleId={query.data?.vehicle_id ?? vehicleId}
          hasResult={query.data != null}
          quality={query.data?.data_quality}
          evidence={query.data?.evidence}
          limitations={cards.flatMap((card) => card.limitations ?? [])}
          generatedAt={query.data?.generated_at}
          provenance={t('advancedIntelligence.federated.brief.source', 'Local subject privacy accounting')}
          emptyMessage={vehicleId == null
            ? t('advancedIntelligence.vehicle.empty', 'Select a vehicle to load intelligence.')
            : t('advancedIntelligence.federated.budget.empty', 'Privacy budget status is unavailable.')}
        />
      </FadeIn>

      <FadeIn delay={0.05}>
        <InsightPanel
          title={t('advancedIntelligence.federated.cards.title', 'Subject-scoped model cards')}
          query={vehicleId != null ? query : undefined}
          empty={cards.length === 0}
          emptyMessage={vehicleId == null ? t('advancedIntelligence.vehicle.empty', 'Select a vehicle to load intelligence.') : t(
            'advancedIntelligence.federated.cards.empty',
            'No local model cards exist for this vehicle and subject.',
          )}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            {cards.map((card) => (
              <article key={card.id} className="min-w-0 rounded-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-4 break-words">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Text as="h3" variant="subhead" id={`${cardId}-${card.id}-name`}>{card.model_name}</Text>
                    <Text as="p" variant="caption">{card.model_version} · {card.task}</Text>
                  </div>
                  <Badge variant={card.latest_status === 'completed' ? 'success' : card.latest_status === 'insufficient' ? 'warning' : 'neutral'}>
                    {card.latest_status ?? t('advancedIntelligence.federated.status.none', 'No round')}
                  </Badge>
                </div>
                <Table variant="embedded" aria-labelledby={`${cardId}-${card.id}-name`}><tbody>
                  <tr>
                    <th scope="row" className="text-[var(--text-muted)]">
                      {t('advancedIntelligence.federated.card.epsilon', 'Epsilon')}
                    </th>
                    <td className="text-end">{fmtNumber(card.epsilon_spent)} / {fmtNumber(card.epsilon_budget)}</td>
                  </tr>
                  <tr>
                    <th scope="row" className="text-[var(--text-muted)]">
                      {t('advancedIntelligence.federated.card.rounds', 'Rounds')}
                    </th>
                    <td className="text-end">{fmtInt(card.round_count)}</td>
                  </tr>
                  <tr>
                    <th scope="row" className="text-[var(--text-muted)]">
                      {t('advancedIntelligence.federated.card.samples', 'Latest local samples')}
                    </th>
                    <td className="text-end">{card.latest_sample_count != null ? fmtInt(card.latest_sample_count) : '—'}</td>
                  </tr>
                  <tr>
                    <th scope="row" className="text-[var(--text-muted)]">
                      {t('advancedIntelligence.federated.card.aggregate', 'Local aggregate')}
                    </th>
                    <td className="text-end">{formatEfficiencyFromSI(card.latest_metric_wh_per_m, units.unitPrefs)}</td>
                  </tr>
                </tbody></Table>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-4 min-h-11 md:min-h-9"
                  wrapLabel
                  aria-labelledby={`${cardId}-${card.id}-use ${cardId}-${card.id}-name`}
                  onClick={() => setForm({
                    model_name: card.model_name,
                    model_version: card.model_version,
                    task: card.task,
                    epsilon: Math.min(0.1, Math.max(0.01, card.epsilon_budget - card.epsilon_spent)),
                    epsilon_budget: card.epsilon_budget,
                    expected_version: card.version,
                  })}
                >
                  <span id={`${cardId}-${card.id}-use`}>{t('advancedIntelligence.federated.card.use', 'Use for next local round')}</span>
                </Button>
              </article>
            ))}
          </div>
          {(query.data?.total ?? 0) > PAGE_SIZE ? (
            <Pagination page={page} pageSize={PAGE_SIZE} total={query.data?.total ?? 0} onPageChange={setPage} />
          ) : null}
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.1}>
        <InsightPanel
          title={t('advancedIntelligence.federated.form.title', 'Privacy-gated local training round')}
          description={t(
            'advancedIntelligence.federated.form.subtitle',
            'Confirmation spends epsilon only when enough valid local aggregate samples are available.',
          )}
        >
          <form className="space-y-4" onSubmit={requestConfirmation}>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Input
                label={t('advancedIntelligence.federated.form.name', 'Model name')}
                value={form.model_name}
                maxLength={120}
                required
                onChange={(event) => setForm((current) => ({ ...current, model_name: event.target.value }))}
              />
              <Input
                label={t('advancedIntelligence.federated.form.version', 'Model version')}
                value={form.model_version}
                required
                onChange={(event) => setForm((current) => ({ ...current, model_version: event.target.value }))}
              />
              <Select
                label={t('advancedIntelligence.federated.form.task', 'Task')}
                value={form.task}
                options={[{ value: 'efficiency', label: t('advancedIntelligence.federated.task.efficiency', 'Efficiency') }]}
                onChange={(event) => setForm((current) => ({ ...current, task: event.target.value }))}
              />
              <Input
                type="number"
                label={t('advancedIntelligence.federated.form.epsilon', 'Requested epsilon')}
                value={form.epsilon}
                min={0.01}
                max={5}
                step={0.01}
                required
                onChange={(event) => setForm((current) => ({ ...current, epsilon: Number(event.target.value) }))}
              />
              <Input
                type="number"
                label={t('advancedIntelligence.federated.form.budget', 'Epsilon budget')}
                value={form.epsilon_budget}
                min={form.epsilon}
                max={20}
                step={0.01}
                required
                onChange={(event) => setForm((current) => ({ ...current, epsilon_budget: Number(event.target.value) }))}
              />
              <Input
                type="number"
                label={t('advancedIntelligence.federated.form.expectedVersion', 'Expected model-card version')}
                value={form.expected_version}
                min={0}
                required
                onChange={(event) => setForm((current) => ({ ...current, expected_version: Number(event.target.value) }))}
              />
            </div>
            <Button type="submit" wrapLabel className="min-h-11 md:min-h-10" disabled={vehicleId == null || mutation.isPending || !form.model_name.trim()}>
              {t('advancedIntelligence.federated.form.review', 'Review privacy spend')}
            </Button>
          </form>
          <MutationError error={mutationError} />
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.15}>
        <EvidencePanel
          quality={roundResult?.data_quality ?? query.data?.data_quality}
          evidence={roundResult?.evidence ?? query.data?.evidence}
          limitations={cards.flatMap((card) => card.limitations ?? [])}
          unsupported={[
            t('advancedIntelligence.federated.unsupported.upload', 'Raw-data or gradient upload'),
            t('advancedIntelligence.federated.unsupported.global', 'A centralized fleet model or cross-subject access'),
          ]}
        />
      </FadeIn>

      <ConfirmDialog
        open={review != null && review.vehicle_id === vehicleId}
        variant="warning"
        loading={mutation.isPending}
        title={t('advancedIntelligence.federated.confirm.title', 'Confirm local privacy spend')}
        message={t(
          'advancedIntelligence.federated.confirm.body',
          'This local round may spend {{epsilon}} epsilon. It never uploads raw vehicle data.',
          { epsilon: review?.epsilon ?? form.epsilon },
        )}
        details={<MutationError error={mutationError} />}
        confirmDisabled={review == null || review.vehicle_id !== vehicleId}
        confirmLabel={t('advancedIntelligence.federated.confirm.action', 'Start local round')}
        cancelLabel={t('common.cancel', 'Cancel')}
        onConfirm={confirmRound}
        onCancel={() => setReview(null)}
      />
    </PageLayout>
  );
}
