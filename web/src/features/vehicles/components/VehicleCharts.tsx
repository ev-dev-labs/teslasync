import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ChartTooltip,
  AREA_DEFAULTS, areaGradient,
} from '@/components/charts'
import { Navigation, Activity, Car, Settings } from 'lucide-react'
import {
  MapContainer, Polyline, Marker, vehicleIcon,
  MapTileLayer, MapInvalidator, MapLayerSwitcher,
  type LatLngExpression,
  type MapStyle,
} from '@/components/maps'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { FadeIn } from '@/components/motion/FadeIn'
import { MetricCard } from '@/components/data-display/MetricCard'
import { useUnits } from '@/hooks/useUnits'
import { cleanNil } from '@/lib/cleanNil'
import { fmtNumber, isFiniteNumber } from '@/lib/numberFormat'
import { formatTime } from '@/lib/dateFormat'
import { parseSettingEnum } from '@/lib/parseSettingEnum'
import type { VehicleState, Position, VehicleConfigSnapshot, UserPreferenceSnapshot } from '@/api/types'
import { convertSpeedFromSI } from '@/lib/unitConversion'

interface VehicleChartsProps {
  state: VehicleState
  positions: Position[] | undefined
  vehicleConfigData: VehicleConfigSnapshot | null | undefined
  userPrefData: UserPreferenceSnapshot | null | undefined
}

export function VehicleCharts({
  state,
  positions,
  vehicleConfigData,
  userPrefData,
}: VehicleChartsProps) {
  const { t } = useTranslation()
  const { unitPrefs } = useUnits()
  const speedUnit = unitPrefs.speed
  const toSpeedDisplay = useCallback(
    (value: number) => convertSpeedFromSI(value, speedUnit),
    [speedUnit],
  )
  const [mapStyle, setMapStyle] = useState<MapStyle>('dark')

  // GPS trail for the polyline. `(0, 0)` is Tesla's "no fix yet" placeholder
  // (and any nullish / NaN coord is unusable), so both axes must be truthy.
  const trail = useMemo<LatLngExpression[]>(
    () =>
      (positions ?? [])
        .filter((p) => p.latitude && p.longitude)
        .map((p) => [p.latitude, p.longitude] as LatLngExpression),
    [positions],
  )

  // Speed series for the area chart, oldest → newest (left → right). A
  // non-finite `speed_mph` (null, NaN, ±Infinity) becomes a gap rather than a
  // `NaN` datum that would poison the axis domain.
  const speedSeries = useMemo(
    () =>
      (positions ?? [])
        .map((p) => ({
          time: formatTime(p.ts),
          speed: isFiniteNumber(p.speed_mph) ? toSpeedDisplay(p.speed_mph) : null,
        }))
        .reverse(),
    [positions, toSpeedDisplay],
  )

  const hasSpeedData = useMemo(() => speedSeries.some((d) => d.speed != null), [speedSeries])
  const hasLocation = Boolean(state.latitude && state.longitude)

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Live Map */}
      {hasLocation && (
        <FadeIn delay={0.15}>
          <GlassPanel className="overflow-hidden h-full">
            <div className="p-4 pb-0">
              <h3 className="section-title flex items-center gap-2 mb-3">
                <Navigation className="h-4 w-4 text-cyan-300" aria-hidden="true" />{' '}
                {t('common.location', 'Location')}
              </h3>
            </div>
            <div
              className="h-72 relative"
              role="region"
              aria-label={t('vehicles.detail.locationMapLabel', 'Vehicle location map')}
            >
              <MapLayerSwitcher current={mapStyle} onChange={setMapStyle} />
              <MapContainer
                center={[state.latitude, state.longitude]}
                zoom={14}
                scrollWheelZoom
                className="h-full w-full"
              >
                <MapTileLayer style={mapStyle} />
                <MapInvalidator />
                <Marker position={[state.latitude, state.longitude]} icon={vehicleIcon()} />
                {trail.length > 1 && (
                  <Polyline
                    positions={trail}
                    pathOptions={{ color: '#00f0ff', weight: 3, opacity: 0.6 }}
                  />
                )}
              </MapContainer>
            </div>
            <div className="p-3 text-center">
              <p className="text-2xs text-[var(--text-muted)] font-mono">
                {fmtNumber(state.latitude)}, {fmtNumber(state.longitude)}
              </p>
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      {/* Vehicle Configuration */}
      {vehicleConfigData && (
        <FadeIn delay={0.18}>
          <GlassPanel className="p-5">
            <h3 className="section-title mb-4 flex items-center gap-2">
              <Car className="h-4 w-4 text-purple-300" aria-hidden="true" />
              {t('common.vehicleConfig', 'Vehicle Configuration')}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { label: t('vehicles.detail.config.model', 'Model'), value: cleanNil(vehicleConfigData.car_type) },
                { label: t('vehicles.detail.config.trim', 'Trim'), value: cleanNil(vehicleConfigData.trim) },
                { label: t('vehicles.detail.config.color', 'Color'), value: cleanNil(vehicleConfigData.exterior_color) },
                { label: t('vehicles.detail.config.roof', 'Roof'), value: cleanNil(vehicleConfigData.roof_color) },
                { label: t('vehicles.detail.config.wheels', 'Wheels'), value: cleanNil(vehicleConfigData.wheel_type) },
                { label: t('vehicles.detail.config.firmware', 'Firmware'), value: cleanNil(vehicleConfigData.version) },
                { label: t('vehicles.detail.config.name', 'Name'), value: cleanNil(vehicleConfigData.vehicle_name) },
                { label: t('vehicles.detail.config.chargePort', 'Charge Port'), value: cleanNil(vehicleConfigData.charge_port) },
                {
                  label: t('vehicles.detail.config.rearHeaters', 'Rear Heaters'),
                  value: cleanNil(vehicleConfigData.rear_seat_heaters),
                },
                {
                  label: t('vehicles.detail.config.efficiency', 'Efficiency'),
                  value: cleanNil(vehicleConfigData.efficiency_package),
                },
                {
                  label: t('vehicles.detail.config.sunroof', 'Sunroof'),
                  value:
                    cleanNil(vehicleConfigData.sunroof_installed) ||
                    t('vehicles.detail.config.notInstalled', 'Not Installed'),
                },
                {
                  label: t('vehicles.detail.europeVehicle', 'Europe Vehicle'),
                  value:
                    vehicleConfigData.europe_vehicle != null
                      ? vehicleConfigData.europe_vehicle
                        ? t('common.yes', 'Yes')
                        : t('common.no', 'No')
                      : '—',
                },
                {
                  label: t('vehicles.detail.rhd', 'Right-Hand Drive'),
                  value:
                    vehicleConfigData.right_hand_drive != null
                      ? vehicleConfigData.right_hand_drive
                        ? t('common.yes', 'Yes')
                        : t('common.no', 'No')
                      : '—',
                },
                {
                  label: t('vehicles.detail.config.remoteStart', 'Remote Start'),
                  value:
                    vehicleConfigData.remote_start_enabled != null
                      ? vehicleConfigData.remote_start_enabled
                        ? t('vehicles.detail.config.active', 'Active')
                        : t('vehicles.detail.config.off', 'Off')
                      : '—',
                },
                {
                  label: t('vehicles.detail.config.offroadLightbar', 'Offroad Lightbar'),
                  value:
                    vehicleConfigData.offroad_lightbar_present != null
                      ? vehicleConfigData.offroad_lightbar_present
                        ? t('vehicles.detail.config.present', 'Present')
                        : t('common.no', 'No')
                      : '—',
                },
                {
                  label: t('vehicles.detail.config.swUpdate', 'SW Update'),
                  value:
                    cleanNil(vehicleConfigData.software_update_version) ||
                    t('vehicles.detail.config.none', 'None'),
                },
                {
                  label: t('vehicles.detail.config.swDownload', 'SW Download'),
                  value:
                    vehicleConfigData.software_update_download_pct != null
                      ? `${vehicleConfigData.software_update_download_pct}%`
                      : '—',
                },
                {
                  label: t('vehicles.detail.config.swInstall', 'SW Install'),
                  value:
                    vehicleConfigData.software_update_install_pct != null
                      ? `${vehicleConfigData.software_update_install_pct}%`
                      : '—',
                },
              ].map((item) => (
                <MetricCard key={item.label} label={item.label} value={item.value || '—'} />
              ))}
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      {/* User Preferences */}
      {userPrefData && (
        <FadeIn delay={0.19}>
          <GlassPanel className="p-5">
            <h3 className="section-title mb-4 flex items-center gap-2">
              <Settings className="h-4 w-4 text-amber-300" aria-hidden="true" />
              {t('common.carPreferences', 'Car Display Preferences')}
            </h3>
            <p className="text-2xs text-[var(--text-muted)] mb-3">
              {t(
                'vehicles.detail.prefs.intro',
                "These are your vehicle's display settings — you can sync your app to match them from the Settings page.",
              )}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {[
                {
                  label: t('vehicles.detail.prefs.distance', 'Distance'),
                  value: parseSettingEnum(userPrefData.setting_distance_unit, 'distance'),
                },
                {
                  label: t('vehicles.detail.prefs.temperature', 'Temperature'),
                  value: parseSettingEnum(
                    userPrefData.setting_temperature_unit,
                    'temperature',
                  ),
                },
                {
                  label: t('vehicles.detail.prefs.chargeUnit', 'Charge Unit'),
                  value: parseSettingEnum(userPrefData.setting_charge_unit, 'charge'),
                },
                {
                  label: t('vehicles.detail.prefs.tirePressure', 'Tire Pressure'),
                  value: parseSettingEnum(
                    userPrefData.setting_tire_pressure_unit,
                    'pressure',
                  ),
                },
                {
                  label: t('vehicles.detail.prefs.time24h', '24h Time'),
                  value:
                    userPrefData.setting_24hr_time != null
                      ? userPrefData.setting_24hr_time
                        ? t('common.yes', 'Yes')
                        : t('common.no', 'No')
                      : '—',
                },
              ].map((item) => (
                <MetricCard key={item.label} label={item.label} value={item.value || '—'} />
              ))}
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      {/* Battery & Speed chart */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-6 h-full">
          <h3 className="section-title mb-4 flex items-center gap-2">
            <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('common.speedHistory', 'Speed History')}
          </h3>
          {hasSpeedData ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={speedSeries}>
                  {areaGradient('vehicleSpeedGrad', '#00f0ff', 0.1)}
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--glass-border)"
                    strokeOpacity={0.4}
                  />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                  />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    {...AREA_DEFAULTS}
                    dataKey="speed"
                    stroke="#00f0ff"
                    fill="url(#vehicleSpeedGrad)"
                    name={t('vehicles.detail.speedSeries', 'Speed {{unit}}', { unit: speedUnit })}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center">
              <p className="text-xs text-[var(--text-muted)]">
                {t('common.positionDataWillAppear', 'Position data will appear here')}
              </p>
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </div>
  )
}
