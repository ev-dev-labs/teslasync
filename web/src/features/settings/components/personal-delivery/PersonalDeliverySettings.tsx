import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isApiError } from '@/api/client'
import { personalScope, usePersonalIdentity } from '@/api/hooks/usePersonalIdentity'
import {
  useCurrentPersonalDevice,
  usePersonalDeliveryChange,
  usePersonalDeliveryDevices,
} from '@/api/hooks/usePersonalDelivery'
import { DataStateNotice, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback'
import { Button, ConfirmDialog, ErrorText, GlassPanel, PanelTitle, Text } from '@/components/ui'
import { useDataState } from '@/hooks/useDataState'
import { useOperationalMode } from '@/hooks/useOperationalMode'
import { personalPushSupported, refreshPersonalDeliveryWorker } from '@/lib/personalPush'
import { PersonalDeliveryDeviceRow } from './PersonalDeliveryDeviceRow'
import { usePersonalBrowser } from '@/hooks/usePersonalBrowser'

interface Props {
  active: boolean
  family: 'charging' | 'commute'
}

export function PersonalDeliverySettings({ active, family }: Props) {
  const { t } = useTranslation()
  const identity = usePersonalIdentity(active)
  const scope = personalScope(identity.data)
  const ready = active && scope != null && !identity.isFetching && !identity.isError
  const devices = usePersonalDeliveryDevices(scope, ready)
  const state = useDataState(devices)
  const browser = usePersonalBrowser()
  const current = useCurrentPersonalDevice(scope, browser.subscription?.endpoint ?? null, browser.generation, ready)
  const change = usePersonalDeliveryChange(scope)
  const operationalMode = useOperationalMode()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<number | null>(null)
  const accessDenied = isApiError(devices.error) &&
    (devices.error.status === 401 || devices.error.status === 403 || devices.error.code === 'IDENTITY_CHANGED')
  const blocked = !operationalMode.canWrite || !ready || state.status !== 'ok' ||
    devices.isFetching || busy || change.isPending
  const lookupKnown = browser.status === 'unsupported' || (browser.status === 'ready' &&
    (browser.subscription == null || (current.isSuccess && !current.isFetching)))
  const currentDevice = browser.subscription && current.isSuccess ? current.data : null
  const available = family === 'commute' ? state.data?.commute_available : state.data?.available
  const rows = (state.data?.devices ?? []).map((device) =>
    currentDevice?.id === device.id ? currentDevice : device)

  const connect = async () => {
    if (blocked || !available || !state.data?.public_key || !personalPushSupported()) return
    setBusy(true)
    setError(null)
    try {
      const subscription = await browser.subscribe(state.data.public_key)
      const json = subscription.toJSON()
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth || !personalPushSupported()) {
        throw new Error('Personal browser subscription is unavailable')
      }
      await change.mutateAsync({
        kind: 'enroll',
        subscription: { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
        texts: {
          verification_title: t('smartCharging.delivery.verifyTitle', 'TeslaSync device confirmation'),
          verification_body: t('smartCharging.delivery.verifyBody', 'This browser is ready for personal notifications.'),
          charging_title: t('smartCharging.delivery.pushTitle', 'Charging readiness'),
          charging_body: t('smartCharging.delivery.pushBody', 'Open TeslaSync to review a charging decision.'),
        },
      })
    } catch (caught) {
      setError(isApiError(caught) && caught.code === 'DEVICE_IN_USE'
        ? t('smartCharging.delivery.owned', 'This browser is linked to another account. Sign in as its owner to disconnect it first.')
        : t('smartCharging.delivery.connectFailed', 'Could not confirm this browser. Check notification permission and server configuration, then retry.'))
    } finally {
      setBusy(false)
    }
  }

  const updatePreference = async (id: number, enabled: boolean) => {
    const needsRefresh = family === 'commute' && enabled
    if (blocked || (needsRefresh && currentDevice?.id !== id)) return
    if (needsRefresh) setBusy(true)
    setError(null)
    try {
      if (needsRefresh) await refreshPersonalDeliveryWorker()
      await change.mutateAsync(family === 'commute'
        ? {
          kind: 'commute', id, enabled, copy: {
            title: t('smartCommute.delivery.pushTitle', 'Smart Commute'),
            body: t('smartCommute.delivery.pushBody', 'Open TeslaSync to review a route comparison.'),
          },
        }
        : { kind: 'charging', id, enabled })
    } catch {
      setError(t('smartCharging.delivery.changeFailed', 'The delivery preference was not saved. Refresh and retry.'))
    } finally {
      if (needsRefresh) setBusy(false)
    }
  }

  const disconnect = async () => {
    if (blocked || removing == null) return
    const clearBrowser = currentDevice?.id === removing
    setBusy(true)
    setError(null)
    try {
      await change.mutateAsync({ kind: 'delete', id: removing })
      setRemoving(null)
      if (clearBrowser) await browser.clear()
    } catch {
      setError(t('smartCharging.delivery.disconnectFailed', 'The device could not be fully disconnected. Refresh and retry; remove any remaining browser subscription if needed.'))
    } finally {
      setBusy(false)
    }
  }

  const clearBrowser = async () => {
    setBusy(true)
    setError(null)
    try {
      await browser.clear()
    } catch {
      setError(t('smartCharging.delivery.clearFailed', 'The browser subscription could not be removed. Retry from this browser.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <GlassPanel padding="lg" className="space-y-4">
      <PanelTitle>{t('smartCharging.delivery.title', 'Personal browser notifications')}</PanelTitle>
      <Text as="p" variant="bodySm">
        {t('smartCharging.delivery.privacy', 'Your browser’s push service receives an encrypted, short-lived token, not trip details. TeslaSync checks the same account and current consent before showing a generic notification.')}
      </Text>
      {family === 'commute' && (
        <Text as="p" variant="bodySm">
          {t('smartCommute.delivery.help', 'Commute push starts off and only applies to routines with approved traffic checks. Enable it from the browser that should receive it. This replaces the previous commute recipient without changing charging notifications.')}
        </Text>
      )}
      {identity.isFetching || identity.isLoading ? <Skeleton lines={2} /> : identity.error ? (
        <QueryError error={identity.error} onRetry={() => void identity.refetch()} />
      ) : !scope ? (
        <DataStateNotice state="unavailable" title={t('smartCharging.identityMissing', 'Identity unavailable')}
          message={t('smartCharging.identityMissingDescription', 'Your authentication provider did not supply a verified identity.')} />
      ) : accessDenied ? <QueryError error={devices.error} onRetry={() => void devices.refetch()} /> : state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={() => void devices.refetch()} />
      ) : !state.hasData ? <Skeleton lines={2} /> : (
        <>
          <StaleRefreshWarning state={state} label={t('smartCharging.delivery.title', 'Personal browser notifications')} />
          {scope.mode === 'open' && (
            <Text as="p" variant="bodySm">
              {t('smartCharging.delivery.shared', 'Without sign-in, anyone with access to TeslaSync can manage these delivery devices.')}
            </Text>
          )}
          {!state.data?.available && (
            <Text as="p" variant="bodySm">
              {t('smartCharging.delivery.serverUnavailable', 'Personal delivery needs VAPID credentials and the same encryption key on the API and notification worker. Existing alert channels are separate.')}
            </Text>
          )}
          {family === 'commute' && state.data?.available && !available && (
            <Text as="p" variant="bodySm">
              {t('smartCommute.delivery.unavailable', 'Commute push requires configured HERE traffic checks and shared live signals.')}
            </Text>
          )}
          {browser.status === 'unsupported' && (
            <Text as="p" variant="bodySm">
              {t('smartCharging.delivery.browserUnavailable', 'Personal browser delivery needs a supported browser and a secure, same-origin connection.')}
            </Text>
          )}
          {browser.status === 'error' && (
            <Button wrapLabel variant="secondary" size="sm" onClick={browser.retry}>
              {t('smartCharging.delivery.retryBrowser', 'Retry checking this browser')}
            </Button>
          )}
          {current.isError && <QueryError error={current.error} onRetry={() => void current.refetch()} />}
          {error && removing == null && <ErrorText role="alert">{error}</ErrorText>}
          {browser.status === 'ready' && !currentDevice?.verified && (
            <Button wrapLabel variant="primary" disabled={blocked || !lookupKnown || !available}
              onClick={() => void connect()}>
              {currentDevice
                ? t('smartCharging.delivery.retryConfirmation', 'Retry confirmation')
                : t('smartCharging.delivery.connect', 'Connect this browser')}
            </Button>
          )}
          {browser.subscription && lookupKnown && !currentDevice && (
            <Button wrapLabel variant="secondary" disabled={blocked} onClick={() => void clearBrowser()}>
              {t('smartCharging.delivery.clearBrowser', 'Remove this browser subscription')}
            </Button>
          )}
          {rows.length === 0 ? (
            <Text as="p" variant="bodySm">
              {family === 'commute'
                ? t('smartCommute.delivery.empty', 'No personal devices are connected.')
                : t('smartCharging.delivery.empty', 'No personal devices are connected. Charging push is off by default.')}
            </Text>
          ) : rows.map((device, index) => (
            <PersonalDeliveryDeviceRow key={device.id} device={device} index={index}
              current={currentDevice?.id === device.id} disabled={blocked || !lookupKnown}
              available={available ?? false} family={family}
              onChange={(id, enabled) => void updatePreference(id, enabled)} onRemove={setRemoving} />
          ))}
          <ConfirmDialog open={removing != null} variant="danger" confirmDisabled={blocked} loading={busy}
            title={t('smartCharging.delivery.disconnectTitle', 'Disconnect this device?')}
            message={t('smartCharging.delivery.disconnectDescription', 'Pending personal deliveries are invalidated. Plans and existing alert channels are unchanged.')}
            details={error ? <ErrorText role="alert">{error}</ErrorText> : undefined}
            confirmLabel={t('smartCharging.delivery.disconnect', 'Disconnect device')}
            cancelLabel={t('common.cancel', 'Cancel')} onCancel={() => setRemoving(null)}
            onConfirm={() => void disconnect()} />
        </>
      )}
    </GlassPanel>
  )
}
