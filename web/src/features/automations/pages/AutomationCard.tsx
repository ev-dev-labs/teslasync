/**
 * AutomationCard — displays a single automation with toggle, status, actions menu.
 */
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { GlassPanel, Badge, Button as UiButton, Toggle, ConfirmDialog, PinButton, PanelTitle, Text, Caption } from '@/components/ui';
import {
  Zap, AlertTriangle, MoreVertical, Play, Copy, Download,
  Trash2, RotateCcw, Car, CheckCircle, XCircle, SkipForward,
} from 'lucide-react';
import type { Automation } from '@/api/types';
import { formatDateTime, formatRelativeTime } from '@/lib/dateFormat';

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
  const conflicts = a.conflicts ?? [];
  const failureCount = a.failure_count ?? 0;

  // Dismiss the actions menu on Escape so keyboard users can close it without
  // reaching for the mouse-only backdrop overlay.
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

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
          'p-4 transition-all duration-normal',
          isFiring && 'ring-2 ring-neon-cyan/50 shadow-lg shadow-neon-cyan/10',
          uiStatus === 'auto-disabled' && 'border-red-500/30',
        )}
      >
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <PanelTitle className="truncate">{a.name}</PanelTitle>
              <Badge variant={status.variant}>{t(`automations.status.${uiStatus}`, status.label)}</Badge>
              {isFiring && (
                <Caption className="flex items-center gap-1 text-cyan-300 animate-pulse">
                  <Zap className="h-3 w-3" aria-hidden="true" />
                  {t('automations.firing', 'Firing')}
                </Caption>
              )}
            </div>
            {a.description && (
              <Text as="p" variant="body" className="mt-0.5 truncate text-[var(--text-secondary)]">{a.description}</Text>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <PinButton itemType="automation" itemId={a.id} size="sm" />
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
                aria-haspopup="true"
                aria-expanded={menuOpen}
              >
                <MoreVertical className="h-4 w-4" />
              </UiButton>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" aria-hidden="true" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-[var(--border-subtle)] bg-gray-900 py-1 shadow-xl">
                    <UiButton
                      type="button"
                      variant="ghost"
                      className="!h-auto !w-full !justify-start !rounded-none !px-3 !py-2 text-sm text-[var(--text-primary)] hover:!bg-[var(--surface-2)]"
                      onClick={() => { onTestRun(a.id); setMenuOpen(false); }}
                    >
                      <Play className="h-3.5 w-3.5" />
                      {t('automations.testRun', 'Test Run')}
                    </UiButton>
                    {a.auto_disabled && (
                      <UiButton
                        type="button"
                        variant="ghost"
                        className="!h-auto !w-full !justify-start !rounded-none !px-3 !py-2 text-sm text-cyan-300 hover:!bg-[var(--surface-2)]"
                        onClick={() => { onReEnable(a.id); setMenuOpen(false); }}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        {t('automations.reEnable', 'Re-enable')}
                      </UiButton>
                    )}
                    <UiButton
                      type="button"
                      variant="ghost"
                      className="!h-auto !w-full !justify-start !rounded-none !px-3 !py-2 text-sm text-[var(--text-primary)] hover:!bg-[var(--surface-2)]"
                      onClick={() => { setMenuOpen(false); }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {t('automations.duplicate', 'Duplicate')}
                    </UiButton>
                    <UiButton
                      type="button"
                      variant="ghost"
                      className="!h-auto !w-full !justify-start !rounded-none !px-3 !py-2 text-sm text-[var(--text-primary)] hover:!bg-[var(--surface-2)]"
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

        {/* Vehicle row */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {vehicleName ? (
            <Caption className="flex items-center gap-1">
              <Car className="h-3 w-3" aria-hidden="true" />
              {vehicleName}
            </Caption>
          ) : (
            <Caption>{t('automations.allVehicles', 'All vehicles')}</Caption>
          )}
        </div>

        {/* Stats row */}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Caption className="flex items-center gap-1">
            {a.last_triggered_at ? (
              <>
                <CheckCircle className="h-3 w-3 text-emerald-300" aria-hidden="true" />
                {t('automations.lastRun', 'Last')}: {formatRelativeTime(a.last_triggered_at)}
              </>
            ) : (
              <>
                <SkipForward className="h-3 w-3" aria-hidden="true" />
                {t('automations.neverRun', 'Never run')}
              </>
            )}
          </Caption>
          <Caption aria-hidden="true">·</Caption>
          <Caption>{t('automations.runs', 'Runs')}: {a.execution_count ?? 0}</Caption>
          {failureCount > 0 && (
            <>
              <Caption aria-hidden="true">·</Caption>
              <Caption className="flex items-center gap-1 text-rose-300">
                <XCircle className="h-3 w-3" aria-hidden="true" />
                {t('automations.fails', 'Fails')}: {failureCount}
              </Caption>
            </>
          )}
          {a.next_fire_time && (
            <>
              <Caption aria-hidden="true">·</Caption>
              <Caption className="text-cyan-300">
                {t('automations.nextFire', 'Next')}: {formatDateTime(a.next_fire_time)}
              </Caption>
            </>
          )}
        </div>

        {/* Auto-disabled warning */}
        {a.auto_disabled && a.auto_disabled_reason && (
          <div className="mt-2 flex items-start gap-2 rounded-md bg-red-500/10 px-3 py-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-300" aria-hidden="true" />
            <Text as="span" variant="bodySm" className="text-rose-300">{a.auto_disabled_reason}</Text>
          </div>
        )}

        {/* Conflicts */}
        {conflicts.length > 0 && (
          <div className="mt-2 space-y-1">
            {conflicts.map((c, i) => {
              const isWarning = c.severity === 'warning';
              return (
                <div
                  key={`conflict-${a.id}-${i}`}
                  className={cn(
                    'flex items-start gap-2 rounded-md px-3 py-1.5',
                    isWarning ? 'bg-amber-500/10' : 'bg-blue-500/10',
                  )}
                >
                  <AlertTriangle
                    className={cn('mt-0.5 h-3 w-3 shrink-0', isWarning ? 'text-amber-300' : 'text-blue-300')}
                    aria-hidden="true"
                  />
                  <Text as="span" variant="bodySm" className={isWarning ? 'text-amber-300' : 'text-blue-300'}>
                    {t('automations.conflictWith', 'Conflict with')}{' '}
                    <Text as="span" weight="medium">"{c.automation_name}"</Text>
                    {' — '}{c.reason}
                  </Text>
                </div>
              );
            })}
          </div>
        )}
      </GlassPanel>

      <ConfirmDialog
        open={confirmDelete}
        title={t('automations.deleteTitle', 'Delete Automation')}
        message={t('automations.deleteMessage', { name: a.name, defaultValue: 'Are you sure you want to delete "{{name}}"? This cannot be undone.' })}
        confirmLabel={t('automations.deleteConfirm', 'Delete')}
        cancelLabel={t('common.cancel', 'Cancel')}
        variant="danger"
        onConfirm={() => { onDelete(a.id); setConfirmDelete(false); }}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
