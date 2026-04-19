import { useState, useMemo, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Wrench, Globe, KeyRound, CheckCircle, AlertTriangle,
  Copy, ExternalLink, Server, Shield, Database, GitBranch,
  Radio, Settings, Cpu, Car, Key, Clock, FileCode, Link, Braces,
  Fingerprint, Hash, HardDrive, Palette, Timer, Network, BookOpen,
  Regex, Lock, Play, RefreshCw,
  Download, Upload, Trash2, Satellite, Eye, Zap, ListChecks, ArrowRight, ArrowLeft,
  MapPin, FileText, ChevronRight, AlertCircle,
} from 'lucide-react'
import { PageContainer } from '@/components/layout'
import { GlassPanel, Badge, Button, Input, Select, DataTable, Accordion, Textarea, type Column } from '@/components/ui'
import { Skeleton, AlertBanner } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { usePageTitle } from '@/hooks/usePageTitle'
import { request } from '@/api/client'
import { getErrorMessage } from '@/lib/errorMessage'
import type { Vehicle } from '@/api/types'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/dateFormat'
import { fmtNumber, fmtInt } from '@/lib/numberFormat'
import SignalConfigModal from '@/components/ui/SignalConfigModal'
import {
  useFleetTelemetryErrorVINs, useFleetTelemetryErrors,
  useRefreshFleetTelemetryErrorVINs, useRefreshFleetTelemetryErrors,
  type FleetTelemetryErrorVIN, type FleetTelemetryError,
} from '@/api/hooks/useTelemetry'

/* ─── constants ───────────────────────────────────────────────────────── */

const ICON_COLOR_MAP: Record<string, string> = {
  cyan: 'bg-neon-cyan/10 text-neon-cyan ring-1 ring-neon-cyan/20',
  green: 'bg-neon-green/10 text-neon-green ring-1 ring-neon-green/20',
  purple: 'bg-neon-purple/10 text-neon-purple ring-1 ring-neon-purple/20',
  amber: 'bg-neon-amber/10 text-neon-amber ring-1 ring-neon-amber/20',
  red: 'bg-neon-red/10 text-neon-red ring-1 ring-neon-red/20',
}

const VIN_MANUFACTURERS: Record<string, string> = {
  '5YJ': 'Tesla (USA)',
  LRW: 'Tesla (China)',
  '7SA': 'Tesla (EU/Berlin)',
  XP7: 'Tesla (USA)',
}
const VIN_MODELS: Record<string, string> = {
  S: 'Model S',
  '3': 'Model 3',
  X: 'Model X',
  Y: 'Model Y',
}
const VIN_DRIVE: Record<string, string> = {
  '1': 'Single Motor RWD',
  '2': 'Dual Motor AWD',
  '3': 'Performance AWD',
  '4': 'Single Motor RWD (LFP)',
  A: 'Dual Motor AWD',
  B: 'Dual Motor AWD',
  F: 'Performance AWD',
  P: 'Performance',
  E: 'Dual Motor',
  N: 'Dual Motor',
}
const VIN_YEAR: Record<string, string> = {
  H: '2017',
  J: '2018',
  K: '2019',
  L: '2020',
  M: '2021',
  N: '2022',
  P: '2023',
  R: '2024',
  S: '2025',
  T: '2026',
}
const VIN_PLANT: Record<string, string> = {
  F: 'Fremont, CA',
  A: 'Austin, TX',
  B: 'Berlin, Germany',
  C: 'Shanghai, China',
  G: 'Gigafactory',
  E: 'Palo Alto, CA',
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

const PERMS: Record<string, string> = {
  '7': 'rwx',
  '6': 'rw-',
  '5': 'r-x',
  '4': 'r--',
  '3': '-wx',
  '2': '-w-',
  '1': '--x',
  '0': '---',
}

const HTTP_CODES: { code: number; text: string; desc: string }[] = [
  { code: 200, text: 'OK', desc: 'Request succeeded' },
  { code: 201, text: 'Created', desc: 'Resource created' },
  { code: 204, text: 'No Content', desc: 'Success with no body' },
  { code: 301, text: 'Moved Permanently', desc: 'Resource moved' },
  { code: 302, text: 'Found', desc: 'Temporary redirect' },
  { code: 304, text: 'Not Modified', desc: 'Use cached version' },
  { code: 400, text: 'Bad Request', desc: 'Invalid request' },
  { code: 401, text: 'Unauthorized', desc: 'Auth required' },
  { code: 403, text: 'Forbidden', desc: 'Access denied' },
  { code: 404, text: 'Not Found', desc: 'Resource not found' },
  { code: 405, text: 'Method Not Allowed', desc: 'HTTP method not supported' },
  { code: 408, text: 'Request Timeout', desc: 'Client took too long' },
  { code: 409, text: 'Conflict', desc: 'Resource conflict' },
  { code: 422, text: 'Unprocessable Entity', desc: 'Validation failed' },
  { code: 429, text: 'Too Many Requests', desc: 'Rate limited' },
  { code: 500, text: 'Internal Server Error', desc: 'Server error' },
  { code: 502, text: 'Bad Gateway', desc: 'Upstream error' },
  { code: 503, text: 'Service Unavailable', desc: 'Server overloaded' },
  { code: 504, text: 'Gateway Timeout', desc: 'Upstream timeout' },
]

const TESLA_ENDPOINTS: { method: string; path: string; desc: string }[] = [
  { method: 'GET', path: '/api/1/vehicles', desc: 'List vehicles' },
  { method: 'GET', path: '/api/1/vehicles/{id}/vehicle_data', desc: 'Get vehicle data' },
  { method: 'POST', path: '/api/1/vehicles/{id}/command/wake_up', desc: 'Wake up vehicle' },
  { method: 'POST', path: '/api/1/vehicles/{id}/command/door_lock', desc: 'Lock doors' },
  { method: 'POST', path: '/api/1/vehicles/{id}/command/door_unlock', desc: 'Unlock doors' },
  { method: 'POST', path: '/api/1/vehicles/{id}/command/flash_lights', desc: 'Flash lights' },
  { method: 'POST', path: '/api/1/vehicles/{id}/command/honk_horn', desc: 'Honk horn' },
  { method: 'POST', path: '/api/1/vehicles/{id}/command/set_charge_limit', desc: 'Set charge limit' },
  { method: 'POST', path: '/api/1/vehicles/{id}/command/charge_start', desc: 'Start charging' },
  { method: 'POST', path: '/api/1/vehicles/{id}/command/charge_stop', desc: 'Stop charging' },
  { method: 'GET', path: '/api/1/vehicles/{id}/nearby_charging_sites', desc: 'Nearby chargers' },
]

const TELEMETRY_FIELDS = [
  { category: 'Location', fields: ['Location', 'GpsHeading', 'GpsState', 'DestinationLocation', 'DestinationName', 'MilesToArrival', 'MinutesToArrival', 'RouteLine', 'RouteLastUpdated', 'OriginLocation', 'LocatedAtHome', 'LocatedAtWork', 'LocatedAtFavorite'] },
  { category: 'Driving', fields: ['VehicleSpeed', 'Gear', 'CruiseSetSpeed', 'BrakePedal', 'BrakePedalPos', 'PedalPosition', 'DriveRail', 'LateralAcceleration', 'LongitudinalAcceleration', 'RouteTrafficMinutesDelay', 'LifetimeEnergyGainedRegen', 'LifetimeEnergyUsedDrive'] },
  { category: 'Charging', fields: ['BatteryLevel', 'Soc', 'ChargeState', 'DetailedChargeState', 'ChargeLimitSoc', 'ChargeAmps', 'ChargeCurrentRequest', 'ChargeCurrentRequestMax', 'ChargeEnableRequest', 'ChargerVoltage', 'ChargerPhases', 'ChargeRateMilePerHour', 'DCChargingPower', 'DCChargingEnergyIn', 'ACChargingPower', 'ACChargingEnergyIn', 'EnergyRemaining', 'EstBatteryRange', 'IdealBatteryRange', 'RatedRange', 'PackVoltage', 'PackCurrent', 'ChargePortDoorOpen', 'ChargePortLatch', 'ChargePortColdWeatherMode', 'ChargingCableType', 'FastChargerPresent', 'FastChargerType', 'TimeToFullCharge', 'EstimatedHoursToChargeTermination', 'ExpectedEnergyPercentAtTripArrival', 'SuperchargerSessionTripPlanner', 'ScheduledChargingMode', 'ScheduledChargingPending', 'ScheduledChargingStartTime', 'ScheduledDepartureTime', 'PreconditioningEnabled', 'BrickVoltageMax', 'BrickVoltageMin', 'NumBrickVoltageMax', 'NumBrickVoltageMin', 'ModuleTempMax', 'ModuleTempMin', 'NumModuleTempMax', 'NumModuleTempMin', 'BatteryHeaterOn', 'NotEnoughPowerToHeat', 'BMSState', 'BmsFullchargecomplete', 'DCDCEnable', 'IsolationResistance', 'LifetimeEnergyUsed'] },
  { category: 'Powershare', fields: ['PowershareStatus', 'PowershareType', 'PowershareStopReason', 'PowershareHoursLeft', 'PowershareInstantaneousPowerKW'] },
  { category: 'Climate', fields: ['InsideTemp', 'OutsideTemp', 'HvacFanSpeed', 'HvacFanStatus', 'HvacPower', 'HvacACEnabled', 'HvacAutoMode', 'HvacLeftTemperatureRequest', 'HvacRightTemperatureRequest', 'HvacSteeringWheelHeatAuto', 'HvacSteeringWheelHeatLevel', 'ClimateKeeperMode', 'DefrostMode', 'DefrostForPreconditioning', 'CabinOverheatProtectionMode', 'CabinOverheatProtectionTemperatureLimit', 'SeatHeaterLeft', 'SeatHeaterRight', 'SeatHeaterRearLeft', 'SeatHeaterRearCenter', 'SeatHeaterRearRight', 'SeatVentEnabled', 'ClimateSeatCoolingFrontLeft', 'ClimateSeatCoolingFrontRight', 'AutoSeatClimateLeft', 'AutoSeatClimateRight', 'RearDefrostEnabled', 'RearDisplayHvacEnabled', 'WiperHeatEnabled'] },
  { category: 'Vehicle State', fields: ['Locked', 'SentryMode', 'DoorState', 'FdWindow', 'FpWindow', 'RdWindow', 'RpWindow', 'Odometer', 'HomelinkNearby', 'HomelinkDeviceCount', 'GuestModeEnabled', 'GuestModeMobileAccessState', 'DriverSeatOccupied', 'CenterDisplay', 'CurrentLimitMph', 'SpeedLimitMode', 'ValetModeEnabled', 'ServiceMode', 'PairedPhoneKeyAndKeyFobQty', 'LightsHazardsActive', 'LightsHighBeams', 'LightsTurnSignal', 'TonneauPosition', 'TonneauOpenPercent', 'TonneauTentMode'] },
  { category: 'Safety', fields: ['DriverSeatBelt', 'PassengerSeatBelt', 'AutomaticEmergencyBrakingOff', 'AutomaticBlindSpotCamera', 'BlindSpotCollisionWarningChime', 'CruiseFollowDistance', 'EmergencyLaneDepartureAvoidance', 'ForwardCollisionWarning', 'LaneDepartureAvoidance', 'SpeedLimitWarning', 'PinToDriveEnabled', 'MilesSinceReset', 'SelfDrivingMilesSinceReset'] },
  { category: 'Powertrain', fields: ['DiTorquemotor', 'DiTorqueActualR', 'DiTorqueActualF', 'DiTorqueActualREL', 'DiTorqueActualRER', 'DiSlaveTorqueCmd', 'DiAxleSpeedF', 'DiAxleSpeedR', 'DiAxleSpeedREL', 'DiAxleSpeedRER', 'DiStateR', 'DiStateF', 'DiStateREL', 'DiStateRER', 'DiStatorTempR', 'DiStatorTempF', 'DiStatorTempREL', 'DiStatorTempRER', 'DiHeatsinkTR', 'DiHeatsinkTF', 'DiHeatsinkTREL', 'DiHeatsinkTRER', 'DiInverterTR', 'DiInverterTF', 'DiInverterTREL', 'DiInverterTRER', 'DiMotorCurrentR', 'DiMotorCurrentF', 'DiMotorCurrentREL', 'DiMotorCurrentRER', 'DiVBatR', 'DiVBatF', 'DiVBatREL', 'DiVBatRER', 'Hvil'] },
  { category: 'Tires & Service', fields: ['TpmsPressureFl', 'TpmsPressureFr', 'TpmsPressureRl', 'TpmsPressureRr', 'TpmsHardWarnings', 'TpmsSoftWarnings', 'TpmsLastSeenPressureTimeFl', 'TpmsLastSeenPressureTimeFr', 'TpmsLastSeenPressureTimeRl', 'TpmsLastSeenPressureTimeRr'] },
  { category: 'Media', fields: ['MediaNowPlayingTitle', 'MediaNowPlayingArtist', 'MediaNowPlayingAlbum', 'MediaNowPlayingStation', 'MediaNowPlayingDuration', 'MediaNowPlayingElapsed', 'MediaPlaybackStatus', 'MediaPlaybackSource', 'MediaAudioVolume', 'MediaAudioVolumeIncrement', 'MediaAudioVolumeMax'] },
  { category: 'User Preference', fields: ['Setting24HourTime', 'SettingChargeUnit', 'SettingDistanceUnit', 'SettingTemperatureUnit', 'SettingTirePressureUnit'] },
  { category: 'Vehicle Config', fields: ['CarType', 'Trim', 'ExteriorColor', 'RoofColor', 'WheelType', 'VehicleName', 'Version', 'RearSeatHeaters', 'SunroofInstalled', 'EfficiencyPackage', 'EuropeVehicle', 'RightHandDrive', 'RemoteStartEnabled', 'ChargePort', 'OffroadLightbarPresent', 'SoftwareUpdateVersion', 'SoftwareUpdateDownloadPercentComplete', 'SoftwareUpdateInstallationPercentComplete', 'SoftwareUpdateExpectedDurationMinutes', 'SoftwareUpdateScheduledStartTime'] },
]

const ONBOARDING_STEPS = [
  { id: 'account', label: 'devtools.onboarding.account', icon: KeyRound, desc: 'devtools.onboarding.accountDesc' },
  { id: 'application', label: 'devtools.onboarding.application', icon: FileCode, desc: 'devtools.onboarding.applicationDesc' },
  { id: 'keypair', label: 'devtools.onboarding.keypair', icon: Key, desc: 'devtools.onboarding.keypairDesc' },
  { id: 'register', label: 'devtools.onboarding.register', icon: Globe, desc: 'devtools.onboarding.registerDesc' },
  { id: 'auth', label: 'devtools.onboarding.auth', icon: Shield, desc: 'devtools.onboarding.authDesc' },
  { id: 'pair', label: 'devtools.onboarding.pair', icon: Link, desc: 'devtools.onboarding.pairDesc' },
  { id: 'telemetry', label: 'devtools.onboarding.telemetry', icon: Radio, desc: 'devtools.onboarding.telemetryDesc' },
] as const

/* ─── API helper ──────────────────────────────────────────────────────── */

async function apiFetch(
  endpoint: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: unknown,
): Promise<Record<string, unknown>> {
  try {
    return await request<Record<string, unknown>>(`/dev-tools/${endpoint}`, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Request failed' }
  }
}

/* ─── tiny helpers ────────────────────────────────────────────────────── */

function useVehicleOptions() {
  const { data } = useQuery<Vehicle[]>({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  })
  const vehicles = data ?? []
  const options = vehicles.map((v) => ({
    value: v.vin,
    label: v.display_name || v.vin,
  }))
  return { vehicles, options }
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const r1 = r / 255
  const g1 = g / 255
  const b1 = b / 255
  const max = Math.max(r1, g1, b1)
  const min = Math.min(r1, g1, b1)
  const l = (max + min) / 2
  if (max === min) return [0, 0, Math.round(l * 100)]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === r1) h = ((g1 - b1) / d + (g1 < b1 ? 6 : 0)) / 6
  else if (max === g1) h = ((b1 - r1) / d + 2) / 6
  else h = ((r1 - g1) / d + 4) / 6
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)]
}



function describeCron(parts: string[]): string {
  if (parts.length !== 5) return 'Invalid cron expression'
  const [min, hr, dom, mon, dow] = parts
  const pieces: string[] = []
  if (min === '*' && hr === '*') pieces.push('Every minute')
  else if (min !== '*' && hr === '*') pieces.push(`At minute ${min} of every hour`)
  else if (min !== '*' && hr !== '*') pieces.push(`At ${hr.padStart(2, '0')}:${min.padStart(2, '0')}`)
  else pieces.push(`Every minute of hour ${hr}`)
  if (dom !== '*') pieces.push(`on day ${dom}`)
  if (mon !== '*') pieces.push(`in month ${mon}`)
  if (dow !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const idx = parseInt(dow, 10)
    pieces.push(`on ${days[idx] ?? dow}`)
  }
  return pieces.join(' ')
}

function getNextCronRuns(parts: string[], count: number): Date[] {
  if (parts.length !== 5) return []
  const results: Date[] = []
  const now = new Date()
  const check = new Date(now)
  check.setSeconds(0, 0)
  check.setMinutes(check.getMinutes() + 1)
  const matchField = (field: string, value: number): boolean => {
    if (field === '*') return true
    if (field.includes('/')) {
      const [, step] = field.split('/')
      return value % parseInt(step ?? '1', 10) === 0
    }
    if (field.includes(',')) return field.split(',').map(Number).includes(value)
    if (field.includes('-')) {
      const [lo, hi] = field.split('-').map(Number)
      return value >= (lo ?? 0) && value <= (hi ?? 0)
    }
    return parseInt(field, 10) === value
  }
  let safety = 0
  while (results.length < count && safety < 525960) {
    safety++
    const [min, hr, dom, mon, dow] = parts
    if (
      matchField(min ?? '*', check.getMinutes()) &&
      matchField(hr ?? '*', check.getHours()) &&
      matchField(dom ?? '*', check.getDate()) &&
      matchField(mon ?? '*', check.getMonth() + 1) &&
      matchField(dow ?? '*', check.getDay())
    ) {
      results.push(new Date(check))
    }
    check.setMinutes(check.getMinutes() + 1)
  }
  return results
}

function getRelativeTime(date: Date): string {
  const now = Date.now()
  const diff = Math.abs(now - date.getTime())
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

/* ─── CopyButton ──────────────────────────────────────────────────────── */

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [text])

  return (
    <Button variant="ghost" size="sm" onClick={handleCopy} icon={copied ? <CheckCircle className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}>
      {copied ? t('Copied') : t('Copy')}
    </Button>
  )
}

/* ─── ResultPanel ─────────────────────────────────────────────────────── */

interface ResultPanelProps {
  title: string
  data?: unknown
  error?: string
  idle?: boolean
  idleMessage?: string
}

function ResultPanel({ title, data, error, idleMessage }: ResultPanelProps) {
  const hasData = data != null
  const stringifiedData = hasData ? JSON.stringify(data, null, 2) : ''

  return (
    <div className={cn(
      'mt-3 rounded-lg p-3',
      error ? 'bg-neon-red/5' : hasData ? 'bg-neon-green/5' : 'bg-white/[0.02]',
    )}>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-medium text-white/70">{title}</span>
        {hasData ? <CopyButton text={stringifiedData} /> : null}
      </div>
      {error ? (
        <p className="text-sm text-neon-red">{error}</p>
      ) : hasData ? (
        <pre className="max-h-64 overflow-auto rounded bg-black/30 p-2 text-xs text-white/80">
          {stringifiedData}
        </pre>
      ) : (
        <p className="text-sm italic text-white/30">{idleMessage ?? 'No result yet'}</p>
      )}
    </div>
  )
}

/* ─── ToolCard ────────────────────────────────────────────────────────── */

interface ToolCardProps {
  icon: React.ElementType
  color: string
  title: string
  description: string
  children: React.ReactNode
}

function ToolCard({ icon: Icon, color, title, description, children }: ToolCardProps) {
  return (
    <GlassPanel className="p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', ICON_COLOR_MAP[color] ?? ICON_COLOR_MAP.cyan)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <p className="text-xs text-white/50">{description}</p>
        </div>
      </div>
      {children}
    </GlassPanel>
  )
}

/* ─── BackendTool ─────────────────────────────────────────────────────── */

interface BackendToolProps {
  icon: React.ElementType
  color: string
  title: string
  description: string
  endpoint: string
  method?: 'GET' | 'POST' | 'DELETE'
  bodyBuilder?: () => unknown
  children?: React.ReactNode
}

function BackendTool({
  icon,
  color,
  title,
  description,
  endpoint,
  method = 'GET',
  bodyBuilder,
  children,
}: BackendToolProps) {
  const { t } = useTranslation()
  const mutation = useMutation({
    mutationFn: () => apiFetch(endpoint, method, bodyBuilder?.()),
  })

  return (
    <ToolCard icon={icon} color={color} title={title} description={description}>
      {children}
      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          loading={mutation.isPending}
          onClick={() => mutation.mutate()}
          icon={<Play className="h-3.5 w-3.5" />}
        >
          {t('Run')}
        </Button>
        {mutation.data && (
          <Badge variant={mutation.data.error ? 'danger' : 'success'} size="sm" dot>
            {mutation.data.error ? t('Failed') : t('Success')}
          </Badge>
        )}
      </div>
      {mutation.data && (
        <ResultPanel
          title={title}
          data={mutation.data.error ? undefined : mutation.data}
          error={typeof mutation.data.error === 'string' ? mutation.data.error : undefined}
        />
      )}
    </ToolCard>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 1 — Fleet API Tools
   ═══════════════════════════════════════════════════════════════════════ */

function FleetApiConfigTool() {
  const { t } = useTranslation()
  const { data, isLoading, error: configError } = useQuery({
    queryKey: ['devtools', 'fleet-api-info'],
    queryFn: () => apiFetch('fleet-api-info'),
  })

  if (isLoading) return <GlassPanel className="p-5"><Skeleton lines={4} /></GlassPanel>
  if (configError) return <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" />}>{t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(configError)}</AlertBanner>

  const info = data ?? {}
  const baseUrl = (info.baseUrl as string) ?? ''
  const clientId = (info.clientId as string) ?? ''
  const authStatus = info.authenticated === true
  const regions = (info.regions as string[]) ?? []

  return (
    <ToolCard icon={Settings} color="cyan" title={t('Config')} description={t('Config Desc')}>
      <div className="grid gap-3 sm:grid-cols-2">
        <GlassPanel className="p-3">
          <span className="text-xs text-white/50">{t('Base Url')}</span>
          <div className="mt-1 flex items-center gap-2">
            <span className="truncate text-sm font-mono text-white">{baseUrl || '—'}</span>
            {baseUrl && <CopyButton text={baseUrl} />}
          </div>
        </GlassPanel>
        <GlassPanel className="p-3">
          <span className="text-xs text-white/50">{t('Client Id')}</span>
          <div className="mt-1 flex items-center gap-2">
            <span className="truncate text-sm font-mono text-white">{clientId || '—'}</span>
            {clientId && <CopyButton text={clientId} />}
          </div>
        </GlassPanel>
        <GlassPanel className="p-3">
          <span className="text-xs text-white/50">{t('Auth Status')}</span>
          <div className="mt-1 flex items-center gap-2">
            {authStatus ? (
              <Badge variant="success" size="sm" dot>{t('Authenticated')}</Badge>
            ) : (
              <Badge variant="danger" size="sm" dot>{t('Not Authenticated')}</Badge>
            )}
          </div>
        </GlassPanel>
        <GlassPanel className="p-3">
          <span className="text-xs text-white/50">{t('Regions')}</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {regions.length > 0
              ? regions.map((r) => <Badge key={r} variant="info" size="sm">{r}</Badge>)
              : <span className="text-sm text-white/40">—</span>}
          </div>
        </GlassPanel>
      </div>
    </ToolCard>
  )
}

function PartnerRegistrationTool() {
  const { t } = useTranslation()
  const [domain, setDomain] = useState('')
  const mutation = useMutation({
    mutationFn: () => apiFetch('register-partner', 'POST', { domain }),
  })

  const opensslGen = 'openssl ecparam -name prime256v1 -genkey -noout -out private.pem'
  const opensslPub = 'openssl ec -in private.pem -pubout -out public.pem'

  return (
    <ToolCard icon={Globe} color="green" title={t('Partner Reg')} description={t('Partner Reg Desc')}>
      <div className="space-y-3">
        <GlassPanel className="border-neon-amber/20 bg-neon-amber/5 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-neon-amber" />
            <div className="text-xs text-neon-amber/80">
              <p className="font-semibold">{t('Prerequisites')}</p>
              <p className="mt-1">{t('Prerequisites Desc')}</p>
            </div>
          </div>
        </GlassPanel>

        <div className="space-y-2">
          <span className="text-xs font-medium text-white/70">{t('Openssl Commands')}</span>
          <div className="space-y-1">
            <div className="flex items-center gap-2 rounded bg-black/30 px-3 py-1.5">
              <code className="flex-1 text-xs text-neon-cyan">{opensslGen}</code>
              <CopyButton text={opensslGen} />
            </div>
            <div className="flex items-center gap-2 rounded bg-black/30 px-3 py-1.5">
              <code className="flex-1 text-xs text-neon-cyan">{opensslPub}</code>
              <CopyButton text={opensslPub} />
            </div>
          </div>
        </div>

        <Input
          label={t('Domain')}
          placeholder="yourapp.example.com"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          icon={<Globe className="h-4 w-4" />}
        />
        <Button
          variant="primary"
          size="sm"
          loading={mutation.isPending}
          onClick={() => mutation.mutate()}
          icon={<Play className="h-3.5 w-3.5" />}
        >
          {t('Register')}
        </Button>
        {mutation.data && (
          <ResultPanel
            title={t('Partner Reg')}
            data={mutation.data.error ? undefined : mutation.data}
            error={typeof mutation.data.error === 'string' ? mutation.data.error : undefined}
          />
        )}
      </div>
    </ToolCard>
  )
}

function PublicKeySetupTool() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [pemInput, setPemInput] = useState('')

  const { data: status, isLoading, error: keyError } = useQuery({
    queryKey: ['devtools', 'public-key-status'],
    queryFn: () => apiFetch('public-key-status'),
  })

  const generateMut = useMutation({
    mutationFn: () => apiFetch('generate-keypair', 'POST'),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['devtools', 'public-key-status'] }) },
  })

  const uploadMut = useMutation({
    mutationFn: () => apiFetch('upload-public-key', 'POST', { pem: pemInput }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['devtools', 'public-key-status'] }); setPemInput('') },
  })

  const deleteMut = useMutation({
    mutationFn: () => apiFetch('public-key', 'DELETE'),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['devtools', 'public-key-status'] }) },
  })

  if (isLoading) return <GlassPanel className="p-5"><Skeleton lines={3} /></GlassPanel>
  if (keyError) return <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" />}>{t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(keyError)}</AlertBanner>

  const configured = status?.configured === true
  const fingerprint = (status?.fingerprint as string) ?? ''
  const wellKnownUrl = (status?.wellKnownUrl as string) ?? ''

  return (
    <ToolCard icon={Key} color="purple" title={t('Public Key')} description={t('Public Key Desc')}>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/50">{t('Status')}:</span>
          {configured ? (
            <Badge variant="success" size="sm" dot>{t('Configured')}</Badge>
          ) : (
            <Badge variant="warning" size="sm" dot>{t('Not Configured')}</Badge>
          )}
        </div>

        {fingerprint && (
          <div className="flex items-center gap-2 rounded bg-black/30 px-3 py-1.5">
            <Fingerprint className="h-4 w-4 text-neon-purple" />
            <code className="text-xs text-white/80">{fingerprint}</code>
            <CopyButton text={fingerprint} />
          </div>
        )}

        {wellKnownUrl && (
          <div className="flex items-center gap-2 rounded bg-black/30 px-3 py-1.5">
            <Link className="h-4 w-4 text-neon-cyan" />
            <code className="flex-1 truncate text-xs text-white/80">{wellKnownUrl}</code>
            <CopyButton text={wellKnownUrl} />
          </div>
        )}

        <GlassPanel className="border-neon-amber/20 bg-neon-amber/5 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-neon-amber" />
            <span className="text-xs text-neon-amber/80">{t('Private Key Warning')}</span>
          </div>
        </GlassPanel>

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" loading={generateMut.isPending} onClick={() => generateMut.mutate()} icon={<Key className="h-3.5 w-3.5" />}>
            {t('Generate Keypair')}
          </Button>
          <Button variant="danger" size="sm" loading={deleteMut.isPending} onClick={() => deleteMut.mutate()} icon={<Trash2 className="h-3.5 w-3.5" />}>
            {t('Delete Keypair')}
          </Button>
        </div>

        <ResultPanel title={t('Generate Keypair')} data={generateMut.data?.error ? undefined : generateMut.data} error={typeof generateMut.data?.error === 'string' ? generateMut.data.error : undefined} idle={!generateMut.data} idleMessage={t('devtools.keypairIdle', 'Generate or delete a keypair to see results')} />
        <ResultPanel title={t('Delete Keypair')} data={deleteMut.data?.error ? undefined : deleteMut.data} error={typeof deleteMut.data?.error === 'string' ? deleteMut.data.error : undefined} idle={!deleteMut.data} />

        <div className="space-y-2">
          <span className="text-xs font-medium text-white/70">{t('Upload Pem')}</span>
          <Textarea
            rows={4}
            placeholder={t('Pem Placeholder')}
            value={pemInput}
            onChange={(e) => setPemInput(e.target.value)}
          />
          <Button variant="secondary" size="sm" loading={uploadMut.isPending} onClick={() => uploadMut.mutate()} icon={<Upload className="h-3.5 w-3.5" />}>
            {t('Upload Key')}
          </Button>
          <ResultPanel title={t('Upload Key')} data={uploadMut.data?.error ? undefined : uploadMut.data} error={typeof uploadMut.data?.error === 'string' ? uploadMut.data.error : undefined} idle={!uploadMut.data} idleMessage={t('devtools.uploadIdle', 'Upload a public key to see results')} />
        </div>
      </div>
    </ToolCard>
  )
}

function VehicleKeyPairingTool() {
  const { t } = useTranslation()
  const { data } = useQuery({
    queryKey: ['devtools', 'fleet-api-info'],
    queryFn: () => apiFetch('fleet-api-info'),
  })
  const hostname = (data?.hostname as string) ?? 'yourapp.example.com'
  const pairingUrl = `https://tesla.com/_ak/${hostname}`

  return (
    <ToolCard icon={Car} color="green" title={t('Key Pairing')} description={t('Key Pairing Desc')}>
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded bg-black/30 px-3 py-2">
          <Link className="h-4 w-4 text-neon-green" />
          <code className="flex-1 truncate text-sm text-neon-green">{pairingUrl}</code>
          <CopyButton text={pairingUrl} />
        </div>
        <div className="rounded-lg bg-neon-cyan/5 p-3">
          <p className="text-xs text-white/60">{t('Pairing Instructions')}</p>
          <ul className="mt-2 space-y-1 text-xs text-white/50">
            <li className="flex items-start gap-2">
              <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-neon-cyan" />
              <span>{t('devtools.fleet.pairingStep1', 'Pairing Step1')}</span>
            </li>
            <li className="flex items-start gap-2">
              <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-neon-cyan" />
              <span>{t('devtools.fleet.pairingStep2', 'Pairing Step2')}</span>
            </li>
            <li className="flex items-start gap-2">
              <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-neon-cyan" />
              <span>{t('devtools.fleet.pairingStep3', 'Pairing Step3')}</span>
            </li>
          </ul>
        </div>
      </div>
    </ToolCard>
  )
}

function FleetTelemetrySubscribeTool() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [vin, setVin] = useState('')
  const [hostname, setHostname] = useState('')
  const [port, setPort] = useState('443')
  const [interval, setInterval_] = useState(30)
  const [caCert, setCaCert] = useState('')
  const [signalModalOpen, setSignalModalOpen] = useState(false)
  const [selectedSignals, setSelectedSignals] = useState<{ name: string; interval: number }[]>([])

  const { options: vehicleOptions } = useVehicleOptions()

  const subscribeMut = useMutation({
    mutationFn: () =>
      apiFetch('fleet-telemetry-subscribe', 'POST', {
        vins: [vin],
        hostname,
        port: parseInt(port, 10),
        ca: caCert || undefined,
        fields: selectedSignals.length > 0 ? selectedSignals.map((s) => s.name) : undefined,
        interval_seconds: interval,
        field_intervals: selectedSignals.length > 0
          ? Object.fromEntries(selectedSignals.filter((s) => s.interval !== interval).map((s) => [s.name, s.interval]))
          : undefined,
      }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['devtools'] }) },
  })

  return (
    <ToolCard icon={Radio} color="cyan" title={t('Telemetry Sub')} description={t('Telemetry Sub Desc')}>
      <div className="space-y-3">
        <Select
          label={t('Vehicle')}
          placeholder={t('Select Vehicle')}
          options={vehicleOptions}
          value={vin}
          onChange={(e) => setVin(e.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={t('Hostname')}
            placeholder="telemetry.example.com"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            icon={<Server className="h-4 w-4" />}
          />
          <Input
            label={t('Port')}
            placeholder="443"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            icon={<Network className="h-4 w-4" />}
          />
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-white/70">{t('Ca Cert')}</span>
          <Textarea
            rows={3}
            placeholder={t('Ca Cert Placeholder')}
            value={caCert}
            onChange={(e) => setCaCert(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setSignalModalOpen(true)}
            icon={<Settings className="h-3.5 w-3.5" />}
          >
            {t('Configure Signals')} ({selectedSignals.length})
          </Button>
          <span className="text-xs text-white/40">
            {t('Interval Label')}: {interval}s
          </span>
        </div>
        <Button
          variant="primary"
          size="sm"
          loading={subscribeMut.isPending}
          onClick={() => subscribeMut.mutate()}
          icon={<Play className="h-3.5 w-3.5" />}
        >
          {t('Subscribe')}
        </Button>
        {subscribeMut.data && (
          <ResultPanel
            title={t('Telemetry Sub')}
            data={subscribeMut.data.error ? undefined : subscribeMut.data}
            error={typeof subscribeMut.data.error === 'string' ? subscribeMut.data.error : undefined}
          />
        )}
      </div>
      <SignalConfigModal
        open={signalModalOpen}
        onClose={() => setSignalModalOpen(false)}
        categories={TELEMETRY_FIELDS}
        initialSelected={selectedSignals.map((s) => s.name)}
        initialInterval={interval}
        onSubmit={(signals) => {
          setSelectedSignals(signals)
          if (signals.length > 0) setInterval_(signals[0]?.interval ?? 30)
          setSignalModalOpen(false)
        }}
      />
    </ToolCard>
  )
}

interface TelemetryError {
  id: string
  timestamp: string
  code: string
  message: string
}

function FleetTelemetryConfigTool() {
  const { t } = useTranslation()
  const [vin, setVin] = useState('')

  const { options: vehicleOptions } = useVehicleOptions()

  const configQuery = useMutation({ mutationFn: () => apiFetch(`fleet-telemetry-config?vin=${vin}`) })
  const errorsQuery = useMutation({ mutationFn: () => apiFetch(`fleet-telemetry-errors?vin=${vin}`) })
  const deleteMut = useMutation({ mutationFn: () => apiFetch(`fleet-telemetry-config?vin=${vin}`, 'DELETE') })

  const errorData = Array.isArray(errorsQuery.data?.errors) ? (errorsQuery.data.errors as TelemetryError[]) : []

  const errorColumns: Column<TelemetryError>[] = useMemo(() => [
    { key: 'timestamp', header: t('Timestamp'), render: (r) => <span className="text-xs">{formatDateTime(r.timestamp)}</span> },
    { key: 'code', header: t('Code'), render: (r) => <Badge variant="danger" size="sm">{r.code}</Badge> },
    { key: 'message', header: t('Message'), render: (r) => <span className="text-xs text-white/70">{r.message}</span> },
  ], [t])

  return (
    <ToolCard icon={Satellite} color="purple" title={t('Telemetry Config')} description={t('Telemetry Config Desc')}>
      <div className="space-y-3">
        <Select
          label={t('Vehicle')}
          placeholder={t('Select Vehicle')}
          options={vehicleOptions}
          value={vin}
          onChange={(e) => setVin(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" loading={configQuery.isPending} onClick={() => configQuery.mutate()} icon={<Eye className="h-3.5 w-3.5" />}>
            {t('Get Config')}
          </Button>
          <Button variant="secondary" size="sm" loading={errorsQuery.isPending} onClick={() => errorsQuery.mutate()} icon={<AlertTriangle className="h-3.5 w-3.5" />}>
            {t('View Errors')}
          </Button>
          <Button variant="danger" size="sm" loading={deleteMut.isPending} onClick={() => deleteMut.mutate()} icon={<Trash2 className="h-3.5 w-3.5" />}>
            {t('Delete Config')}
          </Button>
        </div>
        <ResultPanel title={t('Telemetry Config')} data={configQuery.data?.error ? undefined : configQuery.data} error={typeof configQuery.data?.error === 'string' ? configQuery.data.error : undefined} idle={!configQuery.data} idleMessage={t('devtools.configIdle', 'Fetch config to see results')} />
        <ResultPanel title={t('Delete Config')} data={deleteMut.data?.error ? undefined : deleteMut.data} error={typeof deleteMut.data?.error === 'string' ? deleteMut.data.error : undefined} idle={!deleteMut.data} />
        {errorData.length > 0 && (
          <div className="space-y-2">
            <DataTable columns={errorColumns} data={errorData} keyExtractor={(r) => r.id} compact pagination={{ defaultPageSize: 50 }} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const blob = new Blob([JSON.stringify(errorData, null, 2)], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `telemetry-errors-${vin}.json`
                a.click()
                URL.revokeObjectURL(url)
              }}
              icon={<Download className="h-3.5 w-3.5" />}
            >
              {t('Download Errors')}
            </Button>
          </div>
        )}
      </div>
    </ToolCard>
  )
}

function FleetStatusTool() {
  const { t } = useTranslation()
  const { vehicles } = useVehicleOptions()
  const fleetStatusMut = useMutation({
    mutationFn: () => apiFetch('fleet-status', 'POST', { vins: vehicles.map((v) => v.vin) }),
  })

  return (
    <ToolCard icon={Zap} color="green" title={t('Fleet Status')} description={t('Check fleet status for all vehicles')}>
      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          loading={fleetStatusMut.isPending}
          onClick={() => fleetStatusMut.mutate()}
          disabled={vehicles.length === 0}
          icon={<Play className="h-3.5 w-3.5" />}
        >
          {t('Check Fleet Status')}
        </Button>
      </div>
      {fleetStatusMut.data && (
        <ResultPanel
          title={t('Fleet Status')}
          data={fleetStatusMut.data.error ? undefined : fleetStatusMut.data}
          error={typeof fleetStatusMut.data.error === 'string' ? fleetStatusMut.data.error : undefined}
        />
      )}
    </ToolCard>
  )
}

function VehicleDataTools() {
  const { t } = useTranslation()
  const [vin, setVin] = useState('')
  const { options: vehicleOptions } = useVehicleOptions()

  const chargingMut = useMutation({ mutationFn: () => apiFetch(`nearby-charging?vin=${vin}`) })
  const releaseNotesMut = useMutation({ mutationFn: () => apiFetch(`release-notes?vin=${vin}`) })
  const alertsMut = useMutation({ mutationFn: () => apiFetch(`recent-alerts?vin=${vin}`) })
  const serviceMut = useMutation({ mutationFn: () => apiFetch(`service-data?vin=${vin}`) })

  const lastResult = chargingMut.data ?? releaseNotesMut.data ?? alertsMut.data ?? serviceMut.data

  return (
    <ToolCard icon={Car} color="cyan" title={t('Vehicle Data')} description={t('Vehicle Data Desc')}>
      <div className="space-y-3">
        <Select
          label={t('Vehicle')}
          placeholder={t('Select Vehicle')}
          options={vehicleOptions}
          value={vin}
          onChange={(e) => setVin(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" loading={chargingMut.isPending} onClick={() => chargingMut.mutate()} icon={<MapPin className="h-3.5 w-3.5" />}>
            {t('Nearby Charging')}
          </Button>
          <Button variant="secondary" size="sm" loading={releaseNotesMut.isPending} onClick={() => releaseNotesMut.mutate()} icon={<FileText className="h-3.5 w-3.5" />}>
            {t('Release Notes')}
          </Button>
          <Button variant="secondary" size="sm" loading={alertsMut.isPending} onClick={() => alertsMut.mutate()} icon={<AlertTriangle className="h-3.5 w-3.5" />}>
            {t('Recent Alerts')}
          </Button>
          <Button variant="secondary" size="sm" loading={serviceMut.isPending} onClick={() => serviceMut.mutate()} icon={<Wrench className="h-3.5 w-3.5" />}>
            {t('Service Data')}
          </Button>
        </div>
        {lastResult && (
          <ResultPanel
            title={t('Vehicle Data')}
            data={lastResult.error ? undefined : lastResult}
            error={typeof lastResult.error === 'string' ? lastResult.error : undefined}
          />
        )}
      </div>
    </ToolCard>
  )
}

/* ─── Fleet Telemetry Health Section ─────────────────────────────────── */

function FleetTelemetryHealthSection() {
  const { t } = useTranslation()
  const [selectedVin, setSelectedVin] = useState('')

  const { data: errorVINs, isLoading: vinsLoading } = useFleetTelemetryErrorVINs()
  const { data: errors, isLoading: errorsLoading } = useFleetTelemetryErrors(selectedVin || undefined)
  const refreshVINs = useRefreshFleetTelemetryErrorVINs()
  const refreshErrors = useRefreshFleetTelemetryErrors()

  const vinList = errorVINs ?? []
  const errorList = errors ?? []

  const isRecent = (dateStr: string | null) => {
    if (!dateStr) return false
    const diff = Date.now() - new Date(dateStr).getTime()
    return diff < 24 * 60 * 60 * 1000
  }

  const vinColumns: Column<FleetTelemetryErrorVIN>[] = useMemo(() => [
    {
      key: 'vin',
      header: t('devtools.health.vin', 'VIN'),
      render: (r) => (
        <button
          className="text-xs font-mono text-neon-cyan hover:underline"
          onClick={() => setSelectedVin(r.vin === selectedVin ? '' : r.vin)}
        >
          {r.vin}
        </button>
      ),
    },
    {
      key: 'first_seen_at',
      header: t('devtools.health.firstSeen', 'First Seen'),
      render: (r) => <span className="text-xs text-white/60">{formatDateTime(r.first_seen_at)}</span>,
    },
    {
      key: 'last_seen_at',
      header: t('devtools.health.lastSeen', 'Last Seen'),
      render: (r) => (
        <span className={cn('text-xs', isRecent(r.last_seen_at) ? 'text-neon-red' : 'text-neon-amber')}>
          {formatDateTime(r.last_seen_at)}
        </span>
      ),
    },
  ], [t, selectedVin])

  const errorColumns: Column<FleetTelemetryError>[] = useMemo(() => [
    {
      key: 'vin',
      header: t('devtools.health.vin', 'VIN'),
      render: (r) => <span className="text-xs font-mono text-white/80">{r.vin}</span>,
    },
    {
      key: 'error_code',
      header: t('devtools.health.errorCode', 'Error Code'),
      render: (r) => r.error_code ? <Badge variant="danger" size="sm">{r.error_code}</Badge> : <span className="text-xs text-white/40">—</span>,
    },
    {
      key: 'error_message',
      header: t('devtools.health.message', 'Message'),
      render: (r) => <span className="text-xs text-white/70">{r.error_message ?? '—'}</span>,
    },
    {
      key: 'reported_at',
      header: t('devtools.health.reportedAt', 'Reported At'),
      render: (r) => (
        <span className={cn('text-xs', r.reported_at && isRecent(r.reported_at) ? 'text-neon-red' : 'text-white/60')}>
          {r.reported_at ? formatDateTime(r.reported_at) : '—'}
        </span>
      ),
    },
  ], [t])

  return (
    <div className="space-y-4">
      {/* Error VINs Summary */}
      <ToolCard
        icon={AlertTriangle}
        color="red"
        title={t('devtools.health.errorVinsTitle', 'Error VINs')}
        description={t('devtools.health.errorVinsDesc', 'Vehicles with fleet telemetry configuration errors')}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Badge variant={vinList.length > 0 ? 'danger' : 'success'} size="sm">
              {vinList.length} {t('devtools.health.affectedVehicles', 'affected')}
            </Badge>
            {selectedVin && (
              <Badge variant="info" size="sm">
                {t('devtools.health.filteredBy', 'Filtered')}: {selectedVin}
                <button className="ml-1 text-white/60 hover:text-white" onClick={() => setSelectedVin('')}>×</button>
              </Badge>
            )}
            <Button
              variant="secondary"
              size="sm"
              loading={refreshVINs.isPending}
              onClick={() => refreshVINs.mutate()}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
            >
              {t('devtools.health.refreshVins', 'Refresh from Tesla')}
            </Button>
          </div>
          {vinsLoading ? (
            <Skeleton className="h-24" />
          ) : vinList.length > 0 ? (
            <DataTable columns={vinColumns} data={vinList} keyExtractor={(r) => r.vin} compact />
          ) : (
            <p className="py-4 text-center text-sm text-white/40">
              {t('devtools.health.noErrorVins', 'No vehicles with telemetry errors')}
            </p>
          )}
        </div>
      </ToolCard>

      {/* Error Log Table */}
      <ToolCard
        icon={AlertCircle}
        color="amber"
        title={t('devtools.health.errorLogTitle', 'Error Log')}
        description={t('devtools.health.errorLogDesc', 'Detailed fleet telemetry error history')}
      >
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              loading={refreshErrors.isPending}
              onClick={() => refreshErrors.mutate()}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
            >
              {t('devtools.health.refreshErrors', 'Refresh from Tesla')}
            </Button>
          </div>
          {errorsLoading ? (
            <Skeleton className="h-40" />
          ) : errorList.length > 0 ? (
            <DataTable columns={errorColumns} data={errorList} keyExtractor={(r) => String(r.id)} compact pagination />
          ) : (
            <p className="py-4 text-center text-sm text-white/40">
              {t('devtools.health.noErrors', 'No fleet telemetry errors recorded')}
            </p>
          )}
        </div>
      </ToolCard>
    </div>
  )
}

function FleetApiSection() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <FleetApiConfigTool />
      <PartnerRegistrationTool />
      <PublicKeySetupTool />
      <VehicleKeyPairingTool />
      <FleetTelemetrySubscribeTool />
      <FleetTelemetryConfigTool />
      <FleetStatusTool />
      <VehicleDataTools />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 0 — Onboarding Workflow
   ═══════════════════════════════════════════════════════════════════════ */

function OnboardingWorkflow() {
  const { t } = useTranslation()
  const [currentStep, setCurrentStep] = useState(0)
  const [completed, setCompleted] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('devtools-onboarding')
      return saved ? (JSON.parse(saved) as Record<string, boolean>) : {}
    } catch {
      return {}
    }
  })

  useEffect(() => {
    localStorage.setItem('devtools-onboarding', JSON.stringify(completed))
  }, [completed])

  const { data: keyStatus, error: keyStatusError } = useQuery({
    queryKey: ['devtools', 'public-key-status'],
    queryFn: () => apiFetch('public-key-status'),
    refetchInterval: 30000,
  })

  const { data: fleetInfo, error: fleetInfoError } = useQuery({
    queryKey: ['devtools', 'fleet-api-info'],
    queryFn: () => apiFetch('fleet-api-info'),
    refetchInterval: 30000,
  })

  useEffect(() => {
    const autoDetected: Record<string, boolean> = { ...completed }
    if (keyStatus?.configured === true) autoDetected.keypair = true
    if (fleetInfo?.authenticated === true) autoDetected.auth = true
    const changed = Object.keys(autoDetected).some((k) => autoDetected[k] !== completed[k])
    if (changed) setCompleted(autoDetected)
  }, [keyStatus, fleetInfo, completed])

  const completedCount = ONBOARDING_STEPS.filter((s) => completed[s.id]).length
  const progressPct = (completedCount / ONBOARDING_STEPS.length) * 100
  const step = ONBOARDING_STEPS[currentStep]
  if (!step) return null
  const StepIcon = step.icon

  const markComplete = () => {
    setCompleted((prev) => ({ ...prev, [step.id]: true }))
    if (currentStep < ONBOARDING_STEPS.length - 1) setCurrentStep(currentStep + 1)
  }

  const onboardingError = [keyStatusError, fleetInfoError].find(Boolean)

  return (
    <div className="space-y-4">
      {onboardingError && (
        <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(onboardingError)}
        </AlertBanner>
      )}

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-white/60">
          <span>{t('Progress')}</span>
          <span>{completedCount} / {ONBOARDING_STEPS.length} ({fmtInt(progressPct)}%)</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-glass-border">
          <div
            className="h-full rounded-full bg-gradient-to-r from-neon-cyan to-neon-green transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Step indicators */}
      <div className="flex flex-wrap gap-2">
        {ONBOARDING_STEPS.map((s, i) => (
          <Badge
            key={s.id}
            variant={completed[s.id] ? 'success' : i === currentStep ? 'info' : 'neutral'}
            size="sm"
            dot={i === currentStep}
            onClick={() => setCurrentStep(i)}
            className="cursor-pointer"
          >
            {t(s.label)}
          </Badge>
        ))}
      </div>

      {/* Step content */}
      <GlassPanel className="p-5">
        <div className="mb-4 flex items-start gap-3">
          <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', completed[step.id] ? ICON_COLOR_MAP.green : ICON_COLOR_MAP.cyan)}>
            {completed[step.id] ? <CheckCircle className="h-5 w-5" /> : <StepIcon className="h-5 w-5" />}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">
              {t('devtools.onboarding.stepLabel', { num: currentStep + 1 })}: {t(step.label)}
            </h3>
            <p className="text-xs text-white/50">{t(step.desc)}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={currentStep === 0}
            onClick={() => setCurrentStep(currentStep - 1)}
            icon={<ArrowLeft className="h-3.5 w-3.5" />}
          >
            {t('Previous')}
          </Button>
          <Button
            variant={completed[step.id] ? 'secondary' : 'primary'}
            size="sm"
            onClick={markComplete}
            icon={<CheckCircle className="h-3.5 w-3.5" />}
          >
            {completed[step.id] ? t('Completed') : t('Mark Complete')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={currentStep === ONBOARDING_STEPS.length - 1}
            onClick={() => setCurrentStep(currentStep + 1)}
            icon={<ArrowRight className="h-3.5 w-3.5" />}
          >
            {t('Next')}
          </Button>
        </div>
      </GlassPanel>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 2 — Infrastructure
   ═══════════════════════════════════════════════════════════════════════ */

function MqttTestTool() {
  const { t } = useTranslation()
  const [topic, setTopic] = useState('')
  const [message, setMessage] = useState('')

  const mutation = useMutation({
    mutationFn: () => apiFetch('mqtt-test', 'POST', { topic, message }),
  })

  return (
    <ToolCard icon={Radio} color="amber" title={t('Mqtt')} description={t('Mqtt Desc')}>
      <div className="space-y-3">
        <Input
          label={t('Topic')}
          placeholder="test/topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          icon={<Radio className="h-4 w-4" />}
        />
        <div>
          <span className="mb-1 block text-xs font-medium text-white/70">{t('Message')}</span>
          <Textarea
            rows={3}
            placeholder='{"key": "value"}'
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>
        <Button variant="primary" size="sm" loading={mutation.isPending} onClick={() => mutation.mutate()} icon={<Play className="h-3.5 w-3.5" />}>
          {t('Send Test')}
        </Button>
        {mutation.data && (
          <ResultPanel
            title={t('Mqtt')}
            data={mutation.data.error ? undefined : mutation.data}
            error={typeof mutation.data.error === 'string' ? mutation.data.error : undefined}
          />
        )}
      </div>
    </ToolCard>
  )
}

function InfrastructureSection() {
  const { t } = useTranslation()
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <BackendTool icon={Database} color="cyan" title={t('Db Stats')} description={t('Db Stats Desc')} endpoint="db-stats" />
      <BackendTool icon={GitBranch} color="green" title={t('Migrations')} description={t('Migrations Desc')} endpoint="migration-status" />
      <MqttTestTool />
      <BackendTool icon={Shield} color="purple" title={t('Env Check')} description={t('Env Check Desc')} endpoint="env-check" />
      <BackendTool icon={Cpu} color="amber" title={t('Runtime')} description={t('Runtime Desc')} endpoint="runtime-info" />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 3 — Client-Side Utilities
   ═══════════════════════════════════════════════════════════════════════ */

/* ── VIN Decoder ──────────────────────────────────────────────────────── */

function VinDecoderTool() {
  const { t } = useTranslation()
  const [vin, setVin] = useState('')
  const decoded = useMemo(() => {
    if (vin.length < 11) return null
    const upper = vin.toUpperCase()
    const mfr = VIN_MANUFACTURERS[upper.slice(0, 3)] ?? t('Unknown')
    const model = VIN_MODELS[upper[3] ?? ''] ?? t('Unknown')
    const drive = VIN_DRIVE[upper[7] ?? ''] ?? t('Unknown')
    const year = VIN_YEAR[upper[9] ?? ''] ?? t('Unknown')
    const plant = VIN_PLANT[upper[10] ?? ''] ?? t('Unknown')
    const serial = upper.slice(11)
    return { mfr, model, drive, year, plant, serial }
  }, [vin, t])

  return (
    <ToolCard icon={Car} color="cyan" title={t('Vin Decoder')} description={t('Vin Decoder Desc')}>
      <div className="space-y-3">
        <Input
          label={t('Vin')}
          placeholder="5YJ3E1EA1NF000001"
          value={vin}
          onChange={(e) => setVin(e.target.value)}
          icon={<Car className="h-4 w-4" />}
        />
        {decoded && (
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(decoded).map(([k, v]) => (
              <div key={k} className="rounded bg-black/20 px-3 py-2">
                <span className="text-xs text-white/50">{t(`devtools.utils.vin_${k}`)}</span>
                <p className="text-sm font-medium text-white">{v}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </ToolCard>
  )
}

/* ── JWT Decoder ──────────────────────────────────────────────────────── */

interface JwtDecoded {
  header: Record<string, unknown> | null
  payload: Record<string, unknown> | null
  error?: string
}

function JwtDecoderTool() {
  const { t } = useTranslation()
  const [jwt, setJwt] = useState('')
  const decoded = useMemo<JwtDecoded>(() => {
    if (!jwt.trim()) return { header: null, payload: null }
    try {
      const parts = jwt.split('.')
      if (parts.length < 2) return { header: null, payload: null, error: t('Invalid Jwt') }
      const header = JSON.parse(atob(parts[0] ?? '')) as Record<string, unknown>
      const payload = JSON.parse(atob(parts[1] ?? '')) as Record<string, unknown>
      return { header, payload }
    } catch {
      return { header: null, payload: null, error: t('Invalid Jwt') }
    }
  }, [jwt, t])

  return (
    <ToolCard icon={KeyRound} color="purple" title={t('Jwt Decoder')} description={t('Jwt Decoder Desc')}>
      <div className="space-y-3">
        <div>
          <span className="mb-1 block text-xs font-medium text-white/70">{t('Jwt Input')}</span>
          <Textarea
            rows={3}
            placeholder="eyJhbGciOiJSUzI1NiIs..."
            value={jwt}
            onChange={(e) => setJwt(e.target.value)}
          />
        </div>
        {decoded.error && <p className="text-sm text-neon-red">{decoded.error}</p>}
        {decoded.header && (
          <ResultPanel title={t('Jwt Header')} data={decoded.header} />
        )}
        {decoded.payload && (
          <ResultPanel title={t('Jwt Payload')} data={decoded.payload} />
        )}
      </div>
    </ToolCard>
  )
}

/* ── Timestamp Tool ───────────────────────────────────────────────────── */

function TimestampTool() {
  const { t } = useTranslation()
  const [unix, setUnix] = useState('')
  const [iso, setIso] = useState('')
  const [now, setNow] = useState<Date>(new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const fromUnix = useMemo(() => {
    if (!unix) return null
    const ms = unix.length > 10 ? parseInt(unix, 10) : parseInt(unix, 10) * 1000
    const d = new Date(ms)
    return isNaN(d.getTime()) ? null : d
  }, [unix])

  const fromIso = useMemo(() => {
    if (!iso) return null
    const d = new Date(iso)
    return isNaN(d.getTime()) ? null : d
  }, [iso])

  return (
    <ToolCard icon={Clock} color="green" title={t('Timestamp')} description={t('Timestamp Desc')}>
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded bg-black/20 px-3 py-2">
          <Clock className="h-4 w-4 text-neon-green" />
          <div className="text-sm">
            <span className="font-mono text-white">{Math.floor(now.getTime() / 1000)}</span>
            <span className="mx-2 text-white/30">|</span>
            <span className="font-mono text-white/70">{now.toISOString()}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => { setUnix(String(Math.floor(Date.now() / 1000))); setIso(new Date().toISOString()) }}>
            {t('Now')}
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Input
              label={t('Unix Timestamp')}
              placeholder="1700000000"
              value={unix}
              onChange={(e) => setUnix(e.target.value)}
              icon={<Hash className="h-4 w-4" />}
            />
            {fromUnix && (
              <div className="mt-1 space-y-0.5">
                <p className="text-xs text-white/60">{t('Iso')}: <span className="font-mono text-neon-cyan">{fromUnix.toISOString()}</span></p>
                <p className="text-xs text-white/60">{t('Local')}: <span className="font-mono text-neon-cyan">{formatDateTime(fromUnix)}</span></p>
                <p className="text-xs text-white/60">{t('Relative')}: <span className="font-mono text-neon-cyan">{getRelativeTime(fromUnix)}</span></p>
              </div>
            )}
          </div>
          <div>
            <Input
              label={t('Iso Timestamp')}
              placeholder="2024-01-01T00:00:00Z"
              value={iso}
              onChange={(e) => setIso(e.target.value)}
              icon={<Clock className="h-4 w-4" />}
            />
            {fromIso && (
              <div className="mt-1 space-y-0.5">
                <p className="text-xs text-white/60">{t('Unix')}: <span className="font-mono text-neon-cyan">{Math.floor(fromIso.getTime() / 1000)}</span></p>
                <p className="text-xs text-white/60">{t('Local')}: <span className="font-mono text-neon-cyan">{formatDateTime(fromIso)}</span></p>
                <p className="text-xs text-white/60">{t('Relative')}: <span className="font-mono text-neon-cyan">{getRelativeTime(fromIso)}</span></p>
              </div>
            )}
          </div>
        </div>
      </div>
    </ToolCard>
  )
}

/* ── Base64 Tool ──────────────────────────────────────────────────────── */

function Base64Tool() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'encode' | 'decode'>('encode')
  const [inputVal, setInputVal] = useState('')
  const output = useMemo(() => {
    if (!inputVal) return ''
    try {
      return mode === 'encode' ? btoa(inputVal) : atob(inputVal)
    } catch {
      return t('Invalid Input')
    }
  }, [inputVal, mode, t])

  return (
    <ToolCard icon={Braces} color="amber" title={t('devtools.utils.base64', 'Base64')} description={t('devtools.utils.base64Desc', 'Base64Desc')}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <Button variant={mode === 'encode' ? 'primary' : 'ghost'} size="sm" onClick={() => setMode('encode')}>{t('Encode')}</Button>
          <Button variant={mode === 'decode' ? 'primary' : 'ghost'} size="sm" onClick={() => setMode('decode')}>{t('Decode')}</Button>
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-white/70">{t('Input Label')}</span>
          <Textarea rows={3} value={inputVal} onChange={(e) => setInputVal(e.target.value)} placeholder={mode === 'encode' ? 'Hello World' : 'SGVsbG8gV29ybGQ='} />
        </div>
        {output && (
          <div className="rounded bg-black/20 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/50">{t('Output Label')}</span>
              <CopyButton text={output} />
            </div>
            <pre className="mt-1 whitespace-pre-wrap break-all text-sm font-mono text-neon-cyan">{output}</pre>
          </div>
        )}
      </div>
    </ToolCard>
  )
}

/* ── URL Encoder ──────────────────────────────────────────────────────── */

function UrlEncoderTool() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'encode' | 'decode'>('encode')
  const [inputVal, setInputVal] = useState('')
  const output = useMemo(() => {
    if (!inputVal) return ''
    try {
      return mode === 'encode' ? encodeURIComponent(inputVal) : decodeURIComponent(inputVal)
    } catch {
      return t('Invalid Input')
    }
  }, [inputVal, mode, t])

  return (
    <ToolCard icon={Link} color="cyan" title={t('Url Encoder')} description={t('Url Encoder Desc')}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <Button variant={mode === 'encode' ? 'primary' : 'ghost'} size="sm" onClick={() => setMode('encode')}>{t('Encode')}</Button>
          <Button variant={mode === 'decode' ? 'primary' : 'ghost'} size="sm" onClick={() => setMode('decode')}>{t('Decode')}</Button>
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-white/70">{t('Input Label')}</span>
          <Textarea rows={2} value={inputVal} onChange={(e) => setInputVal(e.target.value)} placeholder={mode === 'encode' ? 'hello world&foo=bar' : 'hello%20world%26foo%3Dbar'} />
        </div>
        {output && (
          <div className="rounded bg-black/20 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/50">{t('Output Label')}</span>
              <CopyButton text={output} />
            </div>
            <pre className="mt-1 whitespace-pre-wrap break-all text-sm font-mono text-neon-cyan">{output}</pre>
          </div>
        )}
      </div>
    </ToolCard>
  )
}

/* ── JSON Formatter ───────────────────────────────────────────────────── */

function JsonFormatterTool() {
  const { t } = useTranslation()
  const [inputVal, setInputVal] = useState('')
  const result = useMemo(() => {
    if (!inputVal.trim()) return { formatted: '', error: '' }
    try {
      const parsed = JSON.parse(inputVal) as unknown
      return { formatted: JSON.stringify(parsed, null, 2), error: '' }
    } catch (e) {
      return { formatted: '', error: e instanceof Error ? e.message : t('Invalid Json') }
    }
  }, [inputVal, t])

  return (
    <ToolCard icon={Braces} color="green" title={t('Json Formatter')} description={t('Json Formatter Desc')}>
      <div className="space-y-3">
        <div>
          <span className="mb-1 block text-xs font-medium text-white/70">{t('Json Input')}</span>
          <Textarea rows={4} value={inputVal} onChange={(e) => setInputVal(e.target.value)} placeholder='{"key":"value"}' />
        </div>
        {result.error && <p className="text-sm text-neon-red">{result.error}</p>}
        {result.formatted && (
          <div className="rounded bg-black/20 p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/50">{t('Formatted')}</span>
              <CopyButton text={result.formatted} />
            </div>
            <pre className="mt-1 max-h-64 overflow-auto text-xs font-mono text-neon-green">{result.formatted}</pre>
          </div>
        )}
      </div>
    </ToolCard>
  )
}

/* ── UUID Generator ───────────────────────────────────────────────────── */

function UuidGeneratorTool() {
  const { t } = useTranslation()
  const [uuids, setUuids] = useState<string[]>([])

  const generate = useCallback(() => {
    const uuid = crypto.randomUUID()
    setUuids((prev) => [uuid, ...prev].slice(0, 10))
  }, [])

  return (
    <ToolCard icon={Fingerprint} color="purple" title={t('Uuid Generator')} description={t('Uuid Generator Desc')}>
      <div className="space-y-3">
        <Button variant="primary" size="sm" onClick={generate} icon={<RefreshCw className="h-3.5 w-3.5" />}>
          {t('Generate')}
        </Button>
        {uuids.length > 0 && (
          <div className="space-y-1">
            {uuids.map((u, i) => (
              <div key={`${u}-${i}`} className="flex items-center gap-2 rounded bg-black/20 px-3 py-1.5">
                <code className="flex-1 text-xs font-mono text-neon-purple">{u}</code>
                <CopyButton text={u} />
              </div>
            ))}
          </div>
        )}
      </div>
    </ToolCard>
  )
}

/* ── Hash Calculator ──────────────────────────────────────────────────── */

function HashCalculatorTool() {
  const { t } = useTranslation()
  const [inputVal, setInputVal] = useState('')
  const [hashResult, setHashResult] = useState('')
  const [computing, setComputing] = useState(false)

  const compute = useCallback(async () => {
    if (!inputVal) return
    setComputing(true)
    try {
      const encoder = new TextEncoder()
      const data = encoder.encode(inputVal)
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      const hex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
      setHashResult(hex)
    } catch {
      setHashResult(t('Hash Error'))
    }
    setComputing(false)
  }, [inputVal, t])

  return (
    <ToolCard icon={Hash} color="red" title={t('Hash Calculator')} description={t('Hash Calculator Desc')}>
      <div className="space-y-3">
        <div>
          <span className="mb-1 block text-xs font-medium text-white/70">{t('Hash Input')}</span>
          <Textarea rows={2} value={inputVal} onChange={(e) => setInputVal(e.target.value)} placeholder={t('Hash Placeholder')} />
        </div>
        <Button variant="primary" size="sm" loading={computing} onClick={() => void compute()} icon={<Hash className="h-3.5 w-3.5" />}>
          {t('devtools.utils.computeSha256', 'Compute Sha256')}
        </Button>
        {hashResult && (
          <div className="flex items-center gap-2 rounded bg-black/20 px-3 py-2">
            <code className="flex-1 break-all text-xs font-mono text-neon-red">{hashResult}</code>
            <CopyButton text={hashResult} />
          </div>
        )}
      </div>
    </ToolCard>
  )
}

/* ── Byte Size Converter ──────────────────────────────────────────────── */

function ByteSizeTool() {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [unit, setUnit] = useState('B')

  const conversions = useMemo(() => {
    const num = parseFloat(value)
    if (isNaN(num)) return null
    const unitIdx = BYTE_UNITS.indexOf(unit as typeof BYTE_UNITS[number])
    if (unitIdx < 0) return null
    const bytes = num * Math.pow(1024, unitIdx)
    return BYTE_UNITS.map((u, i) => ({
      unit: u,
      value: fmtNumber(bytes / Math.pow(1024, i), i === 0 ? 0 : 4),
    }))
  }, [value, unit])

  const unitOptions = BYTE_UNITS.map((u) => ({ value: u, label: u }))

  return (
    <ToolCard icon={HardDrive} color="cyan" title={t('Byte Size')} description={t('Byte Size Desc')}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('Value')} placeholder="1024" value={value} onChange={(e) => setValue(e.target.value)} icon={<HardDrive className="h-4 w-4" />} />
          <Select label={t('Unit')} options={unitOptions} value={unit} onChange={(e) => setUnit(e.target.value)} />
        </div>
        {conversions && (
          <div className="grid grid-cols-5 gap-2">
            {conversions.map((c) => (
              <div key={c.unit} className={cn('rounded px-2 py-1.5 text-center', c.unit === unit ? 'bg-neon-cyan/10 ring-1 ring-neon-cyan/30' : 'bg-black/20')}>
                <p className="text-xs text-white/50">{c.unit}</p>
                <p className="text-sm font-mono text-white">{c.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </ToolCard>
  )
}

/* ── Color Converter ──────────────────────────────────────────────────── */

function ColorConverterTool() {
  const { t } = useTranslation()
  const [hex, setHex] = useState('#3b82f6')

  const parsed = useMemo(() => {
    const clean = hex.replace('#', '')
    if (clean.length !== 6) return null
    const r = parseInt(clean.slice(0, 2), 16)
    const g = parseInt(clean.slice(2, 4), 16)
    const b = parseInt(clean.slice(4, 6), 16)
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null
    const [h, s, l] = rgbToHsl(r, g, b)
    return { r, g, b, h, s, l }
  }, [hex])

  return (
    <ToolCard icon={Palette} color="purple" title={t('Color Converter')} description={t('Color Converter Desc')}>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Input label={t('Hex Color')} placeholder="#3b82f6" value={hex} onChange={(e) => setHex(e.target.value)} icon={<Palette className="h-4 w-4" />} />
          <div className="mt-5 h-10 w-10 shrink-0 rounded-lg ring-1 ring-glass-border" style={{ backgroundColor: hex }} />
        </div>
        {parsed && (
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded bg-black/20 px-3 py-2">
              <span className="text-xs text-white/50">RGB</span>
              <p className="font-mono text-sm text-white">rgb({parsed.r}, {parsed.g}, {parsed.b})</p>
              <CopyButton text={`rgb(${parsed.r}, ${parsed.g}, ${parsed.b})`} />
            </div>
            <div className="rounded bg-black/20 px-3 py-2">
              <span className="text-xs text-white/50">HSL</span>
              <p className="font-mono text-sm text-white">hsl({parsed.h}, {parsed.s}%, {parsed.l}%)</p>
              <CopyButton text={`hsl(${parsed.h}, ${parsed.s}%, ${parsed.l}%)`} />
            </div>
            <div className="rounded bg-black/20 px-3 py-2">
              <span className="text-xs text-white/50">HEX</span>
              <p className="font-mono text-sm text-white">{hex}</p>
              <CopyButton text={hex} />
            </div>
          </div>
        )}
      </div>
    </ToolCard>
  )
}

/* ── Cron Parser ──────────────────────────────────────────────────────── */

function CronParserTool() {
  const { t } = useTranslation()
  const [expr, setExpr] = useState('')

  const parts = useMemo(() => expr.trim().split(/\s+/), [expr])
  const description = useMemo(() => (parts.length === 5 ? describeCron(parts) : ''), [parts])
  const nextRuns = useMemo(() => (parts.length === 5 ? getNextCronRuns(parts, 5) : []), [parts])

  const presets = [
    { label: t('Every Minute'), value: '* * * * *' },
    { label: t('Every Hour'), value: '0 * * * *' },
    { label: t('Every Day'), value: '0 0 * * *' },
    { label: t('Every Week'), value: '0 0 * * 0' },
    { label: t('Every Month'), value: '0 0 1 * *' },
  ]

  return (
    <ToolCard icon={Timer} color="green" title={t('Cron Parser')} description={t('Cron Parser Desc')}>
      <div className="space-y-3">
        <Input
          label={t('Cron Expression')}
          placeholder="*/5 * * * *"
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          icon={<Timer className="h-4 w-4" />}
        />
        <div className="flex flex-wrap gap-1">
          {presets.map((p) => (
            <Button key={p.value} variant="ghost" size="sm" onClick={() => setExpr(p.value)}>
              {p.label}
            </Button>
          ))}
        </div>
        {description && (
          <div className="rounded bg-black/20 px-3 py-2">
            <span className="text-xs text-white/50">{t('Description')}</span>
            <p className="text-sm text-neon-green">{description}</p>
          </div>
        )}
        {nextRuns.length > 0 && (
          <div className="space-y-1">
            <span className="text-xs text-white/50">{t('Next Runs')}</span>
            {nextRuns.map((d, i) => (
              <div key={i} className="flex items-center gap-2 rounded bg-black/20 px-3 py-1">
                <Badge variant="info" size="sm">{i + 1}</Badge>
                <span className="text-xs font-mono text-white/70">{formatDateTime(d)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </ToolCard>
  )
}

/* ── HTTP Status Tool ─────────────────────────────────────────────────── */

function HttpStatusTool() {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return HTTP_CODES
    const q = search.toLowerCase()
    return HTTP_CODES.filter(
      (c) =>
        String(c.code).includes(q) ||
        c.text.toLowerCase().includes(q) ||
        c.desc.toLowerCase().includes(q),
    )
  }, [search])

  const columns: Column<{ code: number; text: string; desc: string }>[] = useMemo(
    () => [
      {
        key: 'code',
        header: t('Status Code'),
        sortable: true,
        render: (r) => (
          <Badge
            variant={r.code < 300 ? 'success' : r.code < 400 ? 'info' : r.code < 500 ? 'warning' : 'danger'}
            size="sm"
          >
            {r.code}
          </Badge>
        ),
      },
      { key: 'text', header: t('Status Text'), render: (r) => <span className="text-sm font-medium text-white">{r.text}</span> },
      { key: 'desc', header: t('Status Desc'), render: (r) => <span className="text-xs text-white/60">{r.desc}</span> },
    ],
    [t],
  )

  return (
    <ToolCard icon={Network} color="amber" title={t('Http Status')} description={t('Http Status Desc')}>
      <div className="space-y-3">
        <Input
          placeholder={t('Search Codes')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          icon={<Network className="h-4 w-4" />}
        />
        <DataTable columns={columns} data={filtered} keyExtractor={(r) => r.code} compact pagination />
      </div>
    </ToolCard>
  )
}

/* ── Tesla API Reference ──────────────────────────────────────────────── */

function TeslaApiRefTool() {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return TESLA_ENDPOINTS
    const q = search.toLowerCase()
    return TESLA_ENDPOINTS.filter(
      (e) =>
        e.method.toLowerCase().includes(q) ||
        e.path.toLowerCase().includes(q) ||
        e.desc.toLowerCase().includes(q),
    )
  }, [search])

  const columns: Column<{ method: string; path: string; desc: string }>[] = useMemo(
    () => [
      {
        key: 'method',
        header: t('Method'),
        render: (r) => (
          <Badge variant={r.method === 'GET' ? 'info' : 'warning'} size="sm">
            {r.method}
          </Badge>
        ),
      },
      {
        key: 'path',
        header: t('Path'),
        render: (r) => (
          <div className="flex items-center gap-1">
            <code className="text-xs font-mono text-neon-cyan">{r.path}</code>
            <CopyButton text={r.path} />
          </div>
        ),
      },
      { key: 'desc', header: t('Endpoint Desc'), render: (r) => <span className="text-xs text-white/60">{r.desc}</span> },
    ],
    [t],
  )

  return (
    <ToolCard icon={BookOpen} color="cyan" title={t('Tesla Api Ref')} description={t('Tesla Api Ref Desc')}>
      <div className="space-y-3">
        <Input
          placeholder={t('Search Endpoints')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          icon={<BookOpen className="h-4 w-4" />}
        />
        <DataTable columns={columns} data={filtered} keyExtractor={(r) => r.path} compact pagination />
      </div>
    </ToolCard>
  )
}

/* ── Regex Tester ─────────────────────────────────────────────────────── */

function RegexTesterTool() {
  const { t } = useTranslation()
  const [pattern, setPattern] = useState('')
  const [flags, setFlags] = useState('g')
  const [testStr, setTestStr] = useState('')

  const matches = useMemo(() => {
    if (!pattern || !testStr) return []
    try {
      const re = new RegExp(pattern, flags)
      const results: { match: string; index: number }[] = []
      let m: RegExpExecArray | null
      if (flags.includes('g')) {
        while ((m = re.exec(testStr)) !== null) {
          results.push({ match: m[0], index: m.index })
          if (!m[0]) break
        }
      } else {
        m = re.exec(testStr)
        if (m) results.push({ match: m[0], index: m.index })
      }
      return results
    } catch {
      return []
    }
  }, [pattern, flags, testStr])

  const flagOptions = [
    { value: 'g', label: 'g (global)' },
    { value: 'gi', label: 'gi (global, case-insensitive)' },
    { value: 'gm', label: 'gm (global, multiline)' },
    { value: 'gim', label: 'gim (all)' },
    { value: '', label: t('No Flags') },
  ]

  return (
    <ToolCard icon={Regex} color="red" title={t('Regex Tester')} description={t('Regex Tester Desc')}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('Pattern')} placeholder="\\d+" value={pattern} onChange={(e) => setPattern(e.target.value)} icon={<Regex className="h-4 w-4" />} />
          <Select label={t('Flags')} options={flagOptions} value={flags} onChange={(e) => setFlags(e.target.value)} />
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-white/70">{t('Test String')}</span>
          <Textarea rows={3} value={testStr} onChange={(e) => setTestStr(e.target.value)} placeholder={t('Test String Placeholder')} />
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={matches.length > 0 ? 'success' : 'neutral'} size="sm">
            {matches.length} {t('Matches')}
          </Badge>
        </div>
        {matches.length > 0 && (
          <div className="space-y-1">
            {matches.map((m, i) => (
              <div key={i} className="flex items-center gap-2 rounded bg-black/20 px-3 py-1">
                <Badge variant="info" size="sm">{i + 1}</Badge>
                <code className="text-xs font-mono text-neon-red">{m.match}</code>
                <span className="text-xs text-white/40">{t('At Index')} {m.index}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </ToolCard>
  )
}

/* ── Unix Permission Converter ────────────────────────────────────────── */

function UnixPermTool() {
  const { t } = useTranslation()
  const [octal, setOctal] = useState('755')

  const symbolic = useMemo(() => {
    if (octal.length !== 3 || !/^[0-7]{3}$/.test(octal)) return null
    return (PERMS[octal[0] ?? '0'] ?? '---') + (PERMS[octal[1] ?? '0'] ?? '---') + (PERMS[octal[2] ?? '0'] ?? '---')
  }, [octal])

  const presetOptions = [
    { value: '755', label: '755 (rwxr-xr-x)' },
    { value: '644', label: '644 (rw-r--r--)' },
    { value: '700', label: '700 (rwx------)' },
    { value: '600', label: '600 (rw-------)' },
    { value: '777', label: '777 (rwxrwxrwx)' },
    { value: '444', label: '444 (r--r--r--)' },
  ]

  return (
    <ToolCard icon={Lock} color="green" title={t('Unix Perm')} description={t('Unix Perm Desc')}>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={t('Octal Perm')} placeholder="755" value={octal} onChange={(e) => setOctal(e.target.value)} icon={<Lock className="h-4 w-4" />} />
          <Select label={t('Presets')} options={presetOptions} value={octal} onChange={(e) => setOctal(e.target.value)} />
        </div>
        {symbolic && (
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded bg-black/20 px-3 py-2 text-center">
              <span className="text-xs text-white/50">{t('Owner')}</span>
              <p className="font-mono text-sm text-neon-green">{symbolic.slice(0, 3)}</p>
            </div>
            <div className="rounded bg-black/20 px-3 py-2 text-center">
              <span className="text-xs text-white/50">{t('Group')}</span>
              <p className="font-mono text-sm text-neon-cyan">{symbolic.slice(3, 6)}</p>
            </div>
            <div className="rounded bg-black/20 px-3 py-2 text-center">
              <span className="text-xs text-white/50">{t('Other')}</span>
              <p className="font-mono text-sm text-neon-amber">{symbolic.slice(6)}</p>
            </div>
          </div>
        )}
        {symbolic && (
          <div className="flex items-center gap-2 rounded bg-black/20 px-3 py-2">
            <code className="text-sm font-mono text-white">{symbolic}</code>
            <CopyButton text={symbolic} />
          </div>
        )}
      </div>
    </ToolCard>
  )
}

/* ── Client Utilities Section ─────────────────────────────────────────── */

function ClientUtilitiesSection() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <VinDecoderTool />
      <JwtDecoderTool />
      <TimestampTool />
      <Base64Tool />
      <UrlEncoderTool />
      <JsonFormatterTool />
      <UuidGeneratorTool />
      <HashCalculatorTool />
      <ByteSizeTool />
      <ColorConverterTool />
      <CronParserTool />
      <HttpStatusTool />
      <TeslaApiRefTool />
      <RegexTesterTool />
      <UnixPermTool />
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   SECTION 4 — Reference Links
   ═══════════════════════════════════════════════════════════════════════ */

const REFERENCE_LINKS = [
  { title: 'devtools.ref.fleetOverview', url: 'https://developer.tesla.com/docs/fleet-api', icon: BookOpen },
  { title: 'devtools.ref.partnerEndpoints', url: 'https://developer.tesla.com/docs/fleet-api/endpoints/partner-endpoints#register', icon: Globe },
  { title: 'devtools.ref.devPortal', url: 'https://developer.tesla.com', icon: ExternalLink },
  { title: 'devtools.ref.telemetryGuide', url: 'https://developer.tesla.com/docs/fleet-api/fleet-telemetry', icon: Radio },
]

function ReferenceLinksSection() {
  const { t } = useTranslation()
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {REFERENCE_LINKS.map((link) => {
        const Icon = link.icon
        return (
          <GlassPanel key={link.url} hover className="p-4">
            <a href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-3">
              <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', ICON_COLOR_MAP.cyan)}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">{t(link.title)}</p>
                <p className="mt-0.5 truncate text-xs text-white/40">{link.url}</p>
              </div>
            </a>
          </GlassPanel>
        )
      })}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════════════════════════════ */

export default function DevToolsPage() {
  const { t } = useTranslation()
  usePageTitle(t('Title'))

  return (
    <PageContainer
      title={t('Title')}
      subtitle={t('Subtitle')}
    >
      <FadeIn>
        <div className="space-y-4">
          <Accordion
            title={t('Setup Wizard')}
            icon={<ListChecks className="h-5 w-5" />}
            badge={<Badge variant="info" size="sm">{t('Guided')}</Badge>}
          >
            <OnboardingWorkflow />
          </Accordion>

          <Accordion
            title={t('Fleet Api')}
            icon={<Wrench className="h-5 w-5" />}
            badge={<Badge variant="success" size="sm">{t('Tools')}</Badge>}
          >
            <FleetApiSection />
          </Accordion>

          <Accordion
            title={t('devtools.health.sectionTitle', 'Fleet Telemetry Health')}
            icon={<Radio className="h-5 w-5" />}
            badge={<Badge variant="danger" size="sm">{t('devtools.health.badgeMonitor', 'Monitor')}</Badge>}
          >
            <FleetTelemetryHealthSection />
          </Accordion>

          <Accordion
            title={t('Infrastructure')}
            icon={<Server className="h-5 w-5" />}
            badge={<Badge variant="neutral" size="sm">{t('Backend')}</Badge>}
          >
            <InfrastructureSection />
          </Accordion>

          <Accordion
            title={t('Client Utils')}
            icon={<Cpu className="h-5 w-5" />}
            badge={<Badge variant="neutral" size="sm">{t('Browser')}</Badge>}
          >
            <ClientUtilitiesSection />
          </Accordion>

          <Accordion
            title={t('Reference')}
            icon={<ExternalLink className="h-5 w-5" />}
            badge={<Badge variant="info" size="sm">{t('Links')}</Badge>}
          >
            <ReferenceLinksSection />
          </Accordion>
        </div>
      </FadeIn>
    </PageContainer>
  )
}
