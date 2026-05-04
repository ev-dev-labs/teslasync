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
import { GlassPanel, Button as UiButton, Input as UiInput, Select as UiSelect, Badge } from '@/components/ui';
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
import { usePinned } from '@/api/hooks/usePinned';
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

interface AutomationImportEnvelope {
  version: number;
  exported_at?: string;
  automations: unknown[];
}

const statusFilterOptions: { value: StatusFilter; key: string; fallback: string }[] = [
  { value: 'all', key: 'automations.filters.all', fallback: 'All' },
  { value: 'active', key: 'automations.filters.active', fallback: 'Active' },
  { value: 'disabled', key: 'automations.filters.disabled', fallback: 'Disabled' },
  { value: 'auto-disabled', key: 'automations.filters.autoDisabled', fallback: 'Auto-Disabled' },
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAutomationImportEnvelope(value: unknown): value is AutomationImportEnvelope {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.version === 'number' && Array.isArray(value.automations);
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
      const data: unknown = JSON.parse(text);
      if (!isAutomationImportEnvelope(data)) {
        throw new Error(t(
          'automations.importTypedEnvelopeRequired',
          'Import a typed TeslaSync CTI automation export file. Legacy automation exports are rejected rather than translated.',
        ));
      }
      const { request } = await import('@/api/client');
      await request('/automations/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      window.location.reload();
    } catch (err) {
      console.error('Import failed:', err);
      const message = err instanceof Error
        ? err.message
        : t('automations.importUnknownError', 'Unknown error');
      window.alert(t(
        'automations.importFailedWithReason',
        'Typed automation import failed: {{message}}',
        { message },
      ));
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }, [t]);

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

  // Safe data
  const items = automations ?? [];
  const localizedStatusFilterOptions = useMemo(
    () => statusFilterOptions.map((option) => ({
      value: option.value,
      label: t(option.key, option.fallback),
    })),
    [t],
  );
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

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (a) =>
          (a.name ?? '').toLowerCase().includes(q) ||
          (a.description ?? '').toLowerCase().includes(q),
      );
    }

    return result;
  }, [items, statusFilter, search]);

  const { data: automationPins = [] } = usePinned('automation');
  const sortedItems = useMemo(() => {
    if (automationPins.length === 0) return filteredItems;
    const order = new Map<string, number>();
    automationPins.forEach((p) => order.set(String(p.item_id), p.position));
    return [...filteredItems].sort((a, b) => {
      const ap = order.get(String(a.id));
      const bp = order.get(String(b.id));
      if (ap != null && bp != null) return ap - bp;
      if (ap != null) return -1;
      if (bp != null) return 1;
      return 0;
    });
  }, [filteredItems, automationPins]);

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
      subtitle={t('automations.subtitle', 'Automate vehicle actions with typed triggers, conditions, and action chains')}
      loading={isLoading}
      actions={
        <div className="flex items-center gap-2">
          <UiInput
            ref={importInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImportFile}
          />
          <UiButton type="button" variant="ghost" size="sm" onClick={() => importInputRef.current?.click()}>
            <Upload className="mr-1.5 h-4 w-4" />
            {t('automations.import', 'Import')}
          </UiButton>
          <UiButton type="button" variant="primary" size="sm" onClick={() => navigate('/automations/new')}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t('automations.create', 'Create')}
          </UiButton>
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
            icon={<Pause className="h-4 w-4 text-[var(--text-secondary)]" />}
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
            <UiSelect
              options={localizedStatusFilterOptions}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="w-40"
              aria-label={t('automations.filterStatus', 'Filter by status')}
            />
            <UiInput
              placeholder={t('automations.search', 'Search automations...')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-64"
            />
            {(statusFilter !== 'all' || search) && (
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
            <summary className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-[var(--text-primary)] select-none">
              <Sparkles className="h-4 w-4 text-cyan-400" />
              {t('automations.presets.title', 'Quick Start Templates')}
              <span className="text-xs font-normal text-[var(--text-muted)] ml-1">
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
            {sortedItems.map((a) => (
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
            {items.length === 0 ? (
              <EmptyState
                icon={<Zap className="h-8 w-8" />}
                message={t('automations.empty', 'No automations yet. Create a typed automation to get started!')}
                actionTo={{
                  label: t('automations.empty.cta', 'Create automation'),
                  to: '/automations/new',
                }}
              />
            ) : (
              <EmptyState
                icon={<Zap className="h-8 w-8" />}
                message={t('automations.noMatch', 'No automations match your filters')}
                action={{
                  label: t('automations.noMatch.cta', 'Reset filters'),
                  onClick: () => {
                    setSearch('');
                    setStatusFilter('all');
                  },
                }}
              />
            )}
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
