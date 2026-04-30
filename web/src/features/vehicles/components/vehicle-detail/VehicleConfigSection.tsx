import { useTranslation } from 'react-i18next'
import { Settings } from 'lucide-react'

import { GlassPanel } from '@/components/ui'
import { KVList } from '@/components/data-display'
import { Skeleton } from '@/components/feedback'
import type { VehicleConfigSnapshot } from '@/api/types'

interface VehicleConfigSectionProps {
  vehicleConfig: VehicleConfigSnapshot | null | undefined
  softwareVersion: string | undefined
}

export function VehicleConfigSection({ vehicleConfig, softwareVersion }: VehicleConfigSectionProps) {
  const { t } = useTranslation()

  const configItems = vehicleConfig
    ? [
        { label: t('vehicles.detail.carType', 'Car Type'), value: vehicleConfig.car_type ?? '—' },
        { label: t('vehicles.detail.trim', 'Trim'), value: vehicleConfig.trim ?? '—' },
        { label: t('vehicles.detail.color', 'Exterior Color'), value: vehicleConfig.exterior_color ?? '—' },
        { label: t('vehicles.detail.wheels', 'Wheels'), value: vehicleConfig.wheel_type ?? '—' },
        { label: t('vehicles.detail.roofColor', 'Roof Color'), value: vehicleConfig.roof_color ?? '—' },
        { label: t('vehicles.detail.chargePort', 'Charge Port'), value: vehicleConfig.charge_port ?? '—' },
        { label: t('vehicles.detail.rhd', 'Right-Hand Drive'), value: vehicleConfig.right_hand_drive != null ? (vehicleConfig.right_hand_drive ? t('common.yes', 'Yes') : t('common.no', 'No')) : '—' },
        { label: t('vehicles.detail.europeVehicle', 'Europe Vehicle'), value: vehicleConfig.europe_vehicle != null ? (vehicleConfig.europe_vehicle ? t('common.yes', 'Yes') : t('common.no', 'No')) : '—' },
        { label: t('vehicles.detail.offroadLightbar', 'Offroad Lightbar'), value: vehicleConfig.offroad_lightbar_present != null ? (vehicleConfig.offroad_lightbar_present ? t('common.yes', 'Yes') : t('common.no', 'No')) : '—' },
        { label: t('vehicles.detail.rearSeatHeaters', 'Rear Seat Heaters'), value: vehicleConfig.rear_seat_heaters ?? '—' },
        { label: t('vehicles.detail.sunroofInstalled', 'Sunroof'), value: vehicleConfig.sunroof_installed ?? '—' },
        { label: t('vehicles.detail.softwareVersion', 'Software'), value: vehicleConfig.software_update_version ?? softwareVersion ?? '—' },
      ]
    : []

  return (
    <GlassPanel className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <Settings className="h-4 w-4 text-[var(--neon-cyan)]" />
        <span className="text-lg font-bold text-[var(--text-primary)]">
          {t('vehicles.detail.vehicleConfig', 'Vehicle Configuration')}
        </span>
      </div>
      {configItems.length > 0 ? (
        <KVList items={configItems} columns={2} />
      ) : (
        <Skeleton lines={4} height={16} />
      )}
    </GlassPanel>
  )
}
