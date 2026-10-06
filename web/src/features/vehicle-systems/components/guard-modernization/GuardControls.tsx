import { useTranslation } from 'react-i18next';
import { ShieldCheck, ShieldOff, Info, Siren } from 'lucide-react';
import { useCardPlacement } from '@/components/layout/layout-reference';
import { LayoutCard } from '@/components/layout';
import { FormSection } from '@/components/forms';
import { Button, Toggle, Text, HelperText } from '@/components/ui';
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
      <div data-guard-section="arming" className="min-w-0 flex-1">
        <FormSection title={t('guard.enableGuard', 'Guard mode')}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <StateIcon className="h-5 w-5 text-[var(--text-secondary)]" aria-hidden="true" />
        <Text as="p" variant="sectionTitle">
          {m.guardConfig === null ? t('guard.modernization.notSaved', 'No saved guard policy yet') : m.policyLabel}
        </Text>
        </div>
        <HelperText>{t('guard.modernization.policyOnly', 'Saved policy only; not confirmation of active monitoring or successful arming.')}</HelperText>
        <HelperText>{t('guard.modernization.armingEffect', 'Enabling saves policy and requests door locking, then Sentry on. Disabling saves policy only; it does not unlock doors or turn Sentry off.')}</HelperText>
        <StaleRefreshWarning state={m.configState} label={t('guard.settings', 'Guard settings')} />
        {m.configState.fatalError && <QueryError error={m.configState.fatalError} onRetry={m.configState.retry ?? undefined} />}
        {m.configQuery.isLoading && !configReady && <Skeleton height={44} />}
        {(configReady || m.noVehicle) && (
          <Toggle label={t('guard.enableGuard', 'Guard mode')} checked={m.isArmed}
            onChange={() => m.handleToggleGuard()} disabled={!configReady || m.noVehicle || m.setConfig.isPending} />
        )}
        {!configReady && (
          <HelperText>{t('guard.modernization.sourceUnknown', 'Source unavailable; no security conclusion can be drawn.')}</HelperText>
        )}
        {m.setConfig.isPending && <Text as="span" variant="caption">{t('guard.updating', 'Updating…')}</Text>}
        {m.setConfig.error && <QueryError error={m.setConfig.error} compact />}
        {m.setConfig.error && <HelperText>{t('guard.modernization.saveFailure', 'Policy may have been saved even if arming failed. Review the refreshed policy and live lock/Sentry status before trying again.')}</HelperText>}
        <HelperText>{t('guard.modernization.stepUp', 'Saving or enabling policy and activating panic may require step-up authentication.')}</HelperText>
        </FormSection>
      </div>
      <div data-guard-section="panic" className="min-w-0">
        <LayoutCard title={t('guard.emergency', 'Emergency')}>
        <Button wrapLabel variant="danger" size="lg" onClick={() => m.setPanicDialogOpen(true)}
          loading={m.panic.isPending} disabled={m.panic.isPending || m.noVehicle} className="w-full">
          <Siren className="h-4 w-4" aria-hidden="true" />
          {m.panic.isPending ? t('guard.panicking', 'Sending…') : t('guard.panicButton', 'Activate panic')}
        </Button>
        <HelperText>{t('guard.modernization.panicEffects', 'This requests Sentry mode on, then horn honking, then light flashing. It does not lock doors, send notifications, or create a guard event. Commands can fail or complete only partially.')}</HelperText>
        {m.panic.error && <QueryError error={m.panic.error} compact />}
        </LayoutCard>
      </div>
    </section>
  );
}
