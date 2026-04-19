import { useState, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppSettings } from '@/api/types'
import {
  useSettings, useSaveSettings, useAuthStatus, useAuthURL,
  useRefreshAuth, useDisconnectAuth, useSyncVehicles, useVehicles,
  useCarPreferences, useGasPriceStatus, usePollGasPrice,
  useToggleGasPrice, useUpdateGasPriceConfig,
} from '@/api/hooks/useSettings'
import {
  useTeslaFeatureConfig, useRefreshTeslaFeatureConfig,
  useTeslaUserRegion, useRefreshTeslaRegion,
  useTeslaUserOrders, useRefreshTeslaOrders,
} from '@/api/hooks/useUser'
import { PageContainer } from '@/components/layout'
import { GlassPanel, Button, Input, Select, IconBox, Badge, Toggle } from '@/components/ui'
import { Skeleton, EmptyState } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { useTheme, type ThemeId, type ModeId } from '@/components/ui/ThemeProvider'
import { useToast } from '@/components/feedback/Toast'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useWebPush } from '@/hooks/useWebPush'
import { useNotificationListener, type WebPushPreferences } from '@/hooks/useNotificationListener'
import { cn } from '@/lib/cn'
import { fmtNumber } from '@/lib/numberFormat'
import { formatDateTime } from '@/lib/dateFormat'
import { parseSettingEnum, isSettingMiles, isSettingFahrenheit, isSettingPSI, isSettingBar } from '@/lib/parseSettingEnum'
import {
  Settings as SettingsIcon, Save, ExternalLink, RefreshCw, Car, Shield,
  CheckCircle, XCircle, Palette, Download, Sun, Moon, Monitor, Sparkles,
  Pause, Play, Fuel, Zap, Flag, Globe, Info, ShoppingCart, Package, Calendar,
  Bell,
} from 'lucide-react'

const modeIcons: Record<string, ReactNode> = {
  dark: <Moon className="h-4 w-4" />,
  light: <Sun className="h-4 w-4" />,
  oled: <Monitor className="h-4 w-4" />,
  midnight: <Sparkles className="h-4 w-4" />,
  auto: <Monitor className="h-4 w-4" />,
  sunset: <Sun className="h-4 w-4" />,
  nord: <Sparkles className="h-4 w-4" />,
}

function SettingField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-[var(--text-muted)] mb-1.5 font-medium uppercase tracking-wider">{label}</label>
      {children}
    </div>
  )
}

function orderStatusVariant(status: string): 'info' | 'success' | 'warning' | 'danger' | 'neutral' {
  const s = status.toUpperCase()
  if (s.includes('DELIVER')) return 'success'
  if (s.includes('READY') || s.includes('TRANSPORT')) return 'info'
  if (s.includes('CANCEL') || s.includes('REJECT')) return 'danger'
  if (s.includes('PENDING') || s.includes('ORDER')) return 'warning'
  return 'neutral'
}

function formatOrderStatus(status: string): string {
  return status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatDeliveryDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export default function SettingsPage() {
  const { t } = useTranslation('settings')
  usePageTitle(t('title', 'Settings'))
  const toast = useToast()

  // ── Data queries ──
  const { data: settings, isLoading } = useSettings()
  const { data: auth } = useAuthStatus()

  // ── Browser notifications ──
  const { permission, requestPermission, isSupported: notificationsSupported } = useWebPush()
  const { prefs: pushPrefs, setPrefs: setPushPrefs } = useNotificationListener()
  const { data: gasPriceStatus } = useGasPriceStatus()
  const { data: featureConfig } = useTeslaFeatureConfig()
  const { data: regionConfig } = useTeslaUserRegion()
  const { data: ordersData } = useTeslaUserOrders()
  const { themeId, modeId, setTheme, setMode, setCustomColors, themes: allThemes, modes: allModes } = useTheme()

  // ── Form state ──
  const [form, setForm] = useState<AppSettings>({
    unit_of_length: 'km',
    unit_of_temp: 'C',
    unit_of_pressure: 'bar',
    preferred_range: 'rated',
    language: 'en',
    base_cost_per_kwh: 0.12,
    api_suspended: false,
    theme: 'neon-cyan',
    mode: 'dark',
    custom_primary: '#00b4d8',
    custom_accent: '#e63946',
    gas_price_per_unit: 3.50,
    gas_unit: 'gallon',
    gas_efficiency_mpg: 25,
    decimal_precision: 2,
    quiet_hours_enabled: false,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    alert_digest_mode: 'instant',
  })
  const [saved, setSaved] = useState(false)
  const [customPrimary, setCustomPrimary] = useState(() => localStorage.getItem('teslasync-custom-primary') || '#00b4d8')
  const [customAccent, setCustomAccent] = useState(() => localStorage.getItem('teslasync-custom-accent') || '#e63946')

  const [formInited, setFormInited] = useState(false)
  if (settings && !formInited) {
    setForm(settings)
    setFormInited(true)
  }

  // ── Mutations ──
  const settingsMut = useSaveSettings()
  const authUrlMut = useAuthURL()
  const refreshMut = useRefreshAuth()
  const disconnectMut = useDisconnectAuth()
  const syncMut = useSyncVehicles()
  const gasPollMut = usePollGasPrice()
  const gasToggleMut = useToggleGasPrice()
  const gasConfigMut = useUpdateGasPriceConfig()
  const featureConfigRefresh = useRefreshTeslaFeatureConfig()
  const regionRefresh = useRefreshTeslaRegion()
  const ordersRefresh = useRefreshTeslaOrders()

  // ── Derived feature flag entries ──
  const featureEntries = useMemo(() => {
    const data = featureConfig?.data
    if (!data || typeof data !== 'object') return []
    return Object.entries(data).map(([key, value]) => {
      const isObj = typeof value === 'object' && value !== null
      const enabled = isObj ? (value as Record<string, unknown>).enabled : value
      const details = isObj
        ? Object.entries(value as Record<string, unknown>)
            .filter(([k]) => k !== 'enabled')
            .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
            .join(', ')
        : null
      return { key, enabled: Boolean(enabled), details }
    })
  }, [featureConfig?.data])

  // ── Vehicle user preferences for "Sync from Car" feature ──
  const { data: vehicles } = useVehicles()
  const firstVehicleId = vehicles?.[0]?.id ?? null
  const { data: carPrefs } = useCarPreferences(firstVehicleId)

  function syncUnitsFromCar() {
    if (!carPrefs) return
    const updates: Partial<AppSettings> = {}

    if (isSettingMiles(carPrefs.setting_distance_unit)) updates.unit_of_length = 'mi'
    else if (carPrefs.setting_distance_unit) updates.unit_of_length = 'km'

    if (isSettingFahrenheit(carPrefs.setting_temperature_unit)) updates.unit_of_temp = 'F'
    else if (carPrefs.setting_temperature_unit) updates.unit_of_temp = 'C'

    if (isSettingPSI(carPrefs.setting_tire_pressure_unit)) updates.unit_of_pressure = 'psi'
    else if (isSettingBar(carPrefs.setting_tire_pressure_unit)) updates.unit_of_pressure = 'bar'

    if (Object.keys(updates).length > 0) {
      const newForm = { ...form, ...updates }
      setForm(newForm)
      settingsMut.mutate(newForm)
      toast.success(
        t('toast.unitsSynced', 'Units synced from car'),
        `${t('distance', 'Distance')}: ${updates.unit_of_length === 'mi' ? t('miles', 'Miles') : t('kilometers', 'Kilometers')}, ${t('temperature', 'Temperature')}: ${updates.unit_of_temp === 'F' ? t('fahrenheit', 'Fahrenheit') : t('celsius', 'Celsius')}, ${t('pressure', 'Pressure')}: ${updates.unit_of_pressure === 'psi' ? 'PSI' : 'Bar'}`,
      )
    } else {
      toast.info(t('toast.noChanges', 'No changes'), t('toast.noChangesDesc', 'Could not detect car unit preferences'))
    }
  }

  function handleLogin() {
    authUrlMut.mutate(undefined, {
      onSuccess: (data) => {
        window.location.href = data.auth_url
      },
    })
  }

  return (
    <PageContainer
      title={t('title', 'Settings')}
      subtitle={t('subtitle', 'Configure TeslaSync preferences and Tesla account connection')}
      loading={isLoading}
    >
      {/* ── Tesla Account ── */}
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

          <div className="flex items-center gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/5">
            {auth?.authenticated ? (
              <>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-neon-green/10">
                  <CheckCircle className="h-4 w-4 text-neon-green" />
                </div>
                <div>
                  <p className="text-sm font-medium text-neon-green">{t('tesla.connected', 'Connected')}</p>
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
                <p className="text-sm text-neon-red font-medium">{t('tesla.notConnected', 'Not connected')}</p>
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
                <Button variant="danger" icon={<XCircle className="h-4 w-4" />} onClick={() => { if (confirm(t('tesla.disconnectConfirm', 'Disconnect your Tesla account? You will need to re-authorize to use TeslaSync.'))) disconnectMut.mutate(undefined, {
                  onSuccess: () => toast.success(t('toast.disconnected', 'Tesla account disconnected')),
                  onError: (err: Error) => toast.error(t('toast.disconnectFailed', 'Disconnect failed'), err.message),
                }) }} disabled={disconnectMut.isPending}>
                  {t('tesla.disconnect', 'Disconnect')}
                </Button>
              </>
            )}
          </div>

          {syncMut.isSuccess && (
            <p className="text-sm text-neon-green animate-in fade-in">
              {t('tesla.synced', 'Synced {{count}} vehicle(s).', { count: syncMut.data.synced })}
            </p>
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Feature Flags ── */}
      <FadeIn delay={0.03}>
        <GlassPanel className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <IconBox color="purple">
                <Flag className="h-5 w-5" />
              </IconBox>
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('featureConfig.title', 'Feature Flags')}</h2>
                <p className="text-xs text-[var(--text-muted)]">{t('featureConfig.subtitle', 'Tesla account feature configuration')}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {featureConfig?.fetched_at && (
                <span className="text-[11px] text-[var(--text-muted)]">
                  {t('featureConfig.lastSynced', 'Synced')} {formatDateTime(featureConfig.fetched_at)}
                </span>
              )}
              <Button
                variant="secondary"
                size="sm"
                icon={<RefreshCw className={cn('h-3.5 w-3.5', featureConfigRefresh.isPending && 'animate-spin')} />}
                onClick={() => featureConfigRefresh.mutate(undefined, {
                  onSuccess: () => toast.success(t('toast.featureConfigRefreshed', 'Feature config refreshed')),
                  onError: (err: Error) => toast.error(t('toast.featureConfigFailed', 'Failed to refresh feature config'), err.message),
                })}
                disabled={featureConfigRefresh.isPending}
              >
                {t('featureConfig.refresh', 'Refresh')}
              </Button>
            </div>
          </div>

          {featureEntries.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5 text-left">
                    <th className="pb-2 pr-4 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">{t('featureConfig.feature', 'Feature')}</th>
                    <th className="pb-2 pr-4 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">{t('featureConfig.status', 'Status')}</th>
                    <th className="pb-2 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">{t('featureConfig.details', 'Details')}</th>
                  </tr>
                </thead>
                <tbody>
                  {featureEntries.map((entry) => (
                    <tr key={entry.key} className="border-b border-white/[0.03]">
                      <td className="py-2.5 pr-4 font-medium text-[var(--text-primary)]">{entry.key}</td>
                      <td className="py-2.5 pr-4">
                        <Badge variant={entry.enabled ? 'success' : 'neutral'}>
                          {entry.enabled ? t('featureConfig.enabled', 'Enabled') : t('featureConfig.disabled', 'Disabled')}
                        </Badge>
                      </td>
                      <td className="py-2.5 text-xs text-[var(--text-muted)] max-w-xs truncate">{entry.details ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={<Info className="h-10 w-10" />} message={t('featureConfig.noData', 'No feature config data yet. Click Refresh to fetch from Tesla.')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Region & API ── */}
      <FadeIn delay={0.04}>
        <GlassPanel className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <IconBox color="green">
                <Globe className="h-5 w-5" />
              </IconBox>
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('region.title', 'Region & API')}</h2>
                <p className="text-xs text-[var(--text-muted)]">{t('region.subtitle', 'Tesla account region and Fleet API endpoint')}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {regionConfig?.fetched_at && (
                <span className="text-[11px] text-[var(--text-muted)]">
                  {t('region.lastSynced', 'Synced')} {formatDateTime(regionConfig.fetched_at)}
                </span>
              )}
              <Button
                variant="secondary"
                size="sm"
                icon={<RefreshCw className={cn('h-3.5 w-3.5', regionRefresh.isPending && 'animate-spin')} />}
                onClick={() => regionRefresh.mutate(undefined, {
                  onSuccess: () => toast.success(t('toast.regionRefreshed', 'Region info refreshed')),
                  onError: (err: Error) => toast.error(t('toast.regionFailed', 'Failed to refresh region'), err.message),
                })}
                disabled={regionRefresh.isPending}
              >
                {t('region.refresh', 'Refresh')}
              </Button>
            </div>
          </div>

          {regionConfig?.data?.region ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-lg bg-white/[0.02] border border-white/5 p-4">
                <p className="text-xs text-[var(--text-muted)] mb-1 uppercase tracking-wider">{t('region.regionCode', 'Region')}</p>
                <p className="text-lg font-semibold text-[var(--text-primary)]">{regionConfig.data.region}</p>
              </div>
              <div className="rounded-lg bg-white/[0.02] border border-white/5 p-4">
                <p className="text-xs text-[var(--text-muted)] mb-1 uppercase tracking-wider">{t('region.fleetApiUrl', 'Fleet API Base URL')}</p>
                <p className="text-sm font-mono text-[var(--text-primary)] break-all">{regionConfig.data.fleet_api_base_url ?? '—'}</p>
              </div>
            </div>
          ) : (
            <EmptyState icon={<Info className="h-10 w-10" />} message={t('region.noData', 'No region data yet. Click Refresh to fetch from Tesla.')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Active Orders ── */}
      <FadeIn delay={0.045}>
        <GlassPanel className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <IconBox color="cyan">
                <ShoppingCart className="h-5 w-5" />
              </IconBox>
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('orders.title', 'Active Orders')}</h2>
                <p className="text-xs text-[var(--text-muted)]">{t('orders.subtitle', 'Vehicle orders and delivery tracking from Tesla')}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {ordersData?.fetched_at && (
                <span className="text-[11px] text-[var(--text-muted)]">
                  {t('orders.lastSynced', 'Synced')} {formatDateTime(ordersData.fetched_at)}
                </span>
              )}
              <Button
                variant="secondary"
                size="sm"
                icon={<RefreshCw className={cn('h-3.5 w-3.5', ordersRefresh.isPending && 'animate-spin')} />}
                onClick={() => ordersRefresh.mutate(undefined, {
                  onSuccess: () => toast.success(t('toast.ordersRefreshed', 'Orders refreshed')),
                  onError: (err: Error) => toast.error(t('toast.ordersFailed', 'Failed to refresh orders'), err.message),
                })}
                disabled={ordersRefresh.isPending}
              >
                {t('orders.refresh', 'Refresh')}
              </Button>
            </div>
          </div>

          {(ordersData?.orders ?? []).length > 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {(ordersData?.orders ?? []).map((order) => (
                <div key={order.order_id} className="rounded-lg bg-white/[0.02] border border-white/5 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-[var(--text-muted)]" />
                      <span className="text-sm font-semibold text-[var(--text-primary)]">{order.model || '—'}</span>
                    </div>
                    <Badge variant={orderStatusVariant(order.status)}>
                      {formatOrderStatus(order.status)}
                    </Badge>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-[var(--text-muted)]">{t('orders.orderId', 'Order ID')}</span>
                      <span className="font-mono text-[var(--text-primary)]">{order.order_id}</span>
                    </div>
                    {order.vin && (
                      <div className="flex justify-between">
                        <span className="text-[var(--text-muted)]">{t('orders.vin', 'VIN')}</span>
                        <span className="font-mono text-[var(--text-primary)]">{order.vin}</span>
                      </div>
                    )}
                    {order.delivery_date && (
                      <div className="flex justify-between">
                        <span className="text-[var(--text-muted)]">{t('orders.deliveryDate', 'Delivery Date')}</span>
                        <span className="flex items-center gap-1 text-[var(--text-primary)]">
                          <Calendar className="h-3 w-3" />
                          {formatDeliveryDate(order.delivery_date)}
                        </span>
                      </div>
                    )}
                    {order.is_upgradable && (
                      <div className="flex justify-end">
                        <Badge variant="info" size="sm">{t('orders.upgradable', 'Upgradable')}</Badge>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={<Info className="h-10 w-10" />} message={
              ordersData?.fetched_at
                ? t('orders.noOrders', 'No active orders found.')
                : t('orders.noData', 'No order data yet. Click Refresh to fetch from Tesla.')
            } />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Fleet API Settings — link ── */}
      <FadeIn delay={0.05}>
        <a href="/fleet-api" className="block">
          <GlassPanel className="p-5 flex items-center gap-4 hover:border-white/10 transition-colors cursor-pointer group">
            <div className={cn(
              'flex h-10 w-10 items-center justify-center rounded-xl ring-1',
              settings?.api_suspended
                ? 'bg-neon-red/10 text-neon-red ring-neon-red/20'
                : 'bg-neon-green/10 text-neon-green ring-neon-green/20'
            )}>
              <Zap className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('fleet.title', 'Fleet API Settings')}</h2>
              <p className="text-xs text-[var(--text-muted)]">
                {settings?.api_suspended
                  ? t('fleet.suspended', 'API polling is suspended')
                  : t('fleet.description', 'Manage polling, endpoint toggles, and telemetry capture')}
              </p>
            </div>
            <ExternalLink className="h-4 w-4 text-[var(--text-muted)] group-hover:text-neon-cyan transition-colors shrink-0" />
          </GlassPanel>
        </a>
      </FadeIn>

      {/* ── Application Settings ── */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-6 space-y-6">
          <div className="flex items-center gap-3">
            <IconBox color="cyan">
              <SettingsIcon className="h-5 w-5" />
            </IconBox>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('app.title', 'Application')}</h2>
              <p className="text-xs text-[var(--text-muted)]">{t('app.subtitle', 'Units, language, and cost preferences')}</p>
            </div>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : (
            <>
              {/* Sync from Car banner */}
              {carPrefs && (carPrefs.setting_distance_unit || carPrefs.setting_temperature_unit) && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-neon-cyan/20 bg-neon-cyan/5 p-4 mb-5">
                  <div className="flex items-center gap-3">
                    <Car className="h-5 w-5 text-neon-cyan shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">
                        {t('app.carUses', 'Car uses')} {parseSettingEnum(carPrefs.setting_distance_unit, 'distance')} / {parseSettingEnum(carPrefs.setting_temperature_unit, 'temperature')} / {parseSettingEnum(carPrefs.setting_tire_pressure_unit, 'pressure')}
                      </p>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        {t('app.syncHint', "Sync your app's units to match your vehicle's display settings")}
                      </p>
                    </div>
                  </div>
                  <Button variant="primary" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={syncUnitsFromCar} className="shrink-0">
                    {t('app.syncFromCar', 'Sync from Car')}
                  </Button>
                </div>
              )}

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Select
                  label={t('app.distanceUnit', 'Distance Unit')}
                  value={form.unit_of_length}
                  onChange={e => setForm({ ...form, unit_of_length: e.target.value })}
                  options={[{ value: 'km', label: t('app.kilometers', 'Kilometers') }, { value: 'mi', label: t('app.miles', 'Miles') }]}
                />
                <Select
                  label={t('app.temperatureUnit', 'Temperature Unit')}
                  value={form.unit_of_temp}
                  onChange={e => setForm({ ...form, unit_of_temp: e.target.value })}
                  options={[{ value: 'C', label: t('app.celsius', 'Celsius') }, { value: 'F', label: t('app.fahrenheit', 'Fahrenheit') }]}
                />
                <Select
                  label={t('app.pressureUnit', 'Pressure Unit')}
                  value={form.unit_of_pressure ?? 'bar'}
                  onChange={e => setForm({ ...form, unit_of_pressure: e.target.value })}
                  options={[{ value: 'bar', label: t('app.bar', 'Bar') }, { value: 'psi', label: t('app.psi', 'PSI') }]}
                />
                <Select
                  label={t('app.preferredRange', 'Preferred Range')}
                  value={form.preferred_range}
                  onChange={e => setForm({ ...form, preferred_range: e.target.value })}
                  options={[{ value: 'rated', label: t('app.rated', 'Rated') }, { value: 'ideal', label: t('app.ideal', 'Ideal') }]}
                />

                <div>
                  <Input
                    label={t('app.decimalPrecision', 'Decimal Precision')}
                    type="number"
                    min={0}
                    max={20}
                    value={String(form.decimal_precision)}
                    onChange={e => setForm({ ...form, decimal_precision: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })}
                    placeholder="e.g. 2"
                  />
                  <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                    {t('app.preview', 'Preview')}: {(14.248539).toFixed(form.decimal_precision)}
                  </p>
                </div>

                <Select
                  label={t('app.language', 'Language')}
                  value={form.language}
                  onChange={e => setForm({ ...form, language: e.target.value })}
                  options={[
                    { value: 'en', label: 'English' },
                    { value: 'de', label: 'Deutsch' },
                    { value: 'fr', label: 'Français' },
                    { value: 'es', label: 'Español' },
                    { value: 'zh', label: '中文' },
                  ]}
                />

                <SettingField label={t('app.electricityCost', 'Electricity Cost (per kWh)')}>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-sm">$</span>
                    <Input
                      type="number"
                      step="0.01"
                      value={form.base_cost_per_kwh}
                      onChange={e => setForm({ ...form, base_cost_per_kwh: parseFloat(e.target.value) || 0 })}
                      className="w-full pl-7 pr-3 py-2.5 text-sm"
                    />
                  </div>
                </SettingField>

                <SettingField label={t('app.gasPrice', 'Gas Price (for EV vs ICE comparison)')}>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-sm">$</span>
                      <Input
                        type="number"
                        step="0.01"
                        value={form.gas_price_per_unit}
                        onChange={e => setForm({ ...form, gas_price_per_unit: parseFloat(e.target.value) || 0 })}
                        className="w-full pl-7 pr-3 py-2.5 text-sm"
                      />
                    </div>
                    <Select
                      value={form.gas_unit}
                      onChange={e => setForm({ ...form, gas_unit: e.target.value })}
                      options={[{ value: 'gallon', label: t('app.perGallon', '/ gallon') }, { value: 'liter', label: t('app.perLiter', '/ liter') }]}
                      className="w-28"
                    />
                  </div>
                </SettingField>

                <SettingField label={t('app.comparisonMPG', 'Comparison Vehicle MPG')}>
                  <Input
                    type="number"
                    step="0.5"
                    value={form.gas_efficiency_mpg}
                    onChange={e => setForm({ ...form, gas_efficiency_mpg: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2.5 text-sm"
                    placeholder={t('app.mpgPlaceholder', 'Average MPG of equivalent gas car')}
                  />
                </SettingField>

                <SettingField label={t('app.googleMapsApiKey', 'Google Maps API Key')}>
                  <Input
                    type="password"
                    value={form.google_maps_api_key || ''}
                    onChange={e => setForm({ ...form, google_maps_api_key: e.target.value })}
                    className="w-full px-3 py-2.5 text-sm"
                    placeholder={t('app.googleMapsPlaceholder', 'Enter your Google Maps API key')}
                  />
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">
                    {t('app.googleMapsHint', 'Optional — enables satellite views, Places autocomplete, and enhanced geocoding.')}{' '}
                    {t('app.getKeyAt', 'Get a key at')}{' '}
                    <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" className="text-neon-cyan hover:underline">console.cloud.google.com</a>
                  </p>
                </SettingField>
              </div>
            </>
          )}

          <div className="flex items-center gap-4">
            <Button variant="primary" icon={<Save className="h-4 w-4" />} onClick={() => settingsMut.mutate(form, {
              onSuccess: () => { toast.success(t('toast.saved', 'Settings saved'), t('toast.savedDesc', 'Your preferences have been updated')); setSaved(true); setTimeout(() => setSaved(false), 3000) },
              onError: () => toast.error(t('toast.saveFailed', 'Failed to save'), t('toast.saveFailedDesc', 'Could not update settings')),
            })} loading={settingsMut.isPending}>
              {t('app.save', 'Save Settings')}
            </Button>
            {saved && (
              <span className="text-sm text-neon-green flex items-center gap-1 animate-in fade-in">
                <CheckCircle className="h-4 w-4" /> {t('app.settingsSaved', 'Settings saved')}
              </span>
            )}
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ── Gas Price Auto-Poll ── */}
      <FadeIn delay={0.12}>
        <GlassPanel className="p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10 text-orange-400 ring-1 ring-orange-500/20">
              <Fuel className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('gas.title', 'Gas Price Auto-Poll')}</h2>
              <p className="text-xs text-[var(--text-muted)]">{t('gas.subtitle', 'Automatically fetch US average gas prices from EIA')}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SettingField label={t('gas.autoPoll', 'Auto-Poll')}>
              <Button
                variant="ghost"
                onClick={() => {
                  gasToggleMut.mutate(!gasPriceStatus?.enabled, {
                    onSuccess: () => toast.info(!gasPriceStatus?.enabled ? t('gas.enabled', 'Auto-poll enabled') : t('gas.disabled', 'Auto-poll disabled')),
                  })
                }}
                className={cn(
                  'flex items-center gap-3 w-full rounded-xl border p-3.5 h-auto transition-all duration-200',
                  gasPriceStatus?.enabled
                    ? 'border-neon-green/40 bg-neon-green/5 text-neon-green'
                    : 'border-[var(--glass-border)] bg-[var(--surface-2)] text-[var(--text-muted)]'
                )}
              >
                {gasPriceStatus?.enabled ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                <span className="text-sm font-medium">{gasPriceStatus?.enabled ? t('gas.running', 'Running') : t('gas.stopped', 'Stopped')}</span>
              </Button>
            </SettingField>

            <Select
              label={t('gas.pollInterval', 'Poll Interval')}
              value={gasPriceStatus?.poll_interval || '7d'}
              onChange={e => gasConfigMut.mutate(e.target.value, { onSuccess: () => toast.info(t('gas.intervalUpdated', 'Poll interval updated')) })}
              options={[
                { value: 'daily', label: t('gas.daily', 'Daily') },
                { value: '7d', label: t('gas.weekly', 'Weekly') },
                { value: '15d', label: t('gas.biweekly', 'Bi-weekly') },
                { value: '30d', label: t('gas.monthly', 'Monthly') },
              ]}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--surface-2)] p-3.5">
              <p className="text-xs font-medium uppercase tracking-wider mb-1 text-[var(--text-muted)]">{t('gas.currentPrice', 'Current Price')}</p>
              <p className="text-lg font-semibold text-[var(--text-primary)]">
                {gasPriceStatus?.current_price ? `$${fmtNumber(gasPriceStatus.current_price)}/gal` : '—'}
              </p>
            </div>
            <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--surface-2)] p-3.5">
              <p className="text-xs font-medium uppercase tracking-wider mb-1 text-[var(--text-muted)]">{t('gas.lastPolled', 'Last Polled')}</p>
              <p className="text-sm text-[var(--text-primary)]">
                {gasPriceStatus?.last_poll_time && gasPriceStatus.last_poll_time !== '0001-01-01T00:00:00Z'
                  ? formatDateTime(gasPriceStatus.last_poll_time)
                  : t('gas.never', 'Never')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Button variant="primary" icon={<Zap className="h-4 w-4" />} onClick={() => gasPollMut.mutate(undefined, { onSuccess: () => toast.info(t('gas.pollTriggered', 'Gas price poll triggered')) })} loading={gasPollMut.isPending}>
              {t('gas.pollNow', 'Poll Now')}
            </Button>
            <p className="text-[10px] text-[var(--text-muted)]">
              {t('gas.source', 'Source: U.S. Energy Information Administration')}
            </p>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ── Browser Notifications ── */}
      <FadeIn delay={0.13}>
        <GlassPanel className="p-6 space-y-5">
          <div className="flex items-center gap-3">
            <IconBox color="cyan">
              <Bell className="h-5 w-5" />
            </IconBox>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('browserNotifications.title', 'Browser Notifications')}</h2>
              <p className="text-xs text-[var(--text-muted)]">{t('browserNotifications.subtitle', 'Get notified when the app tab is in the background')}</p>
            </div>
          </div>

          {!notificationsSupported ? (
            <p className="text-xs text-white/40">
              {t('browserNotifications.unsupported', 'Browser notifications are not supported in this browser.')}
            </p>
          ) : (
            <div className="space-y-4">
              {/* Permission state */}
              <div className="flex items-center gap-3">
                {permission === 'default' && (
                  <Button
                    variant="primary"
                    icon={<Bell className="h-4 w-4" />}
                    onClick={requestPermission}
                  >
                    {t('browserNotifications.enable', 'Enable Browser Notifications')}
                  </Button>
                )}
                {permission === 'granted' && (
                  <Badge variant="success">
                    {t('browserNotifications.enabled', 'Enabled')}
                  </Badge>
                )}
                {permission === 'denied' && (
                  <span className="text-xs text-white/40">
                    {t('browserNotifications.blocked', 'Notifications are blocked. Enable in your browser settings.')}
                  </span>
                )}
              </div>

              {/* Per-event toggles — only show when permission is granted */}
              {permission === 'granted' && (
                <div className="space-y-3 pt-2 border-t border-white/[0.06]">
                  <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                    {t('browserNotifications.events', 'Notify me about')}
                  </p>
                  <Toggle
                    label={t('browserNotifications.alerts', 'Alerts')}
                    checked={pushPrefs.alerts}
                    onChange={(checked) => setPushPrefs((prev: WebPushPreferences) => ({ ...prev, alerts: checked }))}
                    size="sm"
                  />
                  <Toggle
                    label={t('browserNotifications.exportStatus', 'Export completions')}
                    checked={pushPrefs.exportStatus}
                    onChange={(checked) => setPushPrefs((prev: WebPushPreferences) => ({ ...prev, exportStatus: checked }))}
                    size="sm"
                  />
                  <p className="text-[10px] text-[var(--text-muted)]">
                    {t('browserNotifications.hint', 'Notifications only fire when the app tab is in the background.')}
                  </p>
                </div>
              )}
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Theme & Appearance ── */}
      <FadeIn delay={0.15}>
        <GlassPanel className="p-6 space-y-6">
          <div className="flex items-center gap-3">
            <IconBox color="purple">
              <Palette className="h-5 w-5" />
            </IconBox>
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('theme.title', 'Appearance')}</h2>
              <p className="text-xs text-[var(--text-muted)]">{t('theme.subtitle', 'Customize colors and display mode')}</p>
            </div>
          </div>

          {/* Mode Selector */}
          <div>
            <p className="text-xs font-medium uppercase tracking-wider mb-3 text-[var(--text-muted)]">{t('theme.displayMode', 'Display Mode')}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.values(allModes).map(m => (
                <Button
                  key={m.id}
                  variant="ghost"
                  onClick={() => { setMode(m.id as ModeId); toast.info(`${t('theme.mode', 'Mode')}: ${m.name}`) }}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border p-3.5 h-auto transition-all duration-200 justify-start',
                    modeId === m.id
                      ? 'border-[var(--theme-primary)] bg-[var(--surface-3)]'
                      : 'border-[var(--glass-border)] bg-[var(--surface-2)] hover:border-[var(--theme-primary)]/30'
                  )}
                  style={modeId === m.id ? { boxShadow: 'inset 0 0 12px rgba(var(--theme-primary-rgb), 0.15)' } : undefined}
                >
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-lg"
                    style={{
                      background: m.surface3,
                      border: `1px solid ${m.glassBorder}`,
                    }}
                  >
                    <span style={{ color: m.textPrimary }}>{modeIcons[m.id]}</span>
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-medium text-[var(--text-primary)]">{m.name}</p>
                    <div className="flex gap-1 mt-1">
                      {[m.bg, m.surface1, m.surface2, m.surface3].map((c, i) => (
                        <div key={i} className="h-2 w-4 rounded-sm border border-[var(--glass-border)]" style={{ background: c }} />
                      ))}
                    </div>
                  </div>
                  {modeId === m.id && (
                    <CheckCircle className="h-4 w-4 ml-auto text-[var(--theme-primary)]" />
                  )}
                </Button>
              ))}
            </div>
          </div>

          {/* Accent Color */}
          <div>
            <p className="text-xs font-medium uppercase tracking-wider mb-3 text-[var(--text-muted)]">{t('theme.accentColor', 'Accent Color')}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {Object.values(allThemes).filter(thm => thm.id !== 'custom').map(thm => (
                <Button
                  key={thm.id}
                  variant="ghost"
                  onClick={() => { setTheme(thm.id as ThemeId); toast.info(`${t('theme.theme', 'Theme')}: ${thm.name}`) }}
                  className={cn(
                    'group relative rounded-xl border p-4 text-left h-auto transition-all duration-200 justify-start items-start flex-col',
                    themeId === thm.id
                      ? 'bg-[var(--surface-3)]'
                      : 'bg-[var(--surface-2)] hover:bg-[var(--surface-3)]'
                  )}
                  style={{ borderColor: themeId === thm.id ? thm.primary : 'var(--glass-border)' }}
                >
                  <div
                    className="h-6 w-6 rounded-full mb-3"
                    style={{
                      background: `linear-gradient(135deg, ${thm.primary}, ${thm.accent})`,
                      boxShadow: themeId === thm.id ? `0 0 12px ${thm.primary}` : 'none',
                    }}
                  />
                  <p className="text-xs font-medium text-[var(--text-primary)]">{thm.name}</p>
                  {themeId === thm.id && (
                    <div className="absolute top-2.5 right-2.5">
                      <CheckCircle className="h-4 w-4" style={{ color: thm.primary }} />
                    </div>
                  )}
                </Button>
              ))}

              {/* Custom color picker card */}
              <Button
                variant="ghost"
                onClick={() => { setCustomColors(customPrimary, customAccent); toast.info(`${t('theme.theme', 'Theme')}: ${t('theme.custom', 'Custom')}`) }}
                className={cn(
                  'group relative rounded-xl border p-4 text-left h-auto transition-all duration-200 justify-start items-start flex-col',
                  themeId === 'custom'
                    ? 'bg-[var(--surface-3)]'
                    : 'bg-[var(--surface-2)] hover:bg-[var(--surface-3)]'
                )}
                style={{ borderColor: themeId === 'custom' ? customPrimary : 'var(--glass-border)' }}
              >
                <div
                  className="h-6 w-6 rounded-full mb-3"
                  style={{
                    background: `linear-gradient(135deg, ${customPrimary}, ${customAccent})`,
                    boxShadow: themeId === 'custom' ? `0 0 12px ${customPrimary}` : 'none',
                  }}
                />
                <p className="text-xs font-medium text-[var(--text-primary)]">{t('theme.custom', 'Custom')}</p>
                {themeId === 'custom' && (
                  <div className="absolute top-2.5 right-2.5">
                    <CheckCircle className="h-4 w-4" style={{ color: customPrimary }} />
                  </div>
                )}
              </Button>
            </div>

            {/* Custom color pickers — shown when custom theme is active */}
            {themeId === 'custom' && (
              <div className="flex flex-wrap gap-6 mt-4 p-4 rounded-xl bg-[var(--surface-2)] border border-[var(--glass-border)] animate-in fade-in">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-[var(--text-secondary)]">{t('theme.primary', 'Primary')}</span>
                  <Input
                    type="color"
                    value={customPrimary}
                    onChange={e => { setCustomPrimary(e.target.value); setCustomColors(e.target.value, customAccent) }}
                    className="h-8 w-10 rounded-lg border border-[var(--glass-border)] bg-transparent cursor-pointer p-0"
                  />
                  <span className="text-[10px] font-mono text-[var(--text-muted)]">{customPrimary}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-[var(--text-secondary)]">{t('theme.accent', 'Accent')}</span>
                  <Input
                    type="color"
                    value={customAccent}
                    onChange={e => { setCustomAccent(e.target.value); setCustomColors(customPrimary, e.target.value) }}
                    className="h-8 w-10 rounded-lg border border-[var(--glass-border)] bg-transparent cursor-pointer p-0"
                  />
                  <span className="text-[10px] font-mono text-[var(--text-muted)]">{customAccent}</span>
                </div>
              </div>
            )}
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ── Data Export — link ── */}
      <FadeIn delay={0.18}>
        <a href="/data-export" className="block">
          <GlassPanel className="p-5 flex items-center gap-4 hover:border-white/10 transition-colors cursor-pointer group">
            <IconBox color="green">
              <Download className="h-5 w-5" />
            </IconBox>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('export.title', 'Data Export')}</h2>
              <p className="text-xs text-[var(--text-muted)]">{t('export.subtitle', 'Export drives, charging, analytics, or full backup as CSV/JSON')}</p>
            </div>
            <ExternalLink className="h-4 w-4 text-[var(--text-muted)] group-hover:text-neon-cyan transition-colors shrink-0" />
          </GlassPanel>
        </a>
      </FadeIn>
    </PageContainer>
  )
}
