/**
 * AutomationsListPage — the automations command center.
 *
 * Full-width, mobile-first bento: a KPI band, a filter toolbar, a collapsible
 * quick-start preset gallery, and a hero split that pairs the automations
 * workspace (cards) with a live activity-feed sidebar on wide screens. Every
 * data-bound section owns its own loading / empty / error state.
 */
import { useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout';
import {
  GlassPanel, Button, Input, Select, Badge, SectionTitle, Text, Caption,
} from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import {
  AlertBanner,
  EmptyState,
  OperationalWriteNotice,
  QueryError,
  Skeleton,
} from '@/components/feedback';
import { EmptyStateGuidanceDetails } from '@/components/feedback/ActionableEmptyState';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useAutomationEvents } from '@/hooks/useAutomationEvents';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import {
  useAutomations,
  useAutomationHistory,
  useToggleAutomation,
  useDeleteAutomation,
  useTestRunAutomation,
  useReEnableAutomation,
  useImportAutomations,
} from '@/api/hooks/useAutomations';
import { useVehicles } from '@/api/hooks/useVehicles';
import { usePinned } from '@/api/hooks/usePinned';
import { AutomationCard } from './AutomationCard';
import { AutomationActivityFeed } from './AutomationActivityFeed';
import { PresetGallery } from './PresetGallery';
import {
  Zap, Plus, Upload, ListFilter, AlertTriangle,
  Pause, Power, ShieldOff, Sparkles, ChevronRight,
} from 'lucide-react';
import type { Automation } from '@/api/types';

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

export function computeStats(automations: Automation[]): AutomationStats {
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

export function buildVehicleLookup(vehicles: { id: number; display_name: string }[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const v of vehicles) {
    map.set(v.id, v.display_name);
  }
  return map;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isAutomationImportEnvelope(value: unknown): value is AutomationImportEnvelope {
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

  // Data hooks — each section below owns its own loading / empty / error state.
  const {
    data: automations,
    isLoading,
    isError,
    error,
    refetch,
  } = useAutomations();
  const {
    data: historyResponse,
    isLoading: historyLoading,
    error: historyError,
  } = useAutomationHistory(20);
  const { data: vehicles } = useVehicles();
  const { events: liveEvents, connectionState, firingNow } = useAutomationEvents({ maxEvents: 50 });

  // Mutations
  const toggleMutation = useToggleAutomation();
  const deleteMutation = useDeleteAutomation();
  const testRunMutation = useTestRunAutomation();
  const reEnableMutation = useReEnableAutomation();
  const importMutation = useImportAutomations();
  const operationalMode = useOperationalMode();

  // Import file input — validation errors surface via alert; network
  // success/failure is handled by the mutation's toast + query invalidation.
  const importInputRef = useRef<HTMLInputElement>(null);
  const handleImportFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed: unknown = JSON.parse(text);
        if (!isAutomationImportEnvelope(parsed)) {
          throw new Error(
            t(
              'automations.importTypedEnvelopeRequired',
              'Import a typed TeslaSync CTI automation export file. Legacy automation exports are rejected rather than translated.',
            ),
          );
        }
        importMutation.mutate(parsed);
      } catch (err) {
        const message = err instanceof Error
          ? err.message
          : t('automations.importUnknownError', 'Unknown error');
        window.alert(
          t('automations.importFailedWithReason', 'Typed automation import failed: {{message}}', {
            message,
          }),
        );
      } finally {
        if (importInputRef.current) importInputRef.current.value = '';
      }
    },
    [t, importMutation],
  );

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

    const query = search.trim();
    if (query) {
      const q = query.toLowerCase();
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

  const hasActiveFilter = statusFilter !== 'all' || search.trim().length > 0;

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
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Input
            ref={importInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImportFile}
            disabled={!operationalMode.canWrite}
            aria-label={t('automations.importFileLabel', 'Choose automation export file')}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => importInputRef.current?.click()}
            loading={importMutation.isPending}
            disabled={!operationalMode.canWrite}
            title={operationalMode.writeBlockReason ?? undefined}
          >
            <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t('automations.import', 'Import')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => navigate('/automations/new')}
            disabled={!operationalMode.canWrite}
            title={operationalMode.writeBlockReason ?? undefined}
          >
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t('automations.create', 'Create')}
          </Button>
        </div>
      }
    >
      <OperationalWriteNotice
        title={t(
          'automations.readOnly.title',
          'Automation controls are read-only',
        )}
      />

      {/* 1 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        <section
          aria-label={t('automations.stats.aria', 'Automation summary')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        >
          <MetricCard
            label={t('automations.stats.total', 'Total')}
            value={stats.total}
            icon={<ListFilter className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t('automations.stats.active', 'Active')}
            value={stats.active}
            icon={<Power className="h-5 w-5" />}
            color="green"
          />
          <MetricCard
            label={t('automations.stats.disabled', 'Disabled')}
            value={stats.disabled}
            icon={<Pause className="h-5 w-5" />}
            color="blue"
          />
          <MetricCard
            label={t('automations.stats.autoDisabled', 'Auto-Disabled')}
            value={stats.autoDisabled}
            icon={<ShieldOff className="h-5 w-5" />}
            color="red"
            className={stats.autoDisabled > 0 ? 'border-neon-red/30' : undefined}
          />
        </section>
      </FadeIn>

      {/* 2 — Auto-disabled warning (conditional, self-contained) */}
      {stats.autoDisabled > 0 && (
        <FadeIn delay={0.03}>
          <AlertBanner
            variant="danger"
            icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
            title={t('automations.autoDisabledTitle', 'Attention needed')}
          >
            {t(
              'automations.autoDisabledWarning',
              '{{count}} automation(s) have been auto-disabled due to repeated failures.',
              { count: stats.autoDisabled },
            )}
          </AlertBanner>
        </FadeIn>
      )}

      {/* 3 — Filter toolbar */}
      <FadeIn delay={0.05}>
        <GlassPanel className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Select
              options={localizedStatusFilterOptions}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="w-full sm:w-44"
              aria-label={t('automations.filterStatus', 'Filter by status')}
            />
            <Input
              placeholder={t('automations.search', 'Search automations...')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full sm:w-64"
              aria-label={t('automations.search', 'Search automations...')}
            />
            {hasActiveFilter && (
              <Badge variant="neutral" className="self-start sm:self-auto">
                {t('automations.filterCount', '{{shown}} / {{total}}', {
                  shown: filteredItems.length,
                  total: items.length,
                })}
              </Badge>
            )}
          </div>
        </GlassPanel>
      </FadeIn>

      {/* 4 — Quick-start preset gallery (collapsible) */}
      <FadeIn delay={0.07}>
        <GlassPanel className="p-4 sm:p-5">
          <details className="group">
            <summary
              className="flex items-center gap-2 cursor-pointer select-none rounded-md -m-1 p-1 transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 [&::-webkit-details-marker]:hidden [&::marker]:content-none"
              aria-label={t('automations.presets.toggleAria', 'Show or hide quick start templates')}
            >
              <ChevronRight
                className="h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform duration-normal group-open:rotate-90"
                aria-hidden="true"
              />
              <Sparkles className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
              <Text variant="body" className="font-semibold">
                {t('automations.presets.title', 'Quick Start Templates')}
              </Text>
              <Caption className="ml-1 hidden sm:inline">
                {t('automations.presets.hint', 'One-click install')}
              </Caption>
              <Caption className="ml-auto group-open:hidden">
                {t('automations.presets.expand', 'Click to expand')}
              </Caption>
              <Caption className="ml-auto hidden group-open:inline">
                {t('automations.presets.collapse', 'Click to collapse')}
              </Caption>
            </summary>
            <div className="mt-4">
              <PresetGallery
                actionsDisabled={!operationalMode.canWrite}
                actionsDisabledReason={operationalMode.writeBlockReason ?? undefined}
              />
            </div>
          </details>
        </GlassPanel>
      </FadeIn>

      {/* 5 — Hero split: automations workspace + live activity sidebar */}
      <FadeIn delay={0.09}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
          {/* Automations workspace (hero, spans 2 of 3 on wide screens) */}
          <div className="min-w-0 space-y-3 xl:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionTitle>{t('automations.yourAutomations', 'Your Automations')}</SectionTitle>
              <Caption>
                {t('automations.showingCount', 'Showing {{count}}', { count: sortedItems.length })}
              </Caption>
            </div>

            {isError ? (
              <GlassPanel className="p-6">
                <QueryError error={error} onRetry={() => refetch()} />
              </GlassPanel>
            ) : isLoading ? (
              <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={`auto-skel-${i}`} className="h-40 w-full rounded-xl" />
                ))}
              </div>
            ) : sortedItems.length > 0 ? (
              <StaggerContainer className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
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
                      actionsDisabled={!operationalMode.canWrite}
                      actionsDisabledReason={operationalMode.writeBlockReason ?? undefined}
                    />
                  </StaggerItem>
                ))}
              </StaggerContainer>
            ) : items.length === 0 ? (
              <GlassPanel className="p-8">
                <EmptyState
                  icon={<Zap className="h-8 w-8" />}
                  message={t('automations.empty', 'No automations yet. Create a typed automation to get started!')}
                  actionTo={operationalMode.canWrite
                    ? {
                        label: t('automations.empty.cta', 'Create automation'),
                        to: '/automations/new',
                      }
                    : undefined}
                />
                {/* HELP-02 — this list is empty BY DESIGN (automations are
                    opt-in and never created for you), which is exactly the
                    thing a bare empty state cannot say. */}
                <EmptyStateGuidanceDetails
                  guidanceId="automations.list"
                  className="mx-auto"
                />
              </GlassPanel>
            ) : (
              <GlassPanel className="p-8">
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
              </GlassPanel>
            )}
          </div>

          {/* Live activity feed (context sidebar, spans 1 of 3; sticky on wide) */}
          <div className="min-w-0 xl:col-span-1">
            <div className="xl:sticky xl:top-4">
              <AutomationActivityFeed
                history={historyItems}
                historyStats={historyStats}
                isLoading={historyLoading}
                error={historyError}
                liveEvents={liveEvents}
                connectionState={connectionState}
              />
            </div>
          </div>
        </section>
      </FadeIn>
    </PageContainer>
  );
}
