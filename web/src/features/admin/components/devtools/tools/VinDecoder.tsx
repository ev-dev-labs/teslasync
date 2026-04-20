import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Car } from 'lucide-react'
import { Input } from '@/components/ui'
import { ToolCard } from '../ToolCard'
import { VIN_MANUFACTURERS, VIN_MODELS, VIN_DRIVE, VIN_YEAR, VIN_PLANT } from '../constants'

export function VinDecoderTool() {
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
