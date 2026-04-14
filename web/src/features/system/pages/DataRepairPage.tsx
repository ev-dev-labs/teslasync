/**
 * DataRepairPage — fix incomplete charging sessions and drive records.
 *
 * Lists stale (open) sessions with inline edit forms to update, close, or discard them.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { MetricCard } from '@/components/data-display/MetricCard';
import { EmptyState } from '@/components/feedback/EmptyState';
import { FadeIn } from '@/components/motion/FadeIn';
import { useToast } from '@/components/feedback/Toast';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtInt } from '@/lib/numberFormat';
import { request } from '@/api/client';
import {
  Wrench, BatteryCharging, Route, AlertTriangle, CheckCircle,
  X, Save, Clock, Trash2,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChargingSession {
  id: number;
  vehicle_id: number;
  start_date: string;
  start_battery_level: number;
  end_battery_level?: number;
  charge_energy_added?: number;
  charger_power?: number;
  duration_min?: number;
  cost?: number;
}

interface Drive {
  id: number;
  vehicle_id: number;
  start_date: string;
  start_battery_level?: number;
  end_battery_level?: number;
  distance?: number;
  duration_min?: number;
  speed_max?: number;
  end_range_km?: number;
}

interface StaleData {
  stale_charging: ChargingSession[];
  stale_drives: Drive[];
}

type Tab = 'charging' | 'drives';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hoursOpen(startDate: string): string {
  const h = (Date.now() - new Date(startDate).getTime()) / 3600000;
  if (h < 24) return `${fmtInt(h)}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${fmtInt(h % 24)}h`;
}

// ─── Charging Edit Form ──────────────────────────────────────────────────────

function ChargingEditForm({ session, onClose, t }: { session: ChargingSession; onClose: () => void; t: (k: string) => string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    end_date: '',
    charge_energy_added: String(session.charge_energy_added ?? ''),
    end_battery_level: String(session.end_battery_level ?? ''),
    charger_power: String(session.charger_power ?? ''),
    duration_min: String(session.duration_min ?? ''),
    cost: String(session.cost ?? ''),
  });

  const updateMut = useMutation({
    mutationFn: () => {
      const data: Record<string, unknown> = {};
      if (form.end_date) data.end_date = form.end_date;
      if (form.charge_energy_added) data.charge_energy_added = Number(form.charge_energy_added);
      if (form.end_battery_level) data.end_battery_level = Number(form.end_battery_level);
      if (form.charger_power) data.charger_power = Number(form.charger_power);
      if (form.duration_min) data.duration_min = Number(form.duration_min);
      if (form.cost) data.cost = Number(form.cost);
      return request(`/data-repair/charging/${session.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    },
    onSuccess: () => { toast.success(t('Session updated')); qc.invalidateQueries({ queryKey: ['stale-sessions'] }); onClose(); },
    onError: () => toast.error(t('Failed to update session')),
  });

  const closeMut = useMutation({
    mutationFn: () => request(`/data-repair/charging/${session.id}/close`, { method: 'POST' }),
    onSuccess: () => { toast.success(t('Session closed')); qc.invalidateQueries({ queryKey: ['stale-sessions'] }); onClose(); },
    onError: () => toast.error(t('Failed to close session')),
  });

  const discardMut = useMutation({
    mutationFn: () => request(`/data-repair/charging/${session.id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.success(t('Session discarded')); qc.invalidateQueries({ queryKey: ['stale-sessions'] }); onClose(); },
    onError: () => toast.error(t('Failed to discard session')),
  });

  return (
    <GlassPanel className="p-4 space-y-4 bg-neon-amber/[0.03] border-neon-amber/20">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Input label={t('End Date (ISO)')} value={form.end_date} placeholder="2026-03-30T04:00:00Z" onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
        <Input label={t('Energy Added (kWh)')} type="number" value={form.charge_energy_added} onChange={e => setForm(f => ({ ...f, charge_energy_added: e.target.value }))} />
        <Input label={t('End Battery %')} type="number" value={form.end_battery_level} onChange={e => setForm(f => ({ ...f, end_battery_level: e.target.value }))} />
        <Input label={t('Charger Power (kW)')} type="number" value={form.charger_power} onChange={e => setForm(f => ({ ...f, charger_power: e.target.value }))} />
        <Input label={t('Duration (min)')} type="number" value={form.duration_min} onChange={e => setForm(f => ({ ...f, duration_min: e.target.value }))} />
        <Input label={t('Cost ($)')} type="number" value={form.cost} onChange={e => setForm(f => ({ ...f, cost: e.target.value }))} />
      </div>
      <div className="flex items-center gap-2 pt-2">
        <Button variant="secondary" size="sm" onClick={() => updateMut.mutate()} loading={updateMut.isPending} icon={<Save className="h-3.5 w-3.5" />}>{t('Save')}</Button>
        <Button variant="secondary" size="sm" onClick={() => closeMut.mutate()} loading={closeMut.isPending} icon={<Clock className="h-3.5 w-3.5" />}>{t('Close Session')}</Button>
        <Button variant="danger" size="sm" onClick={() => discardMut.mutate()} loading={discardMut.isPending} icon={<Trash2 className="h-3.5 w-3.5" />}>{t('Discard')}</Button>
        <Button variant="ghost" size="sm" onClick={onClose} icon={<X className="h-3.5 w-3.5" />} className="ml-auto">{t('Cancel')}</Button>
      </div>
    </GlassPanel>
  );
}

// ─── Drive Edit Form ─────────────────────────────────────────────────────────

function DriveEditForm({ drive, onClose, t }: { drive: Drive; onClose: () => void; t: (k: string) => string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    end_date: '',
    distance: String(drive.distance ?? ''),
    duration_min: String(drive.duration_min ?? ''),
    end_battery_level: String(drive.end_battery_level ?? ''),
    speed_max: String(drive.speed_max ?? ''),
    end_range_km: String(drive.end_range_km ?? ''),
  });

  const updateMut = useMutation({
    mutationFn: () => {
      const data: Record<string, unknown> = {};
      if (form.end_date) data.end_date = form.end_date;
      if (form.distance) data.distance = Number(form.distance);
      if (form.duration_min) data.duration_min = Number(form.duration_min);
      if (form.end_battery_level) data.end_battery_level = Number(form.end_battery_level);
      if (form.speed_max) data.speed_max = Number(form.speed_max);
      if (form.end_range_km) data.end_range_km = Number(form.end_range_km);
      return request(`/data-repair/drives/${drive.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    },
    onSuccess: () => { toast.success(t('Drive updated')); qc.invalidateQueries({ queryKey: ['stale-sessions'] }); onClose(); },
    onError: () => toast.error(t('Failed to update drive')),
  });

  const closeMut = useMutation({
    mutationFn: () => request(`/data-repair/drives/${drive.id}/close`, { method: 'POST' }),
    onSuccess: () => { toast.success(t('Drive closed')); qc.invalidateQueries({ queryKey: ['stale-sessions'] }); onClose(); },
    onError: () => toast.error(t('Failed to close drive')),
  });

  const discardMut = useMutation({
    mutationFn: () => request(`/data-repair/drives/${drive.id}`, { method: 'DELETE' }),
    onSuccess: () => { toast.success(t('Drive discarded')); qc.invalidateQueries({ queryKey: ['stale-sessions'] }); onClose(); },
    onError: () => toast.error(t('Failed to discard drive')),
  });

  return (
    <GlassPanel className="p-4 space-y-4 bg-neon-amber/[0.03] border-neon-amber/20">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Input label={t('End Date (ISO)')} value={form.end_date} placeholder="2026-03-30T04:00:00Z" onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
        <Input label={t('Distance (km)')} type="number" value={form.distance} onChange={e => setForm(f => ({ ...f, distance: e.target.value }))} />
        <Input label={t('Duration (min)')} type="number" value={form.duration_min} onChange={e => setForm(f => ({ ...f, duration_min: e.target.value }))} />
        <Input label={t('End Battery %')} type="number" value={form.end_battery_level} onChange={e => setForm(f => ({ ...f, end_battery_level: e.target.value }))} />
        <Input label={t('Max Speed (km/h)')} type="number" value={form.speed_max} onChange={e => setForm(f => ({ ...f, speed_max: e.target.value }))} />
        <Input label={t('End Range (km)')} type="number" value={form.end_range_km} onChange={e => setForm(f => ({ ...f, end_range_km: e.target.value }))} />
      </div>
      <div className="flex items-center gap-2 pt-2">
        <Button variant="secondary" size="sm" onClick={() => updateMut.mutate()} loading={updateMut.isPending} icon={<Save className="h-3.5 w-3.5" />}>{t('Save')}</Button>
        <Button variant="secondary" size="sm" onClick={() => closeMut.mutate()} loading={closeMut.isPending} icon={<Clock className="h-3.5 w-3.5" />}>{t('Close Drive')}</Button>
        <Button variant="danger" size="sm" onClick={() => discardMut.mutate()} loading={discardMut.isPending} icon={<Trash2 className="h-3.5 w-3.5" />}>{t('Discard')}</Button>
        <Button variant="ghost" size="sm" onClick={onClose} icon={<X className="h-3.5 w-3.5" />} className="ml-auto">{t('Cancel')}</Button>
      </div>
    </GlassPanel>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function DataRepairPage() {
  const { t } = useTranslation();
  usePageTitle(t('Data Repair'));

  const [tab, setTab] = useState<Tab>('charging');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['stale-sessions'],
    queryFn: () => request<StaleData>('/data-repair/stale'),
    refetchInterval: 30_000,
  });

  const staleCharging = data?.stale_charging ?? [];
  const staleDrives = data?.stale_drives ?? [];
  const totalStale = staleCharging.length + staleDrives.length;

  const records = tab === 'charging' ? staleCharging : staleDrives;

  return (
    <PageContainer
      title={t('Data Repair')}
      subtitle={totalStale > 0 ? `${totalStale} ${t('incomplete session')}${totalStale !== 1 ? 's' : ''} ${t('found')}` : t('Fix incomplete or stale sessions')}
      loading={isLoading}
      error={error as Error | null}
    >
      {/* ── Stats ────────────────────────────────────────────────── */}
      <FadeIn>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricCard label={t('Total Stale')} value={totalStale} icon={<AlertTriangle className="h-4 w-4" />} color="amber" />
          <MetricCard label={t('Stale Charging')} value={staleCharging.length} icon={<BatteryCharging className="h-4 w-4" />} color="cyan" />
          <MetricCard label={t('Stale Drives')} value={staleDrives.length} icon={<Route className="h-4 w-4" />} color="purple" />
          <MetricCard label={t('Status')} value={totalStale === 0 ? t('Clean') : t('Needs Repair')} icon={<Wrench className="h-4 w-4" />} color={totalStale === 0 ? 'green' : 'red'} />
        </div>
      </FadeIn>

      {/* ── Tab buttons ──────────────────────────────────────────── */}
      <FadeIn>
        <div className="flex items-center gap-1 rounded-xl bg-white/[0.03] p-1 ring-1 ring-white/[0.06] w-fit">
          <Button
            variant="ghost"
            size="sm"
            icon={<BatteryCharging className="h-4 w-4" />}
            onClick={() => { setTab('charging'); setExpandedId(null); }}
            className={cn('border', tab === 'charging' ? 'bg-neon-amber/15 text-neon-amber border-neon-amber/20' : 'border-transparent text-[var(--text-secondary)]')}
          >
            {t('Charging Sessions')}
            {staleCharging.length > 0 && <Badge variant="warning" size="sm" className="ml-1">{staleCharging.length}</Badge>}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Route className="h-4 w-4" />}
            onClick={() => { setTab('drives'); setExpandedId(null); }}
            className={cn('border', tab === 'drives' ? 'bg-neon-amber/15 text-neon-amber border-neon-amber/20' : 'border-transparent text-[var(--text-secondary)]')}
          >
            {t('Drives')}
            {staleDrives.length > 0 && <Badge variant="warning" size="sm" className="ml-1">{staleDrives.length}</Badge>}
          </Button>
        </div>
      </FadeIn>

      {/* ── Content ──────────────────────────────────────────────── */}
      <FadeIn>
        {records.length === 0 ? (
          <EmptyState
            icon={<CheckCircle className="h-10 w-10" />}
            title={t('All sessions are complete')}
            message={t(tab === 'charging' ? 'No stale charging sessions found.' : 'No stale drives found.')}
          />
        ) : (
          <div className="space-y-3">
            {tab === 'charging' ? (
              staleCharging.map(s => (
                <div key={s.id}>
                  <GlassPanel
                    className={cn('p-4 cursor-pointer transition-all', expandedId === s.id ? 'bg-neon-amber/[0.06] border-neon-amber/20' : 'hover:border-white/10')}
                    onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                  >
                    <div className="flex items-center gap-4 flex-wrap">
                      <span className="text-xs font-mono text-[var(--text-muted)] w-12 shrink-0">#{s.id}</span>
                      <span className="text-xs text-[var(--text-secondary)] w-40 shrink-0">{formatDateTime(s.start_date)}</span>
                      <span className="text-xs text-[var(--text-primary)] w-16 shrink-0">{s.start_battery_level}%</span>
                      <span className="text-xs text-[var(--text-muted)] w-16 shrink-0">{t('Vehicle')} {s.vehicle_id}</span>
                      <span className="text-xs text-neon-amber font-medium w-16 shrink-0">{hoursOpen(s.start_date)}</span>
                      <Badge variant="warning" size="sm"><AlertTriangle className="h-3 w-3 inline mr-0.5" />{t('Open')}</Badge>
                    </div>
                  </GlassPanel>
                  {expandedId === s.id && <ChargingEditForm session={s} onClose={() => setExpandedId(null)} t={t} />}
                </div>
              ))
            ) : (
              staleDrives.map(d => (
                <div key={d.id}>
                  <GlassPanel
                    className={cn('p-4 cursor-pointer transition-all', expandedId === d.id ? 'bg-neon-amber/[0.06] border-neon-amber/20' : 'hover:border-white/10')}
                    onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}
                  >
                    <div className="flex items-center gap-4 flex-wrap">
                      <span className="text-xs font-mono text-[var(--text-muted)] w-12 shrink-0">#{d.id}</span>
                      <span className="text-xs text-[var(--text-secondary)] w-40 shrink-0">{formatDateTime(d.start_date)}</span>
                      <span className="text-xs text-[var(--text-primary)] w-16 shrink-0">{d.start_battery_level != null ? `${d.start_battery_level}%` : '—'}</span>
                      <span className="text-xs text-[var(--text-muted)] w-16 shrink-0">{t('Vehicle')} {d.vehicle_id}</span>
                      <span className="text-xs text-neon-amber font-medium w-16 shrink-0">{hoursOpen(d.start_date)}</span>
                      <Badge variant="warning" size="sm"><AlertTriangle className="h-3 w-3 inline mr-0.5" />{t('Open')}</Badge>
                    </div>
                  </GlassPanel>
                  {expandedId === d.id && <DriveEditForm drive={d} onClose={() => setExpandedId(null)} t={t} />}
                </div>
              ))
            )}
          </div>
        )}
      </FadeIn>
    </PageContainer>
  );
}
