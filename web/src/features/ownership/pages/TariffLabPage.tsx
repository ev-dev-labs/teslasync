import { type FormEvent, useMemo, useState } from 'react';
import { Plug, Plus, Trash2, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useCreateTariff,
  useDeleteTariff,
  useSimulateTariffs,
  useTariffs,
} from '@/api/hooks/useOwnership';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import { Badge, Button, DataTable, Input, Select, Text, Toggle } from '@/components/ui';
import type { Column } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber } from '@/lib/numberFormat';
import type {
  Tariff,
  TariffRate,
  TariffSimulationResult,
  TariffStructure,
} from '@/types/ownership';
import {
  EvidencePanel,
  MutationError,
  OwnershipPanel,
  StatGrid,
  VerdictBadge,
} from '../components';
import { formatCurrencyMinor, formatPct, formatPricePerEnergy } from '../formatters';

const STRUCTURES: TariffStructure[] = ['flat', 'tou', 'tiered', 'real_time', 'demand'];
const ALL_DAYS = 127;

/** A fresh band spanning the whole week and the whole day. */
function newRate(): TariffRate {
  return {
    id: 0,
    label: 'Standard',
    day_mask: ALL_DAYS,
    start_minute: 0,
    end_minute: 1440,
    price_minor_per_wh: 0.015,
    tier_upper_wh: null,
    season_start_month: 1,
    season_end_month: 12,
  };
}

function minutesToClock(minutes: number): string {
  const safe = Math.max(0, Math.min(1440, Math.round(minutes)));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function clockToMinutes(value: string): number {
  const [hours, mins] = value.split(':').map((part) => Number(part));
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return 0;
  return Math.max(0, Math.min(1440, hours * 60 + mins));
}

export default function TariffLabPage() {
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const [windowDays, setWindowDays] = useState(90);
  const [shiftablePct, setShiftablePct] = useState(35);
  const [switchFeeMinor, setSwitchFeeMinor] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState({
    name: '',
    provider: '',
    currency: 'USD',
    structure: 'tou' as TariffStructure,
    standing_charge_minor_per_day: 0,
    demand_charge_minor_per_w: 0,
    export_price_minor_per_wh: 0,
    is_current: false,
    rates: [newRate()],
  });

  usePageTitle(t('ownership.tariff.title', 'Utility Tariff Arbitrage Lab'));

  const tariffQuery = useTariffs(100, 0);
  const create = useCreateTariff();
  const remove = useDeleteTariff();
  const simulate = useSimulateTariffs();

  const tariffs = useMemo(() => tariffQuery.data?.items ?? [], [tariffQuery.data?.items]);
  const result = simulate.data;
  const results = useMemo(() => result?.results ?? [], [result?.results]);
  const currency = results[0]?.currency ?? draft.currency;
  const money = (minor: number | null | undefined) =>
    formatCurrencyMinor(minor, currency, units.unitPrefs.locale);

  const chartData = useMemo(
    () =>
      results.map((row) => ({
        name: row.name,
        annual: row.annual_cost_minor / 100,
        isBest: row.rank === 1,
        isCurrent: row.is_current,
      })),
    [results],
  );

  const toggleSelected = (id: number) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  const runSimulation = () => {
    if (vehicleId == null) return;
    simulate.mutate({
      vehicle_id: vehicleId,
      window_days: windowDays,
      tariff_ids: selected,
      shiftable_pct: shiftablePct,
      switch_fee_minor: switchFeeMinor,
      confirmed: true,
    });
  };

  const submitTariff = (event: FormEvent) => {
    event.preventDefault();
    create.mutate(draft, {
      onSuccess: () => {
        setFormOpen(false);
        setDraft((current) => ({ ...current, name: '', provider: '', rates: [newRate()] }));
      },
    });
  };

  const planColumns: Column<Tariff>[] = [
    {
      key: 'select',
      header: t('ownership.tariff.plan.compare', 'Compare'),
      render: (row) => (
        <Toggle
          label=""
          checked={selected.includes(row.id)}
          onChange={() => toggleSelected(row.id)}
        />
      ),
    },
    {
      key: 'name',
      header: t('ownership.tariff.plan.name', 'Plan'),
      render: (row) => (
        <div>
          <Text as="p" variant="label">
            {row.name}
          </Text>
          <Text as="p" variant="caption">
            {row.provider || t('ownership.tariff.plan.noProvider', 'No provider recorded')}
          </Text>
        </div>
      ),
    },
    {
      key: 'structure',
      header: t('ownership.tariff.plan.structure', 'Structure'),
      render: (row) => <Badge variant="info">{row.structure.replace(/_/g, ' ')}</Badge>,
    },
    {
      key: 'bands',
      header: t('ownership.tariff.plan.bands', 'Price bands'),
      render: (row) => <span className="tabular-nums">{(row.rates ?? []).length}</span>,
    },
    {
      key: 'standing',
      header: t('ownership.tariff.plan.standing', 'Standing charge'),
      render: (row) => (
        <span className="tabular-nums">
          {formatCurrencyMinor(
            row.standing_charge_minor_per_day,
            row.currency,
            units.unitPrefs.locale,
          )}
          <span className="text-[var(--text-muted)]">/d</span>
        </span>
      ),
    },
    {
      key: 'demand',
      header: t('ownership.tariff.plan.demand', 'Demand charge'),
      render: (row) => (
        <span className="tabular-nums">
          {row.demand_charge_minor_per_w > 0
            ? `${formatCurrencyMinor(row.demand_charge_minor_per_w * 1000, row.currency, units.unitPrefs.locale)}/kW`
            : '—'}
        </span>
      ),
    },
    {
      key: 'current',
      header: t('ownership.tariff.plan.current', 'Current'),
      render: (row) =>
        row.is_current ? (
          <Badge variant="success" dot>
            {t('ownership.tariff.plan.onPlan', 'On plan')}
          </Badge>
        ) : (
          <Text as="span" variant="caption">
            —
          </Text>
        ),
    },
    {
      key: 'actions',
      header: t('ownership.action.header', 'Actions'),
      render: (row) => (
        <Button
          variant="ghost"
          size="sm"
          icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
          onClick={() => remove.mutate(row.id)}
        >
          {t('ownership.action.remove', 'Remove')}
        </Button>
      ),
    },
  ];

  const resultColumns: Column<TariffSimulationResult>[] = [
    {
      key: 'rank',
      header: t('ownership.tariff.result.rank', 'Rank'),
      render: (row) => (
        <span className={`tabular-nums ${row.rank === 1 ? 'text-emerald-300' : ''}`}>
          #{row.rank}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'name',
      header: t('ownership.tariff.result.plan', 'Plan'),
      render: (row) => (
        <div className="flex items-center gap-2">
          <Text as="span" variant="label">
            {row.name}
          </Text>
          {row.is_current ? (
            <Badge variant="neutral">{t('ownership.tariff.result.currentTag', 'current')}</Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: 'annual',
      header: t('ownership.tariff.result.annual', 'Annualised cost'),
      render: (row) => <span className="tabular-nums">{money(row.annual_cost_minor)}</span>,
      sortable: true,
    },
    {
      key: 'delta',
      header: t('ownership.tariff.result.delta', 'vs current'),
      render: (row) => (
        <span
          className={`tabular-nums ${(row.delta_vs_current_minor ?? 0) < 0 ? 'text-emerald-300' : (row.delta_vs_current_minor ?? 0) > 0 ? 'text-rose-300' : ''}`}
        >
          {money(row.delta_vs_current_minor)}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'effective',
      header: t('ownership.tariff.result.effective', 'Effective price'),
      render: (row) => (
        <span className="tabular-nums">
          {formatPricePerEnergy(
            row.effective_price_minor_per_wh,
            row.currency,
            units.unitPrefs,
            units.unitPrefs.locale,
          )}
        </span>
      ),
    },
    {
      key: 'shift',
      header: t('ownership.tariff.result.shift', 'Load-shift upside'),
      render: (row) => (
        <span className="tabular-nums text-emerald-300">
          {row.load_shift_saving_minor > 0 ? money(row.load_shift_saving_minor) : '—'}
        </span>
      ),
    },
    {
      key: 'breakeven',
      header: t('ownership.tariff.result.breakEven', 'Break-even'),
      render: (row) =>
        row.break_even_days != null
          ? t('ownership.tariff.result.days', '{{count}} d', { count: row.break_even_days })
          : '—',
    },
    {
      key: 'peak',
      header: t('ownership.tariff.result.peak', 'Peak demand'),
      render: (row) =>
        row.peak_demand_w != null ? units.formatPower(row.peak_demand_w) : '—',
    },
    {
      key: 'breakdown',
      header: t('ownership.tariff.result.breakdown', 'Energy / standing / demand'),
      render: (row) => (
        <Text as="span" variant="caption">
          {money(row.energy_cost_minor)} · {money(row.standing_cost_minor)} ·{' '}
          {money(row.demand_cost_minor)}
        </Text>
      ),
    },
  ];

  const bestResult = results.find((row) => row.rank === 1) ?? null;

  return (
    <PageContainer
      title={t('ownership.tariff.title', 'Utility Tariff Arbitrage Lab')}
      subtitle={t(
        'ownership.tariff.subtitle',
        'Replay your real measured charging load against every rate plan you can author — flat, time-of-use, tiered, real-time, and demand — then rank them on annualised cost.',
      )}
      loading={tariffQuery.isLoading}
      error={tariffQuery.error as Error | null}
      actions={<VehicleSelect withIcon />}
    >
      <AlertBanner
        variant="info"
        title={t('ownership.tariff.notice.title', 'Replay, not forecast')}
      >
        {t(
          'ownership.tariff.notice.body',
          'Each plan is priced against the exact sessions you actually charged, bucketed into their real time-of-day bands. Annualisation scales the observed window — it does not predict future consumption.',
        )}
      </AlertBanner>

      <FadeIn>
        <OwnershipPanel
          title={t('ownership.tariff.controls.title', 'Comparison parameters')}
          description={t(
            'ownership.tariff.controls.subtitle',
            'Shiftable share is the fraction of energy you could realistically move into the cheapest band without changing when you drive.',
          )}
        >
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Select
              label={t('ownership.window.label', 'Analysis window')}
              options={[30, 90, 180, 365].map((days) => ({
                value: String(days),
                label: t('ownership.window.days', '{{count}} days', { count: days }),
              }))}
              value={String(windowDays)}
              onChange={(event) => setWindowDays(Number(event.target.value))}
            />
            <Input
              type="number"
              label={t('ownership.tariff.controls.shiftable', 'Shiftable load (%)')}
              value={shiftablePct}
              min={0}
              max={100}
              onChange={(event) => setShiftablePct(Number(event.target.value))}
            />
            <Input
              type="number"
              label={t('ownership.tariff.controls.switchFee', 'Switching fee (minor units)')}
              value={switchFeeMinor}
              min={0}
              onChange={(event) => setSwitchFeeMinor(Number(event.target.value))}
            />
            <div className="flex items-end">
              <Button
                onClick={runSimulation}
                loading={simulate.isPending}
                disabled={vehicleId == null || simulate.isPending}
                icon={<Zap className="h-4 w-4" aria-hidden="true" />}
              >
                {t('ownership.tariff.controls.run', 'Replay load against plans')}
              </Button>
            </div>
          </div>
          <Text as="p" variant="caption" className="mt-3">
            {selected.length > 0
              ? t('ownership.tariff.controls.selected', '{{count}} plans selected', {
                  count: selected.length,
                })
              : t(
                  'ownership.tariff.controls.all',
                  'No plans selected — every stored plan will be evaluated.',
                )}
          </Text>
          <MutationError error={simulate.error} />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <OwnershipPanel
          title={t('ownership.tariff.summary.title', 'Arbitrage summary')}
          empty={!result}
          emptyMessage={t(
            'ownership.tariff.summary.empty',
            'Run a replay to see how much your plan choice is worth.',
          )}
        >
          <StatGrid
            stats={[
              {
                key: 'saving',
                label: t('ownership.tariff.stat.saving', 'Best-case annual saving'),
                value: money(result?.max_saving_minor),
                tone: (result?.max_saving_minor ?? 0) > 0 ? 'positive' : 'default',
                hint: bestResult?.name,
              },
              {
                key: 'observed',
                label: t('ownership.tariff.stat.observed', 'Observed energy'),
                value: units.formatEnergy(result?.observed_energy_wh ?? 0),
                hint: t('ownership.tariff.stat.sessions', '{{count}} sessions', {
                  count: result?.session_count ?? 0,
                }),
              },
              {
                key: 'plans',
                label: t('ownership.tariff.stat.plans', 'Plans evaluated'),
                value: fmtNumber(results.length, 0),
              },
              {
                key: 'shift',
                label: t('ownership.tariff.stat.shift', 'Shiftable share modelled'),
                value: formatPct(result?.shiftable_pct, 0),
                tone: 'accent',
              },
            ]}
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.1}>
        <OwnershipPanel
          title={t('ownership.tariff.chart.title', 'Annualised cost by plan')}
          description={t(
            'ownership.tariff.chart.subtitle',
            'Green is the cheapest ranked plan; grey bars are the alternatives you would be paying instead.',
          )}
          empty={chartData.length === 0}
          emptyMessage={t('ownership.tariff.chart.empty', 'Run a replay to populate this chart.')}
        >
          <ChartContainer
            height={300}
            title={t('ownership.tariff.chart.caption', 'Annualised cost comparison')}
            ariaLabel={t(
              'ownership.tariff.chart.aria',
              'Bar chart comparing annualised cost of each evaluated tariff plan',
            )}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={chartMargin}>
                <CartesianGrid {...chartGrid} />
                <XAxis dataKey="name" tick={axisTick} />
                <YAxis tick={axisTick} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="annual" name={t('ownership.tariff.chart.cost', 'Annual cost')}>
                  {chartData.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={entry.isBest ? '#34d399' : entry.isCurrent ? '#22d3ee' : '#64748b'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.15}>
        <OwnershipPanel
          title={t('ownership.tariff.results.title', 'Ranked plan economics')}
          empty={results.length === 0}
          emptyMessage={t(
            'ownership.tariff.results.empty',
            'No plan produced a priced result — check that your plans have at least one price band.',
          )}
        >
          <DataTable
            columns={resultColumns}
            data={results}
            keyExtractor={(row) => row.tariff_id}
            tableId="ownership-tariff-results"
          />
          {results.some((row) => (row.warnings ?? []).length > 0) ? (
            <div className="mt-4 space-y-2">
              {results.flatMap((row) =>
                (row.warnings ?? []).map((warning) => (
                  <Text as="p" variant="caption" key={`${row.tariff_id}-${warning}`}>
                    ⚠ {row.name}: {warning}
                  </Text>
                )),
              )}
            </div>
          ) : null}
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.2}>
        <OwnershipPanel
          title={t('ownership.tariff.bands.title', 'Where your energy actually landed')}
          description={t(
            'ownership.tariff.bands.subtitle',
            'Band occupancy for each plan — this is the mechanism behind the ranking, not a projection.',
          )}
          empty={results.length === 0}
          emptyMessage={t('ownership.tariff.bands.empty', 'Run a replay to break down band usage.')}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            {results.map((row) => (
              <article
                key={row.tariff_id}
                className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <Text as="h3" variant="subhead">
                    {row.name}
                  </Text>
                  <VerdictBadge
                    value={row.rank === 1 ? 'keep' : 'review'}
                    label={t('ownership.tariff.bands.rank', 'Rank {{rank}}', { rank: row.rank })}
                    dot={false}
                  />
                </div>
                <div className="mt-3 space-y-2">
                  {(row.bands ?? []).length > 0 ? (
                    (row.bands ?? []).map((band) => (
                      <div key={`${row.tariff_id}-${band.label}`}>
                        <div className="flex justify-between gap-3 text-sm">
                          <span>{band.label}</span>
                          <span className="tabular-nums text-[var(--text-muted)]">
                            {units.formatEnergy(band.energy_wh)} · {money(band.cost_minor)}
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
                          <div
                            className="h-full rounded-full bg-cyan-400/70"
                            style={{ width: `${Math.min(100, Math.max(0, band.share_pct))}%` }}
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <Text as="p" variant="caption">
                      {t('ownership.tariff.bands.none', 'This plan has a single undifferentiated rate.')}
                    </Text>
                  )}
                </div>
              </article>
            ))}
          </div>
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.25}>
        <OwnershipPanel
          title={t('ownership.tariff.plans.title', 'Your rate plan library')}
          description={t(
            'ownership.tariff.plans.subtitle',
            'Author any plan your utility offers. Prices are stored per watt-hour in currency minor units so exotic structures stay exact.',
          )}
          empty={tariffs.length === 0 && !formOpen}
          emptyMessage={t(
            'ownership.tariff.plans.empty',
            'No plans yet — add the plan you are on today plus any you are considering.',
          )}
          actions={
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus className="h-4 w-4" aria-hidden="true" />}
              onClick={() => setFormOpen((open) => !open)}
            >
              {formOpen
                ? t('ownership.action.cancel', 'Cancel')
                : t('ownership.tariff.plans.add', 'Add plan')}
            </Button>
          }
        >
          {formOpen ? (
            <form className="mb-6 space-y-5" onSubmit={submitTariff}>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <Input
                  label={t('ownership.tariff.form.name', 'Plan name')}
                  value={draft.name}
                  required
                  maxLength={160}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, name: event.target.value }))
                  }
                />
                <Input
                  label={t('ownership.tariff.form.provider', 'Provider')}
                  value={draft.provider}
                  maxLength={160}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, provider: event.target.value }))
                  }
                />
                <Input
                  label={t('ownership.form.currency', 'ISO currency code')}
                  value={draft.currency}
                  minLength={3}
                  maxLength={3}
                  required
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      currency: event.target.value.toUpperCase(),
                    }))
                  }
                />
                <Select
                  label={t('ownership.tariff.form.structure', 'Rate structure')}
                  options={STRUCTURES.map((structure) => ({
                    value: structure,
                    label: structure.replace(/_/g, ' '),
                  }))}
                  value={draft.structure}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      structure: event.target.value as TariffStructure,
                    }))
                  }
                />
                <Input
                  type="number"
                  label={t('ownership.tariff.form.standing', 'Standing charge (minor/day)')}
                  value={draft.standing_charge_minor_per_day}
                  min={0}
                  step={0.0001}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      standing_charge_minor_per_day: Number(event.target.value),
                    }))
                  }
                />
                <Input
                  type="number"
                  label={t('ownership.tariff.form.demand', 'Demand charge (minor per W)')}
                  value={draft.demand_charge_minor_per_w}
                  min={0}
                  step={0.000001}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      demand_charge_minor_per_w: Number(event.target.value),
                    }))
                  }
                />
                <Input
                  type="number"
                  label={t('ownership.tariff.form.export', 'Export price (minor per Wh)')}
                  value={draft.export_price_minor_per_wh}
                  min={0}
                  step={0.000001}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      export_price_minor_per_wh: Number(event.target.value),
                    }))
                  }
                />
                <div className="flex items-end">
                  <Toggle
                    label={t('ownership.tariff.form.isCurrent', 'This is my current plan')}
                    checked={draft.is_current}
                    onChange={(checked) =>
                      setDraft((current) => ({ ...current, is_current: checked }))
                    }
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Text as="h3" variant="label">
                    {t('ownership.tariff.form.bands', 'Price bands')}
                  </Text>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon={<Plus className="h-4 w-4" aria-hidden="true" />}
                    onClick={() =>
                      setDraft((current) => ({ ...current, rates: [...current.rates, newRate()] }))
                    }
                  >
                    {t('ownership.tariff.form.addBand', 'Add band')}
                  </Button>
                </div>
                {draft.rates.map((rate, index) => (
                  <div
                    key={index}
                    className="grid gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 md:grid-cols-2 xl:grid-cols-5"
                  >
                    <Input
                      label={t('ownership.tariff.form.bandLabel', 'Label')}
                      value={rate.label}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          rates: current.rates.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, label: event.target.value } : item,
                          ),
                        }))
                      }
                    />
                    <Input
                      type="time"
                      label={t('ownership.tariff.form.bandStart', 'Starts')}
                      value={minutesToClock(rate.start_minute)}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          rates: current.rates.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, start_minute: clockToMinutes(event.target.value) }
                              : item,
                          ),
                        }))
                      }
                    />
                    <Input
                      type="time"
                      label={t('ownership.tariff.form.bandEnd', 'Ends')}
                      value={minutesToClock(rate.end_minute)}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          rates: current.rates.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, end_minute: clockToMinutes(event.target.value) }
                              : item,
                          ),
                        }))
                      }
                    />
                    <Input
                      type="number"
                      label={t('ownership.tariff.form.bandPrice', 'Price (minor per Wh)')}
                      value={rate.price_minor_per_wh}
                      min={0}
                      step={0.000001}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          rates: current.rates.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, price_minor_per_wh: Number(event.target.value) }
                              : item,
                          ),
                        }))
                      }
                    />
                    <div className="flex items-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                        disabled={draft.rates.length <= 1}
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            rates: current.rates.filter((_, itemIndex) => itemIndex !== index),
                          }))
                        }
                      >
                        {t('ownership.action.remove', 'Remove')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <Button
                type="submit"
                loading={create.isPending}
                icon={<Plug className="h-4 w-4" aria-hidden="true" />}
              >
                {t('ownership.tariff.form.save', 'Save rate plan')}
              </Button>
              <MutationError error={create.error} />
            </form>
          ) : null}

          <DataTable
            columns={planColumns}
            data={tariffs}
            keyExtractor={(row) => row.id}
            tableId="ownership-tariff-plans"
            emptyMessage={t(
              'ownership.tariff.plans.empty',
              'No plans yet — add the plan you are on today plus any you are considering.',
            )}
          />
          <MutationError error={remove.error} />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.3}>
        <EvidencePanel
          quality={result?.quality}
          evidence={result?.evidence}
          unsupported={[
            t(
              'ownership.tariff.unsupported.future',
              'Future utility price changes, seasonal reindexing, or regulatory riders',
            ),
            t(
              'ownership.tariff.unsupported.home',
              'Household load outside the vehicle — only measured charging sessions are priced',
            ),
          ]}
        />
      </FadeIn>
    </PageContainer>
  );
}
