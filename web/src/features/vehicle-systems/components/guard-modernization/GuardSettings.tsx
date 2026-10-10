import { useTranslation } from 'react-i18next';
import { useCardPlacement } from '@/components/layout/layout-reference';
import { FormSection } from '@/components/forms';
import { Button, Select, Toggle, HelperText } from '@/components/ui';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { cn } from '@/lib/cn';
import type { GuardPageModel } from './useGuardPageModel';

export function GuardSettings({ model: m }: { model: GuardPageModel }) {
  const { t } = useTranslation();
  const placement = useCardPlacement();
  const configReady = m.configQuery.data !== undefined;
  const disabled = m.noVehicle || m.setConfig.isPending || !configReady;
  return (
    <div data-guard-section="settings" className={cn('min-w-0', placement?.className)}>
      <FormSection title={t('guard.settings', 'Guard settings')}
        description={t('guard.modernization.engineLimitation', 'Automatic guard monitoring, theft detection, and auto-panic are not established by the current service. These settings persist policy; verify vehicle security using current lock and Sentry readings.')}>
      {m.guardConfig === null && <HelperText>{t('guard.modernization.notSaved', 'No saved guard policy yet')}</HelperText>}
      <StaleRefreshWarning state={m.configState} label={t('guard.settings', 'Guard settings')} />
      <StaleRefreshWarning state={m.geofencesState} label={t('guard.homeGeofence', 'Home geofence')} />
      {m.geofencesState.fatalError && <QueryError error={m.geofencesState.fatalError} onRetry={m.geofencesState.retry ?? undefined} />}
      {m.configState.fatalError && <QueryError error={m.configState.fatalError} onRetry={m.configState.retry ?? undefined} />}
      {m.configQuery.isLoading && !configReady ? <Skeleton height={180} /> : configReady ? (
        <>
          <div className="grid min-w-0 grid-cols-1 gap-4 @xl:grid-cols-2">
            <div className="min-w-0 space-y-1">
              <Select label={t('guard.homeGeofence', 'Home geofence')}
                options={m.geofenceOptions} value={m.effectiveHomeGeofenceId}
                disabled={disabled || m.geofencesQuery.data === undefined}
                onChange={e => m.setHomeGeofenceId(e.target.value)} />
              <HelperText>{t('guard.modernization.geofencePolicy', 'Saved home-area policy; leaving this area is not proof of an active automatic alert service.')}</HelperText>
              {m.geofencesQuery.isLoading && !m.geofencesQuery.data && <Skeleton height={32} />}
              {m.geofencesQuery.data?.length === 0 && <HelperText>{t('guard.noGeofence', '— No home geofence —')}</HelperText>}
            </div>
            <div className="min-w-0 space-y-1">
              <Select label={t('guard.sensitivity', 'Sensitivity')}
                options={m.sensitivityOptions} value={m.effectiveSensitivity} disabled={disabled}
                onChange={e => m.setSensitivity(e.target.value)} />
              <HelperText>{t('guard.modernization.sensitivityPolicy', 'Saved movement threshold policy; automatic detection is not established.')}</HelperText>
            </div>
            <div className="min-w-0 space-y-1">
              <Toggle label={t('guard.autoPanic', 'Auto-panic on trigger')}
                checked={m.effectiveAutoPanic} onChange={m.setAutoPanic} disabled={disabled} />
              <HelperText>{t('guard.modernization.autoPanicPolicy', 'Saved auto-panic preference; no automatic execution worker is established.')}</HelperText>
            </div>
          </div>
        </>
      ) : <HelperText>{t('guard.modernization.sourceUnknown', 'Source unavailable; no security conclusion can be drawn.')}</HelperText>}
      <div className="flex flex-wrap justify-end">
        <Button wrapLabel onClick={m.handleSaveSettings} loading={m.setConfig.isPending} disabled={disabled}>
          {t('guard.saveSettings', 'Save settings')}
        </Button>
      </div>
      {m.setConfig.error && <QueryError error={m.setConfig.error} compact />}
      {m.setConfig.error && <HelperText>{t('guard.modernization.saveFailure', 'Policy may have been saved even if arming failed. Review the refreshed policy and live lock/Sentry status before trying again.')}</HelperText>}
      </FormSection>
    </div>
  );
}
