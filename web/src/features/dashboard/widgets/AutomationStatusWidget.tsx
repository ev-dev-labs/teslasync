import { useTranslation } from 'react-i18next';
import { Workflow, Clock } from 'lucide-react';
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
import { DashboardSourceBrief } from '../components/operationalbrief-all/DashboardSourceBrief';

function formatRelativeTime(dateStr: string | null, t: (k: string, f: string) => string, fmtInt: (value: unknown) => string): string {
  if (!dateStr) return '—';
  const ts = new Date(dateStr).getTime();
  // Guard unparseable timestamps so a malformed value renders as an em dash
  // instead of "NaNd ago".
  if (Number.isNaN(ts)) return '—';
  const diff = Date.now() - ts;
  // `next_fire_time` is a future instant, so `diff` is negative there. Render
  // future times as "in Xm" rather than collapsing every one of them to the
  // past-tense "Just now".
  const future = diff < 0;
  const minutes = Math.floor(Math.abs(diff) / 60_000);
  if (minutes < 1) return t('widget.justNow', 'Just now');
  const value =
    minutes < 60
      ? `${fmtInt(minutes)}m`
      : minutes < 1_440
        ? `${fmtInt(Math.floor(minutes / 60))}h`
        : `${fmtInt(Math.floor(minutes / 1_440))}d`;
  return future
    ? `${t('widget.in', 'in')} ${value}`
    : `${value} ${t('widget.ago', 'ago')}`;
}

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
  const { fmtInt } = useNumberFormatting();
  const status = getStatusBadge(automation, t);
  const lastRun = automation.last_triggered_at;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 py-1.5 border-b border-[var(--border-subtle)] last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <Text variant="bodySm" className="min-w-0 [overflow-wrap:anywhere]">{automation.name}</Text>
          <Badge variant={status.variant} size="sm">
            {status.label}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-0.5">
          {lastRun && (
            <Caption
              className="flex items-center gap-0.5"
              title={t('widget.lastRun', 'Last run')}
            >
              <Clock className="h-2.5 w-2.5" aria-hidden="true" />
              {formatRelativeTime(lastRun, t, fmtInt)}
            </Caption>
          )}
          {automation.next_fire_time && (
            <Caption
              className="flex items-center gap-0.5"
              title={t('widget.nextRun', 'Next run')}
            >
              <span aria-hidden="true">⏰</span> {formatRelativeTime(automation.next_fire_time, t, fmtInt)}
            </Caption>
          )}
        </div>
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
  return (
    <div className="h-full flex flex-col gap-2">
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
      {!isCompact && <DashboardSourceBrief
        metrics={[
          { metricId: 'count', rawValue: automations == null ? null : items.filter(a => a.enabled).length, label: t('widget.active', 'Active'), description: t('widget.automation.activeDescription', 'Enabled automations in the returned configuration list.') },
          { metricId: 'count', rawValue: automations == null ? null : items.filter(a => a.consecutive_failures > 0 && a.enabled).length, label: t('widget.failing', 'Failing'), description: t('widget.automation.failingDescription', 'Enabled automations with consecutive failures; successful empty lists retain measured zero.') },
          { metricId: 'count', rawValue: automations == null ? null : items.filter(a => a.auto_disabled).length, label: t('widget.autoDisabled', 'Auto-disabled'), description: t('widget.automation.disabledDescription', 'Automations explicitly auto-disabled by the source, not all manually disabled automations.') },
        ]}
        state={state} eyebrow={t('dashboard.summary.eyebrow', 'Source summary')}
        title={t('widget.automation.summaryTitle', 'Automation configuration')}
        description={t('widget.automation.summaryDescription', 'Current automation configuration and reported failure flags; no execution-success confidence is inferred.')}
        scope={t('widget.automation.summaryScope', 'Returned automation list; action permissions and per-row recovery remain independent')}
        loading={isLoading && !automations} testId="automation-operational-brief"
      />}
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
