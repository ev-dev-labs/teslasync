import { type FormEvent, useMemo, useState } from 'react';
import { AlertTriangle, PackagePlus, Trash2, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  useConsumableItems,
  useConsumablesReport,
  useCreateConsumable,
  useCreateConsumableEvent,
  useDeleteConsumable,
} from '@/api/hooks/useOwnership';
import { AlertBanner } from '@/components/feedback';
import { VehicleSelect } from '@/components/forms';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { Badge, Button, DataTable, Input, Select, Text, Textarea } from '@/components/ui';
import type { Column } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import type {
  ConsumableCategory,
  ConsumableEventKind,
  ConsumableItem,
  ConsumableLifecycle,
  DutyCycleStress,
} from '@/types/ownership';
import {
  EvidencePanel,
  MoneyInput,
  MutationError,
  OwnershipPanel,
  SiNumberInput,
  StatGrid,
  VerdictBadge,
} from '../components';
import {
  daysToSeconds,
  formatCurrencyMinor,
  formatPct,
  formatSpan,
  fromDateInput,
  toDateInput,
} from '../formatters';

const CATEGORIES: ConsumableCategory[] = [
  'tire',
  'cabin_filter',
  'hepa_filter',
  'wiper',
  'brake_fluid',
  'coolant',
  'brake_pad',
  'suspension',
  'key_battery',
  'other',
];

/** Mirrors the consumable_events_kind_check database constraint. */
const EVENT_KINDS: ConsumableEventKind[] = ['inspect', 'rotate', 'service', 'replace', 'note'];

const EVENT_KIND_LABELS: Record<ConsumableEventKind, (t: TFunction) => string> = {
  inspect: (t) => t('ownership.consumables.eventKind.inspect', 'Inspection'),
  rotate: (t) => t('ownership.consumables.eventKind.rotate', 'Rotation'),
  service: (t) => t('ownership.consumables.eventKind.service', 'Service'),
  replace: (t) => t('ownership.consumables.eventKind.replace', 'Replacement'),
  note: (t) => t('ownership.consumables.eventKind.note', 'Note'),
};

function healthTone(pct: number): string {
  if (pct >= 60) return 'bg-emerald-400/70';
  if (pct >= 25) return 'bg-amber-400/70';
  return 'bg-rose-400/70';
}

export default function ConsumablesLifecyclePage() {
  const { t } = useTranslation();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const [formOpen, setFormOpen] = useState(false);
  const [eventFor, setEventFor] = useState<number | null>(null);
  const [draft, setDraft] = useState({
    category: 'tire' as ConsumableCategory,
    label: '',
    position: '',
    installed_at: new Date().toISOString(),
    installed_odometer_m: 0,
    rated_life_days: null as number | null,
    rated_life_m: 60000 as number | null,
    cost_minor: 0,
    currency: 'USD',
    notes: '',
  });
  const [eventDraft, setEventDraft] = useState({
    kind: 'inspect' as ConsumableEventKind,
    odometer_m: null as number | null,
    cost_minor: 0,
    note: '',
  });

  usePageTitle(t('ownership.consumables.navTitle', 'Consumables Lifecycle'));

  const reportQuery = useConsumablesReport(vehicleId);
  const itemsQuery = useConsumableItems(vehicleId);
  const create = useCreateConsumable();
  const remove = useDeleteConsumable();
  const createEvent = useCreateConsumableEvent();

  const report = reportQuery.data;
  const lifecycles = useMemo(() => report?.items ?? [], [report?.items]);
  const items = useMemo(() => itemsQuery.data?.items ?? [], [itemsQuery.data?.items]);
  const currency = report?.currency ?? draft.currency;

  const allStress = useMemo(() => {
    const seen = new Map<string, DutyCycleStress>();
    lifecycles.forEach((lifecycle) => {
      (lifecycle.stress_factors ?? []).forEach((factor) => {
        if (!seen.has(factor.code)) seen.set(factor.code, factor);
      });
    });
    return Array.from(seen.values());
  }, [lifecycles]);

  const submitItem = (event: FormEvent) => {
    event.preventDefault();
    if (vehicleId == null) return;
    create.mutate(
      {
        vehicle_id: vehicleId,
        category: draft.category,
        label: draft.label,
        position: draft.position,
        installed_at: draft.installed_at,
        installed_odometer_m: draft.installed_odometer_m,
        rated_life_m: draft.rated_life_m,
        rated_life_s: draft.rated_life_days == null ? null : daysToSeconds(draft.rated_life_days),
        cost_minor: draft.cost_minor,
        currency: draft.currency,
        notes: draft.notes,
      },
      { onSuccess: () => setFormOpen(false) },
    );
  };

  const submitEvent = (event: FormEvent) => {
    event.preventDefault();
    if (eventFor == null) return;
    createEvent.mutate(
      {
        item_id: eventFor,
        kind: eventDraft.kind,
        occurred_at: new Date().toISOString(),
        odometer_m: eventDraft.odometer_m,
        cost_minor: eventDraft.cost_minor,
        note: eventDraft.note,
      },
      {
        onSuccess: () => {
          setEventFor(null);
          setEventDraft({ kind: 'inspect' as ConsumableEventKind, odometer_m: null, cost_minor: 0, note: '' });
        },
      },
    );
  };

  const stressColumns: Column<DutyCycleStress>[] = [
    {
      key: 'label',
      header: t('ownership.consumables.stress.label', 'Duty-cycle factor'),
      render: (row) => (
        <div>
          <Text as="p" variant="label">
            {row.label}
          </Text>
          <Text as="p" variant="caption">
            {row.narrative}
          </Text>
        </div>
      ),
    },
    {
      key: 'observed',
      header: t('ownership.consumables.stress.observed', 'Your vehicle'),
      render: (row) => (
        <span className="tabular-nums">
          {fmtNumber(row.observed_value, 2)} {row.si_unit}
        </span>
      ),
    },
    {
      key: 'baseline',
      header: t('ownership.consumables.stress.baseline', 'Reference'),
      render: (row) => (
        <span className="tabular-nums">
          {fmtNumber(row.baseline_value, 2)} {row.si_unit}
        </span>
      ),
    },
    {
      key: 'multiplier',
      header: t('ownership.consumables.stress.multiplier', 'Wear multiplier'),
      render: (row) => (
        <span
          className={`tabular-nums ${row.multiplier > 1.15 ? 'text-rose-300' : row.multiplier < 0.9 ? 'text-emerald-300' : ''}`}
        >
          ×{fmtNumber(row.multiplier, 2)}
        </span>
      ),
      sortable: true,
    },
  ];

  const itemColumns: Column<ConsumableItem>[] = [
    {
      key: 'label',
      header: t('ownership.consumables.item.label', 'Part'),
      render: (row) => (
        <div>
          <Text as="p" variant="label">
            {row.label}
          </Text>
          <Text as="p" variant="caption">
            {row.category.replace(/_/g, ' ')}
            {row.position ? ` · ${row.position}` : ''}
          </Text>
        </div>
      ),
    },
    {
      key: 'installed',
      header: t('ownership.consumables.item.installed', 'Installed'),
      render: (row) => (
        <div>
          <Text as="p" variant="caption">
            {formatDateTime(row.installed_at)}
          </Text>
          <Text as="p" variant="caption">
            {units.formatDistance(row.installed_odometer_m)}
          </Text>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'rated',
      header: t('ownership.consumables.item.rated', 'Rated life'),
      render: (row) => (
        <div>
          <Text as="p" variant="caption">
            {row.rated_life_m != null ? units.formatDistance(row.rated_life_m) : '—'}
          </Text>
          <Text as="p" variant="caption">
            {row.rated_life_s != null ? formatSpan(row.rated_life_s) : '—'}
          </Text>
        </div>
      ),
    },
    {
      key: 'cost',
      header: t('ownership.consumables.item.cost', 'Cost'),
      render: (row) => (
        <span className="tabular-nums">
          {formatCurrencyMinor(row.cost_minor, row.currency, units.unitPrefs.locale)}
        </span>
      ),
    },
    {
      key: 'retired',
      header: t('ownership.consumables.item.retired', 'Retired'),
      render: (row) =>
        row.retired_at ? (
          <Badge variant="neutral">{formatDateTime(row.retired_at)}</Badge>
        ) : (
          <Badge variant="success">{t('ownership.consumables.item.inService', 'in service')}</Badge>
        ),
    },
    {
      key: 'actions',
      header: t('ownership.action.header', 'Actions'),
      render: (row) => (
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<Wrench className="h-4 w-4" aria-hidden="true" />}
            onClick={() => setEventFor(row.id)}
          >
            {t('ownership.consumables.item.log', 'Log event')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
            onClick={() => remove.mutate(row.id)}
          >
            {t('ownership.action.remove', 'Remove')}
          </Button>
        </div>
      ),
    },
  ];

  const renderLifecycle = (lifecycle: ConsumableLifecycle) => (
    <div
      key={lifecycle.item.id}
      className="rounded-xl border border-white/[0.08] bg-white/[0.025] p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Text as="h3" variant="label">
              {lifecycle.item.label}
            </Text>
            <VerdictBadge value={lifecycle.status} />
            {lifecycle.stress_multiplier > 1.2 ? (
              <Badge variant="warning" dot>
                {t('ownership.consumables.card.harsh', 'harsh duty cycle')}
              </Badge>
            ) : null}
          </div>
          <Text as="p" variant="caption">
            {lifecycle.item.category.replace(/_/g, ' ')}
            {lifecycle.item.position ? ` · ${lifecycle.item.position}` : ''}
          </Text>
        </div>
        <div className="text-right">
          <Text as="p" variant="caption">
            {t('ownership.consumables.card.health', 'Remaining life')}
          </Text>
          <p
            className={`tabular-nums text-lg font-semibold ${
              lifecycle.health_pct >= 60
                ? 'text-emerald-300'
                : lifecycle.health_pct >= 25
                  ? 'text-amber-300'
                  : 'text-rose-300'
            }`}
          >
            {formatPct(lifecycle.health_pct, 0)}
          </p>
        </div>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
        <div
          className={`h-full rounded-full ${healthTone(lifecycle.health_pct)}`}
          style={{ width: `${Math.min(100, Math.max(0, lifecycle.health_pct))}%` }}
        />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div>
          <Text as="p" variant="caption">
            {t('ownership.consumables.card.used', 'Distance on part')}
          </Text>
          <p className="tabular-nums text-sm text-[var(--text-primary)]">
            {units.formatDistance(lifecycle.distance_used_m)}
          </p>
          <Text as="p" variant="caption">
            {lifecycle.distance_life_used_pct != null
              ? t('ownership.consumables.card.ofRated', '{{value}} of rated life', {
                  value: formatPct(lifecycle.distance_life_used_pct, 0),
                })
              : '—'}
          </Text>
        </div>
        <div>
          <Text as="p" variant="caption">
            {t('ownership.consumables.card.adjusted', 'Duty-adjusted life')}
          </Text>
          <p className="tabular-nums text-sm text-[var(--text-primary)]">
            {lifecycle.adjusted_life_m != null
              ? units.formatDistance(lifecycle.adjusted_life_m)
              : '—'}
          </p>
          <Text as="p" variant="caption">
            {t('ownership.consumables.card.multiplier', 'Wear ×{{value}}', {
              value: fmtNumber(lifecycle.stress_multiplier, 2),
            })}
          </Text>
        </div>
        <div>
          <Text as="p" variant="caption">
            {t('ownership.consumables.card.remaining', 'Remaining')}
          </Text>
          <p className="tabular-nums text-sm text-[var(--text-primary)]">
            {lifecycle.remaining_m != null ? units.formatDistance(lifecycle.remaining_m) : '—'}
          </p>
          <Text as="p" variant="caption">
            {lifecycle.remaining_s != null ? formatSpan(lifecycle.remaining_s) : '—'}
          </Text>
        </div>
        <div>
          <Text as="p" variant="caption">
            {t('ownership.consumables.card.replace', 'Projected replacement')}
          </Text>
          <p className="text-sm text-[var(--text-primary)]">
            {lifecycle.projected_replace_at
              ? formatDateTime(lifecycle.projected_replace_at)
              : '—'}
          </p>
          <Text as="p" variant="caption">
            {t('ownership.consumables.card.binding', 'Bound by {{limit}}', {
              limit: lifecycle.binding_limit,
            })}
          </Text>
        </div>
      </div>

      <Text as="p" variant="bodySm">
        {lifecycle.narrative}
      </Text>

      {(lifecycle.events ?? []).length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {(lifecycle.events ?? []).slice(0, 6).map((entry) => (
            <Badge key={entry.id} variant="neutral">
              {EVENT_KIND_LABELS[entry.kind](t)} · {formatDateTime(entry.occurred_at)}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );

  return (
    <PageContainer
      title={t('ownership.consumables.title', 'Consumables & Wear-Parts Lifecycle')}
      subtitle={t(
        'ownership.consumables.subtitle',
        'Rated life assumes an average car. Yours is not average — this projects each part against your measured speed profile, regen share, power draw and climate, then tells you which limit will actually retire it.',
      )}
      loading={reportQuery.isLoading}
      error={reportQuery.error as Error | null}
      actions={<VehicleSelect withIcon />}
    >
      <AlertBanner
        variant="info"
        title={t('ownership.consumables.notice.title', 'Duty cycle beats the manual')}
      >
        {t(
          'ownership.consumables.notice.body',
          'The wear multiplier is derived from your own drives, clamped to a defensible range. It is a projection, not a measurement of physical wear — always inspect before relying on it for a safety-critical part.',
        )}
      </AlertBanner>

      <FadeIn>
        <OwnershipPanel title={t('ownership.consumables.summary.title', 'Fleet wear posture')}>
          <StatGrid
            stats={[
              {
                key: 'due',
                label: t('ownership.consumables.stat.due', 'Due soon'),
                value: fmtNumber(report?.due_soon_count ?? 0, 0),
                tone: (report?.due_soon_count ?? 0) > 0 ? 'warning' : 'default',
              },
              {
                key: 'overdue',
                label: t('ownership.consumables.stat.overdue', 'Overdue'),
                value: fmtNumber(report?.overdue_count ?? 0, 0),
                tone: (report?.overdue_count ?? 0) > 0 ? 'critical' : 'default',
              },
              {
                key: 'next',
                label: t('ownership.consumables.stat.next', 'Next replacement'),
                value: report?.next_replace_at ? formatDateTime(report.next_replace_at) : '—',
              },
              {
                key: 'twelve',
                label: t('ownership.consumables.stat.twelve', 'Next 12 months'),
                value: formatCurrencyMinor(
                  report?.twelve_month_cost_minor,
                  currency,
                  units.unitPrefs.locale,
                ),
              },
              {
                key: 'lifetime',
                label: t('ownership.consumables.stat.lifetime', 'Spent to date'),
                value: formatCurrencyMinor(
                  report?.lifetime_spend_minor,
                  currency,
                  units.unitPrefs.locale,
                ),
              },
              {
                key: 'stress',
                label: t('ownership.consumables.stat.stress', 'Average duty stress'),
                value: `×${fmtNumber(report?.fleet_stress_average ?? 1, 2)}`,
                tone: (report?.fleet_stress_average ?? 1) > 1.2 ? 'warning' : 'default',
                hint: t('ownership.consumables.stat.stressHint', '1.00 is the reference profile'),
              },
            ]}
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <OwnershipPanel
          title={t('ownership.consumables.lifecycles.title', 'Part-by-part projection')}
          empty={lifecycles.length === 0}
          emptyMessage={t(
            'ownership.consumables.lifecycles.empty',
            'Record a part below and its lifecycle projection appears here.',
          )}
          actions={<AlertTriangle className="h-4 w-4 text-amber-300" aria-hidden="true" />}
        >
          <div className="space-y-4">{lifecycles.map(renderLifecycle)}</div>
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.1}>
        <OwnershipPanel
          title={t('ownership.consumables.stress.title', 'Why your wear rate differs')}
          description={t(
            'ownership.consumables.stress.subtitle',
            'Each factor compares a measured trait of your driving against a reference profile. Multipliers compound, then clamp.',
          )}
          empty={allStress.length === 0}
          emptyMessage={t(
            'ownership.consumables.stress.empty',
            'Not enough drives yet to characterise your duty cycle.',
          )}
        >
          <DataTable
            columns={stressColumns}
            data={allStress}
            keyExtractor={(row) => row.code}
            tableId="ownership-consumables-stress"
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.15}>
        <OwnershipPanel
          title={t('ownership.consumables.items.title', 'Part register')}
          empty={items.length === 0 && !formOpen}
          emptyMessage={t('ownership.consumables.items.empty', 'No parts recorded yet.')}
          actions={
            <Button
              variant="secondary"
              size="sm"
              icon={<PackagePlus className="h-4 w-4" aria-hidden="true" />}
              onClick={() => setFormOpen((open) => !open)}
            >
              {formOpen
                ? t('ownership.action.cancel', 'Cancel')
                : t('ownership.consumables.items.add', 'Record part')}
            </Button>
          }
        >
          {formOpen ? (
            <form className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3" onSubmit={submitItem}>
              <Select
                label={t('ownership.consumables.form.category', 'Category')}
                value={draft.category}
                options={CATEGORIES.map((category) => ({
                  value: category,
                  label: category.replace(/_/g, ' '),
                }))}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    category: event.target.value as ConsumableCategory,
                  }))
                }
              />
              <Input
                label={t('ownership.consumables.form.label', 'Part label')}
                value={draft.label}
                required
                maxLength={160}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, label: event.target.value }))
                }
              />
              <Input
                label={t('ownership.consumables.form.position', 'Position')}
                value={draft.position}
                maxLength={64}
                hint={t('ownership.consumables.form.positionHint', 'e.g. front-left')}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, position: event.target.value }))
                }
              />
              <Input
                type="date"
                label={t('ownership.consumables.form.installed', 'Installed on')}
                value={toDateInput(draft.installed_at)}
                required
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    installed_at: fromDateInput(event.target.value),
                  }))
                }
              />
              <SiNumberInput
                label={t('ownership.consumables.form.odometer', 'Odometer at install')}
                value={draft.installed_odometer_m}
                siUnit="m"
                displayHint={units.formatDistance(draft.installed_odometer_m)}
                min={0}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, installed_odometer_m: value ?? 0 }))
                }
              />
              <SiNumberInput
                label={t('ownership.consumables.form.ratedDistance', 'Rated life (distance)')}
                value={draft.rated_life_m}
                siUnit="m"
                displayHint={
                  draft.rated_life_m != null ? units.formatDistance(draft.rated_life_m) : undefined
                }
                min={0}
                onChange={(value) => setDraft((current) => ({ ...current, rated_life_m: value }))}
              />
              <Input
                type="number"
                label={t('ownership.consumables.form.ratedDays', 'Rated life (days)')}
                value={draft.rated_life_days ?? ''}
                min={1}
                hint={t(
                  'ownership.consumables.form.ratedDaysHint',
                  'Filters and fluids age on the calendar too',
                )}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    rated_life_days: event.target.value === '' ? null : Number(event.target.value),
                  }))
                }
              />
              <MoneyInput
                label={t('ownership.consumables.form.cost', 'Replacement cost')}
                value={draft.cost_minor}
                currency={draft.currency}
                locale={units.unitPrefs.locale}
                onChange={(value) => setDraft((current) => ({ ...current, cost_minor: value ?? 0 }))}
              />
              <Input
                label={t('ownership.form.currency', 'ISO currency code')}
                value={draft.currency}
                minLength={3}
                maxLength={3}
                required
                onChange={(event) =>
                  setDraft((current) => ({ ...current, currency: event.target.value.toUpperCase() }))
                }
              />
              <div className="md:col-span-2 xl:col-span-3">
                <Textarea
                  label={t('ownership.consumables.form.notes', 'Notes')}
                  value={draft.notes}
                  rows={2}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, notes: event.target.value }))
                  }
                />
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <Button type="submit" loading={create.isPending} disabled={vehicleId == null}>
                  {t('ownership.consumables.form.save', 'Save part')}
                </Button>
                <MutationError error={create.error} />
              </div>
            </form>
          ) : null}

          {eventFor != null ? (
            <form
              className="mb-6 grid gap-4 rounded-lg border border-white/[0.07] bg-white/[0.02] p-4 md:grid-cols-4"
              onSubmit={submitEvent}
            >
              <Select
                label={t('ownership.consumables.event.kind', 'Event')}
                value={eventDraft.kind}
                options={EVENT_KINDS.map((kind) => ({
                  value: kind,
                  label: EVENT_KIND_LABELS[kind](t),
                }))}
                onChange={(event) =>
                  setEventDraft((current) => ({
                    ...current,
                    kind: event.target.value as ConsumableEventKind,
                  }))
                }
              />
              <SiNumberInput
                label={t('ownership.consumables.event.odometer', 'Odometer')}
                value={eventDraft.odometer_m}
                siUnit="m"
                displayHint={
                  eventDraft.odometer_m != null
                    ? units.formatDistance(eventDraft.odometer_m)
                    : undefined
                }
                min={0}
                onChange={(value) => setEventDraft((current) => ({ ...current, odometer_m: value }))}
              />
              <MoneyInput
                label={t('ownership.consumables.event.cost', 'Cost')}
                value={eventDraft.cost_minor}
                currency={currency}
                locale={units.unitPrefs.locale}
                onChange={(value) =>
                  setEventDraft((current) => ({ ...current, cost_minor: value ?? 0 }))
                }
              />
              <Input
                label={t('ownership.consumables.event.note', 'Note')}
                value={eventDraft.note}
                maxLength={300}
                onChange={(event) =>
                  setEventDraft((current) => ({ ...current, note: event.target.value }))
                }
              />
              <div className="md:col-span-4 flex gap-2">
                <Button type="submit" loading={createEvent.isPending}>
                  {t('ownership.consumables.event.submit', 'Log event')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setEventFor(null)}>
                  {t('ownership.action.cancel', 'Cancel')}
                </Button>
              </div>
              <div className="md:col-span-4">
                <MutationError error={createEvent.error} />
              </div>
            </form>
          ) : null}

          <DataTable
            columns={itemColumns}
            data={items}
            keyExtractor={(row) => row.id}
            tableId="ownership-consumables-items"
            emptyMessage={t('ownership.consumables.items.empty', 'No parts recorded yet.')}
          />
          <MutationError error={remove.error} />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.2}>
        <OwnershipPanel title={t('ownership.consumables.economics.title', 'Wear economics')}>
          <StatGrid
            columns={3}
            stats={[
              {
                key: 'blended',
                label: t('ownership.consumables.econ.blended', 'Blended wear cost'),
                value:
                  report?.blended_cost_per_m_minor != null
                    ? formatCurrencyMinor(
                        Math.round(report.blended_cost_per_m_minor * 1000),
                        currency,
                        units.unitPrefs.locale,
                      )
                    : '—',
                hint: t('ownership.consumables.econ.blendedHint', 'per 1 000 metres driven'),
              },
              {
                key: 'odometer',
                label: t('ownership.consumables.econ.odometer', 'Odometer'),
                value: report?.odometer_m != null ? units.formatDistance(report.odometer_m) : '—',
              },
              {
                key: 'parts',
                label: t('ownership.consumables.econ.parts', 'Parts tracked'),
                value: fmtNumber(lifecycles.length, 0),
              },
            ]}
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.25}>
        <EvidencePanel
          quality={report?.quality}
          evidence={report?.evidence}
          unsupported={[
            t(
              'ownership.consumables.unsupported.physical',
              'Measuring physical wear — no tread-depth or pad-thickness sensor exists on the vehicle',
            ),
            t(
              'ownership.consumables.unsupported.recall',
              'Manufacturer service bulletins and recalls affecting a part',
            ),
          ]}
        />
      </FadeIn>
    </PageContainer>
  );
}
