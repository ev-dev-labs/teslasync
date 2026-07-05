import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';
import { BatteryCharging, Filter, ArrowUpDown, Download, Trash2 } from 'lucide-react';
import { Button, Pagination } from '@/components/ui';
import { BulkActionsToolbar, type BulkAction } from '@/components/data-display';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { Skeleton, EmptyState } from '@/components/feedback';
import { SearchInput, FilterBar, ActiveFilterChips, type FilterChipDescriptor } from '@/components/forms';
import { cn } from '@/lib/cn';
import { apiUrl } from '@/api/client';
import type { ChargingSession } from '@/api/types';
import { ChargingSessionCard } from '../ChargingSessionCard';
import type { SortKey, ChargerFilter } from './helpers';

interface SessionListSectionProps {
  sessions: ChargingSession[] | undefined;
  filteredSessions: ChargingSession[];
  isLoading: boolean;
  toDistanceDisplay: (mi: number) => number;
  distanceUnit: string;
  sortBy: SortKey;
  sortDesc: boolean;
  chargerFilter: ChargerFilter;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  onSortChange: (key: SortKey) => void;
  onSortToggle: () => void;
  onChargerFilterChange: (filter: ChargerFilter) => void;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  startDate: string;
  endDate: string;
  vehicleId: number | null;
  // Bulk-action plumbing
  selectedIds?: Set<number>;
  onToggleSelected?: (id: number, on: boolean) => void;
  onClearSelection?: () => void;
  onBulkDelete?: (ids: number[]) => Promise<void>;
}

export function SessionListSection({
  sessions,
  filteredSessions,
  isLoading,
  toDistanceDisplay,
  distanceUnit,
  sortBy,
  sortDesc,
  chargerFilter,
  searchQuery,
  onSearchQueryChange,
  onSortChange,
  onSortToggle,
  onChargerFilterChange,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  startDate,
  endDate,
  vehicleId,
  selectedIds,
  onToggleSelected,
  onClearSelection,
  onBulkDelete,
}: SessionListSectionProps) {
  const { t } = useTranslation();

  // Defensive: callers own the filtered slice, but a nullish value must never
  // crash the panel on `.length`/`.map` — degrade to an empty list instead.
  const filtered = filteredSessions ?? [];

  const bulkActions = useMemo<BulkAction[]>(() => {
    if (!onBulkDelete) return [];
    const count = selectedIds?.size ?? 0;
    return [
      {
        id: 'delete',
        label: t('bulk.actions.delete', 'Delete'),
        icon: <Trash2 className="h-3.5 w-3.5" />,
        variant: 'danger',
        confirm: {
          title: t('bulk.deleteConfirmTitle', 'Delete {{count}} {{noun}}?', {
            count,
            noun: count === 1
              ? t('bulk.noun.session_one', 'charging session')
              : t('bulk.noun.session_other', 'charging sessions'),
          }),
          description: t('bulk.deleteConfirmDescription', 'This cannot be undone.'),
          confirmLabel: t('common.delete', 'Delete'),
        },
        onClick: async (ids) => {
          await onBulkDelete(ids.map(Number));
        },
      },
    ];
  }, [t, selectedIds?.size, onBulkDelete]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
        icon={<BatteryCharging className="h-8 w-8" />}
        title={t('charging.list.empty', 'No charging sessions yet')}
        message={t('charging.list.emptyDescription', 'Charging data will appear here once your vehicle records a session.')}
      />
    );
  }

  const handleSortClick = (key: SortKey) => {
    if (sortBy === key) onSortToggle();
    else onSortChange(key);
  };

  return (
    <>
      {/* Search bar */}
      <FadeIn delay={0.2}>
        <FilterBar className="mb-0">
          <SearchInput
            value={searchQuery}
            onChange={onSearchQueryChange}
            placeholder={t('charging.sessions.searchPlaceholder', 'Search by location or charger type…')}
            className="w-full sm:w-72"
            historyScope="charging:sessions"
          />
        </FilterBar>
        <ActiveFilterChips
          className="mt-2"
          filters={
            ([
              searchQuery
                ? {
                    key: 'q',
                    label: t('charging.sessions.filterLabel.search', 'Search'),
                    value: searchQuery,
                    onRemove: () => onSearchQueryChange(''),
                  } satisfies FilterChipDescriptor
                : null,
              chargerFilter !== 'all'
                ? {
                    key: 'charger',
                    label: t('charging.sessions.filterLabel.charger', 'Charger'),
                    value:
                      chargerFilter === 'home'
                        ? t('charging.sessions.filterHome', 'Home')
                        : chargerFilter === 'supercharger'
                          ? t('charging.sessions.filterSC', 'SC')
                          : t('charging.sessions.filterDC', 'DC'),
                    onRemove: () => onChargerFilterChange('all'),
                  } satisfies FilterChipDescriptor
                : null,
            ].filter(Boolean) as FilterChipDescriptor[]) as readonly FilterChipDescriptor[]
          }
          onClearAll={() => {
            onSearchQueryChange('');
            onChargerFilterChange('all');
          }}
        />
      </FadeIn>

      {/* Sort & Filter controls */}
      <FadeIn delay={0.22}>
        <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-2 sm:gap-3">
          <h3 className="section-title flex items-center gap-2 flex-1">
            <BatteryCharging className="h-4 w-4 text-neon-green" />
            {t('charging.sessions.allSessions', 'All Sessions')}
            <span className="text-xs text-[var(--text-muted)] font-normal ml-1">({filtered.length})</span>
          </h3>
          {/* Charger filter */}
          <div className="flex items-center gap-1 rounded-lg bg-white/[0.02] p-1 border border-white/[0.06]">
            <Filter className="h-3 w-3 text-[var(--text-muted)] ml-1" />
            {([
              { key: 'all' as const, label: t('charging.sessions.filterAll', 'All') },
              { key: 'home' as const, label: t('charging.sessions.filterHome', 'Home') },
              { key: 'supercharger' as const, label: t('charging.sessions.filterSC', 'SC') },
              { key: 'dc' as const, label: t('charging.sessions.filterDC', 'DC') },
            ] as const).map((f) => (
              <Button
                key={f.key}
                variant="ghost"
                size="sm"
                onClick={() => onChargerFilterChange(f.key)}
                aria-pressed={chargerFilter === f.key}
                className={cn(
                  'px-2.5 py-1 h-auto rounded-md text-xs font-medium transition-all',
                  chargerFilter === f.key
                    ? 'bg-white/[0.08] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-transparent',
                )}
              >
                {f.label}
              </Button>
            ))}
          </div>
          {/* Sort controls */}
          <div className="flex items-center gap-1 rounded-lg bg-white/[0.02] p-1 border border-white/[0.06]">
            <ArrowUpDown className="h-3 w-3 text-[var(--text-muted)] ml-1" />
            {([
              { key: 'date' as const, label: t('charging.sessions.sortDate', 'Date') },
              { key: 'energy' as const, label: t('charging.sessions.sortEnergy', 'kWh') },
              { key: 'cost' as const, label: t('charging.sessions.sortCost', 'Cost') },
              { key: 'duration' as const, label: t('charging.sessions.sortTime', 'Time') },
              { key: 'power' as const, label: t('charging.sessions.sortPower', 'Power') },
            ] as const).map((k) => (
              <Button
                key={k.key}
                variant="ghost"
                size="sm"
                onClick={() => handleSortClick(k.key)}
                aria-pressed={sortBy === k.key}
                className={cn(
                  'px-2.5 py-1 h-auto rounded-md text-xs font-medium transition-all',
                  sortBy === k.key
                    ? 'bg-white/[0.08] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-transparent',
                )}
              >
                {k.label}
                {sortBy === k.key && <span className="ml-0.5" aria-hidden="true">{sortDesc ? '↓' : '↑'}</span>}
              </Button>
            ))}
          </div>
          {/* Export buttons */}
          <div className="flex items-center gap-2">
            <a
              href={apiUrl(`/export/charging?format=csv${startDate ? `&start=${startDate}` : ''}${endDate ? `&end=${endDate}` : ''}${vehicleId ? `&vehicle_id=${vehicleId}` : ''}`)}
              download="teslasync-charging.csv"
            >
              <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />}>
                {t('charging.sessions.exportCsv', 'CSV')}
              </Button>
            </a>
            <a
              href={apiUrl(`/export/charging?format=json${startDate ? `&start=${startDate}` : ''}${endDate ? `&end=${endDate}` : ''}${vehicleId ? `&vehicle_id=${vehicleId}` : ''}`)}
              download="teslasync-charging.json"
            >
              <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />}>
                {t('charging.sessions.exportJson', 'JSON')}
              </Button>
            </a>
          </div>
        </div>
      </FadeIn>

      {/* Session cards */}
      {filtered.length === 0 ? (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<BatteryCharging className="h-8 w-8" />}
          title={t('charging.list.noMatches', 'No sessions match your filters')}
          message={t('charging.list.noMatchesDescription', 'Try clearing the search or charger filter to see more sessions.')}
        />
      ) : (
        <>
          {onBulkDelete && onClearSelection && onToggleSelected && (
            <BulkActionsToolbar
              selectedIds={Array.from(selectedIds ?? [])}
              total={filtered.length}
              onClear={onClearSelection}
              actions={bulkActions}
              itemNoun={{
                one: t('bulk.noun.session_one', 'charging session'),
                other: t('bulk.noun.session_other', 'charging sessions'),
              }}
            />
          )}
          <StaggerContainer className="space-y-3">
            {filtered.map((s) => (
              <StaggerItem key={s.id}>
                <ChargingSessionCard
                  session={s}
                  toDistanceDisplay={toDistanceDisplay}
                  distanceUnit={distanceUnit}
                  selected={selectedIds?.has(s.id) ?? false}
                  onToggleSelect={onToggleSelected}
                />
              </StaggerItem>
            ))}
          </StaggerContainer>
        </>
      )}

      {/* Pagination */}
      <Pagination
        page={page}
        pageSize={pageSize}
        total={
          filtered.length < pageSize
            ? (page - 1) * pageSize + filtered.length
            : page * pageSize + 1
        }
        onPageChange={onPageChange}
        onPageSizeChange={(s) => { onPageSizeChange(s); onPageChange(1); }}
      />
    </>
  );
}
