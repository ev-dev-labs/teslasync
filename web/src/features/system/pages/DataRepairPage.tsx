/**
 * Evidence-backed session repair worklist. Suggestions remain visible until a
 * fresh diagnosis confirms resolution, and every mutation requires per-row
 * operator confirmation.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle, BatteryCharging, RefreshCw, Route, ShieldAlert, Wrench,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { Button, Text } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import {
  InlineCallout,
  OperationalWriteNotice,
} from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { AIDataRepairSuggestions } from '@/components/ai/AIDataRepairSuggestions';
import {
  repairApplyInput,
  useApplyChargingRepair,
  useApplyDriveRepair,
  useRepairSuggestions,
  useStaleSessions,
  type RepairSuggestion,
} from '@/api/hooks/useDataRepair';

import { RepairSuggestionSection } from '../components/RepairSuggestionSection';
import { StaleChargingWorklist } from '../components/StaleChargingWorklist';
import { StaleDriveWorklist } from '../components/StaleDriveWorklist';

/** Stable per-row key across both suggestion sections. */
function rowKey(s: RepairSuggestion): string {
  return `${s.kind}-${s.session_id}`;
}

/** Human-readable failure text for a per-row mutation error. */
function errorText(err: unknown): string | undefined {
  if (err == null) return undefined;
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return undefined;
}

export default function DataRepairPage() {
  const { t } = useTranslation();
  usePageTitle(t('dataRepair.title', 'Data Repair'));

  const operationalMode = useOperationalMode();

  const suggestionsQuery = useRepairSuggestions();
  const staleQuery = useStaleSessions();

  const driveSuggestions = suggestionsQuery.data?.drive_suggestions ?? [];
  const chargingSuggestions = suggestionsQuery.data?.charging_suggestions ?? [];
  const totalSuggestions = driveSuggestions.length + chargingSuggestions.length;
  const blockedCount = useMemo(
    () => [...driveSuggestions, ...chargingSuggestions].filter((s) => !s.applicable).length,
    [driveSuggestions, chargingSuggestions],
  );

  const staleCharging = staleQuery.data?.stale_charging ?? [];
  const staleDrives = staleQuery.data?.stale_drives ?? [];
  const totalStale = staleCharging.length + staleDrives.length;

  // Per-row apply state, keyed `<kind>-<id>` so two rows never share a spinner
  // or an error banner.
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [appliedKeys, setAppliedKeys] = useState<string[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const applyDrive = useApplyDriveRepair();
  const applyCharging = useApplyChargingRepair();

  const handleApply = (s: RepairSuggestion) => {
    const key = rowKey(s);
    setPendingKey(key);
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });

    const mutation = s.kind === 'drive' ? applyDrive : applyCharging;
    mutation.mutate(repairApplyInput(s), {
      onSuccess: () => {
        setPendingKey(null);
        // The card stays on screen with a success marker until the operator
        // refreshes — a suggestion must never disappear before a fresh
        // diagnosis confirms it is resolved.
        setAppliedKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
      },
      onError: (err) => {
        setPendingKey(null);
        setRowErrors((prev) => ({
          ...prev,
          [key]:
            errorText(err) ??
            t('dataRepair.card.genericError', 'The repair was rejected. Refresh and review again.'),
        }));
      },
    });
  };

  // A single expanded key across both stale panels so only one manual repair
  // form is open at a time (keyed `charging-<id>` / `drive-<id>`).
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const toggle = (key: string) => {
    if (!operationalMode.canWrite) return;
    setExpandedKey((cur) => (cur === key ? null : key));
  };
  const collapse = () => setExpandedKey(null);

  useEffect(() => {
    if (!operationalMode.canWrite) setExpandedKey(null);
  }, [operationalMode.canWrite]);

  const subtitle =
    totalSuggestions > 0
      ? t('dataRepair.subtitle.suggestions', '{{count}} session boundary(s) contradicted by later evidence', {
          count: totalSuggestions,
        })
      : t('dataRepair.subtitle.clean', 'Find and repair broken drive and charging session boundaries');

  const refreshAll = () => {
    void suggestionsQuery.refetch();
    void staleQuery.refetch();
  };

  const actions = (
    <Button
      variant="ghost"
      onClick={refreshAll}
      loading={suggestionsQuery.isFetching || staleQuery.isFetching}
      icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
      aria-label={t('common.refresh', 'Refresh')}
      className="min-h-11"
      data-testid="data-repair-refresh"
    />
  );

  return (
    <PageContainer
      title={t('dataRepair.title', 'Data Repair')}
      subtitle={subtitle}
      actions={actions}
      query={[suggestionsQuery, staleQuery]}
    >
      <OperationalWriteNotice
        title={t('dataRepair.readOnly.title', 'Data repair is read-only')}
      />

      {/* 1 — KPI band: what the diagnosis found. */}
      <FadeIn>
        <section
          aria-label={t('dataRepair.kpis', 'Repair summary')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
        >
          <MetricCard
            label={t('dataRepair.kpi.suggestions', 'Suggested Repairs')}
            value={totalSuggestions}
            icon={<Wrench className="h-4 w-4" />}
            color="amber"
          />
          <MetricCard
            label={t('dataRepair.kpi.driveSuggestions', 'Drive Boundaries')}
            value={driveSuggestions.length}
            icon={<Route className="h-4 w-4" />}
            color="purple"
          />
          <MetricCard
            label={t('dataRepair.kpi.chargingSuggestions', 'Charging Boundaries')}
            value={chargingSuggestions.length}
            icon={<BatteryCharging className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('dataRepair.kpi.blocked', 'Blocked')}
            value={blockedCount}
            icon={<AlertTriangle className="h-4 w-4" />}
            color={blockedCount === 0 ? 'green' : 'red'}
          />
        </section>
      </FadeIn>

      {/* 2 — How the diagnosis works + what an apply does. */}
      <FadeIn delay={0.1}>
        <InlineCallout variant="warning" icon={<ShieldAlert />}>
          {t(
            'dataRepair.callout',
            'Suggestions come from durable history only: a session is listed when its stored state is contradicted by a later signal, never because it is simply old. Applying a repair rewrites the end timestamp (and, for drives, the derived duration) of that one session, is recorded in the audit log, and is never done automatically.',
          )}
        </InlineCallout>
      </FadeIn>

      {suggestionsQuery.data?.truncated && (
        <FadeIn delay={0.12}>
          <InlineCallout variant="info" icon={<AlertTriangle />}>
            {t(
              'dataRepair.truncated',
              'The scan hit its per-request limit, so more sessions may need repair than are listed here. Apply what is shown and refresh.',
            )}
          </InlineCallout>
        </FadeIn>
      )}

      {/* 3 — AI repair suggestions (opt-in; the HOC renders null when ai_mode='off') */}
      <FadeIn delay={0.15}>
        <AIDataRepairSuggestions />
      </FadeIn>

      {/* 4 — The two evidence-backed worklists. */}
      <FadeIn delay={0.2}>
        <section
          aria-label={t('dataRepair.suggestionsRegion', 'Suggested repairs')}
          className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2 xl:gap-5"
        >
          <RepairSuggestionSection
            items={driveSuggestions}
            title={t('dataRepair.drives.suggestionsTitle', 'Drive Boundaries')}
            emptyTitle={t(
              'dataRepair.drives.suggestionsEmptyTitle',
              'No contradicted drive boundaries',
            )}
            emptyMessage={t(
              'dataRepair.drives.suggestionsEmpty',
              'Every drive in the scanned window agrees with the durable signal history.',
            )}
            icon={<Route className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
            isLoading={suggestionsQuery.isLoading}
            isError={suggestionsQuery.isError}
            error={suggestionsQuery.error}
            onRetry={() => void suggestionsQuery.refetch()}
            pendingKey={pendingKey}
            appliedKeys={appliedKeys}
            rowErrors={rowErrors}
            onApply={handleApply}
            disabled={!operationalMode.canWrite}
            disabledReason={operationalMode.writeBlockReason ?? undefined}
          />
          <RepairSuggestionSection
            items={chargingSuggestions}
            title={t('dataRepair.charging.suggestionsTitle', 'Charging Boundaries')}
            emptyTitle={t(
              'dataRepair.charging.suggestionsEmptyTitle',
              'No contradicted charging boundaries',
            )}
            emptyMessage={t(
              'dataRepair.charging.suggestionsEmpty',
              'Every charging session in the scanned window agrees with the durable signal history.',
            )}
            icon={<BatteryCharging className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
            isLoading={suggestionsQuery.isLoading}
            isError={suggestionsQuery.isError}
            error={suggestionsQuery.error}
            onRetry={() => void suggestionsQuery.refetch()}
            pendingKey={pendingKey}
            appliedKeys={appliedKeys}
            rowErrors={rowErrors}
            onApply={handleApply}
            disabled={!operationalMode.canWrite}
            disabledReason={operationalMode.writeBlockReason ?? undefined}
          />
        </section>
      </FadeIn>

      {/* 5 — Manual fallback: incomplete sessions with no contradicting evidence. */}
      <FadeIn delay={0.25}>
        <section
          aria-label={t('dataRepair.worklist', 'Repair worklist')}
          className="space-y-3"
        >
          <Text as="p" variant="bodySm">
            {t(
              'dataRepair.stale.intro',
              'Incomplete sessions with no contradicting evidence. These are listed for manual inspection only — nothing in the recorded history establishes where they should end.',
            )}
            {totalStale > 0 ? ` (${totalStale})` : ''}
          </Text>
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2 xl:gap-5">
            <StaleChargingWorklist
              sessions={staleCharging}
              isLoading={staleQuery.isLoading}
              isError={staleQuery.isError}
              error={staleQuery.error}
              onRetry={() => void staleQuery.refetch()}
              expandedKey={expandedKey}
              onToggle={toggle}
              onCollapse={collapse}
              disabled={!operationalMode.canWrite}
              disabledReason={operationalMode.writeBlockReason ?? undefined}
            />
            <StaleDriveWorklist
              drives={staleDrives}
              isLoading={staleQuery.isLoading}
              isError={staleQuery.isError}
              error={staleQuery.error}
              onRetry={() => void staleQuery.refetch()}
              expandedKey={expandedKey}
              onToggle={toggle}
              onCollapse={collapse}
              disabled={!operationalMode.canWrite}
              disabledReason={operationalMode.writeBlockReason ?? undefined}
            />
          </div>
        </section>
      </FadeIn>
    </PageContainer>
  );
}
