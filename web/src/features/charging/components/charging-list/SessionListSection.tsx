import { useTranslation } from 'react-i18next';
import { BatteryCharging, Filter, ArrowUpDown, Download } from 'lucide-react';
import { Button, Pagination } from '@/components/ui';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { Skeleton, EmptyState } from '@/components/feedback';
import { SearchInput, FilterBar } from '@/components/forms';
import { cn } from '@/lib/cn';
import type { ChargingSession } from '@/api/types';
import { ChargingSessionCard } from '../ChargingSessionCard';
import type { SortKey, ChargerFilter } from './helpers';

interface SessionListSectionProps {
  sessions: ChargingSession[] | undefined;
  filteredSessions: ChargingSession[];
  isLoading: boolean;
  convertDistance: (mi: number) => number;
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
}

export function SessionListSection({
  sessions,
  filteredSessions,
  isLoading,
  convertDistance,
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
}: SessionListSectionProps) {
  const { t } = useTranslation();

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
      <EmptyState
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
          />
        </FilterBar>
      </FadeIn>

      {/* Sort & Filter controls */}
      <FadeIn delay={0.22}>
        <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-center gap-2 sm:gap-3">
          <h3 className="section-title flex items-center gap-2 flex-1">
            <BatteryCharging className="h-4 w-4 text-neon-green" />
            {t('charging.sessions.allSessions', 'All Sessions')}
            <span className="text-xs text-[var(--text-muted)] font-normal ml-1">({filteredSessions.length})</span>
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
                className={cn(
                  'px-2.5 py-1 h-auto rounded-md text-[11px] font-medium transition-all',
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
                className={cn(
                  'px-2.5 py-1 h-auto rounded-md text-[11px] font-medium transition-all',
                  sortBy === k.key
                    ? 'bg-white/[0.08] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-transparent',
                )}
              >
                {k.label}
                {sortBy === k.key && <span className="ml-0.5">{sortDesc ? '↓' : '↑'}</span>}
              </Button>
            ))}
          </div>
          {/* Export buttons */}
          <div className="flex items-center gap-2">
            <a
              href={`/api/v1/export/charging?format=csv${startDate ? `&start=${startDate}` : ''}${endDate ? `&end=${endDate}` : ''}${vehicleId ? `&vehicle_id=${vehicleId}` : ''}`}
              download="teslasync-charging.csv"
            >
              <Button variant="secondary" size="sm" icon={<Download className="h-3.5 w-3.5" />}>
                {t('charging.sessions.exportCsv', 'CSV')}
              </Button>
            </a>
            <a
              href={`/api/v1/export/charging?format=json${startDate ? `&start=${startDate}` : ''}${endDate ? `&end=${endDate}` : ''}${vehicleId ? `&vehicle_id=${vehicleId}` : ''}`}
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
      {filteredSessions.length === 0 ? (
        <EmptyState
          icon={<BatteryCharging className="h-8 w-8" />}
          title={t('charging.list.noMatches', 'No sessions match your filters')}
          message={t('charging.list.noMatchesDescription', 'Try clearing the search or charger filter to see more sessions.')}
        />
      ) : (
        <StaggerContainer className="space-y-3">
          {filteredSessions.map((s) => (
            <StaggerItem key={s.id}>
              <ChargingSessionCard session={s} convertDistance={convertDistance} distanceUnit={distanceUnit} />
            </StaggerItem>
          ))}
        </StaggerContainer>
      )}

      {/* Pagination */}
      <Pagination
        page={page}
        pageSize={pageSize}
        total={
          filteredSessions.length < pageSize
            ? (page - 1) * pageSize + filteredSessions.length
            : page * pageSize + 1
        }
        onPageChange={onPageChange}
        onPageSizeChange={(s) => { onPageSizeChange(s); onPageChange(1); }}
      />
    </>
  );
}
