/**
 * AutomationCard — displays a single automation with toggle, status, actions menu.
 */
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { GlassPanel, Badge, Toggle, ConfirmDialog, PinButton, PanelTitle, Text, Caption } from '@/components/ui';
import { Zap } from 'lucide-react';
import type { Automation } from '@/api/types';
import { AutomationCardActions } from '../components/automation-helper-source-closure/AutomationCardActions';
import { AutomationCardStatistics } from '../components/automation-helper-source-closure/AutomationCardStatistics';
import { AutomationCardNotices } from '../components/automation-helper-source-closure/AutomationCardNotices';

type AutomationUIStatus = 'active' | 'disabled' | 'auto-disabled';

function getUIStatus(a: Automation): AutomationUIStatus {
  if (a.auto_disabled) return 'auto-disabled';
  if (!a.enabled) return 'disabled';
  return 'active';
}

const statusStyles: Record<AutomationUIStatus, { label: string; variant: 'success' | 'neutral' | 'danger' }> = {
  active: { label: 'Active', variant: 'success' },
  disabled: { label: 'Disabled', variant: 'neutral' },
  'auto-disabled': { label: 'Auto-disabled', variant: 'danger' },
};

interface AutomationCardProps {
  automation: Automation;
  isFiring: boolean;
  vehicleName?: string;
  onToggle: (id: number, enabled: boolean) => void;
  onReEnable: (id: number) => void;
  onDelete: (id: number) => void;
  onTestRun: (id: number) => void;
  actionsDisabled?: boolean;
  actionsDisabledReason?: string;
}

export function AutomationCard({
  automation: a,
  isFiring,
  vehicleName,
  onToggle,
  onReEnable,
  onDelete,
  onTestRun,
  actionsDisabled = false,
  actionsDisabledReason,
}: AutomationCardProps) {
  const { t } = useTranslation();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const uiStatus = useMemo(() => getUIStatus(a), [a]);
  const status = statusStyles[uiStatus];

  useEffect(() => {
    if (actionsDisabled) {
      setConfirmDelete(false);
    }
  }, [actionsDisabled]);

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
          'min-w-0 p-4 transition-all duration-normal motion-reduce:transition-none',
          isFiring && 'ring-2 ring-[var(--theme-primary)]',
          uiStatus === 'auto-disabled' && 'border-red-500/30',
        )}
      >
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 basis-48">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <PanelTitle className="min-w-0 break-words">{a.name}</PanelTitle>
              <Badge variant={status.variant}>{t(`automations.status.${uiStatus}`, status.label)}</Badge>
              {isFiring && (
                <Caption className="flex items-center gap-1 animate-pulse motion-reduce:animate-none">
                  <Zap className="h-3 w-3 shrink-0 text-[var(--theme-primary)]" aria-hidden="true" />
                  {t('automations.firing', 'Firing')}
                </Caption>
              )}
            </div>
            {a.description && (
              <Text as="p" variant="bodySm" className="mt-0.5 break-words">{a.description}</Text>
            )}
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-2">
            <PinButton itemType="automation" itemId={a.id} size="sm" />
            <Toggle
              checked={a.auto_disabled ? false : a.enabled}
              onChange={handleToggle}
              disabled={actionsDisabled}
              size="sm"
              aria-label={t('automations.toggleLabel', 'Toggle automation')}
              title={actionsDisabledReason}
            />
            <AutomationCardActions
              automationId={a.id}
              autoDisabled={a.auto_disabled}
              actionsDisabled={actionsDisabled}
              actionsDisabledReason={actionsDisabledReason}
              onTestRun={onTestRun}
              onReEnable={onReEnable}
              onRequestDelete={() => setConfirmDelete(true)}
            />
          </div>
        </div>
        <AutomationCardStatistics automation={a} vehicleName={vehicleName} />
        <AutomationCardNotices automation={a} />
      </GlassPanel>

      <ConfirmDialog
        open={confirmDelete}
        title={t('automations.deleteTitle', 'Delete automation')}
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
