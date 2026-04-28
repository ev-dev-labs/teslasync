/**
 * AutomationCard — displays a single automation with toggle, status, actions menu.
 */
import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { GlassPanel, Badge, Button as UiButton, Toggle, ConfirmDialog } from '@/components/ui';
import {
  Clock, Zap, AlertTriangle, MoreVertical, Play, Copy, Download,
  Trash2, RotateCcw, Car, CheckCircle, XCircle, SkipForward,
} from 'lucide-react';
import type { Automation } from '@/api/types';
import { formatDateTime } from '@/lib/dateFormat';

// ─── Trigger display helpers ──────────────────────────────────────────────────

const triggerLabels: Record<string, string> = {
  cron: 'Schedule',
  state_change: 'State Change',
  geofence: 'Geofence',
  threshold: 'Threshold',
  webhook: 'Webhook',
  sunrise_sunset: 'Sunrise/Sunset',
  manual: 'Manual',
};

function getTriggerLabel(type: string): string {
  return triggerLabels[type] ?? type;
}

function getTriggerSummary(type: string, config: Record<string, unknown> | null): string {
  if (!config) return getTriggerLabel(type);
  if (type === 'cron' && config.cron_expr) {
    const tz = config.timezone ? ` (${config.timezone})` : '';
    return `${config.cron_expr}${tz}`;
  }
  if (type === 'state_change' && config.signal) {
    return `When ${config.signal} changes`;
  }
  if (type === 'geofence' && config.zone_name) {
    return `${config.event ?? 'enter/exit'} ${config.zone_name}`;
  }
  if (type === 'sunrise_sunset') {
    return `${config.event ?? 'sunrise'}${config.offset_minutes ? ` ±${config.offset_minutes}m` : ''}`;
  }
  return getTriggerLabel(type);
}

function getActionsSummary(actions: Record<string, unknown>[] | null): string {
  if (!actions || actions.length === 0) return 'No actions';
  const names = actions.map((a) => {
    const cmd = (a.command as string) ?? (a.type as string) ?? '?';
    return cmd.replace(/_/g, ' ');
  });
  if (names.length <= 3) return names.join(' → ');
  return `${names.slice(0, 2).join(' → ')} → +${names.length - 2} more`;
}

function getConditionsSummary(conditions: Record<string, unknown>[] | null): string | null {
  if (!conditions || conditions.length === 0) return null;
  const parts = conditions.map((c) => {
    if (c.type === 'state_check' && c.signal && c.operator && c.value !== undefined) {
      return `${c.signal} ${c.operator} ${c.value}`;
    }
    if (c.type === 'time_window') return 'Time window';
    if (c.type === 'cooldown') return 'Cooldown';
    return (c.type as string) ?? 'condition';
  });
  return parts.join(' & ');
}

// ─── Time-ago helper ──────────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

type AutomationUIStatus = 'active' | 'disabled' | 'auto-disabled';

function getUIStatus(a: Automation): AutomationUIStatus {
  if (a.auto_disabled) return 'auto-disabled';
  if (!a.enabled) return 'disabled';
  return 'active';
}

const statusStyles: Record<AutomationUIStatus, { label: string; variant: 'success' | 'neutral' | 'danger' }> = {
  active: { label: 'Active', variant: 'success' },
  disabled: { label: 'Disabled', variant: 'neutral' },
  'auto-disabled': { label: 'Auto-Disabled', variant: 'danger' },
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface AutomationCardProps {
  automation: Automation;
  isFiring: boolean;
  vehicleName?: string;
  onToggle: (id: number, enabled: boolean) => void;
  onReEnable: (id: number) => void;
  onDelete: (id: number) => void;
  onTestRun: (id: number) => void;
}

export function AutomationCard({
  automation: a,
  isFiring,
  vehicleName,
  onToggle,
  onReEnable,
  onDelete,
  onTestRun,
}: AutomationCardProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const uiStatus = useMemo(() => getUIStatus(a), [a]);
  const status = statusStyles[uiStatus];
  const triggerSummary = useMemo(() => getTriggerSummary(a.trigger_type, a.trigger_config), [a.trigger_type, a.trigger_config]);
  const actionsSummary = useMemo(() => getActionsSummary(a.actions), [a.actions]);
  const conditionsSummary = useMemo(() => getConditionsSummary(a.conditions), [a.conditions]);
  const conflicts = a.conflicts ?? [];

  const handleToggle = useCallback(
    (checked: boolean) => {
      if (a.auto_disabled && checked) {
        onReEnable(a.id);
      } else {
        onToggle(a.id, checked);
      }
    },
    [a.auto_disabled, a.id, onReEnable, onToggle],
  );

  return (
    <>
      <GlassPanel
        className={cn(
          'p-4 transition-all duration-200',
          isFiring && 'ring-2 ring-neon-cyan/50 shadow-lg shadow-neon-cyan/10',
          uiStatus === 'auto-disabled' && 'border-red-500/30',
        )}
      >
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-base font-semibold text-white/90">{a.name}</h3>
              <Badge variant={status.variant}>{t(`automations.status.${uiStatus}`, status.label)}</Badge>
              {isFiring && (
                <span className="flex items-center gap-1 text-xs text-neon-cyan animate-pulse">
                  <Zap className="h-3 w-3" />
                  {t('automations.firing', 'Firing')}
                </span>
              )}
            </div>
            {a.description && (
              <p className="mt-0.5 truncate text-sm text-white/50">{a.description}</p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Toggle
              checked={a.auto_disabled ? false : a.enabled}
              onChange={handleToggle}
              size="sm"
              aria-label={t('automations.toggleLabel', 'Toggle automation')}
            />

            {/* Kebab menu */}
            <div className="relative">
              <UiButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-label={t('automations.menu', 'Actions menu')}
              >
                <MoreVertical className="h-4 w-4" />
              </UiButton>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-white/10 bg-gray-900 py-1 shadow-xl">
                    <UiButton
                      type="button"
                      variant="ghost"
                      className="!h-auto !w-full !justify-start !rounded-none !px-3 !py-2 text-sm text-white/80 hover:!bg-white/5"
                      onClick={() => { onTestRun(a.id); setMenuOpen(false); }}
                    >
                      <Play className="h-3.5 w-3.5" />
                      {t('automations.testRun', 'Test Run')}
                    </UiButton>
                    {a.auto_disabled && (
                      <UiButton
                        type="button"
                        variant="ghost"
                        className="!h-auto !w-full !justify-start !rounded-none !px-3 !py-2 text-sm text-neon-cyan hover:!bg-white/5"
                        onClick={() => { onReEnable(a.id); setMenuOpen(false); }}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {t('automations.reEnable', 'Re-enable')}
                      </UiButton>
                    )}
                    <UiButton
                      type="button"
                      variant="ghost"
                      className="!h-auto !w-full !justify-start !rounded-none !px-3 !py-2 text-sm text-white/80 hover:!bg-white/5"
                      onClick={() => { setMenuOpen(false); }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {t('automations.duplicate', 'Duplicate')}
                    </UiButton>
                    <UiButton
                      type="button"
                      variant="ghost"
                      className="!h-auto !w-full !justify-start !rounded-none !px-3 !py-2 text-sm text-white/80 hover:!bg-white/5"
                      onClick={() => { setMenuOpen(false); }}
                    >
                      <Download className="h-3.5 w-3.5" />
                      {t('automations.export', 'Export')}
                    </UiButton>
                    <UiButton
                      type="button"
                      variant="ghost"
                      className="!h-auto !w-full !justify-start !rounded-none !px-3 !py-2 text-sm text-red-400 hover:!bg-red-500/10"
                      onClick={() => { setConfirmDelete(true); setMenuOpen(false); }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t('automations.delete', 'Delete')}
                    </UiButton>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Trigger + Vehicle row */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/60">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {getTriggerLabel(a.trigger_type)}
          </span>
          <span className="text-white/30">·</span>
          <span className="text-white/50">{triggerSummary}</span>
          {vehicleName && (
            <>
              <span className="text-white/30">·</span>
              <span className="flex items-center gap-1">
                <Car className="h-3 w-3" />
                {vehicleName}
              </span>
            </>
          )}
        </div>

        {/* Actions chain */}
        <div className="mt-2 text-xs text-white/50">
          <span className="font-medium text-white/70">
            {t('automations.actions', 'Actions')}:
          </span>{' '}
          {actionsSummary}
        </div>

        {/* Conditions */}
        {conditionsSummary && (
          <div className="mt-1 text-xs text-white/50">
            <span className="font-medium text-white/70">
              {t('automations.conditions', 'IF')}:
            </span>{' '}
            {conditionsSummary}
          </div>
        )}

        {/* Stats row */}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-white/50">
          <span className="flex items-center gap-1">
            {a.last_triggered_at ? (
              <>
                <CheckCircle className="h-3 w-3 text-green-400" />
                {t('automations.lastRun', 'Last')}: {timeAgo(a.last_triggered_at)}
              </>
            ) : (
              <>
                <SkipForward className="h-3 w-3" />
                {t('automations.neverRun', 'Never run')}
              </>
            )}
          </span>
          <span className="text-white/30">·</span>
          <span>{t('automations.runs', 'Runs')}: {a.execution_count}</span>
          {a.failure_count > 0 && (
            <>
              <span className="text-white/30">·</span>
              <span className="flex items-center gap-1 text-red-400">
                <XCircle className="h-3 w-3" />
                {t('automations.fails', 'Fails')}: {a.failure_count}
              </span>
            </>
          )}
          {a.next_fire_time && (
            <>
              <span className="text-white/30">·</span>
              <span className="text-neon-cyan/70">
                {t('automations.nextFire', 'Next')}: {formatDateTime(a.next_fire_time)}
              </span>
            </>
          )}
        </div>

        {/* Auto-disabled warning */}
        {a.auto_disabled && a.auto_disabled_reason && (
          <div className="mt-2 flex items-start gap-2 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{a.auto_disabled_reason}</span>
          </div>
        )}

        {/* Conflicts */}
        {conflicts.length > 0 && (
          <div className="mt-2 space-y-1">
            {conflicts.map((c, i) => (
              <div
                key={`conflict-${a.id}-${i}`}
                className={cn(
                  'flex items-start gap-2 rounded-md px-3 py-1.5 text-xs',
                  c.severity === 'warning'
                    ? 'bg-amber-500/10 text-amber-300'
                    : 'bg-blue-500/10 text-blue-300',
                )}
              >
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  {t('automations.conflictWith', 'Conflict with')}{' '}
                  <span className="font-medium">"{c.automation_name}"</span>
                  {' — '}{c.reason}
                </span>
              </div>
            ))}
          </div>
        )}
      </GlassPanel>

      <ConfirmDialog
        open={confirmDelete}
        title={t('automations.deleteTitle', 'Delete Automation')}
        message={t('automations.deleteMessage', `Are you sure you want to delete "${a.name}"? This cannot be undone.`)}
        confirmLabel={t('automations.deleteConfirm', 'Delete')}
        cancelLabel={t('common.cancel', 'Cancel')}
        variant="danger"
        onConfirm={() => { onDelete(a.id); setConfirmDelete(false); }}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
