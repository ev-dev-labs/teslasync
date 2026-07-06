import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings } from 'lucide-react'

import { GlassPanel, PanelTitle } from '@/components/ui'
import { KVList } from '@/components/data-display'
import { EmptyState } from '@/components/feedback'
import type { VehicleConfigSnapshot } from '@/api/types'

interface VehicleConfigSectionProps {
  vehicleConfig: VehicleConfigSnapshot | null | undefined
  softwareVersion: string | undefined
}

export function VehicleConfigSection({ vehicleConfig, softwareVersion }: VehicleConfigSectionProps) {
  const { t } = useTranslation()

  const configItems = useMemo(() => {
    if (!vehicleConfig) return []

    // `boolean | null | undefined` → localized Yes / No, or an em-dash when the
    // flag was never reported. The `!= null` guard is deliberate: an explicit
    // `false` must render "No", not collapse to the placeholder like a
    // truthiness check would.
    const yesNo = (value: boolean | null | undefined) =>
      value != null ? (value ? t('common.yes', 'Yes') : t('common.no', 'No')) : '—'

    return [
      { label: t('vehicles.detail.carType', 'Car Type'), value: vehicleConfig.car_type ?? '—' },
      { label: t('vehicles.detail.trim', 'Trim'), value: vehicleConfig.trim ?? '—' },
      { label: t('vehicles.detail.color', 'Exterior Color'), value: vehicleConfig.exterior_color ?? '—' },
      { label: t('vehicles.detail.wheels', 'Wheels'), value: vehicleConfig.wheel_type ?? '—' },
      { label: t('vehicles.detail.roofColor', 'Roof Color'), value: vehicleConfig.roof_color ?? '—' },
      { label: t('vehicles.detail.chargePort', 'Charge Port'), value: vehicleConfig.charge_port ?? '—' },
      { label: t('vehicles.detail.rhd', 'Right-Hand Drive'), value: yesNo(vehicleConfig.right_hand_drive) },
      { label: t('vehicles.detail.europeVehicle', 'Europe Vehicle'), value: yesNo(vehicleConfig.europe_vehicle) },
      { label: t('vehicles.detail.offroadLightbar', 'Offroad Lightbar'), value: yesNo(vehicleConfig.offroad_lightbar_present) },
      { label: t('vehicles.detail.rearSeatHeaters', 'Rear Seat Heaters'), value: vehicleConfig.rear_seat_heaters ?? '—' },
      { label: t('vehicles.detail.sunroofInstalled', 'Sunroof'), value: vehicleConfig.sunroof_installed ?? '—' },
      { label: t('vehicles.detail.softwareVersion', 'Software'), value: vehicleConfig.software_update_version ?? softwareVersion ?? '—' },
    ]
  }, [vehicleConfig, softwareVersion, t])

  return (
    <GlassPanel className="p-6">
      <PanelTitle className="mb-4 flex items-center gap-2">
        <Settings className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('vehicles.detail.vehicleConfig', 'Vehicle Configuration')}
      </PanelTitle>
      {configItems.length > 0 ? (
        <KVList items={configItems} columns={2} />
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when the vehicle has never reported a config snapshot; no specific recovery action available */ message={t('vehicles.detail.noVehicleConfig', 'No configuration data available')} />
      )}
    </GlassPanel>
  )
}
