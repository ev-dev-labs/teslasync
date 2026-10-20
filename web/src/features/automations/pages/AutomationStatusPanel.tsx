import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { automationNumber } from '@/api/hooks/useAutomations';
import { MetricBar } from '@/components/data-display';
import { DataSourceNotice, Skeleton, EmptyState, QueryError, AlertBanner } from '@/components/feedback';
import type { DataState } from '@/api/dataState';
import { Icons } from '@/lib/icons';

export interface AutomationStatusStats {
  total?: number;
  active?: number;
  disabled?: number;
  autoDisabled?: number;
}

interface AutomationStatusPanelProps {
  stats: AutomationStatusStats;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  dataState?: DataState<unknown>;
}

const STATUS_COLORS = {
  active: 'var(--text-secondary)',
  disabled: 'var(--text-muted)',
  autoDisabled: 'var(--text-secondary)',
} as const;

/**
 * AutomationStatusPanel — the bento context panel beside the table.
 *
 * Summarizes the fleet of automations as proportional health bars (active /
 * disabled / auto-disabled) and surfaces an actionable banner when any
 * automation has been auto-disabled after repeated failures. Owns its own
 * loading / empty / error states.
 */
export function AutomationStatusPanel({
  stats,
  isLoading: loading,
  error: sourceError,
  onRetry,
  dataState,
}: AutomationStatusPanelProps) {
  const { t } = useTranslation();
  const isLoading = dataState ? !dataState.hasData && !dataState.isRefreshBlocked && !dataState.fatalError && loading : loading;
  const error = dataState ? dataState.fatalError : sourceError;

  const total = dataState?.hasData === false ? null : automationNumber(stats.total);
  const active = dataState?.hasData === false ? null : automationNumber(stats.active);
  const disabled = dataState?.hasData === false ? null : automationNumber(stats.disabled);
  const autoDisabled = dataState?.hasData === false ? null : automationNumber(stats.autoDisabled);
  const max = total != null && total > 0 ? total : null;

  const rows = useMemo(
    () =>
      [
        {
          key: 'active',
          label: t('automationList.status.active', 'Active'),
          value: active,
          color: STATUS_COLORS.active,
        },
        {
          key: 'disabled',
          label: t('automationList.status.disabled', 'Disabled'),
          value: disabled,
          color: STATUS_COLORS.disabled,
        },
        {
          key: 'autoDisabled',
          label: t('automationList.status.autoDisabled', 'Auto-disabled'),
          value: autoDisabled,
          color: STATUS_COLORS.autoDisabled,
        },
      ].map((r) => ({
        ...r,
        // Clamp to [0, 100] so an inconsistent payload (a count exceeding the
        // total) can never surface a nonsensical ">100%" readout.
        pct: r.value != null && max != null ? Math.min(100, Math.max(0, Math.round((r.value / max) * 100))) : null,
      })),
    [t, active, disabled, autoDisabled, max],
  );

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Icons.pieChart className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
        {t('automationList.status.title', 'Status breakdown')}
      </PanelTitle>

      {isLoading ? (
        <Skeleton height={168} />
      ) : error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : dataState?.hasData === false && dataState.isRefreshBlocked ? (
        <DataSourceNotice sources={[{
          id: 'automation-status',
          label: t('automationList.status.title', 'Status breakdown'),
          query: { fetchStatus: 'paused', refetch: dataState.retry ?? onRetry },
        }]} />
      ) : total === 0 ? (
        <EmptyState
          icon={<Icons.workflow className="h-8 w-8" />}
          message={t('automationList.status.empty', 'No automations to summarize yet')}
          actionTo={{ label: t('automationList.empty.cta', 'Open builder'), to: '/automations/new' }}
        />
      ) : (
        <div className="space-y-4">
          <div className="space-y-3">
            {rows.map((r) => r.value == null || max == null ? (
              <Text key={r.key} color="secondary">{r.label}: —</Text>
            ) : (
              <MetricBar
                key={r.key}
                label={r.label}
                value={r.value}
                max={max}
                color={r.color}
                sublabel={`${r.value} · ${r.pct}%`}
              />
            ))}
          </div>
          {autoDisabled != null && autoDisabled > 0 && (
            <AlertBanner
              variant="warning"
              icon={<Icons.warning className="h-4 w-4" aria-hidden="true" />}
              title={t('automationList.autoDisabled.title', 'Attention needed')}
            >
              {t(
                'automationList.autoDisabled.body',
                '{{count}} automation(s) were auto-disabled after repeated failures. Re-enable them from the builder once resolved.',
                { count: autoDisabled },
              )}
            </AlertBanner>
          )}
        </div>
      )}
    </GlassPanel>
  );
}
