/**
 * Maintenance workspace: complete schedule, independent history and evidence.
 * Query identity/retry policy belongs to the matching API hooks; raw distances
 * remain SI metres until the existing display boundary. Records still have no
 * populated backend producer and Schedule remains an inherited no-op.
 */
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarPlus, RefreshCw } from 'lucide-react';
import { PageLayout, CardGrid, type CardGridItem } from '@/components/layout';
import { Button } from '@/components/ui';
// The opt-in child remains unchanged; the shared AI category has no barrel.
import { AIPredictiveMaintenance } from '@/components/ai';
import { useMaintenance, useServiceRecords } from '@/api/hooks/useMaintenance';
import { deriveDataState } from '@/api/dataState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { formatDate } from '@/lib/dateFormat';
import {
  MaintenanceGridSlot, MaintenanceSummary, MaintenanceItemsPanel,
  MaintenanceProjectionsPanel, MaintenanceCostPanel, MaintenanceCategoriesPanel,
  MaintenanceRecordsPanel, MaintenanceEvidenceDrawer, buildServiceColumns,
  calculateCostStatistics, countCategories, projectServices, sortItems,
  SORT_OPTIONS, type ServiceRecord,
} from '../components/maintenance-modernization';

export default function MaintenancePage() {
  const { t } = useTranslation();
  usePageTitle(t('maintenance.title', 'Maintenance'));
  const { vehicleId } = useSelectedVehicle();
  const enabled = vehicleId !== null;
  const { formatDistance } = useUnits();
  const { formatCurrency } = useFormatting();
  const { precision: displayPrecision, locale: displayLocale } = useNumberFormatting();

  const itemsQuery = useMaintenance(vehicleId);
  const recordsQuery = useServiceRecords(vehicleId);
  const itemSource = deriveDataState(itemsQuery);
  const recordSource = deriveDataState(recordsQuery, { provenance: 'historical' });
  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const records = useMemo(() => recordsQuery.data ?? [], [recordsQuery.data]);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState('status');
  const [previewRecord, setPreviewRecord] = useState<ServiceRecord | null>(null);

  const categories = useMemo(
    () => Array.from(new Set(items.map(item => item.category))).sort(),
    [items],
  );
  const categoryOptions = useMemo(() => [
    { value: 'all', label: t('maintenance.allCategories', 'All categories') },
    ...categories.map(category => ({
      value: category,
      label: category.charAt(0).toUpperCase() + category.slice(1),
    })),
  ], [categories, t]);
  const sortOptions = useMemo(
    () => SORT_OPTIONS.map(option => ({ value: option.value, label: t(option.labelKey, option.fallback) })),
    [t],
  );
  const filteredItems = useMemo(
    () => sortItems(
      categoryFilter === 'all' ? items : items.filter(item => item.category === categoryFilter),
      sortBy,
    ),
    [items, categoryFilter, sortBy],
  );
  const costStats = useMemo(() => calculateCostStatistics(records), [records]);
  const categoryBreakdown = useMemo(() => countCategories(items), [items]);
  const projections = useMemo(() => projectServices(items, formatDate), [items]);
  const serviceColumns = useMemo(
    () => buildServiceColumns(t, formatDistance, setPreviewRecord),
    [t, formatDistance, displayPrecision, displayLocale],
  );
  const dataSources = useMemo(() => [
    {
      id: 'maintenance-items',
      label: t('dataSources.labels.maintenanceItems', 'Maintenance items'),
      query: itemsQuery,
      enabled,
    },
    {
      id: 'service-records',
      label: t('dataSources.labels.serviceRecords', 'Service records'),
      query: recordsQuery,
      enabled,
    },
  ], [enabled, itemsQuery, recordsQuery, t]);

  const handleRefresh = useCallback(() => {
    void itemsQuery.refetch();
    void recordsQuery.refetch();
  }, [itemsQuery, recordsQuery]);
  const handleSchedule = useCallback(() => {
    // Preserved inherited no-op. No scheduling endpoint or command exists.
  }, []);

  const cards: CardGridItem[] = [
    {
      id: 'maintenance-summary', size: 'full',
      content: <MaintenanceGridSlot><MaintenanceSummary source={itemSource} enabled={enabled} /></MaintenanceGridSlot>,
    },
    {
      id: 'maintenance-advisor', size: 'full',
      content: <MaintenanceGridSlot delay={0.05}><AIPredictiveMaintenance vehicleId={vehicleId ?? undefined} /></MaintenanceGridSlot>,
    },
    {
      id: 'maintenance-items', size: 'half',
      content: <MaintenanceGridSlot delay={0.1}><MaintenanceItemsPanel
        source={itemSource} enabled={enabled} items={filteredItems}
        categoryFilter={categoryFilter} sortBy={sortBy}
        categoryOptions={categoryOptions} sortOptions={sortOptions}
        onCategoryChange={setCategoryFilter} onSortChange={setSortBy}
        formatDistance={formatDistance}
      /></MaintenanceGridSlot>,
    },
    {
      id: 'maintenance-projections', size: 'third',
      content: <MaintenanceGridSlot delay={0.1}><MaintenanceProjectionsPanel
        source={itemSource} enabled={enabled} projections={projections} formatDistance={formatDistance}
      /></MaintenanceGridSlot>,
    },
    {
      id: 'maintenance-cost', size: 'half',
      content: <MaintenanceGridSlot delay={0.15}><MaintenanceCostPanel
        source={recordSource} enabled={enabled} costStats={costStats} formatCurrency={formatCurrency}
      /></MaintenanceGridSlot>,
    },
    {
      id: 'maintenance-categories', size: 'half',
      content: <MaintenanceGridSlot delay={0.15}><MaintenanceCategoriesPanel
        source={itemSource} enabled={enabled} breakdown={categoryBreakdown}
      /></MaintenanceGridSlot>,
    },
    {
      id: 'maintenance-records', size: 'full',
      content: <MaintenanceGridSlot delay={0.2}><MaintenanceRecordsPanel
        source={recordSource} enabled={enabled} records={records} columns={serviceColumns}
      /></MaintenanceGridSlot>,
    },
  ];

  return (
    <PageLayout
      title={t('maintenance.title', 'Maintenance')}
      subtitle={t('maintenance.subtitle', 'Service schedule, records, and upcoming maintenance')}
      secondaryActions={<Button variant="ghost" size="sm" onClick={handleRefresh}
        aria-label={t('maintenance.refresh', 'Refresh maintenance data')}>
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      </Button>}
      primaryAction={<Button variant="primary" size="sm"
        icon={<CalendarPlus className="h-4 w-4" aria-hidden="true" />} onClick={handleSchedule}>
        {t('maintenance.schedule', 'Schedule')}
      </Button>}
      query={[itemsQuery, recordsQuery]}
      dataSources={dataSources}
    >
      <CardGrid items={cards} label={t('maintenance.title', 'Maintenance')} />
      <MaintenanceEvidenceDrawer record={previewRecord} onClose={() => setPreviewRecord(null)}
        formatDistance={formatDistance} formatCurrency={formatCurrency} />
    </PageLayout>
  );
}
