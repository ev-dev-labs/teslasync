import { useTranslation } from 'react-i18next';
import { Workflow } from 'lucide-react';
import { Badge, Caption, Text, Toggle } from '@/components/ui';
import { EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useAutomations, useToggleAutomation } from '@/api/hooks/useAutomations';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { Automation } from '@/api/types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { WidgetBigNumber } from './shared';
import { useDateFormat } from '@/hooks/useDateFormat';

function getStatusBadge(
  a: Automation,
  t: (k: string, f: string) => string,
): { variant: 'success' | 'danger' | 'warning' | 'neutral'; label: string } {
  if (a.auto_disabled) return { variant: 'danger', label: t('widget.autoDisabled', 'Auto-disabled') };
  if (!a.enabled) return { variant: 'neutral', label: t('widget.disabled', 'Disabled') };
  if (a.consecutive_failures > 0) return { variant: 'warning', label: t('widget.failing', 'Failing') };
  if (a.last_success_at) return { variant: 'success', label: t('widget.ok', 'OK') };
  return { variant: 'neutral', label: t('widget.idle', 'Idle') };
}

/* ── Compact: 1×1 – 2×1 ── */
function CompactView({
  automations,
  t,
}: {
  automations: Automation[];
  t: (k: string, f: string) => string;
}) {
  const { fmtInt } = useNumberFormatting();
  const enabled = automations.filter((a) => a.enabled).length;
  const failing = automations.filter((a) => a.consecutive_failures > 0 && a.enabled).length;

  return (
    <div className="h-full flex flex-col items-center justify-center gap-1">
      <Workflow className="h-5 w-5 text-neon-cyan" />
      <WidgetBigNumber
        value={`${fmtInt(enabled)}/${fmtInt(automations.length)}`}
        label={t('widget.active', 'Active')}
        align="center"
      />
      {failing > 0 && (
        <Badge variant="warning" size="sm" dot>
          {fmtInt(failing)} {t('widget.failing', 'Failing')}
        </Badge>
      )}
    </div>
  );
}

/* ── Row for full view ── */
function AutomationRow({
  automation,
  t,
  showToggle,
  actionsDisabled,
  actionsDisabledReason,
}: {
  automation: Automation;
  t: (k: string, f: string) => string;
  showToggle: boolean;
  actionsDisabled: boolean;
  actionsDisabledReason?: string;
}) {
  const toggle = useToggleAutomation();
  const status = getStatusBadge(automation, t);
  const { formatDateTime } = useDateFormat();
  const lastRun = automation.last_triggered_at;
  const nextRun = automation.next_fire_time;
  const scheduleSource = nextRun ?? lastRun;
  const schedule = scheduleSource
    ? formatDateTime(scheduleSource)
      : '—';

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 py-1.5 border-b border-[var(--border-subtle)] last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <Text variant="bodySm" className="min-w-0 [overflow-wrap:anywhere]">{automation.name}</Text>
          <Badge variant={status.variant} size="sm">
            {status.label}
          </Badge>
        </div>
        <Caption
          className="block mt-0.5"
          title={nextRun ? formatDateTime(nextRun) : lastRun ? formatDateTime(lastRun) : undefined}
        >
          {schedule}
        </Caption>
      </div>
      {showToggle && (
        <Toggle
          size="sm"
          checked={automation.enabled}
          disabled={actionsDisabled || toggle.isPending}
          title={actionsDisabledReason}
          onChange={(checked) =>
            toggle.mutate({ id: automation.id, enabled: checked })
          }
          aria-label={`${t('widget.toggle', 'Toggle')} ${automation.name}`}
        />
      )}
      {toggle.error && (
        <QueryError
          error={toggle.error}
          onRetry={actionsDisabled ? undefined : () => toggle.mutate({ id: automation.id, enabled: !automation.enabled })}
        />
      )}
    </div>
  );
}

/* ── Full: 2×2+ ── */
function FullView({
  automations,
  t,
  isWide,
  actionsDisabled,
  actionsDisabledReason,
}: {
  automations: Automation[];
  t: (k: string, f: string) => string;
  isWide: boolean;
  actionsDisabled: boolean;
  actionsDisabledReason?: string;
}) {
  const enabled = automations.filter((automation) => automation.enabled).length;
  const failing = automations.filter((automation) => automation.consecutive_failures > 0 && automation.enabled).length;
  const { fmtInt } = useNumberFormatting();
  return (
    <div className="h-full flex flex-col gap-2">
      <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] pb-1.5">
        <div className="flex min-w-0 items-baseline gap-1">
          <Text variant="bodySm" mono>{fmtInt(enabled)}</Text>
          <Caption>{t('widget.active', 'Active')}</Caption>
        </div>
        {failing > 0 && (
          <Badge variant="warning" size="sm" dot>
            {fmtInt(failing)} {t('widget.failing', 'Failing')}
          </Badge>
        )}
      </div>
      {/* Automation list */}
      <div className="flex-1 min-h-0 overflow-auto">
        {automations.map((a) => (
          <AutomationRow
            key={a.id}
            automation={a}
            t={t}
            showToggle={isWide}
            actionsDisabled={actionsDisabled}
            actionsDisabledReason={actionsDisabledReason}
          />
        ))}
      </div>
    </div>
  );
}

export default function AutomationStatusWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const query = useAutomations();
  const { data: automations, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = query;
  const state = useDataState({ ...query, data: automations ?? undefined });
  const operationalMode = useOperationalMode();

  const items = automations ?? [];
  const isCompact = size.cols <= 1 || size.rows <= 1;
  const isWide = size.cols >= 3;

  return (
    <WidgetShell
      title={t('widget.automationStatus', 'Automation status')}
      icon={
        isCompact && size.cols <= 1 ? undefined : (
          <Workflow className="h-3.5 w-3.5 text-neon-cyan" />
        )
      }
      loading={isLoading}
      dataState={{ ...state, status: state.status === 'initial' && !isLoading ? 'unavailable' : state.status }}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {items.length > 0 ? (
        <FadeIn>
          {isCompact ? (
            <CompactView automations={items} t={t} />
          ) : (
            <FullView
              automations={items}
              t={t}
              isWide={isWide}
              actionsDisabled={!operationalMode.canWrite}
              actionsDisabledReason={operationalMode.writeBlockReason ?? undefined}
            />
          )}
        </FadeIn>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Workflow className="h-5 w-5" />}
          message={t('widget.noAutomations', 'No automations configured')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
