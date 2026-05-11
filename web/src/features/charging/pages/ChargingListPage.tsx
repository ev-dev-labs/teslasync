import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { QueryError } from '@/components/feedback';
import { RangePicker } from '@/components/forms';
import { SavedViewMenu } from '@/components/data-display';
import { DataFreshnessAuto } from '@/components/data-display';
import { useSavedViewUrl } from '@/hooks/useSavedViewUrl';
import { useUrlBatch, useUrlBoolean, useUrlEnum, useUrlNumber, useUrlString } from '@/hooks/useUrlState';
import { useChargingSessionsPaginated, useChargingOptimizer, useBulkDeleteCharging } from '@/api/hooks/useCharging';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { PullToRefresh } from '@/components/mobile';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import {
  HeroGauges,
  QuickMetrics,
  ChartsRow,
  AcDcStatsPanel,
  BatteryLevelChart,
  DetailedStatistics,
  EfficiencyPanel,
  ChargerSpecsPanel,
  OptimizerSection,
  SessionListSection,
  computeStats,
  computeChargerBreakdown,
  computeEnergyTrend,
  computeCostByType,
  computeStartLevelDist,
  computeAcDcBreakdown,
  computeEfficiencyStats,
  computeChargerSpecs,
  computeEnhancedStats,
  filterAndSortSessions,
  type SortKey,
  type ChargerFilter,
} from '../components/charging-list';

/* URL state allowed values (stable refs for useUrlEnum). */
const SORT_KEYS = ['date', 'energy', 'cost', 'duration', 'power'] as const;
const CHARGER_FILTERS = ['all', 'supercharger', 'dc', 'home'] as const;

export default function ChargingListPage() {
  const { t } = useTranslation();
  usePageTitle(t('charging.list.title', 'Charging Sessions'));
  const savedView = useSavedViewUrl();

  const { unitPrefs } = useUnits();
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);
  const distanceUnit = unitPrefs.distance;
  // Phase 40 / Prompt 16: header VehiclePicker is the source of truth.
  // Alert drillthrough URLs (?vehicle_id=...) flow into the same store via
  // useSelectedVehicle, so prior alert-context handling is no longer needed.
  const { vehicleId } = useSelectedVehicle();

  const [sortBy, setSortBy] = useUrlEnum<SortKey>('sort', SORT_KEYS, 'date');
  const [sortDesc, setSortDesc] = useUrlBoolean('sort_desc', true);
  const [chargerFilter, setChargerFilter] = useUrlEnum<ChargerFilter>('charger', CHARGER_FILTERS, 'all');
  const [searchQuery, setSearchQuery] = useUrlString('q', '');
  const [page, setPage] = useUrlNumber('page', 1);
  const [pageSize, setPageSize] = useUrlNumber('size', 50);
  const defaultStartDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 365);
    return d.toISOString().split('T')[0];
  }, []);
  const defaultEndDate = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [startDate] = useUrlString('from', defaultStartDate);
  const [endDate] = useUrlString('to', defaultEndDate);
  const setRangeBatch = useUrlBatch();

  const chargingQuery = useChargingSessionsPaginated(vehicleId, {
    limit: pageSize,
    offset: (page - 1) * pageSize,
    start: startDate,
    end: endDate,
  });
  const {
    data: sessions,
    isLoading,
    error,
    refetch,
  } = chargingQuery;
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : null;
  const { data: optimizer } = useChargingOptimizer(vehicleIdStr);

  // ── Computed data ────────────────────────────────────────────────────
  const stats = useMemo(() => (sessions ? computeStats(sessions) : null), [sessions]);

  const chargerLabels: Record<string, string> = useMemo(() => ({
    supercharger: t('charging.chargerTypes.supercharger', 'Supercharger'),
    dc: t('charging.chargerTypes.dc', 'DC Fast'),
    home: t('charging.chargerTypes.home', 'Home / AC'),
  }), [t]);

  const chargerBreakdown = useMemo(() => (stats ? computeChargerBreakdown(stats, t) : []), [stats, t]);
  const energyTrend = useMemo(() => (sessions ? computeEnergyTrend(sessions) : []), [sessions]);
  const costByType = useMemo(() => (sessions ? computeCostByType(sessions, chargerLabels) : []), [sessions, chargerLabels]);
  const startLevelDist = useMemo(() => (sessions ? computeStartLevelDist(sessions) : []), [sessions]);
  const acDcBreakdown = useMemo(() => (sessions ? computeAcDcBreakdown(sessions) : null), [sessions]);
  const efficiencyStats = useMemo(() => (sessions ? computeEfficiencyStats(sessions) : null), [sessions]);
  const chargerSpecs = useMemo(() => (sessions ? computeChargerSpecs(sessions) : null), [sessions]);
  const enhancedStats = useMemo(() => (sessions && stats ? computeEnhancedStats(sessions, stats) : null), [sessions, stats]);
  const filteredSessions = useMemo(
    () => (sessions ? filterAndSortSessions(sessions, chargerFilter, sortBy, sortDesc, searchQuery) : []),
    [sessions, chargerFilter, sortBy, sortDesc, searchQuery],
  );

  // Phase-40 / Prompt 51 — bulk selection for delete.
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());
  useEffect(() => {
    setBulkSelected(prev => {
      if (prev.size === 0) return prev;
      const visible = new Set(filteredSessions.map(s => s.id));
      const next = new Set<number>();
      prev.forEach(id => { if (visible.has(id)) next.add(id); });
      return next.size === prev.size ? prev : next;
    });
  }, [filteredSessions]);
  const toggleSessionSelected = useCallback((id: number, on: boolean) => {
    setBulkSelected(prev => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }, []);
  const clearSessionSelection = useCallback(() => setBulkSelected(new Set()), []);
  const bulkDeleteChargingMut = useBulkDeleteCharging();
  const handleBulkDeleteCharging = useCallback(async (ids: number[]) => {
    await bulkDeleteChargingMut.mutateAsync(ids);
    clearSessionSelection();
  }, [bulkDeleteChargingMut, clearSessionSelection]);

  // Defensive guard: no vehicle selected (Phase 40 / Prompt 18).
  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('charging.list.title', 'Charging Sessions')} />;
  }

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <PageContainer
      title={t('charging.list.title', 'Charging Sessions')}
      subtitle={t('charging.list.subtitle', 'Cost analysis, charger breakdown, energy patterns, and performance tracking')}
      actions={
        <div className="flex items-center gap-3">
          <DataFreshnessAuto query={chargingQuery} />
          <SavedViewMenu
            route="/charging"
            currentQuery={savedView.currentQuery}
            onApply={savedView.apply}
          />
        </div>
      }
    >
      <PullToRefresh onRefresh={async () => { await refetch(); }}>
      <FadeIn>
        <div data-tour="charging-filters">
          <RangePicker
            value={{ start: startDate, end: endDate }}
            onChange={(r) => {
              setRangeBatch({ from: r.start, to: r.end });
              setPage(1);
            }}
          />
        </div>
      </FadeIn>

      <QueryError error={error as Error} onRetry={refetch} />

      <FadeIn><HeroGauges stats={stats} /></FadeIn>
      <FadeIn delay={0.05}><QuickMetrics stats={stats} /></FadeIn>

      {sessions && sessions.length > 2 && (
        <ChartsRow energyTrend={energyTrend} chargerBreakdown={chargerBreakdown} costByType={costByType} />
      )}

      {acDcBreakdown && (acDcBreakdown.ac.count > 0 || acDcBreakdown.dc.count > 0) && (
        <FadeIn delay={0.17}><AcDcStatsPanel breakdown={acDcBreakdown} /></FadeIn>
      )}

      {startLevelDist.length > 0 && sessions && sessions.length > 5 && (
        <FadeIn delay={0.2}><BatteryLevelChart data={startLevelDist} /></FadeIn>
      )}

      {stats && enhancedStats && (
        <FadeIn delay={0.22}><DetailedStatistics stats={stats} enhanced={enhancedStats} /></FadeIn>
      )}

      {efficiencyStats && (
        <FadeIn delay={0.24}><EfficiencyPanel stats={efficiencyStats} /></FadeIn>
      )}

      <FadeIn delay={0.26}><ChargerSpecsPanel specs={chargerSpecs} /></FadeIn>

      {optimizer && <OptimizerSection optimizer={optimizer} />}

      <div data-tour="charging-list">
      <SessionListSection
        sessions={sessions}
        filteredSessions={filteredSessions}
        isLoading={isLoading}
        toDistanceDisplay={toDistanceDisplay}
        distanceUnit={distanceUnit}
        sortBy={sortBy}
        sortDesc={sortDesc}
        chargerFilter={chargerFilter}
        searchQuery={searchQuery}
        onSearchQueryChange={(v) => { setSearchQuery(v); setPage(1); }}
        onSortChange={(key) => { setSortBy(key); setSortDesc(true); }}
        onSortToggle={() => setSortDesc(!sortDesc)}
        onChargerFilterChange={setChargerFilter}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        startDate={startDate}
        endDate={endDate}
        vehicleId={vehicleId}
        selectedIds={bulkSelected}
        onToggleSelected={toggleSessionSelected}
        onClearSelection={clearSessionSelection}
        onBulkDelete={handleBulkDeleteCharging}
      />
      </div>
      </PullToRefresh>
    </PageContainer>
  );
}
