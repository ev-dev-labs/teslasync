import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useAuthStatus, useAuthURL, useRefreshAuth,
  useDisconnectAuth, useSyncVehicles,
} from '@/api/hooks/useSettings'
import { GlassPanel, Button, ConfirmDialog, IconBox, Heading, HelperText, Text, Badge } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { SourceContent } from '@/components/layout'
import { deriveDataState } from '@/api/dataState'
import { useToast } from '@/components/feedback/Toast'
import { useConfirm } from '@/hooks/useConfirm'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/dateFormat'
import { notifyTeslaAuthRecovered } from '@/lib/teslaAuthRecovery'
import {
  Shield, ExternalLink, RefreshCw, Car, CheckCircle, XCircle, AlertTriangle,
} from 'lucide-react'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export function TeslaAccountSection() {
  const { t } = useTranslation('settings')
  const toast = useToast()
  const authQuery = useAuthStatus()
  const authState = deriveDataState(authQuery)
  const auth = authState.data
  const authUrlMut = useAuthURL()
  const refreshMut = useRefreshAuth()
  const disconnectMut = useDisconnectAuth()
  const syncMut = useSyncVehicles()
  const { confirm: confirmDisconnect, dialogProps: disconnectDialogProps } = useConfirm()

  // Mirror TeslaReauthBanner events so this page shows token-expired status
  // before the next failed API call.
  const [pillDisconnected, setPillDisconnected] = useState(false)
  useEffect(() => {
    const onExpired = () => setPillDisconnected(true)
    const onRecovered = () => setPillDisconnected(false)
    document.addEventListener('teslasync:tesla-auth-expired', onExpired)
    document.addEventListener('teslasync:tesla-auth-recovered', onRecovered)
    return () => {
      document.removeEventListener('teslasync:tesla-auth-expired', onExpired)
      document.removeEventListener('teslasync:tesla-auth-recovered', onRecovered)
    }
  }, [])

  // Fire recovery only on the unauthenticated → authenticated edge so queued
  // mutations can replay and the banner can hide once per recovery.
  const prevAuthRef = useRef<boolean | null>(null)
  useEffect(() => {
    if (!auth) return
    const wasAuthed = prevAuthRef.current
    const isAuthed = !!auth.authenticated
    if (wasAuthed === false && isAuthed) {
      notifyTeslaAuthRecovered()
    }
    prevAuthRef.current = isAuthed
  }, [auth])

  function handleLogin() {
    authUrlMut.mutate(undefined, {
      onSuccess: (data) => {
        // Guard the redirect: a 2xx with a malformed/empty body must not
        // navigate the tab to "/undefined" and strand the user.
        if (data?.auth_url) window.location.href = data.auth_url
      },
    })
  }

  async function handleDisconnect() {
    const ok = await confirmDisconnect({
      title: t('tesla.disconnectTitle', 'Disconnect Tesla account?'),
      message: t('tesla.disconnectConfirm', 'Disconnect your Tesla account? You will need to re-authorize to use TeslaSync.'),
      variant: 'danger',
      confirmLabel: t('tesla.disconnect', 'Disconnect'),
      cancelLabel: t('common.cancel', 'Cancel'),
    })
    if (!ok) return
    disconnectMut.mutate(undefined, {
      onSuccess: () => toast.success(t('toast.disconnected', 'Tesla account disconnected')),
      onError: (err: Error) => toast.error(t('toast.disconnectFailed', 'Disconnect failed'), err.message),
    })
  }

  // Compute soft-warning state — token expires within 7 days but is still
  // technically valid. Surfaces a "Expires in Nd" pill before the silent-
  // failure cliff hits.
  const expiringSoon = (() => {
    if (!auth?.authenticated || !auth.expires_at) return null
    const expiresAt = new Date(auth.expires_at).getTime()
    if (Number.isNaN(expiresAt)) return null
    const remaining = expiresAt - Date.now()
    if (remaining <= 0 || remaining > SEVEN_DAYS_MS) return null
    const days = Math.max(1, Math.ceil(remaining / (24 * 60 * 60 * 1000)))
    return days
  })()

  return (
    <FadeIn>
      <GlassPanel className="p-6 space-y-5">
        <div className="flex items-center gap-3">
          <IconBox color="blue">
            <Shield className="h-5 w-5" />
          </IconBox>
          <div className="min-w-0">
            <Heading level="section">{t('tesla.title', 'Tesla account')}</Heading>
            <HelperText>{t('tesla.subtitle', 'Connect your Tesla account to sync vehicles and data')}</HelperText>
          </div>
        </div>

        <SourceContent
          state={authState.fatalError ? 'error' : authState.status === 'initial' ? 'loading' : authState.status === 'stale' ? 'retained' : auth ? 'ready' : 'empty'}
          label={t('tesla.title', 'Tesla account')}
          emptyMessage={t('tesla.statusUnavailable', 'Tesla account status unavailable.')}
          errorMessage={t('tesla.statusUnavailable', 'Tesla account status unavailable.')}
          error={authState.fatalError}
          errorRecovery={{ onRetry: () => void authQuery.refetch() }}
        >
        <div
          role="status"
          aria-live="polite"
          data-testid="tesla-connection-status"
          className="flex min-w-0 items-center gap-3 p-3 rounded-lg bg-[var(--surface-2)] border border-[var(--border-subtle)]"
        >
          {auth?.authenticated && !pillDisconnected ? (
            <>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/10">
                <CheckCircle className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Text as="p" variant="bodySm" weight="medium" className="text-emerald-300">{t('tesla.connected', 'Connected')}</Text>
                  {expiringSoon !== null && (
                    <Badge
                      variant="warning"
                      size="sm"
                      data-testid="tesla-expiring-soon-pill"
                      className="gap-1"
                    >
                      <AlertTriangle className="h-3 w-3" aria-hidden />
                      {t('tesla.expiringSoon', 'Expires in {{days}}d', { days: expiringSoon })}
                    </Badge>
                  )}
                </div>
                {auth.expires_at && (
                  <HelperText as="p">
                    {t('tesla.tokenExpires', 'Token expires')} {formatDateTime(auth.expires_at)}
                  </HelperText>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-500/10">
                <XCircle className="h-4 w-4 text-rose-300" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <Text as="p" variant="bodySm" weight="medium" className="text-rose-300">
                  {pillDisconnected
                    ? t('tesla.disconnected', 'Disconnected')
                    : t('tesla.notConnected', 'Not connected')}
                </Text>
                {pillDisconnected && (
                  <HelperText as="p">
                    {t('tesla.reauth.body', 'Reconnect to resume live data and commands.')}
                  </HelperText>
                )}
              </div>
            </>
          )}
        </div>
        </SourceContent>

        <div className="flex flex-wrap gap-3">
          {!auth?.authenticated ? (
            <Button variant="primary" wrapLabel icon={<ExternalLink className="h-4 w-4" />} onClick={handleLogin} loading={authUrlMut.isPending}>
              {t('tesla.connect', 'Connect Tesla account')}
            </Button>
          ) : (
            <>
              <Button variant="secondary" wrapLabel icon={<RefreshCw className={cn('h-4 w-4', refreshMut.isPending && 'animate-spin')} />} onClick={() => refreshMut.mutate(undefined, {
                onSuccess: () => toast.success(t('toast.tokenRefreshed', 'Token refreshed')),
                onError: (err: Error) => toast.error(t('toast.tokenRefreshFailed', 'Token refresh failed'), err.message),
              })} disabled={refreshMut.isPending}>
                {t('tesla.refreshToken', 'Refresh token')}
              </Button>
              <Button variant="secondary" wrapLabel icon={<Car className={cn('h-4 w-4', syncMut.isPending && 'animate-spin')} />} onClick={() => syncMut.mutate(undefined, {
                onError: (err: Error) => toast.error(t('toast.syncFailed', 'Vehicle sync failed'), err.message),
              })} disabled={syncMut.isPending}>
                {t('tesla.syncVehicles', 'Sync vehicles')}
              </Button>
              <Button variant="secondary" wrapLabel icon={<ExternalLink className="h-4 w-4" />} onClick={handleLogin} disabled={authUrlMut.isPending}>
                {t('tesla.reauthorize', 'Re-authorize')}
              </Button>
              <Button variant="danger" wrapLabel icon={<XCircle className="h-4 w-4" />} onClick={handleDisconnect} disabled={disconnectMut.isPending}>
                {t('tesla.disconnect', 'Disconnect')}
              </Button>
            </>
          )}
        </div>

        {syncMut.isSuccess && (
          <Text as="p" variant="bodySm" className="text-emerald-300 animate-in fade-in">
            {t('tesla.synced', 'Synced {{count}} vehicle(s).', { count: syncMut.data?.synced ?? 0 })}
          </Text>
        )}
      </GlassPanel>
      {disconnectDialogProps && (
        <ConfirmDialog {...disconnectDialogProps} loading={disconnectMut.isPending} />
      )}
    </FadeIn>
  )
}
