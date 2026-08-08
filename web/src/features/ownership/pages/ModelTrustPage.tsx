import { type FormEvent, useMemo, useState } from 'react';
import { Activity, Crosshair, TrendingDown, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useModelTrust,
  useRecordOutcome,
  useRecordPrediction,
} from '@/api/hooks/useOwnership';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  ChartTooltip,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  axisTick,
  chartGrid,
  chartMargin,
} from '@/components/charts';
import { AlertBanner } from '@/components/feedback';
import { VehicleSelect } from '@/components/forms';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Button, DataTable, Input, Select, Text } from '@/components/ui';
import type { Column } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import type { ModelScorecard, Prediction } from '@/types/ownership';
import {
  EvidencePanel,
  MutationError,
  OwnershipPanel,
  StatGrid,
  VerdictBadge,
} from '../components';
import { daysToSeconds, formatPct, formatSignedPct, formatSpan } from '../formatters';

const WINDOW_OPTIONS = [30, 60, 90, 180, 365];

/**
 * Mirrors allowedTargets in internal/app/ownershipintelsvc/modeltrust.go. The
 * backend rejects any target outside this set, and rejects an si_unit that does
 * not match the target's canonical unit, so both are derived from one map here.
 */
const PREDICTION_TARGET_UNITS = {
  range_m: 'm',
  energy_wh: 'Wh',
  charge_duration_s: 's',
  drive_duration_s: 's',
  efficiency_wh_per_m: 'Wh/m',
  battery_capacity_wh: 'Wh',
  cost_minor: 'minor',
  soc_pct: '%',
  departure_soc_pct: '%',
  arrival_soc_pct: '%',
  tire_pressure_kpa: 'kPa',
  maintenance_due_m: 'm',
  session_energy_wh: 'Wh',
  degradation_pct: '%',
  grid_intensity_g_wh: 'g/Wh',
  idle_consumption_wh: 'Wh',
  regen_share_pct: '%',
  consumable_life_m: 'm',
  premium_minor: 'minor',
  tariff_cost_minor: 'minor',
} as const;

type PredictionTarget = keyof typeof PREDICTION_TARGET_UNITS;

const PREDICTION_TARGETS = Object.keys(PREDICTION_TARGET_UNITS) as PredictionTarget[];

function gradeTone(grade: string): 'positive' | 'warning' | 'critical' | 'default' {
  if (grade === 'trusted') return 'positive';
  if (grade === 'watch') return 'warning';
  if (grade === 'unreliable') return 'critical';
  return 'default';
}

export default function ModelTrustPage() {
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const [windowDays, setWindowDays] = useState(90);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [predictOpen, setPredictOpen] = useState(false);
  const [outcomeFor, setOutcomeFor] = useState<number | null>(null);
  const [predictDraft, setPredictDraft] = useState({
    model_name: '',
    target: 'range_m' as PredictionTarget,
    si_unit: PREDICTION_TARGET_UNITS.range_m as string,
    horizon_days: 7,
    predicted_value: 0,
    predicted_low: null as number | null,
    predicted_high: null as number | null,
    reference: '',
  });
  const [outcomeDraft, setOutcomeDraft] = useState({ observed_value: 0 });

  usePageTitle(t('ownership.trust.navTitle', 'Prediction Accuracy Lab'));

  const trustQuery = useModelTrust(vehicleId, windowDays);
  const recordPrediction = useRecordPrediction();
  const recordOutcome = useRecordOutcome();

  const report = trustQuery.data;
  const scorecards = useMemo(() => report?.scorecards ?? [], [report?.scorecards]);
  const predictions = useMemo(
    () => report?.recent_predictions ?? [],
    [report?.recent_predictions],
  );

  const selectedCard = useMemo(
    () =>
      scorecards.find((card) => `${card.model_name}::${card.target}` === activeModel) ??
      scorecards[0],
    [scorecards, activeModel],
  );

  const calibrationData = useMemo(
    () =>
      (selectedCard?.calibration ?? []).map((bin) => ({
        name: `${fmtNumber(bin.lower_pct, 0)}–${fmtNumber(bin.upper_pct, 0)}%`,
        error: Number(bin.mean_abs_error.toFixed(3)),
        bias: Number(bin.mean_bias.toFixed(3)),
        coverage: bin.coverage_pct != null ? Number(bin.coverage_pct.toFixed(1)) : null,
        samples: bin.sample_count,
      })),
    [selectedCard],
  );

  const submitPrediction = (event: FormEvent) => {
    event.preventDefault();
    if (vehicleId == null) return;
    recordPrediction.mutate(
      {
        vehicle_id: vehicleId,
        model_name: predictDraft.model_name,
        target: predictDraft.target,
        si_unit: predictDraft.si_unit,
        predicted_at: new Date().toISOString(),
        horizon_s: daysToSeconds(predictDraft.horizon_days),
        predicted_value: predictDraft.predicted_value,
        predicted_low: predictDraft.predicted_low,
        predicted_high: predictDraft.predicted_high,
        reference: predictDraft.reference,
      },
      { onSuccess: () => setPredictOpen(false) },
    );
  };

  const submitOutcome = (event: FormEvent) => {
    event.preventDefault();
    if (outcomeFor == null) return;
    recordOutcome.mutate(
      {
        prediction_id: outcomeFor,
        observed_value: outcomeDraft.observed_value,
        observed_at: new Date().toISOString(),
      },
      { onSuccess: () => setOutcomeFor(null) },
    );
  };

  const predictionColumns: Column<Prediction>[] = [
    {
      key: 'model',
      header: t('ownership.trust.pred.model', 'Model'),
      render: (row) => (
        <div>
          <Text as="p" variant="label">
            {row.model_name}
          </Text>
          <Text as="p" variant="caption">
            {row.target} · {row.si_unit}
          </Text>
        </div>
      ),
    },
    {
      key: 'predicted',
      header: t('ownership.trust.pred.predicted', 'Predicted'),
      render: (row) => (
        <div>
          <span className="tabular-nums">{fmtNumber(row.predicted_value, 3)}</span>
          {row.predicted_low != null && row.predicted_high != null ? (
            <Text as="p" variant="caption">
              [{fmtNumber(row.predicted_low, 3)}, {fmtNumber(row.predicted_high, 3)}]
            </Text>
          ) : null}
        </div>
      ),
    },
    {
      key: 'observed',
      header: t('ownership.trust.pred.observed', 'Observed'),
      render: (row) =>
        row.observed_value != null ? (
          <span className="tabular-nums">{fmtNumber(row.observed_value, 3)}</span>
        ) : (
          <Badge variant="neutral">{t('ownership.trust.pred.pending', 'pending')}</Badge>
        ),
    },
    {
      key: 'error',
      header: t('ownership.trust.pred.error', 'Error'),
      render: (row) =>
        row.abs_error_pct != null ? (
          <span
            className={`tabular-nums ${row.abs_error_pct > 25 ? 'text-rose-300' : row.abs_error_pct > 10 ? 'text-amber-300' : 'text-emerald-300'}`}
          >
            {formatPct(row.abs_error_pct)}
          </span>
        ) : (
          '—'
        ),
      sortable: true,
    },
    {
      key: 'interval',
      header: t('ownership.trust.pred.interval', 'In interval'),
      render: (row) =>
        row.in_interval == null ? (
          '—'
        ) : (
          <Badge variant={row.in_interval ? 'success' : 'danger'}>
            {row.in_interval
              ? t('ownership.trust.pred.inside', 'inside')
              : t('ownership.trust.pred.outside', 'outside')}
          </Badge>
        ),
    },
    {
      key: 'horizon',
      header: t('ownership.trust.pred.horizon', 'Horizon'),
      render: (row) => formatSpan(row.horizon_s),
    },
    {
      key: 'when',
      header: t('ownership.trust.pred.when', 'Predicted at'),
      render: (row) => (
        <Text as="span" variant="caption">
          {formatDateTime(row.predicted_at)}
        </Text>
      ),
      sortable: true,
    },
    {
      key: 'actions',
      header: t('ownership.action.header', 'Actions'),
      render: (row) =>
        row.observed_value == null ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setOutcomeDraft({ observed_value: row.predicted_value });
              setOutcomeFor(row.id);
            }}
          >
            {t('ownership.trust.pred.score', 'Score it')}
          </Button>
        ) : (
          <Text as="span" variant="caption">
            {row.observed_at ? formatDateTime(row.observed_at) : '—'}
          </Text>
        ),
    },
  ];

  const scorecardColumns: Column<ModelScorecard>[] = [
    {
      key: 'model',
      header: t('ownership.trust.card.model', 'Model / target'),
      render: (row) => (
        <div>
          <Text as="p" variant="label">
            {row.model_name}
          </Text>
          <Text as="p" variant="caption">
            {row.target} · {row.si_unit}
          </Text>
        </div>
      ),
    },
    {
      key: 'grade',
      header: t('ownership.trust.card.grade', 'Trust'),
      render: (row) => (
        <div className="flex items-center gap-2">
          <VerdictBadge value={row.trust_grade} />
          <span className="tabular-nums text-xs text-[var(--text-muted)]">
            {fmtNumber(row.trust_score, 0)}/100
          </span>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'samples',
      header: t('ownership.trust.card.samples', 'Scored / pending'),
      render: (row) => (
        <span className="tabular-nums">
          {fmtNumber(row.scored_count, 0)} / {fmtNumber(row.pending_count, 0)}
        </span>
      ),
    },
    {
      key: 'mape',
      header: t('ownership.trust.card.mape', 'MAPE'),
      render: (row) => (row.mean_abs_pct_error != null ? formatPct(row.mean_abs_pct_error) : '—'),
      sortable: true,
    },
    {
      key: 'median',
      header: t('ownership.trust.card.median', 'Median APE'),
      render: (row) =>
        row.median_abs_pct_error != null ? formatPct(row.median_abs_pct_error) : '—',
    },
    {
      key: 'bias',
      header: t('ownership.trust.card.bias', 'Bias'),
      render: (row) =>
        row.bias != null ? (
          <span
            className={`tabular-nums ${row.bias > 0 ? 'text-amber-300' : row.bias < 0 ? 'text-indigo-300' : ''}`}
          >
            {fmtNumber(row.bias, 3)} {row.si_unit}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'rmse',
      header: t('ownership.trust.card.rmse', 'RMSE'),
      render: (row) =>
        row.root_mean_square_error != null ? fmtNumber(row.root_mean_square_error, 3) : '—',
    },
    {
      key: 'coverage',
      header: t('ownership.trust.card.coverage', 'Interval coverage'),
      render: (row) =>
        row.interval_coverage_pct != null ? (
          <span
            className={`tabular-nums ${Math.abs(row.interval_coverage_pct - 80) > 15 ? 'text-amber-300' : 'text-emerald-300'}`}
          >
            {formatPct(row.interval_coverage_pct, 0)}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'skill',
      header: t('ownership.trust.card.skill', 'Skill vs naive'),
      render: (row) =>
        row.skill_vs_naive_pct != null ? (
          <span
            className={`tabular-nums ${row.skill_vs_naive_pct > 0 ? 'text-emerald-300' : 'text-rose-300'}`}
          >
            {formatSignedPct(row.skill_vs_naive_pct)}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'drift',
      header: t('ownership.trust.card.drift', 'Drift'),
      render: (row) => (
        <div className="flex items-center gap-1">
          {row.drift_status === 'degrading' ? (
            <TrendingDown className="h-4 w-4 text-rose-300" aria-hidden="true" />
          ) : row.drift_status === 'improving' ? (
            <TrendingUp className="h-4 w-4 text-emerald-300" aria-hidden="true" />
          ) : (
            <Activity className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          )}
          <Text as="span" variant="caption">
            {row.drift_ratio != null ? fmtNumber(row.drift_ratio, 2) : '—'}
          </Text>
        </div>
      ),
    },
    {
      key: 'inspect',
      header: t('ownership.action.header', 'Actions'),
      render: (row) => (
        <Button
          variant={
            `${row.model_name}::${row.target}` === activeModel ? 'primary' : 'ghost'
          }
          size="sm"
          onClick={() => setActiveModel(`${row.model_name}::${row.target}`)}
        >
          {t('ownership.trust.card.inspect', 'Calibration')}
        </Button>
      ),
    },
  ];

  return (
    <PageContainer
      title={t('ownership.trust.title', 'Prediction Accuracy & Model Trust Lab')}
      subtitle={t(
        'ownership.trust.subtitle',
        'Every forecast this platform makes is written down, then scored against what actually happened. Bias, calibration, skill against a naive baseline, and drift over time decide whether a model earns your trust.',
      )}
      loading={trustQuery.isLoading}
      error={trustQuery.error as Error | null}
      actions={
        <div className="flex items-center gap-2">
          <Select
            aria-label={t('ownership.window.label', 'Analysis window')}
            value={String(windowDays)}
            options={WINDOW_OPTIONS.map((days) => ({
              value: String(days),
              label: t('ownership.window.days', '{{count}} days', { count: days }),
            }))}
            onChange={(event) => setWindowDays(Number(event.target.value))}
          />
          <VehicleSelect withIcon />
        </div>
      }
    >
      <AlertBanner
        variant="info"
        title={t('ownership.trust.notice.title', 'Scored against reality, not against itself')}
      >
        {t(
          'ownership.trust.notice.body',
          'A prediction only counts once its outcome is recorded. Skill is measured against a naive persistence baseline, so a model that merely repeats the last value scores zero — not high.',
        )}
      </AlertBanner>

      <FadeIn>
        <OwnershipPanel title={t('ownership.trust.summary.title', 'Portfolio trust')}>
          <StatGrid
            stats={[
              {
                key: 'portfolio',
                label: t('ownership.trust.stat.portfolio', 'Portfolio trust score'),
                value:
                  report?.portfolio_trust_score != null
                    ? `${fmtNumber(report.portfolio_trust_score, 0)}/100`
                    : '—',
                tone:
                  (report?.portfolio_trust_score ?? 0) >= 75
                    ? 'positive'
                    : (report?.portfolio_trust_score ?? 0) >= 50
                      ? 'warning'
                      : 'default',
              },
              {
                key: 'trusted',
                label: t('ownership.trust.stat.trusted', 'Trusted models'),
                value: fmtNumber(report?.trusted_count ?? 0, 0),
                tone: 'positive',
              },
              {
                key: 'watch',
                label: t('ownership.trust.stat.watch', 'On watch'),
                value: fmtNumber(report?.watch_count ?? 0, 0),
                tone: (report?.watch_count ?? 0) > 0 ? 'warning' : 'default',
              },
              {
                key: 'unreliable',
                label: t('ownership.trust.stat.unreliable', 'Unreliable'),
                value: fmtNumber(report?.unreliable_count ?? 0, 0),
                tone: (report?.unreliable_count ?? 0) > 0 ? 'critical' : 'default',
              },
              {
                key: 'scored',
                label: t('ownership.trust.stat.scored', 'Scored / recorded'),
                value: `${fmtNumber(report?.total_scored ?? 0, 0)} / ${fmtNumber(report?.total_predictions ?? 0, 0)}`,
              },
            ]}
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <OwnershipPanel
          title={t('ownership.trust.cards.title', 'Model scorecards')}
          description={t(
            'ownership.trust.cards.subtitle',
            'Drift ratio compares recent-half error against early-half error. Above 1.5 means the model is getting worse.',
          )}
          empty={scorecards.length === 0}
          emptyMessage={t(
            'ownership.trust.cards.empty',
            'No models have enough scored predictions yet in this window.',
          )}
        >
          <DataTable
            columns={scorecardColumns}
            data={scorecards}
            keyExtractor={(row) => `${row.model_name}::${row.target}`}
            tableId="ownership-trust-scorecards"
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.1}>
        <OwnershipPanel
          title={t('ownership.trust.calibration.title', 'Calibration by prediction magnitude')}
          description={
            selectedCard
              ? t('ownership.trust.calibration.for', 'Showing {{model}} → {{target}}', {
                  model: selectedCard.model_name,
                  target: selectedCard.target,
                })
              : undefined
          }
          empty={calibrationData.length === 0}
          emptyMessage={t(
            'ownership.trust.calibration.empty',
            'Select a scorecard with enough scored samples to plot its calibration.',
          )}
          actions={<Crosshair className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
        >
          <ChartContainer
            title={t('ownership.trust.calibration.chart', 'Mean absolute error and bias per bin')}
            ariaLabel={t(
              'ownership.trust.calibration.aria',
              'Bar chart of mean absolute error and mean bias grouped by prediction magnitude bin',
            )}
            data={calibrationData}
            dataColumns={[
              { key: 'name', label: t('ownership.trust.calibration.col.bin', 'Prediction bin') },
              {
                key: 'error',
                label: t('ownership.trust.calibration.col.error', 'Mean absolute error'),
                format: (v) => fmtNumber(v as number, 3),
              },
              {
                key: 'bias',
                label: t('ownership.trust.calibration.col.bias', 'Mean bias'),
                format: (v) => fmtNumber(v as number, 3),
              },
              {
                key: 'samples',
                label: t('ownership.trust.calibration.col.samples', 'Samples'),
                format: (v) => fmtNumber(v as number, 0),
              },
            ]}
            height={280}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={calibrationData} margin={chartMargin}>
                <CartesianGrid {...chartGrid} />
                <XAxis dataKey="name" tick={axisTick} />
                <YAxis tick={axisTick} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="error" fill="rgba(34,211,238,0.65)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="bias" fill="rgba(251,191,36,0.5)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>

          {selectedCard ? (
            <div className="mt-4 space-y-2">
              <Text as="p" variant="bodySm">
                {selectedCard.narrative}
              </Text>
              <div className="flex flex-wrap gap-2">
                <Badge variant={gradeTone(selectedCard.trust_grade) === 'positive' ? 'success' : 'warning'}>
                  {t('ownership.trust.calibration.first', 'First scored {{when}}', {
                    when: selectedCard.first_scored_at
                      ? formatDateTime(selectedCard.first_scored_at)
                      : '—',
                  })}
                </Badge>
                <Badge variant="neutral">
                  {t('ownership.trust.calibration.last', 'Last scored {{when}}', {
                    when: selectedCard.last_scored_at
                      ? formatDateTime(selectedCard.last_scored_at)
                      : '—',
                  })}
                </Badge>
              </div>
            </div>
          ) : null}
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.15}>
        <OwnershipPanel
          title={t('ownership.trust.predictions.title', 'Prediction ledger')}
          description={t(
            'ownership.trust.predictions.subtitle',
            'Record a forecast before the fact, then score it once the outcome is known. Nothing here can be edited after the fact.',
          )}
          empty={predictions.length === 0 && !predictOpen}
          emptyMessage={t(
            'ownership.trust.predictions.empty',
            'No predictions recorded for this vehicle yet.',
          )}
          actions={
            <Button variant="secondary" size="sm" onClick={() => setPredictOpen((open) => !open)}>
              {predictOpen
                ? t('ownership.action.cancel', 'Cancel')
                : t('ownership.trust.predictions.add', 'Record prediction')}
            </Button>
          }
        >
          {predictOpen ? (
            <form
              className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4"
              onSubmit={submitPrediction}
            >
              <Input
                label={t('ownership.trust.form.model', 'Model name')}
                value={predictDraft.model_name}
                required
                maxLength={120}
                onChange={(event) =>
                  setPredictDraft((current) => ({ ...current, model_name: event.target.value }))
                }
              />
              <Select
                label={t('ownership.trust.form.target', 'Target quantity')}
                value={predictDraft.target}
                options={PREDICTION_TARGETS.map((target) => ({
                  value: target,
                  label: `${target} (${PREDICTION_TARGET_UNITS[target]})`,
                }))}
                onChange={(event) => {
                  const target = event.target.value as PredictionTarget;
                  setPredictDraft((current) => ({
                    ...current,
                    target,
                    si_unit: PREDICTION_TARGET_UNITS[target],
                  }));
                }}
              />
              <Input
                label={t('ownership.trust.form.unit', 'SI unit')}
                value={predictDraft.si_unit}
                readOnly
                hint={t(
                  'ownership.trust.form.unitHint',
                  'Derived from the target so stored predictions stay SI-canonical.',
                )}
              />
              <Input
                type="number"
                label={t('ownership.trust.form.horizon', 'Horizon (days)')}
                value={predictDraft.horizon_days}
                min={1}
                required
                onChange={(event) =>
                  setPredictDraft((current) => ({
                    ...current,
                    horizon_days: Number(event.target.value),
                  }))
                }
              />
              <Input
                type="number"
                label={t('ownership.trust.form.value', 'Predicted value')}
                value={predictDraft.predicted_value}
                step="any"
                required
                onChange={(event) =>
                  setPredictDraft((current) => ({
                    ...current,
                    predicted_value: Number(event.target.value),
                  }))
                }
              />
              <Input
                type="number"
                label={t('ownership.trust.form.low', 'Interval low')}
                value={predictDraft.predicted_low ?? ''}
                step="any"
                onChange={(event) =>
                  setPredictDraft((current) => ({
                    ...current,
                    predicted_low: event.target.value === '' ? null : Number(event.target.value),
                  }))
                }
              />
              <Input
                type="number"
                label={t('ownership.trust.form.high', 'Interval high')}
                value={predictDraft.predicted_high ?? ''}
                step="any"
                onChange={(event) =>
                  setPredictDraft((current) => ({
                    ...current,
                    predicted_high: event.target.value === '' ? null : Number(event.target.value),
                  }))
                }
              />
              <Input
                label={t('ownership.trust.form.reference', 'Reference')}
                value={predictDraft.reference}
                maxLength={200}
                hint={t('ownership.trust.form.referenceHint', 'What produced this forecast')}
                onChange={(event) =>
                  setPredictDraft((current) => ({ ...current, reference: event.target.value }))
                }
              />
              <div className="md:col-span-2 xl:col-span-4">
                <Button type="submit" loading={recordPrediction.isPending} disabled={vehicleId == null}>
                  {t('ownership.trust.form.submit', 'Record forecast')}
                </Button>
                <MutationError error={recordPrediction.error} />
              </div>
            </form>
          ) : null}

          {outcomeFor != null ? (
            <form
              className="mb-6 grid gap-4 rounded-lg border border-white/[0.07] bg-white/[0.02] p-4 md:grid-cols-3"
              onSubmit={submitOutcome}
            >
              <Input
                type="number"
                label={t('ownership.trust.outcome.value', 'Observed value')}
                value={outcomeDraft.observed_value}
                step="any"
                required
                onChange={(event) =>
                  setOutcomeDraft({ observed_value: Number(event.target.value) })
                }
              />
              <div className="flex items-end gap-2 md:col-span-2">
                <Button type="submit" loading={recordOutcome.isPending}>
                  {t('ownership.trust.outcome.submit', 'Score prediction')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setOutcomeFor(null)}>
                  {t('ownership.action.cancel', 'Cancel')}
                </Button>
              </div>
              <div className="md:col-span-3">
                <MutationError error={recordOutcome.error} />
              </div>
            </form>
          ) : null}

          <DataTable
            columns={predictionColumns}
            data={predictions}
            keyExtractor={(row) => row.id}
            tableId="ownership-trust-predictions"
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.2}>
        <EvidencePanel
          quality={report?.quality}
          evidence={report?.evidence}
          unsupported={[
            t(
              'ownership.trust.unsupported.retrain',
              'Retraining or auto-correcting a model — this lab measures, it does not tune',
            ),
            t(
              'ownership.trust.unsupported.cause',
              'Explaining why a model drifted; it reports that it did',
            ),
          ]}
        />
      </FadeIn>
    </PageContainer>
  );
}
