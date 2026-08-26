import { AlertTriangle, Archive, RotateCcw, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { InlineCallout } from '@/components/feedback';
import { Button, GlassPanel, PanelTitle, Text } from '@/components/ui';

interface RepairCaseActionPanelProps {
  mode: 'review' | 'restore';
  canWrite: boolean;
  writeBlockReason?: string;
  hasApplyAction?: boolean;
  previewPending?: boolean;
  previewError?: string;
  onApply?: () => void;
  onDismiss?: () => void;
  onQuarantine?: () => void;
  onRestore?: () => void;
}

export function RepairCaseActionPanel({
  mode,
  canWrite,
  writeBlockReason,
  hasApplyAction,
  previewPending,
  previewError,
  onApply,
  onDismiss,
  onQuarantine,
  onRestore,
}: RepairCaseActionPanelProps) {
  const { t } = useTranslation();

  if (mode === 'restore') {
    return (
      <GlassPanel className="border-indigo-500/20 p-4">
        <PanelTitle>{t('dataRepair.cases.restoreTitle', 'Restore quarantined session')}</PanelTitle>
        <Text as="p" variant="bodySm" className="mt-1">
          {t(
            'dataRepair.cases.restoreDescription',
            'The original row and linked relationships will be verified and restored atomically.',
          )}
        </Text>
        <Button
          className="mt-4"
          variant="secondary"
          icon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
          onClick={onRestore}
          disabled={!canWrite}
          title={!canWrite ? writeBlockReason : undefined}
        >
          {t('dataRepair.cases.restoreAction', 'Restore session')}
        </Button>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className="border-rose-500/20 p-4">
      <PanelTitle>{t('dataRepair.cases.controlledActions', 'Controlled actions')}</PanelTitle>
      <Text as="p" variant="bodySm" className="mt-1">
        {t(
          'dataRepair.cases.controlledDescription',
          'Apply a verified boundary, dismiss a false positive, or move the source session into reversible quarantine.',
        )}
      </Text>
      <div className="mt-4 flex flex-wrap gap-2">
        {hasApplyAction ? (
          <Button
            variant="primary"
            icon={<Wrench className="h-4 w-4" aria-hidden="true" />}
            onClick={onApply}
            loading={previewPending}
            disabled={!canWrite}
            title={!canWrite ? writeBlockReason : undefined}
          >
            {t('dataRepair.action.reviewApply', 'Review & apply')}
          </Button>
        ) : null}
        <Button
          variant="secondary"
          onClick={onDismiss}
          disabled={!canWrite}
          title={!canWrite ? writeBlockReason : undefined}
        >
          {t('dataRepair.cases.dismiss', 'Dismiss finding')}
        </Button>
        <Button
          variant="danger"
          icon={<Archive className="h-4 w-4" aria-hidden="true" />}
          onClick={onQuarantine}
          disabled={!canWrite}
          title={!canWrite ? writeBlockReason : undefined}
        >
          {t('dataRepair.cases.quarantineAction', 'Move to quarantine')}
        </Button>
      </div>
      {previewError ? (
        <InlineCallout
          className="mt-3"
          variant="danger"
          icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}
        >
          {previewError}
        </InlineCallout>
      ) : null}
    </GlassPanel>
  );
}
