import { useTranslation } from 'react-i18next';
import { SlidersHorizontal } from 'lucide-react';
import { useCardPlacement } from '@/components/layout/layout-reference';
import { GlassPanel, Button, Select, Toggle, PanelTitle, HelperText } from '@/components/ui';
import { QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { cn } from '@/lib/cn';
import type { GuardPageModel } from './useGuardPageModel';

export function GuardSettings({ model: m }: { model: GuardPageModel }) {
  const { t } = useTranslation();
  const placement = useCardPlacement();
  const configReady = m.configQuery.data !== undefined;
  const disabled = m.noVehicle || m.setConfig.isPending || !configReady;
  return (
    <GlassPanel data-guard-section="settings"
      className={cn('min-w-0 space-y-4 p-4 sm:p-5', placement?.className)}>
      <PanelTitle className="flex items-center gap-2">
        <SlidersHorizontal className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
        {t('guard.settings', 'Guard settings')}
      </PanelTitle>
      <HelperText>{t('guard.modernization.engineLimitation', 'Automatic guard monitoring, theft detection, and auto-panic are not established by the current service. These settings persist policy; verify vehicle security using current lock and Sentry readings.')}</HelperText>
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
          <div className="flex flex-wrap justify-end">
            <Button onClick={m.handleSaveSettings} loading={m.setConfig.isPending} disabled={disabled}>
              {t('guard.saveSettings', 'Save settings')}
            </Button>
          </div>
        </>
      ) : <HelperText>{t('guard.modernization.sourceUnknown', 'Source unavailable; no security conclusion can be drawn.')}</HelperText>}
      {m.setConfig.error && <QueryError error={m.setConfig.error} compact />}
      {m.setConfig.error && <HelperText>{t('guard.modernization.saveFailure', 'Policy may have been saved even if arming failed. Review the refreshed policy and live lock/Sentry status before trying again.')}</HelperText>}
    </GlassPanel>
  );
}
