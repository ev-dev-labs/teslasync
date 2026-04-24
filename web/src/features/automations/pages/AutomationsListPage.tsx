/**
 * AutomationsListPage — the main automations hub.
 *
 * Displays automation cards with toggles, a stats bar, filters,
 * and a live activity feed powered by SSE.
 */
import { useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/data-display/StatCard';
import { EmptyState } from '@/components/feedback/EmptyState';
import { FadeIn } from '@/components/motion/FadeIn';
import { StaggerContainer } from '@/components/motion/StaggerContainer';
import { StaggerItem } from '@/components/motion/StaggerItem';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useAutomationEvents } from '@/hooks/useAutomationEvents';
import {
  useAutomations,
  useAutomationHistory,
  useToggleAutomation,
  useDeleteAutomation,
  useTestRunAutomation,
  useReEnableAutomation,
} from '@/api/hooks/useAutomations';
import { useVehicles } from '@/api/hooks/useVehicles';
import { AutomationCard } from './AutomationCard';
import { AutomationActivityFeed } from './AutomationActivityFeed';
import {
  Zap, Plus, Upload, ListFilter, AlertTriangle,
  Pause, Power, ShieldOff, Sparkles,
} from 'lucide-react';
import type { Automation } from '@/api/types';
import { PresetGallery } from './PresetGallery';

// ─── Filter types ─────────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'active' | 'disabled' | 'auto-disabled';
type TriggerFilter = 'all' | string;

const statusFilterOptions = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'disabled', label: 'Disabled' },
  { value: 'auto-disabled', label: 'Auto-Disabled' },
];

const triggerTypeOptions = [
  { value: 'all', label: 'All Triggers' },
  { value: 'cron', label: 'Schedule' },
  { value: 'state_change', label: 'State Change' },
  { value: 'geofence', label: 'Geofence' },
  { value: 'threshold', label: 'Threshold' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'sunrise_sunset', label: 'Sunrise/Sunset' },
  { value: 'manual', label: 'Manual' },
];

// ─── Stats computation ────────────────────────────────────────────────────────

interface AutomationStats {
  total: number;
  active: number;
  disabled: number;
  autoDisabled: number;
}

function computeStats(automations: Automation[]): AutomationStats {
  let active = 0;
  let disabled = 0;
  let autoDisabled = 0;

  for (const a of automations) {
    if (a.auto_disabled) {
      autoDisabled++;
    } else if (a.enabled) {
      active++;
    } else {
      disabled++;
    }
  }

  return { total: automations.length, active, disabled, autoDisabled };
}

// ─── Vehicle lookup helper ────────────────────────────────────────────────────

function buildVehicleLookup(vehicles: { id: number; display_name: string }[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const v of vehicles) {
    map.set(v.id, v.display_name);
  }
  return map;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AutomationsListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  usePageTitle(t('automations.title', 'Automations'));

  // Data hooks
  const { data: automations, isLoading } = useAutomations();
  const { data: historyResponse, isLoading: historyLoading } = useAutomationHistory(20);
  const { data: vehicles } = useVehicles();
  const { events: liveEvents, connectionState, firingNow } = useAutomationEvents({ maxEvents: 50 });

  // Mutations
  const toggleMutation = useToggleAutomation();
  const deleteMutation = useDeleteAutomation();
  const testRunMutation = useTestRunAutomation();
  const reEnableMutation = useReEnableAutomation();

  // Import file ref
  const importInputRef = useRef<HTMLInputElement>(null);
  const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const body = Array.isArray(data) ? data : [data];
      const { request } = await import('@/api/client');
      await request('/automations/import', { method: 'POST', body: JSON.stringify(body) });
      window.location.reload();
    } catch (err) {
      console.error('Import failed:', err);
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }, []);

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>('all');
  const [search, setSearch] = useState('');

  // Safe data
  const items = automations ?? [];
  const vehicleLookup = useMemo(
    () => buildVehicleLookup(vehicles ?? []),
    [vehicles],
  );
  const historyItems = historyResponse?.items ?? [];
  const historyStats = historyResponse?.summary ?? null;

  // Computed stats
  const stats = useMemo(() => computeStats(items), [items]);

  // Filtered list
  const filteredItems = useMemo(() => {
    let result = items;

    if (statusFilter !== 'all') {
      result = result.filter((a) => {
        if (statusFilter === 'active') return a.enabled && !a.auto_disabled;
        if (statusFilter === 'disabled') return !a.enabled && !a.auto_disabled;
        if (statusFilter === 'auto-disabled') return a.auto_disabled;
        return true;
      });
    }

    if (triggerFilter !== 'all') {
      result = result.filter((a) => a.trigger_type === triggerFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (a) =>
          (a.name ?? '').toLowerCase().includes(q) ||
          (a.description ?? '').toLowerCase().includes(q) ||
          (a.tags ?? []).some((tag) => tag.toLowerCase().includes(q)),
      );
    }

    return result;
  }, [items, statusFilter, triggerFilter, search]);

  // Callbacks
  const handleToggle = useCallback(
    (id: number, enabled: boolean) => {
      toggleMutation.mutate({ id, enabled });
    },
    [toggleMutation],
  );

  const handleReEnable = useCallback(
    (id: number) => {
      reEnableMutation.mutate(id);
    },
    [reEnableMutation],
  );

  const handleDelete = useCallback(
    (id: number) => {
      deleteMutation.mutate(id);
    },
    [deleteMutation],
  );

  const handleTestRun = useCallback(
    (id: number) => {
      testRunMutation.mutate(id);
    },
    [testRunMutation],
  );

  return (
    <PageContainer
      title={t('automations.title', 'Automations')}
      subtitle={t('automations.subtitle', 'Automate vehicle actions with triggers, conditions, and action chains')}
      loading={isLoading}
      actions={
        <div className="flex items-center gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImportFile}
          />
          <Button variant="ghost" size="sm" onClick={() => importInputRef.current?.click()}>
            <Upload className="mr-1.5 h-4 w-4" />
            {t('automations.import', 'Import')}
          </Button>
          <Button variant="primary" size="sm" onClick={() => navigate('/automations/new')}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t('automations.create', 'Create')}
          </Button>
        </div>
      }
    >
      {/* Stats bar */}
      <FadeIn>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label={t('automations.stats.total', 'Total')}
            value={stats.total}
            icon={<ListFilter className="h-4 w-4" />}
          />
          <StatCard
            label={t('automations.stats.active', 'Active')}
            value={stats.active}
            icon={<Power className="h-4 w-4 text-green-400" />}
          />
          <StatCard
            label={t('automations.stats.disabled', 'Disabled')}
            value={stats.disabled}
            icon={<Pause className="h-4 w-4 text-white/50" />}
          />
          <StatCard
            label={t('automations.stats.autoDisabled', 'Auto-Disabled')}
            value={stats.autoDisabled}
            icon={<ShieldOff className="h-4 w-4 text-red-400" />}
            className={stats.autoDisabled > 0 ? 'border-red-500/20' : undefined}
          />
        </div>
      </FadeIn>

      {/* Filters */}
      <FadeIn delay={0.03}>
        <GlassPanel className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              options={statusFilterOptions}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="w-40"
              aria-label={t('automations.filterStatus', 'Filter by status')}
            />
            <Select
              options={triggerTypeOptions}
              value={triggerFilter}
              onChange={(e) => setTriggerFilter(e.target.value as TriggerFilter)}
              className="w-44"
              aria-label={t('automations.filterTrigger', 'Filter by trigger')}
            />
            <Input
              placeholder={t('automations.search', 'Search automations...')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-64"
            />
            {(statusFilter !== 'all' || triggerFilter !== 'all' || search) && (
              <Badge variant="neutral" className="text-xs">
                {filteredItems.length} / {items.length}
              </Badge>
            )}
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Auto-disabled warning banner */}
      {stats.autoDisabled > 0 && (
        <FadeIn delay={0.04}>
          <div className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <span>
              {t(
                'automations.autoDisabledWarning',
                `${stats.autoDisabled} automation(s) have been auto-disabled due to repeated failures.`,
              )}
            </span>
          </div>
        </FadeIn>
      )}

      {/* Preset gallery (collapsible) */}
      <FadeIn delay={0.045}>
        <GlassPanel className="p-5">
          <details className="group">
            <summary className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-white/90 select-none">
              <Sparkles className="h-4 w-4 text-cyan-400" />
              {t('automations.presets.title', 'Quick Start Templates')}
              <span className="text-xs font-normal text-white/40 ml-1">
                {t('automations.presets.hint', 'One-click install')}
              </span>
            </summary>
            <div className="mt-4">
              <PresetGallery />
            </div>
          </details>
        </GlassPanel>
      </FadeIn>

      {/* Automation cards */}
      <FadeIn delay={0.05}>
        {filteredItems.length > 0 ? (
          <StaggerContainer className="space-y-3">
            {filteredItems.map((a) => (
              <StaggerItem key={a.id}>
                <AutomationCard
                  automation={a}
                  isFiring={firingNow.has(a.id)}
                  vehicleName={a.vehicle_id != null ? vehicleLookup.get(a.vehicle_id) : undefined}
                  onToggle={handleToggle}
                  onReEnable={handleReEnable}
                  onDelete={handleDelete}
                  onTestRun={handleTestRun}
                />
              </StaggerItem>
            ))}
          </StaggerContainer>
        ) : (
          <GlassPanel className="p-8">
            <EmptyState
              icon={<Zap className="h-8 w-8" />}
              message={
                items.length === 0
                  ? t('automations.empty', 'No automations yet. Create one to get started!')
                  : t('automations.noMatch', 'No automations match your filters')
              }
            />
          </GlassPanel>
        )}
      </FadeIn>

      {/* Activity feed */}
      <AutomationActivityFeed
        history={historyItems}
        historyStats={historyStats}
        isLoading={historyLoading}
        liveEvents={liveEvents}
        connectionState={connectionState}
      />
    </PageContainer>
  );
}
