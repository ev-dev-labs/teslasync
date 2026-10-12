import { type FormEvent, useMemo, useRef, useState } from 'react';
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
  ChartLegend,
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

import { PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Button, DataTable, Icon, Input, Select, Text } from '@/components/ui';
import type { Column } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { formatDateTime } from '@/lib/dateFormat';

import type { ModelScorecard, Prediction } from '@/types/ownership';
import {
  EvidencePanel,
  MutationError,
  OwnershipPanel,
  VerdictBadge,
} from '../components';
import { OwnershipBrief } from '../components/operationalbrief-all/OwnershipBrief';
import { specialistDisplay } from '../components/operationalbrief-all/specialistDisplay';
import { daysToSeconds, formatPct, formatSignedPct, formatSpan } from '../formatters';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useChartPalette } from '@/hooks/useChartPalette';
import { cn } from '@/lib/cn';
import { glassCardClasses, neonColorMap } from '@/lib/tokens';

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

export default function ModelTrustPage() {
  const { fmtNumber, fmtScientificNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const [windowDays, setWindowDays] = useState(90);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [predictOpen, setPredictOpen] = useState(false);
  const [predictVehicleId, setPredictVehicleId] = useState<number | null>(null);
  const [outcomeFor, setOutcomeFor] = useState<number | null>(null);
  const [outcomeVehicleId, setOutcomeVehicleId] = useState<number | null>(null);
  const predictInstance = useRef(0);
  const outcomeInstance = useRef(0);
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

  usePageTitle(t('ownership.trust.navTitle', 'Prediction accuracy lab'));

  const calibrationHidden = useHiddenSeries('model-trust-calibration');
  const chartPalette = useChartPalette();
  const predictScopeMatches = predictVehicleId != null && predictVehicleId === vehicleId;
  const outcomeScopeMatches = outcomeVehicleId != null && outcomeVehicleId === vehicleId;

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
        name: `${fmtNumber(bin.lower_pct)}–${fmtNumber(bin.upper_pct)}%`,
        error: bin.mean_abs_error,
        bias: bin.mean_bias,
        coverage: bin.coverage_pct,
        samples: bin.sample_count,
      })),
    [selectedCard, fmtNumber],
  );

  const submitPrediction = (event: FormEvent) => {
    event.preventDefault();
    if (predictVehicleId == null || !predictScopeMatches || recordPrediction.isPending) return;
    const instance = predictInstance.current;
    recordPrediction.mutate(
      {
        vehicle_id: predictVehicleId,
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
      { onSuccess: () => {
        if (predictInstance.current === instance) setPredictOpen(false);
      } },
    );
  };

  const submitOutcome = (event: FormEvent) => {
    event.preventDefault();
    if (outcomeFor == null || !outcomeScopeMatches || recordOutcome.isPending) return;
    const instance = outcomeInstance.current;
    recordOutcome.mutate(
      {
        prediction_id: outcomeFor,
        observed_value: outcomeDraft.observed_value,
        observed_at: new Date().toISOString(),
      },
      { onSuccess: () => {
        if (outcomeInstance.current === instance) setOutcomeFor(null);
      } },
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
      align: 'right',
      header: t('ownership.trust.pred.predicted', 'Predicted'),
      render: (row) => (
        <div>
          <span className="tabular-nums">{fmtScientificNumber(row.predicted_value, 3)}</span>
          {row.predicted_low != null && row.predicted_high != null ? (
            <Text as="p" variant="caption">
              [{fmtScientificNumber(row.predicted_low, 3)}, {fmtScientificNumber(row.predicted_high, 3)}]
            </Text>
          ) : null}
        </div>
      ),
    },
    {
      key: 'observed',
      align: 'right',
      header: t('ownership.trust.pred.observed', 'Observed'),
      render: (row) =>
        row.observed_value != null ? (
          <span className="tabular-nums">{fmtScientificNumber(row.observed_value, 3)}</span>
        ) : (
          <Badge variant="neutral">{t('ownership.trust.pred.pending', 'pending')}</Badge>
        ),
    },
    {
      key: 'error',
      align: 'right',
      header: t('ownership.trust.pred.error', 'Error'),
      render: (row) =>
        row.abs_error_pct != null ? (
          <span
            className={cn('tabular-nums', row.abs_error_pct > 25 ? neonColorMap.red.text : row.abs_error_pct > 10 ? neonColorMap.amber.text : neonColorMap.green.text)}
          >
            {formatPct(row.abs_error_pct)}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'interval',
      align: 'right',
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
      align: 'right',
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
    },
    {
      key: 'actions',
      header: t('ownership.action.header', 'Actions'),
      render: (row) =>
        row.observed_value == null ? (
          <Button
            variant="ghost"
            size="sm"
            className="min-h-11 md:min-h-9"
            wrapLabel
            disabled={recordOutcome.isPending}
            onClick={() => {
              outcomeInstance.current += 1;
              setOutcomeVehicleId(row.vehicle_id);
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
        <div className="flex flex-wrap items-center gap-2">
          <VerdictBadge value={row.trust_grade} />
          <Text as="span" variant="caption" className="tabular-nums">
            {fmtNumber(row.trust_score)}/100
          </Text>
        </div>
      ),
    },
    {
      key: 'samples',
      align: 'right',
      header: t('ownership.trust.card.samples', 'Scored / pending'),
      render: (row) => (
        <span className="tabular-nums">
          {fmtInt(row.scored_count)} / {fmtInt(row.pending_count)}
        </span>
      ),
    },
    {
      key: 'mape',
      align: 'right',
      header: t('ownership.trust.card.mape', 'MAPE'),
      render: (row) => (row.mean_abs_pct_error != null ? formatPct(row.mean_abs_pct_error) : '—'),
    },
    {
      key: 'median',
      align: 'right',
      header: t('ownership.trust.card.median', 'Median APE'),
      render: (row) =>
        row.median_abs_pct_error != null ? formatPct(row.median_abs_pct_error) : '—',
    },
    {
      key: 'bias',
      align: 'right',
      header: t('ownership.trust.card.bias', 'Bias'),
      render: (row) =>
        row.bias != null ? (
          <span
            className={cn('tabular-nums', row.bias > 0 ? neonColorMap.amber.text : row.bias < 0 ? neonColorMap.blue.text : undefined)}
          >
            {fmtScientificNumber(row.bias, 3)} {row.si_unit}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'rmse',
      align: 'right',
      header: t('ownership.trust.card.rmse', 'RMSE'),
      render: (row) =>
        row.root_mean_square_error != null ? `${fmtScientificNumber(row.root_mean_square_error, 3)} ${row.si_unit}` : '—',
    },
    {
      key: 'coverage',
      align: 'right',
      header: t('ownership.trust.card.coverage', 'Interval coverage'),
      render: (row) =>
        row.interval_coverage_pct != null ? (
          <span
            className={cn('tabular-nums', Math.abs(row.interval_coverage_pct - 80) > 15 ? neonColorMap.amber.text : neonColorMap.green.text)}
          >
            {formatPct(row.interval_coverage_pct)}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'skill',
      align: 'right',
      header: t('ownership.trust.card.skill', 'Skill vs naive'),
      render: (row) =>
        row.skill_vs_naive_pct != null ? (
          <span
            className={cn('tabular-nums', row.skill_vs_naive_pct > 0 ? neonColorMap.green.text : neonColorMap.red.text)}
          >
            {formatSignedPct(row.skill_vs_naive_pct)}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'drift',
      align: 'right',
      header: t('ownership.trust.card.drift', 'Drift'),
      render: (row) => (
        <div className="flex flex-wrap items-center gap-2">
          {row.drift_status === 'degrading' ? (
            <Icon icon={TrendingDown} size="md" className={neonColorMap.red.text} />
          ) : row.drift_status === 'improving' ? (
            <Icon icon={TrendingUp} size="md" className={neonColorMap.green.text} />
          ) : (
            <Icon icon={Activity} size="md" />
          )}
          <VerdictBadge value={row.drift_status} dot={false} />
          <Text as="span" variant="caption">
            {row.drift_ratio != null ? fmtNumber(row.drift_ratio) : '—'}
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
          className="min-h-11 md:min-h-9"
          wrapLabel
          onClick={() => setActiveModel(`${row.model_name}::${row.target}`)}
        >
          {t('ownership.trust.card.inspect', 'Calibration')}
        </Button>
      ),
    },
  ];

  return (
    <PageLayout
      title={t('ownership.trust.title', 'Prediction accuracy & model trust lab')}
      subtitle={t(
        'ownership.trust.subtitle',
        'Every forecast this platform makes is written down, then scored against what actually happened. Bias, calibration, skill against a naive baseline, and drift over time decide whether a model earns your trust.',
      )}
      query={trustQuery}
      contextActions={
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
        <OwnershipPanel title={t('ownership.trust.summary.title', 'Portfolio trust')}
          source={trustQuery} sourceEnabled={vehicleId != null} empty={!report} preserveSummary>
          <OwnershipBrief
            title={t('ownership.trust.brief.title', 'Recorded model trust and scoring')}
            description={t('ownership.trust.notice.body', 'A prediction only counts once its outcome is recorded. Skill is measured against a naive persistence baseline, so a model that merely repeats the last value scores zero — not high.')}
            scope={t('ownership.brief.window', 'Selected vehicle · {{count}}-day analysis window; coverage is described below', { count: windowDays })}
            source={trustQuery} enabled={vehicleId != null}
            window={report?.window}
            metrics={[
              {
                occurrenceId: 'portfolio', metricId: 'score',
                label: t('ownership.trust.stat.portfolio', 'Portfolio trust score'),
                rawValue: report?.portfolio_trust_score,
                display: specialistDisplay((raw) => `${fmtNumber(raw)}/100`),
                tone:
                  report?.portfolio_trust_score != null && report.portfolio_trust_score >= 75
                    ? 'positive'
                    : report?.portfolio_trust_score != null && report.portfolio_trust_score >= 50
                      ? 'warning'
                      : 'default',
              },
              {
                occurrenceId: 'trusted', metricId: 'count',
                label: t('ownership.trust.stat.trusted', 'Trusted models'),
                rawValue: report?.trusted_count,
                display: specialistDisplay(fmtInt),
                tone: 'positive',
              },
              {
                occurrenceId: 'watch', metricId: 'count',
                label: t('ownership.trust.stat.watch', 'On watch'),
                rawValue: report?.watch_count,
                display: specialistDisplay(fmtInt),
                tone: report?.watch_count != null && report.watch_count > 0 ? 'warning' : 'default',
              },
              {
                occurrenceId: 'unreliable', metricId: 'count',
                label: t('ownership.trust.stat.unreliable', 'Unreliable'),
                rawValue: report?.unreliable_count,
                display: specialistDisplay(fmtInt),
                tone: report?.unreliable_count != null && report.unreliable_count > 0 ? 'critical' : 'default',
              },
              {
                occurrenceId: 'scored', metricId: 'count',
                label: t('ownership.trust.stat.scored', 'Scored / recorded'),
                rawValue: report?.total_scored,
                display: { countTotal: report?.total_predictions,
                  formatter: (raw) => ({ value: `${fmtNumber(raw)} / ${report?.total_predictions == null ? '—' : fmtNumber(report.total_predictions)}`, unit: '' }) },
              },
            ]}
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <OwnershipPanel
          title={t('ownership.trust.cards.title', 'Model scorecards')}
          source={trustQuery}
          sourceEnabled={vehicleId != null}
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
            mobilePresentation={{
              roles: { model: 'title', grade: 'badge', mape: 'primary', samples: 'meta', drift: 'meta' },
              displayValue: (row, key) => key === 'model' ? row.model_name
                : key === 'grade' ? `${fmtNumber(row.trust_score)}/100`
                : key === 'mape' ? row.mean_abs_pct_error == null ? '—' : formatPct(row.mean_abs_pct_error)
                : key === 'samples' ? `${fmtInt(row.scored_count)} / ${fmtInt(row.pending_count)}`
                : key === 'drift' ? row.drift_ratio == null ? '—' : fmtNumber(row.drift_ratio) : null,
              inlineActions: (row) => scorecardColumns.find(column => column.key === 'inspect')?.render(row),
            }}
            data={scorecards}
            keyExtractor={(row) => `${row.model_name}::${row.target}`}
            tableId="ownership-trust-scorecards"
            caption={t('ownership.trust.cards.title', 'Model scorecards')}
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.1}>
        <OwnershipPanel
          title={t('ownership.trust.calibration.title', 'Calibration by prediction magnitude')}
          source={trustQuery}
          sourceEnabled={vehicleId != null}
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
          actions={<Icon icon={Crosshair} size="md" />}
        >
          <ChartContainer
            title={`${t('ownership.trust.calibration.chart', 'Mean absolute error and bias per bin')} (${selectedCard?.si_unit ?? '—'})`}
            ariaLabel={`${t(
              'ownership.trust.calibration.aria',
              'Bar chart of mean absolute error and mean bias grouped by prediction magnitude bin',
            )} (${selectedCard?.si_unit ?? '—'})`}
            data={calibrationData}
            dataColumns={[
              { key: 'name', label: t('ownership.trust.calibration.col.bin', 'Prediction bin') },
              {
                key: 'error',
                label: `${t('ownership.trust.calibration.col.error', 'Mean absolute error')} (${selectedCard?.si_unit ?? '—'})`,
                format: (v) => fmtScientificNumber(v as number, 3),
              },
              {
                key: 'bias',
                label: `${t('ownership.trust.calibration.col.bias', 'Mean bias')} (${selectedCard?.si_unit ?? '—'})`,
                format: (v) => fmtScientificNumber(v as number, 3),
              },
              {
                key: 'samples',
                label: t('ownership.trust.calibration.col.samples', 'Samples'),
                format: (v) => fmtNumber(v as number),
              },
            ]}
            height={280}
            chartKey="model-trust-calibration"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={calibrationData} margin={chartMargin}>
                <CartesianGrid {...chartGrid} />
                <XAxis dataKey="name" tick={axisTick} />
                <YAxis tick={axisTick} tickFormatter={(value: number) => fmtScientificNumber(value, 3)} unit={selectedCard?.si_unit} />
                <Tooltip content={<ChartTooltip valueFormatter={(value) => typeof value === 'number' ? `${fmtScientificNumber(value, 3)} ${selectedCard?.si_unit ?? '—'}` : '—'} />} />
                <ChartLegend state={calibrationHidden} />
                <Bar
                  dataKey="error"
                  name={t('ownership.trust.calibration.col.error', 'Mean absolute error')}
                  fill={chartPalette[0]}
                  radius={[4, 4, 0, 0]}
                  hide={calibrationHidden.isHidden('error')}
                />
                <Bar
                  dataKey="bias"
                  name={t('ownership.trust.calibration.col.bias', 'Mean bias')}
                  fill={chartPalette[1]}
                  radius={[4, 4, 0, 0]}
                  hide={calibrationHidden.isHidden('bias')}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>

          {selectedCard ? (
            <div className="mt-4 space-y-2">
              <Text as="p" variant="bodySm">
                {selectedCard.narrative}
              </Text>
              <div className="flex flex-wrap gap-2">
                <Badge variant="neutral">
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
          source={trustQuery}
          sourceEnabled={vehicleId != null}
          editing={predictOpen || outcomeFor != null}
          description={t(
            'ownership.trust.predictions.subtitle',
            'Record a forecast before the fact, then score it once the outcome is known. Nothing here can be edited after the fact.',
          )}
          empty={predictions.length === 0 && !predictOpen && outcomeFor == null}
          emptyMessage={t(
            'ownership.trust.predictions.empty',
            'No predictions recorded for this vehicle yet.',
          )}
          actions={
            <Button variant="secondary" size="sm" className="min-h-11 md:min-h-9" wrapLabel disabled={recordPrediction.isPending} onClick={() => {
              predictInstance.current += 1;
              if (!predictOpen) setPredictVehicleId(vehicleId);
              setPredictOpen((open) => !open);
            }}>
              {predictOpen
                ? t('ownership.action.cancel', 'Cancel')
                : t('ownership.trust.predictions.add', 'Record prediction')}
            </Button>
          }
        >
          <Text as="p" variant="caption" className="md:col-span-2 xl:col-span-4">
            {t('common.vehicle', 'Vehicle')}: {predictVehicleId ?? '—'}
          </Text>
          {!predictScopeMatches && predictVehicleId != null ? (
            <div className="md:col-span-2 xl:col-span-4">
              <AlertBanner variant="warning">
                {t('annotation.contextChanged', 'This form belongs to {{target}}. Return to that context to save, or cancel and open a new form.', { target: String(predictVehicleId) })}
              </AlertBanner>
            </div>
          ) : null}
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
                <Button type="submit" className="min-h-11 md:min-h-10" wrapLabel loading={recordPrediction.isPending} disabled={!predictScopeMatches}>
                  {t('ownership.trust.form.submit', 'Record forecast')}
                </Button>
                <MutationError error={recordPrediction.error} />
              </div>
            </form>
          ) : null}

          {outcomeFor != null ? (
            <form
              className={cn('mb-6 grid gap-4 md:grid-cols-3', glassCardClasses.md)}
              onSubmit={submitOutcome}
            >
              <Text as="p" variant="caption" className="md:col-span-3">
                {t('common.vehicle', 'Vehicle')}: {outcomeVehicleId ?? '—'}
              </Text>
              {!outcomeScopeMatches && outcomeVehicleId != null ? (
                <div className="md:col-span-3">
                  <AlertBanner variant="warning">
                    {t('annotation.contextChanged', 'This form belongs to {{target}}. Return to that context to save, or cancel and open a new form.', { target: String(outcomeVehicleId) })}
                  </AlertBanner>
                </div>
              ) : null}
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
              <div className="flex flex-wrap items-end gap-2 md:col-span-2">
                <Button type="submit" className="min-h-11 md:min-h-10" wrapLabel loading={recordOutcome.isPending} disabled={!outcomeScopeMatches}>
                  {t('ownership.trust.outcome.submit', 'Score prediction')}
                </Button>
                <Button type="button" variant="ghost" className="min-h-11 md:min-h-10" wrapLabel disabled={recordOutcome.isPending} onClick={() => {
                  outcomeInstance.current += 1;
                  setOutcomeFor(null);
                }}>
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
            mobilePresentation={{
              roles: { model: 'title', predicted: 'primary', observed: 'meta', when: 'meta' },
              displayValue: (row, key) => key === 'model' ? row.model_name
                : key === 'predicted' ? `${fmtScientificNumber(row.predicted_value, 3)} ${row.si_unit}`
                : key === 'observed' ? row.observed_value == null ? t('ownership.trust.pred.pending', 'pending') : `${fmtScientificNumber(row.observed_value, 3)} ${row.si_unit}`
                : key === 'when' ? formatDateTime(row.predicted_at) : null,
              inlineActions: (row) => predictionColumns.find(column => column.key === 'actions')?.render(row),
            }}
            data={predictions}
            keyExtractor={(row) => row.id}
            tableId="ownership-trust-predictions"
            caption={t('ownership.trust.predictions.title', 'Prediction ledger')}
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.2}>
        <EvidencePanel
          source={trustQuery}
          sourceEnabled={vehicleId != null}
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
    </PageLayout>
  );
}
