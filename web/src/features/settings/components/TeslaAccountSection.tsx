import { useTranslation } from 'react-i18next'
import {
  useAuthStatus, useAuthURL, useRefreshAuth,
  useDisconnectAuth, useSyncVehicles,
} from '@/api/hooks/useSettings'
import { GlassPanel, Button, ConfirmDialog, IconBox } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { useToast } from '@/components/feedback/Toast'
import { useConfirm } from '@/hooks/useConfirm'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/dateFormat'
import {
  Shield, ExternalLink, RefreshCw, Car, CheckCircle, XCircle,
} from 'lucide-react'

export function TeslaAccountSection() {
  const { t } = useTranslation('settings')
  const toast = useToast()
  const { data: auth } = useAuthStatus()
  const authUrlMut = useAuthURL()
  const refreshMut = useRefreshAuth()
  const disconnectMut = useDisconnectAuth()
  const syncMut = useSyncVehicles()
  const { confirm: confirmDisconnect, dialogProps: disconnectDialogProps } = useConfirm()

  function handleLogin() {
    authUrlMut.mutate(undefined, {
      onSuccess: (data) => { window.location.href = data.auth_url },
    })
  }

  async function handleDisconnect() {
    const ok = await confirmDisconnect({
      title: t('tesla.disconnectTitle', 'Disconnect Tesla Account?'),
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

  return (
    <FadeIn>
      <GlassPanel className="p-6 space-y-5">
        <div className="flex items-center gap-3">
          <IconBox color="blue">
            <Shield className="h-5 w-5" />
          </IconBox>
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('tesla.title', 'Tesla Account')}</h2>
            <p className="text-xs text-[var(--text-muted)]">{t('tesla.subtitle', 'Connect your Tesla account to sync vehicles and data')}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] border border-[var(--border-subtle)]">
          {auth?.authenticated ? (
            <>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neon-green/10">
                <CheckCircle className="h-4 w-4 text-neon-green" />
              </div>
              <div>
                <p className="text-sm font-medium text-emerald-300">{t('tesla.connected', 'Connected')}</p>
                {auth.expires_at && (
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {t('tesla.tokenExpires', 'Token expires')} {formatDateTime(auth.expires_at)}
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neon-red/10">
                <XCircle className="h-4 w-4 text-neon-red" />
              </div>
              <p className="text-sm text-rose-300 font-medium">{t('tesla.notConnected', 'Not connected')}</p>
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          {!auth?.authenticated ? (
            <Button variant="primary" icon={<ExternalLink className="h-4 w-4" />} onClick={handleLogin} loading={authUrlMut.isPending}>
              {t('tesla.connect', 'Connect Tesla Account')}
            </Button>
          ) : (
            <>
              <Button variant="secondary" icon={<RefreshCw className={cn('h-4 w-4', refreshMut.isPending && 'animate-spin')} />} onClick={() => refreshMut.mutate(undefined, {
                onSuccess: () => toast.success(t('toast.tokenRefreshed', 'Token refreshed')),
                onError: (err: Error) => toast.error(t('toast.tokenRefreshFailed', 'Token refresh failed'), err.message),
              })} disabled={refreshMut.isPending}>
                {t('tesla.refreshToken', 'Refresh Token')}
              </Button>
              <Button variant="secondary" icon={<Car className={cn('h-4 w-4', syncMut.isPending && 'animate-spin')} />} onClick={() => syncMut.mutate(undefined, {
                onError: (err: Error) => toast.error(t('toast.syncFailed', 'Vehicle sync failed'), err.message),
              })} disabled={syncMut.isPending}>
                {t('tesla.syncVehicles', 'Sync Vehicles')}
              </Button>
              <Button variant="secondary" icon={<ExternalLink className="h-4 w-4" />} onClick={handleLogin} disabled={authUrlMut.isPending} className="!border-neon-cyan/30 !text-neon-cyan hover:!bg-neon-cyan/5">
                {t('tesla.reauthorize', 'Re-authorize')}
              </Button>
              <Button variant="danger" icon={<XCircle className="h-4 w-4" />} onClick={handleDisconnect} disabled={disconnectMut.isPending}>
                {t('tesla.disconnect', 'Disconnect')}
              </Button>
            </>
          )}
        </div>

        {syncMut.isSuccess && (
          <p className="text-sm text-emerald-300 animate-in fade-in">
            {t('tesla.synced', 'Synced {{count}} vehicle(s).', { count: syncMut.data.synced })}
          </p>
        )}
      </GlassPanel>
      {disconnectDialogProps && (
        <ConfirmDialog {...disconnectDialogProps} loading={disconnectMut.isPending} />
      )}
    </FadeIn>
  )
}
