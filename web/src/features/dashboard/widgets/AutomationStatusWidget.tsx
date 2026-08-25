import { useTranslation } from 'react-i18next';
import { Workflow, CheckCircle2, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { Badge, Toggle } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useAutomations, useToggleAutomation } from '@/api/hooks/useAutomations';
import { useOperationalMode } from '@/hooks/useOperationalMode';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { Automation } from '@/api/types';

function formatRelativeTime(dateStr: string | null, t: (k: string, f: string) => string): string {
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
      ? `${minutes}m`
      : minutes < 1_440
        ? `${Math.floor(minutes / 60)}h`
        : `${Math.floor(minutes / 1_440)}d`;
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
  const enabled = automations.filter((a) => a.enabled).length;
  const failing = automations.filter((a) => a.consecutive_failures > 0 && a.enabled).length;

  return (
    <div className="h-full flex flex-col items-center justify-center gap-1">
      <Workflow className="h-5 w-5 text-neon-cyan" />
      <span className="text-lg font-bold text-[var(--text-primary)]">
        {enabled}/{automations.length}
      </span>
      <span className="text-2xs text-[var(--text-muted)]">{t('widget.active', 'Active')}</span>
      {failing > 0 && (
        <Badge variant="warning" size="sm" dot>
          {failing} {t('widget.failing', 'Failing')}
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
  const lastRun = automation.last_triggered_at;

  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-white/[0.04] last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-medium text-[var(--text-primary)] truncate">{automation.name}</span>
          <Badge variant={status.variant} size="sm">
            {status.label}
          </Badge>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {lastRun && (
            <span
              className="text-2xs text-[var(--text-muted)] flex items-center gap-0.5"
              title={t('widget.lastRun', 'Last run')}
            >
              <Clock className="h-2.5 w-2.5" aria-hidden="true" />
              {formatRelativeTime(lastRun, t)}
            </span>
          )}
          {automation.next_fire_time && (
            <span
              className="text-2xs text-[var(--text-muted)] flex items-center gap-0.5"
              title={t('widget.nextRun', 'Next run')}
            >
              <span aria-hidden="true">⏰</span> {formatRelativeTime(automation.next_fire_time, t)}
            </span>
          )}
        </div>
      </div>
      {showToggle && (
        <Toggle
          size="sm"
          checked={automation.enabled}
          disabled={actionsDisabled}
          title={actionsDisabledReason}
          onChange={(checked) =>
            toggle.mutate({ id: automation.id, enabled: checked })
          }
          aria-label={`${t('widget.toggle', 'Toggle')} ${automation.name}`}
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
  const enabled = automations.filter((a) => a.enabled).length;
  const failing = automations.filter((a) => a.consecutive_failures > 0 && a.enabled).length;

  return (
    <div className="h-full flex flex-col gap-2">
      {/* Summary stats */}
      <div className="flex items-center gap-3 pb-1.5 border-b border-white/[0.06]">
        <div className="flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3 text-neon-green" />
          <span className="text-xs text-[var(--text-secondary)]">
            {enabled} {t('widget.active', 'Active')}
          </span>
        </div>
        {failing > 0 && (
          <div className="flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 text-amber-400" />
            <span className="text-xs text-amber-400">
              {failing} {t('widget.failing', 'Failing')}
            </span>
          </div>
        )}
        {automations.some((a) => a.auto_disabled) && (
          <div className="flex items-center gap-1">
            <XCircle className="h-3 w-3 text-red-400" />
            <span className="text-xs text-red-400">
              {automations.filter((a) => a.auto_disabled).length}{' '}
              {t('widget.autoDisabled', 'Auto-disabled')}
            </span>
          </div>
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
  const { data: automations, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = useAutomations();
  const operationalMode = useOperationalMode();

  const items = automations ?? [];
  const isCompact = size.cols <= 1 || size.rows <= 1;
  const isWide = size.cols >= 3;

  return (
    <WidgetShell
      title={isCompact && size.cols <= 1 ? undefined : t('widget.automationStatus', 'Automation Status')}
      icon={
        isCompact && size.cols <= 1 ? undefined : (
          <Workflow className="h-3.5 w-3.5 text-neon-cyan" />
        )
      }
      loading={isLoading}
      error={error ? String(error) : null}
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
