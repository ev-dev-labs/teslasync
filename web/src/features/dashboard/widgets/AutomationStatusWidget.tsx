import { useTranslation } from 'react-i18next';
import { Workflow, CheckCircle2, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { Badge, Toggle } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useAutomations, useToggleAutomation } from '@/api/hooks/useAutomations';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { Automation } from '@/api/types';

function formatRelativeTime(dateStr: string | null, t: (k: string, f: string) => string): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t('widget.justNow', 'Just now');
  if (minutes < 60) return `${minutes}m ${t('widget.ago', 'ago')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${t('widget.ago', 'ago')}`;
  const days = Math.floor(hours / 24);
  return `${days}d ${t('widget.ago', 'ago')}`;
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
      <span className="text-lg font-bold text-white/90">
        {enabled}/{automations.length}
      </span>
      <span className="text-[10px] text-white/40">{t('widget.active', 'Active')}</span>
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
}: {
  automation: Automation;
  t: (k: string, f: string) => string;
  showToggle: boolean;
}) {
  const toggle = useToggleAutomation();
  const status = getStatusBadge(automation, t);
  const lastRun = automation.last_triggered_at;

  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-white/[0.04] last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-medium text-white/80 truncate">{automation.name}</span>
          <Badge variant={status.variant} size="sm">
            {status.label}
          </Badge>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {lastRun && (
            <span className="text-[10px] text-white/30 flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {formatRelativeTime(lastRun, t)}
            </span>
          )}
          {automation.next_fire_time && (
            <span className="text-[10px] text-white/30 flex items-center gap-0.5">
              ⏰ {formatRelativeTime(automation.next_fire_time, t)}
            </span>
          )}
        </div>
      </div>
      {showToggle && (
        <Toggle
          size="sm"
          checked={automation.enabled}
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
}: {
  automations: Automation[];
  t: (k: string, f: string) => string;
  isWide: boolean;
}) {
  const enabled = automations.filter((a) => a.enabled).length;
  const failing = automations.filter((a) => a.consecutive_failures > 0 && a.enabled).length;

  return (
    <div className="h-full flex flex-col gap-2">
      {/* Summary stats */}
      <div className="flex items-center gap-3 pb-1.5 border-b border-white/[0.06]">
        <div className="flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3 text-neon-green" />
          <span className="text-xs text-white/60">
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
          />
        ))}
      </div>
    </div>
  );
}

export default function AutomationStatusWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: automations, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = useAutomations();

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
            <FullView automations={items} t={t} isWide={isWide} />
          )}
        </FadeIn>
      ) : (
        <EmptyState
          icon={<Workflow className="h-5 w-5" />}
          message={t('widget.noAutomations', 'No automations configured')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
