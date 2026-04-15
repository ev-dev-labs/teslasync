/**
 * SoftwareUpdatesPage — track firmware versions and update history.
 *
 * Shows current version, update progress, and timeline of all updates.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Download, CheckCircle, Clock, ArrowUpCircle, Smartphone,
  Calendar, ExternalLink, AlertCircle,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, Select, Pagination } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, AlertBanner } from '@/components/feedback';
import { getErrorMessage } from '@/lib/errorMessage';
import { FadeIn } from '@/components/motion';

import { useVehicles } from '@/api/hooks/useVehicles';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDate } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import { request } from '@/api/client';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SoftwareUpdate {
  id: number;
  vehicle_id: number;
  version: string;
  status: string;
  installed_at: string | null;
  scheduled_at: string | null;
  created_at: string;
}

// ─── Status config ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: typeof CheckCircle; badgeVariant: 'success' | 'info' | 'warning' | 'neutral'; label: string }> = {
  installed: { color: 'text-neon-green', bg: 'bg-neon-green/10', icon: CheckCircle, badgeVariant: 'success', label: 'Installed' },
  installing: { color: 'text-neon-cyan', bg: 'bg-neon-cyan/10', icon: Download, badgeVariant: 'info', label: 'Installing' },
  downloading: { color: 'text-neon-cyan', bg: 'bg-neon-cyan/10', icon: Download, badgeVariant: 'info', label: 'Downloading' },
  available: { color: 'text-neon-amber', bg: 'bg-neon-amber/10', icon: ArrowUpCircle, badgeVariant: 'warning', label: 'Available' },
  scheduled: { color: 'text-[var(--text-muted)]', bg: 'bg-white/5', icon: Clock, badgeVariant: 'neutral', label: 'Scheduled' },
};

function getStatus(status: string) {
  return STATUS_CONFIG[status] ?? STATUS_CONFIG.available;
}

// ─── Page component ──────────────────────────────────────────────────────────

export default function SoftwareUpdatesPage() {
  const { t } = useTranslation();
  usePageTitle(t('softwareUpdates.title', 'Software Updates'));

  const { data: vehicles } = useVehicles();
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null;
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const { data: updates, isLoading, error: dataError } = useQuery({
    queryKey: ['software-updates', vehicleId, page],
    queryFn: () => request<SoftwareUpdate[]>(`/software-updates?vehicle_id=${vehicleId}&limit=${pageSize}&offset=${(page - 1) * pageSize}`),
    enabled: vehicleId !== null,
  });

  const anyError = dataError as Error | undefined;

  const vehicleMap = useMemo(() => {
    const m = new Map<number, { id: number; display_name: string; vin: string }>();
    vehicles?.forEach(v => m.set(v.id, v));
    return m;
  }, [vehicles]);

  const latestVersion = updates?.[0]?.version ?? t('Unknown');
  const installedCount = updates?.filter(u => u.status === 'installed').length ?? 0;
  const totalUpdates = updates?.length ?? 0;

  return (
    <PageContainer
      title={t('Software Updates')}
      subtitle={t('Track firmware versions and update history')}
      loading={isLoading}
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
      {anyError && (
        <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(anyError)}
        </AlertBanner>
      )}

      {/* ── Summary cards ────────────────────────────────────────── */}
      <FadeIn>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard icon={<Smartphone className="h-5 w-5" />} label={t('Current Version')} value={latestVersion} color="cyan" />
          <MetricCard icon={<CheckCircle className="h-5 w-5" />} label={t('Updates Installed')} value={installedCount} color="green" />
          <MetricCard icon={<Download className="h-5 w-5" />} label={t('Total Updates')} value={totalUpdates} color="purple" />
        </div>
      </FadeIn>

      {/* ── Update Timeline ──────────────────────────────────────── */}
      <FadeIn>
        <GlassPanel className="p-6">
          <span className="text-sm font-semibold mb-6 block text-[var(--text-primary)]">
            {t('Update Timeline')}
          </span>
          {isLoading ? (
            <div className="space-y-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
          ) : !updates?.length ? (
            <EmptyState
              icon={<Smartphone className="h-12 w-12" />}
              title={t('No update history')}
              message={t('No software update history available')}
            />
          ) : (
            <>
              <div className="relative">
                <div className="absolute left-6 top-0 bottom-0 w-px bg-white/10" />
                <div className="space-y-4">
                  {updates.map(u => {
                    const s = getStatus(u.status);
                    const Icon = s.icon;
                    const vName = vehicleMap.get(u.vehicle_id)?.display_name ?? `${t('Vehicle')} ${u.vehicle_id}`;
                    return (
                      <div key={u.id} className="relative pl-14">
                        <div className={cn('absolute left-3.5 top-3 h-5 w-5 rounded-full flex items-center justify-center ring-4 ring-[var(--bg)]', s.bg)}>
                          <Icon className={cn('h-3 w-3', s.color)} />
                        </div>
                        <GlassPanel className="p-4 hover:border-white/10 transition-colors">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="text-sm font-semibold text-[var(--text-primary)]">{u.version}</span>
                                <Badge variant={s.badgeVariant} size="sm">{t(s.label)}</Badge>
                                <a
                                  href={`https://www.notateslaapp.com/software-updates/version/${encodeURIComponent(u.version)}/release-notes`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[var(--text-muted)] hover:text-neon-cyan transition-colors"
                                  title={t('View release notes')}
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              </div>
                              <span className="text-xs text-[var(--text-muted)]">{vName}</span>
                            </div>
                            <div className="text-right shrink-0">
                              {u.installed_at && (
                                <div className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
                                  <Calendar className="h-3 w-3" />
                                  <span>{formatDate(u.installed_at)}</span>
                                </div>
                              )}
                              {u.scheduled_at && !u.installed_at && (
                                <div className="flex items-center gap-1 text-xs text-neon-amber">
                                  <Clock className="h-3 w-3" />
                                  <span>{t('Scheduled')}: {formatDate(u.scheduled_at)}</span>
                                </div>
                              )}
                              <span className="text-[10px] text-[var(--text-muted)] mt-0.5 block">{formatDate(u.created_at)}</span>
                            </div>
                          </div>
                        </GlassPanel>
                      </div>
                    );
                  })}
                </div>
              </div>
              <Pagination
                page={page}
                pageSize={pageSize}
                total={updates.length < pageSize ? (page - 1) * pageSize + updates.length : page * pageSize + 1}
                onPageChange={setPage}
              />
            </>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
