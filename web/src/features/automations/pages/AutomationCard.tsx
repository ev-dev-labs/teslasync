/**
 * AutomationCard — displays a single automation with toggle, status, actions menu.
 */
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { GlassPanel, Badge, Toggle, ConfirmDialog, PinButton, PanelTitle, Text, Caption } from '@/components/ui';
import { Zap } from 'lucide-react';
import { automationStatus, type AutomationListItem } from '@/api/hooks/useAutomations';
import { AutomationCardActions } from '../components/automation-helper-source-closure/AutomationCardActions';
import { AutomationCardStatistics } from '../components/automation-helper-source-closure/AutomationCardStatistics';
import { AutomationCardNotices } from '../components/automation-helper-source-closure/AutomationCardNotices';

type AutomationUIStatus = 'active' | 'disabled' | 'auto-disabled' | 'unknown';

const statusStyles: Record<AutomationUIStatus, { label: string; variant: 'success' | 'neutral' | 'danger' }> = {
  active: { label: 'Active', variant: 'success' },
  disabled: { label: 'Disabled', variant: 'neutral' },
  'auto-disabled': { label: 'Auto-disabled', variant: 'danger' },
  unknown: { label: 'Unknown', variant: 'neutral' },
};

interface AutomationCardProps {
  automation: AutomationListItem;
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
  const uiStatus = useMemo(() => automationStatus(a) ?? 'unknown', [a]);
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
          uiStatus === 'auto-disabled' && 'border-[var(--semantic-danger)]',
        )}
      >
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 basis-48">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <PanelTitle className="min-w-0 break-words">{a.name}</PanelTitle>
              <Badge variant={status.variant}>{uiStatus === 'unknown'
                ? t('common.unknown', 'Unknown')
                : t(`automations.status.${uiStatus}`, status.label)}</Badge>
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
            <PinButton
              itemType="automation"
              itemId={a.id}
              size="sm"
              minTargetSize={44}
              ariaLabel={t('automations.card.pinLabel', { name: a.name, defaultValue: 'Pin automation {{name}}' })}
            />
            <Toggle
              checked={a.auto_disabled === true ? false : a.enabled === true}
              onChange={handleToggle}
              disabled={actionsDisabled || typeof a.enabled !== 'boolean'}
              size="sm"
              aria-label={t('automations.card.toggleLabel', { name: a.name, defaultValue: 'Toggle automation {{name}}' })}
              title={actionsDisabledReason}
            />
            <AutomationCardActions
              automationId={a.id}
              automationName={a.name}
              autoDisabled={a.auto_disabled === true}
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
