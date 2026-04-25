import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ChartTooltip,
  AREA_DEFAULTS, areaGradient,
} from '@/components/charts'
import { Navigation, Activity, Car, Settings } from 'lucide-react'
import { MapContainer, Polyline, Marker, vehicleIcon } from '@/components/maps'
import { GlassPanel } from '@/components/ui/GlassPanel'
import { FadeIn } from '@/components/motion/FadeIn'
import { MetricCard } from '@/components/data-display/MetricCard'
import { MapTileLayer, MapInvalidator } from '@/components/maps/MapTileLayer'
import { MapLayerSwitcher } from '@/components/maps/MapLayerSwitcher'
import type { MapStyle } from '@/components/maps/MapTileLayer'
import { useSettings } from '@/hooks/useSettings'
import { cleanNil } from '@/lib/cleanNil'
import { fmtNumber } from '@/lib/numberFormat'
import { formatTime } from '@/lib/dateFormat'
import { parseSettingEnum } from '@/lib/parseSettingEnum'
import type { LatLngExpression } from 'leaflet'
import type { VehicleState, Position, VehicleConfigSnapshot, UserPreferenceSnapshot } from '@/api/types'

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
  const { convertSpeed, speedUnit } = useSettings()
  const [mapStyle, setMapStyle] = useState<MapStyle>('dark')

  const trail: LatLngExpression[] =
    positions
      ?.filter((p) => p.latitude && p.longitude)
      .map((p) => [p.latitude, p.longitude] as LatLngExpression) ?? []

  const batteryData =
    positions
      ?.map((p) => ({
        time: formatTime(p.ts),
        speed: p.speed_mph != null ? convertSpeed(p.speed_mph) : null,
      }))
      .reverse() ?? []

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Live Map */}
      {state.latitude && state.longitude && (
        <FadeIn delay={0.15}>
          <GlassPanel className="overflow-hidden h-full">
            <div className="p-4 pb-0">
              <h3 className="section-title flex items-center gap-2 mb-3">
                <Navigation className="h-4 w-4 text-neon-cyan" />{' '}
                {t('common.location', 'Location')}
              </h3>
            </div>
            <div className="h-72 relative">
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
              <p className="text-[10px] text-[var(--text-muted)] font-mono">
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
              <Car className="h-4 w-4 text-neon-purple" />
              {t('common.vehicleConfig', 'Vehicle Configuration')}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { label: 'Model', value: cleanNil(vehicleConfigData.car_type) },
                { label: 'Trim', value: cleanNil(vehicleConfigData.trim) },
                { label: 'Color', value: cleanNil(vehicleConfigData.exterior_color) },
                { label: 'Roof', value: cleanNil(vehicleConfigData.roof_color) },
                { label: 'Wheels', value: cleanNil(vehicleConfigData.wheel_type) },
                { label: 'Firmware', value: cleanNil(vehicleConfigData.version) },
                { label: 'Name', value: cleanNil(vehicleConfigData.vehicle_name) },
                { label: 'Charge Port', value: cleanNil(vehicleConfigData.charge_port) },
                {
                  label: 'Rear Heaters',
                  value: cleanNil(vehicleConfigData.rear_seat_heaters),
                },
                {
                  label: 'Efficiency',
                  value: cleanNil(vehicleConfigData.efficiency_package),
                },
                {
                  label: 'Sunroof',
                  value: cleanNil(vehicleConfigData.sunroof_installed) || 'Not Installed',
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
                  label: 'Remote Start',
                  value:
                    vehicleConfigData.remote_start_enabled != null
                      ? vehicleConfigData.remote_start_enabled
                        ? 'Active'
                        : 'Off'
                      : '—',
                },
                {
                  label: 'Offroad Lightbar',
                  value:
                    vehicleConfigData.offroad_lightbar_present != null
                      ? vehicleConfigData.offroad_lightbar_present
                        ? 'Present'
                        : 'No'
                      : '—',
                },
                {
                  label: 'SW Update',
                  value: cleanNil(vehicleConfigData.software_update_version) || 'None',
                },
                {
                  label: 'SW Download',
                  value:
                    vehicleConfigData.software_update_download_pct != null
                      ? `${vehicleConfigData.software_update_download_pct}%`
                      : '—',
                },
                {
                  label: 'SW Install',
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
              <Settings className="h-4 w-4 text-neon-amber" />
              {t('common.carPreferences', 'Car Display Preferences')}
            </h3>
            <p className="text-[10px] text-[var(--text-muted)] mb-3">
              These are your vehicle&apos;s display settings — you can sync your app to match
              them from the Settings page.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {[
                {
                  label: 'Distance',
                  value: parseSettingEnum(userPrefData.setting_distance_unit, 'distance'),
                },
                {
                  label: 'Temperature',
                  value: parseSettingEnum(
                    userPrefData.setting_temperature_unit,
                    'temperature',
                  ),
                },
                {
                  label: 'Charge Unit',
                  value: parseSettingEnum(userPrefData.setting_charge_unit, 'charge'),
                },
                {
                  label: 'Tire Pressure',
                  value: parseSettingEnum(
                    userPrefData.setting_tire_pressure_unit,
                    'pressure',
                  ),
                },
                {
                  label: '24h Time',
                  value:
                    userPrefData.setting_24hr_time != null
                      ? userPrefData.setting_24hr_time
                        ? 'Yes'
                        : 'No'
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
            <Activity className="h-4 w-4 text-neon-cyan" />
            {t('common.speedHistory', 'Speed History')}
          </h3>
          {batteryData.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={batteryData}>
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
                    name={`Speed ${speedUnit}`}
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
