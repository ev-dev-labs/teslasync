import { useTranslation } from 'react-i18next';
import { ShieldCheck, ShieldOff, Info, Siren } from 'lucide-react';
import { useCardPlacement } from '@/components/layout/layout-reference';
import { GlassPanel, Button, Toggle, PanelTitle, Text, HelperText } from '@/components/ui';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { cn } from '@/lib/cn';
import type { GuardPageModel } from './useGuardPageModel';

export function GuardControls({ model: m }: { model: GuardPageModel }) {
  const { t } = useTranslation();
  const placement = useCardPlacement();
  const StateIcon = m.policyEnabled == null ? Info : m.policyEnabled ? ShieldCheck : ShieldOff;
  // An unsaved policy is a legitimate editable state, not a failed config read.
  const configReady = m.configQuery.data !== undefined;
  return (
    <section aria-label={t('guard.controlSection', 'Guard control and live location')}
      className={cn('flex min-w-0 flex-col gap-4', placement?.className)}>
      <GlassPanel data-guard-section="arming" className="flex flex-1 flex-col gap-4 p-4 sm:p-5">
        <PanelTitle className="flex items-center gap-2">
          <StateIcon className="h-5 w-5 text-[var(--text-secondary)]" aria-hidden="true" />
          {t('guard.enableGuard', 'Guard mode')}
        </PanelTitle>
        <Text as="p" variant="sectionTitle">
          {m.guardConfig === null ? t('guard.modernization.notSaved', 'No saved guard policy yet') : m.policyLabel}
        </Text>
        <HelperText>{t('guard.modernization.policyOnly', 'Saved policy only; not confirmation of active monitoring or successful arming.')}</HelperText>
        <HelperText>{t('guard.modernization.armingEffect', 'Enabling saves policy and requests door locking, then Sentry on. Disabling saves policy only; it does not unlock doors or turn Sentry off.')}</HelperText>
        <StaleRefreshWarning state={m.configState} label={t('guard.settings', 'Guard settings')} />
        {m.configState.fatalError && <QueryError error={m.configState.fatalError} onRetry={m.configState.retry ?? undefined} />}
        {m.configQuery.isLoading && !configReady && <Skeleton height={44} />}
        {configReady ? (
          <Toggle label={t('guard.enableGuard', 'Guard mode')} checked={m.isArmed}
            onChange={() => m.handleToggleGuard()} disabled={m.noVehicle || m.setConfig.isPending} />
        ) : (
          <HelperText>{t('guard.modernization.sourceUnknown', 'Source unavailable; no security conclusion can be drawn.')}</HelperText>
        )}
        {m.setConfig.isPending && <Text as="span" variant="caption">{t('guard.updating', 'Updating…')}</Text>}
        {m.setConfig.error && <QueryError error={m.setConfig.error} compact />}
        {m.setConfig.error && <HelperText>{t('guard.modernization.saveFailure', 'Policy may have been saved even if arming failed. Review the refreshed policy and live lock/Sentry status before trying again.')}</HelperText>}
        <HelperText>{t('guard.modernization.stepUp', 'Saving or enabling policy and activating panic may require step-up authentication.')}</HelperText>
      </GlassPanel>
      <GlassPanel data-guard-section="panic" className="flex flex-col gap-3 p-4 sm:p-5">
        <PanelTitle className="flex items-center gap-2">
          <Siren className="h-5 w-5 text-[var(--text-secondary)]" aria-hidden="true" />
          {t('guard.emergency', 'Emergency')}
        </PanelTitle>
        <Button variant="danger" size="lg" onClick={() => m.setPanicDialogOpen(true)}
          loading={m.panic.isPending} disabled={m.panic.isPending || m.noVehicle} className="w-full">
          <Siren className="h-4 w-4" aria-hidden="true" />
          {m.panic.isPending ? t('guard.panicking', 'Sending…') : t('guard.panicButton', 'Activate panic')}
        </Button>
        <HelperText>{t('guard.modernization.panicEffects', 'This requests Sentry mode on, then horn honking, then light flashing. It does not lock doors, send notifications, or create a guard event. Commands can fail or complete only partially.')}</HelperText>
        {m.panic.error && <QueryError error={m.panic.error} compact />}
      </GlassPanel>
    </section>
  );
}
