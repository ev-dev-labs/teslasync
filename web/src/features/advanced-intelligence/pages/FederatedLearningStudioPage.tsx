import { type FormEvent, useState } from 'react';
import { LockKeyhole, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useFederatedModelCards,
  useStartFederatedRound,
} from '@/api/hooks/useAdvancedIntelligence';
import { StatCard } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { VehicleSelect } from '@/components/forms';
import { Grid, PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Button, ConfirmDialog, Input, Pagination, Select, Text } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import { EvidencePanel, InsightPanel, MutationError } from '../components';
import { formatEfficiencyFromSI } from '../formatters';

const PAGE_SIZE = 12;

interface RoundForm {
  model_name: string;
  model_version: string;
  task: string;
  epsilon: number;
  epsilon_budget: number;
  expected_version: number;
}

export default function FederatedLearningStudioPage() {
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const [page, setPage] = useState(1);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [form, setForm] = useState<RoundForm>({
    model_name: '',
    model_version: 'v1',
    task: 'efficiency',
    epsilon: 0.1,
    epsilon_budget: 2,
    expected_version: 0,
  });
  const query = useFederatedModelCards(vehicleId, PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const mutation = useStartFederatedRound();
  const cards = query.data?.items ?? [];
  usePageTitle(t('advancedIntelligence.federated.title', 'Federated Learning Studio'));

  const requestConfirmation = (event: FormEvent) => {
    event.preventDefault();
    if (vehicleId != null) setConfirmOpen(true);
  };

  const confirmRound = () => {
    if (vehicleId == null || mutation.isPending) return;
    mutation.mutate(
      { ...form, vehicle_id: vehicleId, confirmed: true },
      { onSuccess: () => setConfirmOpen(false) },
    );
  };

  return (
    <PageContainer
      title={t('advancedIntelligence.federated.title', 'Federated Learning Studio')}
      subtitle={t(
        'advancedIntelligence.federated.subtitle',
        'Manage subject-scoped local aggregate model rounds within explicit privacy budgets.',
      )}
      actions={<VehicleSelect withIcon />}
      loading={vehicleId != null && query.isLoading}
      error={query.error instanceof Error ? query.error : null}
    >
      <AlertBanner
        variant="success"
        icon={<LockKeyhole className="h-5 w-5" aria-hidden="true" />}
        title={t('advancedIntelligence.federated.privacy.title', 'Raw vehicle data never leaves this instance')}
      >
        {query.data?.privacy_statement ?? t(
          'advancedIntelligence.federated.privacy.body',
          'Rounds use local aggregates only. No raw trips, locations, video, command payloads, or gradients are uploaded.',
        )}
      </AlertBanner>

      <FadeIn>
        <InsightPanel
          title={t('advancedIntelligence.federated.budget.title', 'Subject privacy budget')}
          empty={!query.data}
          emptyMessage={vehicleId == null
            ? t('advancedIntelligence.vehicle.empty', 'Select a vehicle to load intelligence.')
            : t('advancedIntelligence.federated.budget.empty', 'Privacy budget status is unavailable.')}
        >
          <Grid cols={{ default: 1, sm: 3 }} gap={4}>
            <StatCard
              label={t('advancedIntelligence.federated.budget.total', 'Total epsilon budget')}
              value={query.data ? fmtNumber(query.data.total_epsilon_budget, 2) : null}
            />
            <StatCard
              label={t('advancedIntelligence.federated.budget.spent', 'Epsilon spent')}
              value={query.data ? fmtNumber(query.data.total_epsilon_spent, 2) : null}
            />
            <StatCard
              label={t('advancedIntelligence.federated.budget.remaining', 'Epsilon remaining')}
              value={query.data
                ? fmtNumber(Math.max(0, query.data.total_epsilon_budget - query.data.total_epsilon_spent), 2)
                : null}
              icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
            />
          </Grid>
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <InsightPanel
          title={t('advancedIntelligence.federated.cards.title', 'Subject-scoped model cards')}
          empty={cards.length === 0}
          emptyMessage={t(
            'advancedIntelligence.federated.cards.empty',
            'No local model cards exist for this vehicle and subject.',
          )}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            {cards.map((card) => (
              <article key={card.id} className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Text as="h3" variant="subhead">{card.model_name}</Text>
                    <Text as="p" variant="caption">{card.model_version} · {card.task}</Text>
                  </div>
                  <Badge variant={card.latest_status === 'completed' ? 'success' : 'warning'}>
                    {card.latest_status ?? t('advancedIntelligence.federated.status.none', 'No round')}
                  </Badge>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-[var(--text-muted)]">
                      {t('advancedIntelligence.federated.card.epsilon', 'Epsilon')}
                    </dt>
                    <dd>{fmtNumber(card.epsilon_spent, 2)} / {fmtNumber(card.epsilon_budget, 2)}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--text-muted)]">
                      {t('advancedIntelligence.federated.card.rounds', 'Rounds')}
                    </dt>
                    <dd>{fmtNumber(card.round_count, 0)}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--text-muted)]">
                      {t('advancedIntelligence.federated.card.samples', 'Latest local samples')}
                    </dt>
                    <dd>{card.latest_sample_count != null ? fmtNumber(card.latest_sample_count, 0) : '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-[var(--text-muted)]">
                      {t('advancedIntelligence.federated.card.aggregate', 'Local aggregate')}
                    </dt>
                    <dd>{formatEfficiencyFromSI(card.latest_metric_wh_per_m, units.unitPrefs)}</dd>
                  </div>
                </dl>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-4"
                  onClick={() => setForm({
                    model_name: card.model_name,
                    model_version: card.model_version,
                    task: card.task,
                    epsilon: Math.min(0.1, Math.max(0.01, card.epsilon_budget - card.epsilon_spent)),
                    epsilon_budget: card.epsilon_budget,
                    expected_version: card.version,
                  })}
                >
                  {t('advancedIntelligence.federated.card.use', 'Use for next local round')}
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
            <Button type="submit" disabled={vehicleId == null || mutation.isPending || !form.model_name.trim()}>
              {t('advancedIntelligence.federated.form.review', 'Review privacy spend')}
            </Button>
          </form>
          <MutationError error={mutation.error} />
        </InsightPanel>
      </FadeIn>

      <FadeIn delay={0.15}>
        <EvidencePanel
          quality={mutation.data?.data_quality ?? query.data?.data_quality}
          evidence={mutation.data?.evidence ?? query.data?.evidence}
          limitations={cards.flatMap((card) => card.limitations ?? [])}
          unsupported={[
            t('advancedIntelligence.federated.unsupported.upload', 'Raw-data or gradient upload'),
            t('advancedIntelligence.federated.unsupported.global', 'A centralized fleet model or cross-subject access'),
          ]}
        />
      </FadeIn>

      <ConfirmDialog
        open={confirmOpen}
        variant="warning"
        loading={mutation.isPending}
        title={t('advancedIntelligence.federated.confirm.title', 'Confirm local privacy spend')}
        message={t(
          'advancedIntelligence.federated.confirm.body',
          'This local round may spend {{epsilon}} epsilon. It never uploads raw vehicle data.',
          { epsilon: form.epsilon },
        )}
        confirmLabel={t('advancedIntelligence.federated.confirm.action', 'Start local round')}
        cancelLabel={t('common.cancel', 'Cancel')}
        onConfirm={confirmRound}
        onCancel={() => setConfirmOpen(false)}
      />
    </PageContainer>
  );
}
