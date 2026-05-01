import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { QueryError } from '@/components/feedback';
import { DateRangeFilter } from '@/components/forms';
import { useChargingSessionsPaginated, useChargingOptimizer } from '@/api/hooks/useCharging';
import { useSettings } from '@/hooks/useSettings';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
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

export default function ChargingListPage() {
  const { t } = useTranslation();
  usePageTitle(t('charging.list.title', 'Charging Sessions'));

  const { convertDistance, distanceUnit } = useSettings();
  // Phase 40 / Prompt 16: header VehiclePicker is the source of truth.
  // Alert drillthrough URLs (?vehicle_id=...) flow into the same store via
  // useSelectedVehicle, so prior alert-context handling is no longer needed.
  const { vehicleId } = useSelectedVehicle();

  const [sortBy, setSortBy] = useState<SortKey>('date');
  const [sortDesc, setSortDesc] = useState(true);
  const [chargerFilter, setChargerFilter] = useState<ChargerFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 365);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  const {
    data: sessions,
    isLoading,
    error,
    refetch,
  } = useChargingSessionsPaginated(vehicleId, {
    limit: pageSize,
    offset: (page - 1) * pageSize,
    start: startDate,
    end: endDate,
  });
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

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <PageContainer
      title={t('charging.list.title', 'Charging Sessions')}
      subtitle={t('charging.list.subtitle', 'Cost analysis, charger breakdown, energy patterns, and performance tracking')}
    >
      <FadeIn>
        <DateRangeFilter
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          onApply={() => setPage(1)}
        />
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

      <SessionListSection
        sessions={sessions}
        filteredSessions={filteredSessions}
        isLoading={isLoading}
        convertDistance={convertDistance}
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
      />
    </PageContainer>
  );
}
