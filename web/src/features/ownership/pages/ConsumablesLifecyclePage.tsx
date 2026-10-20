import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
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

import { PageLayout } from '@/components/layout';
import { KVList } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { Accordion, Badge, Button, ConfirmDialog, DataTable, Icon, Input, Select, Text, Textarea, IconButton } from '@/components/ui';
import type { Column } from '@/components/ui';
import { useConfirm } from '@/hooks/useConfirm';
import { useDateFormat } from '@/hooks/useDateFormat';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { neonColorMap } from '@/lib/tokens';

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
import { OwnershipBrief } from '../components/operationalbrief-all/OwnershipBrief';
import { specialistDisplay } from '../components/operationalbrief-all/specialistDisplay';
import {
  daysToSeconds,
  formatCurrencyMinor,
  formatPct,
  formatSpan,
  fromDateInput,
  toDateInput,
} from '../formatters';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

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
  if (pct >= 60) return neonColorMap.green.dot;
  if (pct >= 25) return neonColorMap.amber.dot;
  return neonColorMap.red.dot;
}

export default function ConsumablesLifecyclePage() {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const { vehicleId } = useSelectedVehicle();
  const units = useUnits();
  const [formOpen, setFormOpen] = useState(false);
  const partFormId = useId();
  const [eventFor, setEventFor] = useState<ConsumableItem | null>(null);
  const eventHeadingId = useId();
  const eventHeading = useRef<HTMLHeadingElement>(null);
  const eventTrigger = useRef<HTMLButtonElement | null>(null);
  const currentEvent = useRef(eventFor);
  const currentVehicle = useRef(vehicleId);
  currentEvent.current = eventFor;
  currentVehicle.current = vehicleId;
  useEffect(() => {
    if (eventFor && eventFor.vehicle_id !== vehicleId) setEventFor(null);
    else if (eventFor) eventHeading.current?.focus();
  }, [eventFor, vehicleId]);
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
  const currentPartEditor = useRef({ vehicleId, draft, formOpen, revision: 0 });
  if (currentPartEditor.current.vehicleId !== vehicleId
    || currentPartEditor.current.draft !== draft
    || currentPartEditor.current.formOpen !== formOpen) {
    currentPartEditor.current = {
      vehicleId, draft, formOpen, revision: currentPartEditor.current.revision + 1,
    };
  }
  useEffect(() => () => { currentPartEditor.current.revision += 1; }, []);

  usePageTitle(t('ownership.consumables.navTitle', 'Consumables lifecycle'));

  const reportQuery = useConsumablesReport(vehicleId);
  const itemsQuery = useConsumableItems(vehicleId);
  const create = useCreateConsumable();
  const remove = useDeleteConsumable();
  const { confirm, dialogProps } = useConfirm();

  const handleRemove = async (row: ConsumableItem) => {
    const ok = await confirm({
      title: t('ownership.consumables.delete.title', 'Delete this part?'),
      message: t(
        'ownership.consumables.delete.message',
        '“{{name}}” and its service history will be removed permanently. This cannot be undone.',
        { name: row.label },
      ),
      variant: 'danger',
      confirmLabel: t('common.delete', 'Delete'),
    });
    if (ok && currentVehicle.current === row.vehicle_id) remove.mutate(row.id);
  };
  const createEvent = useCreateConsumableEvent();

  const report = reportQuery.data;
  const lifecycles = useMemo(() => report?.items ?? [], [report?.items]);
  const items = useMemo(() => itemsQuery.data?.items ?? [], [itemsQuery.data?.items]);
  const currency = report?.currency ?? draft.currency;
  const eventEligible = eventFor != null && eventFor.vehicle_id === vehicleId
    && items.some((item) => item.id === eventFor.id && item.vehicle_id === vehicleId);

  const cancelEvent = () => {
    setEventFor(null);
    if (eventFor?.vehicle_id === vehicleId && eventTrigger.current?.isConnected) {
      eventTrigger.current.focus();
    }
  };

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
    if (vehicleId == null || !formOpen || create.isPending) return;
    const revision = currentPartEditor.current.revision;
    const submittedVehicleId = vehicleId;
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
      {
        onSuccess: () => {
          const editor = currentPartEditor.current;
          if (editor.revision === revision && editor.formOpen
            && editor.vehicleId === submittedVehicleId) setFormOpen(false);
        },
      },
    );
  };

  const submitEvent = (event: FormEvent) => {
    event.preventDefault();
    if (!eventEligible || eventFor == null || createEvent.isPending) return;
    const target = eventFor;
    createEvent.mutate(
      {
        item_id: target.id,
        kind: eventDraft.kind,
        occurred_at: new Date().toISOString(),
        odometer_m: eventDraft.odometer_m,
        cost_minor: eventDraft.cost_minor,
        note: eventDraft.note,
      },
      {
        onSuccess: () => {
          if (currentEvent.current !== target || currentVehicle.current !== target.vehicle_id) return;
          setEventFor(null);
          setEventDraft({ kind: 'inspect' as ConsumableEventKind, odometer_m: null, cost_minor: 0, note: '' });
          if (eventTrigger.current?.isConnected) eventTrigger.current.focus();
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
      align: 'right',
      header: t('ownership.consumables.stress.observed', 'Your vehicle'),
      render: (row) => (
        <span className="tabular-nums">
          {fmtNumber(row.observed_value)} {row.si_unit}
        </span>
      ),
    },
    {
      key: 'baseline',
      align: 'right',
      header: t('ownership.consumables.stress.baseline', 'Reference'),
      render: (row) => (
        <span className="tabular-nums">
          {fmtNumber(row.baseline_value)} {row.si_unit}
        </span>
      ),
    },
    {
      key: 'multiplier',
      align: 'right',
      header: t('ownership.consumables.stress.multiplier', 'Wear multiplier'),
      render: (row) => (
        <Text variant="bodySm"
          className={`tabular-nums ${row.multiplier > 1.15 ? neonColorMap.red.text : row.multiplier < 0.9 ? neonColorMap.green.text : ''}`}
        >
          ×{fmtNumber(row.multiplier)}
        </Text>
      ),
      sortable: true,
    },
  ];

  const renderItemActions = (row: ConsumableItem) => (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="secondary" size="sm" wrapLabel
        icon={<Icon icon={Wrench} size="md" />}
        disabled={createEvent.isPending || row.vehicle_id !== vehicleId}
        onClick={(event) => {
          eventTrigger.current = event.currentTarget;
          setEventFor(row);
        }}
      >
        {t('ownership.consumables.item.log', 'Log event')}
      </Button>
      {/* confirm-step: handleRemove asks in the shared ConfirmDialog before removing */}
      <IconButton icon={<Icon icon={Trash2} size="md" />} label={t('ownership.action.remove', 'Remove')} onClick={() => void handleRemove(row)} busy={remove.isPending && remove.variables === row.id} />
    </div>
  );

  const itemColumns: Column<ConsumableItem>[] = [
    {
      key: 'label',
      header: t('ownership.consumables.item.label', 'Part'),
      filterValue: (row) => row.id,
      filterValueLabel: (_value, row) => row.label,
      render: (row) => (
        <div className="min-w-0 break-words">
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
      filterValue: (row) => row.installed_at,
      filterValueLabel: (_value, row) => formatDateTime(row.installed_at),
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
      align: 'right',
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
      align: 'right',
      filterValue: (row) => `${row.currency}:${row.cost_minor}`,
      filterValueLabel: (_value, row) => formatCurrencyMinor(row.cost_minor, row.currency, units.unitPrefs.locale),
      header: t('ownership.consumables.item.cost', 'Cost'),
      render: (row) => (
        <span className="tabular-nums">
          {formatCurrencyMinor(row.cost_minor, row.currency, units.unitPrefs.locale)}
        </span>
      ),
    },
    {
      key: 'retired',
      filterValue: (row) => row.retired_at,
      filterValueLabel: (_value, row) => row.retired_at
        ? formatDateTime(row.retired_at)
        : t('ownership.consumables.item.inService', 'in service'),
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
      render: renderItemActions,
    },
  ];

  const renderLifecycle = (lifecycle: ConsumableLifecycle) => (
    <div
      key={lifecycle.item.id}
      className="min-w-0 rounded-panel border border-[var(--border-default)] bg-[var(--surface-1)] p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Text as="h3" variant="label" className="min-w-0 break-words">
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
        <div className="text-end">
          <Text as="p" variant="caption">
            {t('ownership.consumables.card.health', 'Remaining life')}
          </Text>
          <Text as="p" variant="metricValue" className="tabular-nums">
            {formatPct(lifecycle.health_pct)}
          </Text>
        </div>
      </div>

      <div aria-hidden="true" className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
        {Number.isFinite(lifecycle.health_pct) && <div
          className={`h-full rounded-full ${healthTone(lifecycle.health_pct)}`}
          style={{ width: `${Math.min(100, Math.max(0, lifecycle.health_pct))}%` }}
        />}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div>
          <Text as="p" variant="caption">
            {t('ownership.consumables.card.used', 'Distance on part')}
          </Text>
          <Text as="p" variant="bodySm" className="tabular-nums">
            {units.formatDistance(lifecycle.distance_used_m)}
          </Text>
          <Text as="p" variant="caption">
            {lifecycle.distance_life_used_pct != null
              ? t('ownership.consumables.card.ofRated', '{{value}} of rated life', {
                  value: formatPct(lifecycle.distance_life_used_pct),
                })
              : '—'}
          </Text>
        </div>
        <div>
          <Text as="p" variant="caption">
            {t('ownership.consumables.card.adjusted', 'Duty-adjusted life')}
          </Text>
          <Text as="p" variant="bodySm" className="tabular-nums">
            {lifecycle.adjusted_life_m != null
              ? units.formatDistance(lifecycle.adjusted_life_m)
              : '—'}
          </Text>
          <Text as="p" variant="caption">
            {t('ownership.consumables.card.multiplier', 'Wear ×{{value}}', {
              value: fmtNumber(lifecycle.stress_multiplier),
            })}
          </Text>
        </div>
        <div>
          <Text as="p" variant="caption">
            {t('ownership.consumables.card.remaining', 'Remaining')}
          </Text>
          <Text as="p" variant="bodySm" className="tabular-nums">
            {lifecycle.remaining_m != null ? units.formatDistance(lifecycle.remaining_m) : '—'}
          </Text>
          <Text as="p" variant="caption">
            {lifecycle.remaining_s != null ? formatSpan(lifecycle.remaining_s) : '—'}
          </Text>
        </div>
        <div>
          <Text as="p" variant="caption">
            {t('ownership.consumables.card.replace', 'Projected replacement')}
          </Text>
          <Text as="p" variant="bodySm">
            {lifecycle.projected_replace_at
              ? formatDateTime(lifecycle.projected_replace_at)
              : '—'}
          </Text>
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

      <div className="mt-3">
        <StatGrid
          columns={2}
          stats={[
            {
              key: 'replacementCost',
              label: t('ownership.consumables.form.cost', 'Replacement cost'),
              value: formatCurrencyMinor(
                lifecycle.replacement_cost_minor,
                lifecycle.item.currency,
                units.unitPrefs.locale,
              ),
            },
            {
              key: 'wearCost',
              label: t('ownership.consumables.card.wearCost', 'Part wear cost'),
              value: lifecycle.cost_per_m_minor != null
                ? formatCurrencyMinor(
                    Math.round(lifecycle.cost_per_m_minor * 1000),
                    lifecycle.item.currency,
                    units.unitPrefs.locale,
                  )
                : '—',
              hint: t('ownership.consumables.econ.blendedHint', 'per 1 000 metres driven'),
            },
          ]}
        />
      </div>

      {(lifecycle.events ?? []).length > 0 ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-1">
            {(lifecycle.events ?? []).slice(0, 6).map((entry) => (
              <Badge key={entry.id} variant="neutral">
                {EVENT_KIND_LABELS[entry.kind](t)} · {formatDateTime(entry.occurred_at)}
              </Badge>
            ))}
          </div>
          <Accordion title={t('ownership.consumables.card.history', 'Service history ({{count}} events)', {
            count: (lifecycle.events ?? []).length,
          })}>
            <div className="space-y-4">
              {(lifecycle.events ?? []).map((entry) => (
                <div key={entry.id} className="min-w-0 space-y-2">
                  <Text as="p" variant="label">
                    {EVENT_KIND_LABELS[entry.kind](t)} · {formatDateTime(entry.occurred_at)}
                  </Text>
                  <KVList layout="responsive" items={[
                    {
                      label: t('ownership.consumables.event.odometer', 'Odometer'),
                      value: entry.odometer_m != null ? units.formatDistance(entry.odometer_m) : '—',
                    },
                    {
                      label: t('ownership.consumables.event.cost', 'Cost'),
                      value: formatCurrencyMinor(entry.cost_minor, lifecycle.item.currency, units.unitPrefs.locale),
                    },
                    {
                      label: t('ownership.consumables.event.note', 'Note'),
                      value: entry.note || '—',
                    },
                  ]} />
                </div>
              ))}
            </div>
          </Accordion>
        </div>
      ) : null}
    </div>
  );

  return (
    <PageLayout
      title={t('ownership.consumables.title', 'Consumables & wear-parts lifecycle')}
      subtitle={t(
        'ownership.consumables.subtitle',
        'Rated life assumes an average car. Yours is not average — this projects each part against your measured speed profile, regen share, power draw and climate, then tells you which limit will actually retire it.',
      )}
      query={[reportQuery, itemsQuery]}
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
        <OwnershipPanel title={t('ownership.consumables.summary.title', 'Fleet wear posture')}
          source={reportQuery} sourceEnabled={vehicleId != null} empty={!report} preserveSummary>
          <OwnershipBrief
            title={t('ownership.consumables.brief.title', 'Projected wear and replacement costs')}
            description={t('ownership.consumables.notice.body', 'The wear multiplier is derived from your own drives, clamped to a defensible range. It is a projection, not a measurement of physical wear — always inspect before relying on it for a safety-critical part.')}
            scope={t('ownership.consumables.brief.scope', 'Selected vehicle and recorded parts; costs and replacement dates are projections')}
            source={reportQuery} enabled={vehicleId != null}
            observedAt={report?.as_of}
            metrics={[
              {
                occurrenceId: 'due', metricId: 'count',
                label: t('ownership.consumables.stat.due', 'Due soon'),
                rawValue: report?.due_soon_count,
                display: specialistDisplay(fmtInt),
                tone: (report?.due_soon_count ?? 0) > 0 ? 'warning' : 'default',
              },
              {
                occurrenceId: 'overdue', metricId: 'count',
                label: t('ownership.consumables.stat.overdue', 'Overdue'),
                rawValue: report?.overdue_count,
                display: specialistDisplay(fmtInt),
                tone: (report?.overdue_count ?? 0) > 0 ? 'critical' : 'default',
              },
              {
                occurrenceId: 'next', metricId: 'text',
                label: t('ownership.consumables.stat.next', 'Next replacement'),
                rawValue: report?.next_replace_at ? formatDateTime(report.next_replace_at) : null,
              },
              {
                occurrenceId: 'twelve', metricId: 'currency',
                label: t('ownership.consumables.stat.twelve', 'Next 12 months'),
                rawValue: report?.twelve_month_cost_minor,
                display: specialistDisplay((raw) => formatCurrencyMinor(raw, currency, units.unitPrefs.locale)),
              },
              {
                occurrenceId: 'lifetime', metricId: 'currency',
                label: t('ownership.consumables.stat.lifetime', 'Spent to date'),
                rawValue: report?.lifetime_spend_minor,
                display: specialistDisplay((raw) => formatCurrencyMinor(raw, currency, units.unitPrefs.locale)),
              },
              {
                occurrenceId: 'stress', metricId: 'multiplier',
                label: t('ownership.consumables.stat.stress', 'Average duty stress'),
                rawValue: report?.fleet_stress_average,
                display: specialistDisplay((raw) => `×${fmtNumber(raw)}`),
                tone: (report?.fleet_stress_average ?? 1) > 1.2 ? 'warning' : 'default',
                context: t('ownership.consumables.stat.stressHint', '1.00 is the reference profile'),
              },
            ]}
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.05}>
        <OwnershipPanel
          title={t('ownership.consumables.lifecycles.title', 'Part-by-part projection')}
          source={reportQuery}
          sourceEnabled={vehicleId != null}
          empty={lifecycles.length === 0}
          emptyMessage={t(
            'ownership.consumables.lifecycles.empty',
            'Record a part below and its lifecycle projection appears here.',
          )}
          actions={<Icon icon={AlertTriangle} size="md" className={neonColorMap.amber.text} />}
        >
          <div className="space-y-4">{lifecycles.map(renderLifecycle)}</div>
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.1}>
        <OwnershipPanel
          title={t('ownership.consumables.stress.title', 'Why your wear rate differs')}
          source={reportQuery}
          sourceEnabled={vehicleId != null}
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
            variant="embedded"
            columns={stressColumns}
            mobilePresentation={{
              roles: { label: 'title', observed: 'primary', baseline: 'meta', multiplier: 'meta' },
              displayValue: (row, key) => {
                if (key === 'label') return row.label;
                if (key === 'observed') return `${fmtNumber(row.observed_value)} ${row.si_unit}`;
                if (key === 'baseline') return `${fmtNumber(row.baseline_value)} ${row.si_unit}`;
                if (key === 'multiplier') return `×${fmtNumber(row.multiplier)}`;
                return null;
              },
            }}
            data={allStress}
            keyExtractor={(row) => row.code}
            tableId="ownership-consumables-stress"
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.15}>
        <OwnershipPanel
          title={t('ownership.consumables.items.title', 'Part register')}
          source={itemsQuery}
          sourceEnabled={vehicleId != null}
          editing={formOpen || eventFor != null}
          empty={items.length === 0 && !formOpen}
          emptyMessage={t('ownership.consumables.items.empty', 'No parts recorded yet.')}
          actions={
            <Button
              variant="secondary"
              size="sm"
              icon={<Icon icon={PackagePlus} size="md" />}
              wrapLabel
              aria-expanded={formOpen}
              aria-controls={partFormId}
              onClick={() => {
                currentPartEditor.current.revision += 1;
                setFormOpen((open) => !open);
              }}
            >
              {formOpen
                ? t('ownership.action.cancel', 'Cancel')
                : t('ownership.consumables.items.add', 'Record part')}
            </Button>
          }
        >
          {formOpen ? (
            <form id={partFormId} className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3" onSubmit={submitItem}>
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
              aria-labelledby={eventHeadingId}
              className="mb-6 grid min-w-0 gap-4 rounded-panel border border-[var(--border-default)] bg-[var(--surface-2)] p-4 md:grid-cols-4"
              onSubmit={submitEvent}
            >
              <h3 id={eventHeadingId} ref={eventHeading} tabIndex={-1} className="min-w-0 break-words md:col-span-4">
                <Text variant="subhead">{t('ownership.consumables.item.log', 'Log event')}{' — '}{eventFor.label}</Text>
              </h3>
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
                currency={eventFor.currency}
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
              <div className="md:col-span-4 flex flex-wrap gap-2">
                <Button type="submit" loading={createEvent.isPending} disabled={!eventEligible}>
                  {t('ownership.consumables.event.submit', 'Log event')}
                </Button>
                <Button type="button" variant="ghost" onClick={cancelEvent}>
                  {t('ownership.action.cancel', 'Cancel')}
                </Button>
              </div>
              <div className="md:col-span-4">
                <MutationError error={createEvent.error} />
              </div>
            </form>
          ) : null}

          <DataTable
            variant="embedded"
            columns={itemColumns}
            enableValueFilters
            rowLabel={(row) => row.label}
            mobilePresentation={{
              roles: { label: 'title', cost: 'primary', installed: 'meta', rated: 'meta', retired: 'badge', actions: 'hidden' },
              displayValue: (row, key) => {
                if (key === 'label') return row.label;
                if (key === 'cost') return formatCurrencyMinor(row.cost_minor, row.currency, units.unitPrefs.locale);
                if (key === 'installed') return formatDateTime(row.installed_at);
                if (key === 'rated') return row.rated_life_m != null ? units.formatDistance(row.rated_life_m) : '—';
                if (key === 'retired') return row.retired_at
                  ? formatDateTime(row.retired_at) : t('ownership.consumables.item.inService', 'in service');
                return null;
              },
              inlineActions: renderItemActions,
            }}
            data={items}
            keyExtractor={(row) => row.id}
            tableId="ownership-consumables-items"
            emptyMessage={t('ownership.consumables.items.empty', 'No parts recorded yet.')}
          />
          <MutationError error={remove.error} />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.2}>
        <OwnershipPanel title={t('ownership.consumables.economics.title', 'Wear economics')}
          source={reportQuery} sourceEnabled={vehicleId != null} empty={!report} preserveSummary>
          <OwnershipBrief
            title={t('ownership.consumables.economicsBrief.title', 'Blended wear cost and recorded distance')}
            description={t('ownership.consumables.economicsBrief.description', 'Blended wear cost retains the recorded currency per 1 000 metres, independently of the odometer display unit.')}
            scope={t('ownership.consumables.brief.scope', 'Selected vehicle and recorded parts; costs and replacement dates are projections')}
            source={reportQuery} enabled={vehicleId != null}
            observedAt={report?.as_of}
            metrics={[
              {
                occurrenceId: 'blended', metricId: 'rate',
                label: t('ownership.consumables.econ.blended', 'Blended wear cost'),
                rawValue: report?.blended_cost_per_m_minor,
                display: specialistDisplay((raw) => formatCurrencyMinor(Math.round(raw * 1000), currency, units.unitPrefs.locale)),
                context: t('ownership.consumables.econ.blendedHint', 'per 1 000 metres driven'),
              },
              {
                occurrenceId: 'odometer', metricId: 'distance',
                label: t('ownership.consumables.econ.odometer', 'Odometer'),
                rawValue: report?.odometer_m,
                display: specialistDisplay(units.formatDistance),
              },
              {
                occurrenceId: 'parts', metricId: 'count',
                label: t('ownership.consumables.econ.parts', 'Parts tracked'),
                rawValue: report ? lifecycles.length : null,
                display: specialistDisplay(fmtInt),
              },
            ]}
          />
        </OwnershipPanel>
      </FadeIn>

      <FadeIn delay={0.25}>
        <EvidencePanel
          source={reportQuery}
          sourceEnabled={vehicleId != null}
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
      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </PageLayout>
  );
}
