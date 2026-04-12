import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import { ArrowLeft, Power } from 'lucide-react'
import { FadeIn, StatusBadge, Button } from '@/components/ui'
import { wakeVehicle, getVehicleStatus } from '@/api/vehicles'
import type { Vehicle, VehicleState, VehicleStatus } from '@/api/types'

interface VehicleHeaderProps {
  vehicle: Vehicle | undefined
  state: VehicleState | undefined
  onRefetchState: () => void
}

export function VehicleHeader({ vehicle, state, onRefetchState }: VehicleHeaderProps) {
  const { t } = useTranslation()
  const vehicleId = vehicle?.id ?? 0

  const status: VehicleStatus = vehicle ? getVehicleStatus(vehicle, state) : 'offline'

  const wakeMut = useMutation({
    mutationFn: () => wakeVehicle(vehicleId),
    onSuccess: () => {
      setTimeout(() => onRefetchState(), 5000)
    },
  })

  return (
    <FadeIn>
      <div className="flex items-center gap-4">
        <Link
          to="/vehicles"
          className="rounded-xl p-2.5 text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-primary)] transition-all"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">
              {vehicle?.display_name || vehicle?.vin || t('common.vehicle', 'Vehicle')}
            </h1>
            <StatusBadge
              status={status as 'online' | 'offline' | 'asleep' | 'driving' | 'charging' | 'updating'}
              size="md"
            />
          </div>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">
            {vehicle?.model} {vehicle?.trim_badging} &middot;{' '}
            <span className="font-mono">{vehicle?.vin}</span>
          </p>
        </div>
        <Button
          onClick={() => wakeMut.mutate()}
          loading={wakeMut.isPending}
          icon={<Power className="h-4 w-4" />}
        >
          {t('common.wakeUp', 'Wake Up')}
        </Button>
      </div>
    </FadeIn>
  )
}
