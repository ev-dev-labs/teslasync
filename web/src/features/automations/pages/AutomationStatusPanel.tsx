import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { GlassPanel, PanelTitle } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError, AlertBanner } from '@/components/feedback';
import { Icons } from '@/lib/icons';

export interface AutomationStatusStats {
  total: number;
  active: number;
  disabled: number;
  autoDisabled: number;
}

interface AutomationStatusPanelProps {
  stats: AutomationStatusStats;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}

/**
 * Status colors mirror the app's semantic status palette (emerald / slate /
 * rose). Passed as data into the shared `<MetricBar color>` prop — the same
 * hex-as-data pattern the reference TimelinePage uses for its state bars.
 */
const STATUS_COLORS = {
  active: '#10b981',
  disabled: '#64748b',
  autoDisabled: '#f43f5e',
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
  isLoading,
  error,
  onRetry,
}: AutomationStatusPanelProps) {
  const { t } = useTranslation();
  const max = Math.max(stats.total, 1);

  const rows = useMemo(
    () => [
      {
        key: 'active',
        label: t('automationList.status.active', 'Active'),
        value: stats.active,
        color: STATUS_COLORS.active,
      },
      {
        key: 'disabled',
        label: t('automationList.status.disabled', 'Disabled'),
        value: stats.disabled,
        color: STATUS_COLORS.disabled,
      },
      {
        key: 'autoDisabled',
        label: t('automationList.status.autoDisabled', 'Auto-disabled'),
        value: stats.autoDisabled,
        color: STATUS_COLORS.autoDisabled,
      },
    ],
    [t, stats.active, stats.disabled, stats.autoDisabled],
  );

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Icons.pieChart className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('automationList.status.title', 'Status breakdown')}
      </PanelTitle>

      {isLoading ? (
        <Skeleton height={168} />
      ) : error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : stats.total === 0 ? (
        <EmptyState
          icon={<Icons.workflow className="h-8 w-8" />}
          message={t('automationList.status.empty', 'No automations to summarize yet')}
        />
      ) : (
        <div className="space-y-4">
          <div className="space-y-3">
            {rows.map((r) => (
              <MetricBar
                key={r.key}
                label={r.label}
                value={r.value}
                max={max}
                color={r.color}
                sublabel={`${r.value} · ${Math.round((r.value / max) * 100)}%`}
              />
            ))}
          </div>
          {stats.autoDisabled > 0 && (
            <AlertBanner
              variant="warning"
              icon={<Icons.warning className="h-4 w-4" aria-hidden="true" />}
              title={t('automationList.autoDisabled.title', 'Attention needed')}
            >
              {t(
                'automationList.autoDisabled.body',
                '{{count}} automation(s) were auto-disabled after repeated failures. Re-enable them from the builder once resolved.',
                { count: stats.autoDisabled },
              )}
            </AlertBanner>
          )}
        </div>
      )}
    </GlassPanel>
  );
}
