/**
 * LocationsPage — visited locations ranked by frequency.
 *
 * Shows stats, bar charts (visits + time), and paginated location list.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MapPin, Clock, Hash, Trophy, Navigation } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Select, Pagination } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  ChartTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';

import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDate } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { request } from '@/api/client';

// ─── Types ───────────────────────────────────────────────────────────────────

interface VisitedLocation {
  id: number;
  address_name: string;
  visit_count: number;
  total_duration_min: number;
  last_visited: string | null;
}

interface Vehicle { id: number; vin: string; display_name: string }

// ─── Page ────────────────────────────────────────────────────────────────────

export default function LocationsPage() {
  const { t } = useTranslation();
  usePageTitle(t('Locations'));

  const { data: vehicles } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  });
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null;
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const { data: locations, isLoading, error } = useQuery({
    queryKey: ['visited-locations', vehicleId, page, pageSize],
    queryFn: () => request<VisitedLocation[]>(`/locations?vehicle_id=${vehicleId}&limit=${pageSize}&offset=${(page - 1) * pageSize}`),
    enabled: vehicleId !== null,
  });

  const totalVisits = locations?.reduce((s, l) => s + l.visit_count, 0) ?? 0;
  const totalTime = locations?.reduce((s, l) => s + l.total_duration_min, 0) ?? 0;
  const uniquePlaces = locations?.length ?? 0;
  const topLocation = locations?.[0];
  const avgDurationMin = totalVisits > 0 ? totalTime / totalVisits : 0;

  const visitsChartData = useMemo(() =>
    (locations ?? []).slice(0, 15).map(l => ({
      name: (l.address_name ?? '').length > 25 ? (l.address_name ?? '').slice(0, 22) + '…' : (l.address_name ?? ''),
      visits: l.visit_count,
    })),
  [locations]);

  const timeChartData = useMemo(() =>
    (locations ?? []).slice(0, 10).map(l => ({
      name: (l.address_name ?? '').length > 25 ? (l.address_name ?? '').slice(0, 22) + '…' : (l.address_name ?? ''),
      hours: +(fmtNumber(l.total_duration_min / 60, 1)),
    })),
  [locations]);

  return (
    <PageContainer
      title={t('Visited Locations')}
      subtitle={t('Places you\'ve been — ranked by frequency')}
      loading={isLoading}
      error={error as Error | null}
      actions={
        vehicles && vehicles.length > 1 ? (
          <Select
            value={String(vehicleId ?? '')}
            onChange={e => setSelectedVehicle(Number(e.target.value))}
            options={vehicles.map(v => ({ value: String(v.id), label: v.display_name || v.vin }))}
          />
        ) : undefined
      }
    >
      {/* ── Summary stats ────────────────────────────────────────── */}
      <FadeIn>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4">
          <MetricCard label={t('Unique Places')} value={uniquePlaces} icon={<Navigation className="h-4 w-4" />} color="green" />
          <MetricCard label={t('Total Visits')} value={totalVisits} icon={<Hash className="h-4 w-4" />} color="cyan" />
          <MetricCard label={t('Total Time')} value={`${fmtInt(totalTime / 60)}h`} icon={<Clock className="h-4 w-4" />} color="purple" />
          <MetricCard label={t('Most Visited')} value={topLocation?.address_name ?? '—'} icon={<Trophy className="h-4 w-4" />} color="amber" />
          <MetricCard label={t('Avg Visit')} value={avgDurationMin > 60 ? `${Math.floor(avgDurationMin / 60)}h ${fmtInt(avgDurationMin % 60)}m` : `${fmtInt(avgDurationMin)}m`} icon={<Clock className="h-4 w-4" />} color="cyan" />
        </div>
      </FadeIn>

      {/* ── Top Locations by Visits ───────────────────────────────── */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-6">
          <span className="text-sm font-semibold mb-4 block text-[var(--text-primary)]">{t('Top Locations by Visits')}</span>
          {isLoading ? <Skeleton className="h-[300px]" /> : visitsChartData.length === 0 ? (
            <div className="flex items-center justify-center h-[300px] text-[var(--text-muted)] text-sm">{t('No visited location data')}</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(300, visitsChartData.length * 36)}>
              <BarChart data={visitsChartData} layout="vertical" margin={{ left: 120 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
                <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#9ca3af' }} width={110} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="visits" name={t('Visits')} fill="#10b981" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Top Locations by Time ────────────────────────────────── */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-6">
          <span className="text-sm font-semibold mb-4 block text-[var(--text-primary)]">{t('Top Locations by Time Spent (hours)')}</span>
          {isLoading ? <Skeleton className="h-[280px]" /> : timeChartData.length === 0 ? (
            <div className="flex items-center justify-center h-[280px] text-[var(--text-muted)] text-sm">{t('No time-spent data available')}</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(280, timeChartData.length * 36)}>
              <BarChart data={timeChartData} layout="vertical" margin={{ left: 120 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
                <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#9ca3af' }} width={110} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="hours" name={t('Hours')} fill="#a855f7" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── All Locations list ───────────────────────────────────── */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-6">
          <span className="text-sm font-semibold mb-4 block text-[var(--text-primary)]">{t('All Locations')}</span>
          {isLoading ? (
            <div className="space-y-3">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
          ) : !locations?.length ? (
            <EmptyState icon={<MapPin className="h-12 w-12" />} title={t('No locations')} message={t('No visited locations recorded yet')} />
          ) : (
            <>
              <div className="space-y-2">
                {locations.map((loc, i) => (
                  <GlassPanel key={loc.id} className="p-4 flex items-center gap-4 hover:border-white/10 transition-colors">
                    <div className={cn(
                      'h-8 w-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0',
                      i === 0 ? 'bg-neon-amber/20 text-neon-amber' : i < 3 ? 'bg-neon-cyan/10 text-neon-cyan' : 'bg-white/5 text-[var(--text-muted)]',
                    )}>
                      #{i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium truncate block text-[var(--text-primary)]">{loc.address_name}</span>
                      <span className="text-[11px] text-[var(--text-muted)]">
                        {loc.visit_count} {t('visits')} · {fmtInt(loc.total_duration_min / 60)}h {t('total')} · ~{loc.visit_count > 0 ? fmtInt(loc.total_duration_min / loc.visit_count) : 0}m {t('avg')}
                        {loc.last_visited && ` · ${t('Last')}: ${formatDate(loc.last_visited)}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-neon-green text-xs font-medium shrink-0">
                      <Hash className="h-3 w-3" />{loc.visit_count}
                    </div>
                  </GlassPanel>
                ))}
              </div>
              <Pagination
                page={page}
                pageSize={pageSize}
                total={locations.length < pageSize ? (page - 1) * pageSize + locations.length : page * pageSize + 1}
                onPageChange={setPage}
              />
            </>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
