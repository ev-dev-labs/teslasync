import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  NotebookPen, Briefcase, Building2, Heart, HelpCircle, Sparkles, Receipt,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import {
  GlassPanel, PanelTitle, Text, Button, Select, Input, HelpTooltip,
  DataTable, type Column,
} from '@/components/ui';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { MetricCard, MetricBar } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';

import { useDrives } from '@/api/hooks/useDriving';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateShort } from '@/lib/dateFormat';
import { convertDistanceToSI } from '@/lib/unitConversion';
import { chartTokens } from '@/lib/tokens';
import type { Drive } from '@/types/driving';

import {
  TRIP_CATEGORIES,
  driveAmount,
  isTripCategory,
  suggestByCorridor,
  summarizeLogbook,
  type TripCategory,
} from '../lib/tripLogbook';
import { useTripLogbook } from '../hooks/useTripLogbook';

/* ------------------------------------------------------------------ */
/*  Category presentation                                             */
/* ------------------------------------------------------------------ */

const CATEGORY_META: Record<TripCategory, {
  i18nKey: string;
  fallback: string;
  icon: typeof Briefcase;
  cardColor: 'blue' | 'cyan' | 'purple';
  barColor: string;
}> = {
  business: { i18nKey: 'logbook.business', fallback: 'Business', icon: Briefcase, cardColor: 'blue',   barColor: chartTokens.series[0] },
  commute:  { i18nKey: 'logbook.commute',  fallback: 'Commute',  icon: Building2, cardColor: 'cyan',   barColor: chartTokens.series[5] },
  personal: { i18nKey: 'logbook.personal', fallback: 'Personal', icon: Heart,     cardColor: 'purple', barColor: chartTokens.series[4] },
};

type CategoryFilter = 'all' | 'unclassified' | TripCategory;

interface LogbookRow {
  id: number;
  /** ISO start timestamp — sortable key and export source. */
  date: string;
  route: string;
  /** SI meters — sortable key; rendered via the distance formatter. */
  distanceM: number;
  category: TripCategory | null;
  amount: number;
}

/** km per statute mile, derived from the shared conversion lib. */
const KM_PER_MILE = convertDistanceToSI(1, 'mi') / 1000;

export default function TripLogbookPage() {
  const { t } = useTranslation();
  usePageTitle(t('logbook.title', 'Trip Logbook'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const { formatDistance, unitPrefs } = useUnits();
  const { formatCurrency } = useFormatting();

  const { start, end, setRange } = useRangeState({
    persistKey: 'trip-logbook.range',
    defaultPresetId: 'all',
  });

  const drivesQuery = useDrives(vehicleIdStr);
  const allDrives = useMemo<Drive[]>(() => drivesQuery.data ?? [], [drivesQuery.data]);

  const { categories, ratesPerKm, setCategory, setCategories, setRatePerKm } = useTripLogbook();
  const [filter, setFilter] = useState<CategoryFilter>('all');

  // Narrow to the picked window so the KPI band, shares, and table agree.
  const drives = useMemo<Drive[]>(() => {
    if (!allDrives.length) return [];
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return allDrives.filter((d) => {
      if (!d.startTs) return false;
      const ts = new Date(d.startTs).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }, [allDrives, start, end]);

  const summary = useMemo(
    () => summarizeLogbook(drives, categories, ratesPerKm),
    [drives, categories, ratesPerKm],
  );

  // Corridors learn from every drive of the vehicle (classified history
  // outside the window still teaches routes), but suggestions only apply to
  // drives visible in the current range so one click never mutates rows the
  // user can't see.
  const suggestions = useMemo(() => {
    const all = suggestByCorridor(allDrives, categories);
    if (all.length === 0) return all;
    const visible = new Set(drives.map((d) => d.id));
    return all.filter((s) => visible.has(s.driveId));
  }, [allDrives, drives, categories]);

  const rows = useMemo<LogbookRow[]>(() => {
    const filtered = drives.filter((d) => {
      if (filter === 'all') return true;
      const cat = categories[d.id] ?? null;
      return filter === 'unclassified' ? cat == null : cat === filter;
    });
    return filtered.map((d) => {
      const cat = categories[d.id] ?? null;
      return {
        id: d.id,
        date: d.startTs,
        route: `${d.startAddress ?? '—'} → ${d.endAddress ?? '—'}`,
        distanceM: d.distanceM,
        category: cat,
        amount: cat != null ? driveAmount(d.distanceM, cat, ratesPerKm) : 0,
      };
    });
  }, [drives, categories, ratesPerKm, filter]);

  const categoryOptions = useMemo(
    () => [
      { value: '', label: t('logbook.unclassified', 'Unclassified') },
      ...TRIP_CATEGORIES.map((c) => ({ value: c, label: t(CATEGORY_META[c].i18nKey, CATEGORY_META[c].fallback) })),
    ],
    [t],
  );

  const columns = useMemo<Column<LogbookRow>[]>(() => [
    {
      key: 'date',
      header: t('logbook.date', 'Date'),
      sortable: true,
      render: (r) => <Text variant="bodySm">{formatDateShort(r.date)}</Text>,
    },
    {
      key: 'route',
      header: t('logbook.route', 'Route'),
      render: (r) => (
        <Text variant="bodySm" className="block max-w-[16rem] truncate" title={r.route}>
          {r.route}
        </Text>
      ),
    },
    {
      key: 'distanceM',
      header: t('logbook.distance', 'Distance'),
      align: 'right',
      sortable: true,
      render: (r) => (
        <Text variant="body" className="font-mono tabular-nums">
          {formatDistance(r.distanceM, { precision: 1 })}
        </Text>
      ),
    },
    {
      key: 'category',
      header: t('logbook.category', 'Category'),
      render: (r) => (
        <Select
          aria-label={t('logbook.categoryFor', 'Category for drive on {{date}}', { date: formatDateShort(r.date) })}
          value={r.category ?? ''}
          onChange={(e) => setCategory(r.id, isTripCategory(e.target.value) ? e.target.value : null)}
          options={categoryOptions}
        />
      ),
    },
    {
      key: 'amount',
      header: t('logbook.amount', 'Amount'),
      align: 'right',
      sortable: true,
      render: (r) =>
        r.category != null && r.amount > 0 ? (
          <Text variant="body" className="font-mono tabular-nums text-emerald-300">
            {formatCurrency(r.amount)}
          </Text>
        ) : (
          <Text variant="caption">—</Text>
        ),
    },
  ], [t, formatDistance, formatCurrency, setCategory, categoryOptions]);

  /* ---- Rate editing (display in the user's distance unit) ---- */
  const perMile = unitPrefs.distance === 'mi';
  const rateUnitLabel = perMile
    ? t('logbook.perMile', '/ mi')
    : t('logbook.perKm', '/ km');

  function displayRate(cat: TripCategory): number {
    const perKm = ratesPerKm[cat];
    return Math.round((perMile ? perKm * KM_PER_MILE : perKm) * 10_000) / 10_000;
  }

  function handleRateChange(cat: TripCategory, text: string): void {
    if (text === '') return;
    const n = Number(text);
    if (!Number.isFinite(n) || n < 0) return;
    setRatePerKm(cat, perMile ? n / KM_PER_MILE : n);
  }

  const isLoading = drivesQuery.isLoading;
  const isError = drivesQuery.isError;

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('logbook.title', 'Trip Logbook')} />;
  }

  return (
    <PageContainer
      title={t('logbook.title', 'Trip Logbook')}
      subtitle={t('logbook.subtitle', 'Classify drives for tax deduction and expense reimbursement')}
      query={drivesQuery}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            align="end"
            triggerTestId="trip-logbook-range"
          />
        </div>
      }
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('logbook.kpis', 'Logbook summary metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={96} className="rounded-xl" />
            ))
          ) : (
            <>
              {TRIP_CATEGORIES.map((cat) => {
                const meta = CATEGORY_META[cat];
                const totals = summary.perCategory[cat];
                const Icon = meta.icon;
                return (
                  <MetricCard
                    key={cat}
                    label={t(meta.i18nKey, meta.fallback)}
                    value={formatDistance(totals.distanceM, { precision: 1 })}
                    subtitle={
                      totals.amount > 0
                        ? formatCurrency(totals.amount)
                        : t('logbook.driveCount', '{{count}} drives', { count: totals.count })
                    }
                    icon={<Icon className="h-5 w-5" />}
                    color={meta.cardColor}
                  />
                );
              })}
              <MetricCard
                label={t('logbook.unclassified', 'Unclassified')}
                value={summary.unclassified.count}
                subtitle={t('logbook.ofTotal', 'of {{total}} drives', { total: summary.totalCount })}
                icon={<HelpCircle className="h-5 w-5" />}
                color="amber"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Reimbursement (1/3) + drives table (2/3) */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <GlassPanel className="p-4 sm:p-5 xl:col-span-1">
            <PanelTitle className="mb-1 flex items-center gap-2">
              <Receipt className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('logbook.reimbursement', 'Reimbursement')}
              <HelpTooltip
                size="sm"
                i18nKey="help.tripLogbook.body"
                defaultValue="Set the rate your employer or tax authority reimburses per distance driven in each category. Rates are stored per kilometre and converted to your display unit; amounts are rate × drive distance."
                ariaLabel={t('help.tripLogbook.iconLabel', 'More info about reimbursement rates')}
              />
            </PanelTitle>

            <div className="mb-4 flex items-baseline gap-2">
              <Text className="font-mono text-2xl tabular-nums text-emerald-300">
                {formatCurrency(summary.totalAmount)}
              </Text>
              <Text variant="caption">{t('logbook.inPeriod', 'reimbursable in this period')}</Text>
            </div>

            <div className="flex flex-col gap-4">
              {TRIP_CATEGORIES.map((cat) => {
                const meta = CATEGORY_META[cat];
                const totals = summary.perCategory[cat];
                return (
                  <div key={cat} className="flex flex-col gap-2">
                    <MetricBar
                      label={t(meta.i18nKey, meta.fallback)}
                      value={totals.distanceM}
                      max={Math.max(summary.totalDistanceM, 1)}
                      color={meta.barColor}
                      sublabel={formatDistance(totals.distanceM, { precision: 1 })}
                    />
                    <Input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={0.01}
                      aria-label={t('logbook.rateFor', 'Reimbursement rate for {{category}}', {
                        category: t(meta.i18nKey, meta.fallback),
                      })}
                      // Uncontrolled with a unit-scoped key: a controlled value
                      // would snap "0." back to "0" mid-keystroke. The store
                      // updates live via onChange; the key remounts the field
                      // with a re-converted default when the display unit flips.
                      key={`${cat}-${unitPrefs.distance}`}
                      defaultValue={displayRate(cat)}
                      onChange={(e) => handleRateChange(cat, e.target.value)}
                      suffix={<span className="whitespace-nowrap">{rateUnitLabel}</span>}
                      className="max-w-[10rem]"
                    />
                  </div>
                );
              })}
            </div>
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <PanelTitle className="flex items-center gap-2">
                <NotebookPen className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('logbook.drives', 'Drives')}
              </PanelTitle>
              <Select
                aria-label={t('logbook.filter', 'Filter by category')}
                value={filter}
                onChange={(e) => setFilter(e.target.value as CategoryFilter)}
                options={[
                  { value: 'all', label: t('logbook.filterAll', 'All categories') },
                  { value: 'unclassified', label: t('logbook.unclassified', 'Unclassified') },
                  ...TRIP_CATEGORIES.map((c) => ({
                    value: c,
                    label: t(CATEGORY_META[c].i18nKey, CATEGORY_META[c].fallback),
                  })),
                ]}
              />
            </div>

            {suggestions.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
                  <Text variant="bodySm">
                    {t(
                      'logbook.suggestionBanner',
                      '{{count}} unclassified drives match routes you have already classified.',
                      { count: suggestions.length },
                    )}
                  </Text>
                </div>
                <Button variant="secondary" onClick={() => setCategories(suggestions)}>
                  {t('logbook.applySuggestions', 'Apply suggestions')}
                </Button>
              </div>
            )}

            {isError ? (
              <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
            ) : isLoading ? (
              <Skeleton height={320} />
            ) : drives.length === 0 ? (
              <EmptyState
                icon={<NotebookPen className="h-8 w-8" />}
                message={t('logbook.noDrives', 'No drives in this period yet.')}
                actionTo={{ label: t('logbook.browseDrives', 'Browse drives'), to: '/drives' }}
              />
            ) : (
              <DataTable
                tableId="driving:trip-logbook"
                columns={columns}
                data={rows}
                keyExtractor={(r) => r.id}
                emptyMessage={t('logbook.noneInFilter', 'No drives in this category yet.')}
                pagination
                exportable
                exportFilename="trip-logbook"
                exportRow={(r) => ({
                  // Keys mirror the column keys — the CSV export reads
                  // exportRow(row)[column.key] under each visible column header.
                  date: r.date.slice(0, 10),
                  route: r.route,
                  distanceM: formatDistance(r.distanceM, { precision: 1 }),
                  category: r.category ?? '',
                  amount: r.amount > 0 ? Math.round(r.amount * 100) / 100 : 0,
                })}
              />
            )}
          </GlassPanel>
        </section>
      </FadeIn>
    </PageContainer>
  );
}
