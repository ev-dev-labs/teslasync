import { useState, useMemo, useCallback, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Car } from 'lucide-react'
import { Input } from '@/components/ui'
import { ToolCard } from '../ToolCard'
import { VIN_MANUFACTURERS, VIN_MODELS, VIN_DRIVE, VIN_YEAR, VIN_PLANT } from '../constants'

type VinField = 'mfr' | 'model' | 'drive' | 'year' | 'plant' | 'serial'
type DecodedVin = Record<VinField, string>

// Minimum characters (after whitespace removal) needed before the plant digit at
// index 10 is present and the VIN is worth decoding.
const MIN_VIN_LENGTH = 11

// Ordered field list drives the results grid. The English fallback guarantees a
// readable label even when the `devtools.utils.vin_*` translation key is absent
// (previously these rendered as the raw key string).
const VIN_FIELDS: ReadonlyArray<{ key: VinField; label: string }> = [
  { key: 'mfr', label: 'Manufacturer' },
  { key: 'model', label: 'Model' },
  { key: 'drive', label: 'Drive' },
  { key: 'year', label: 'Year' },
  { key: 'plant', label: 'Plant' },
  { key: 'serial', label: 'Serial' },
]

export function VinDecoderTool() {
  const { t } = useTranslation()
  const [vin, setVin] = useState('')

  const decoded = useMemo<DecodedVin | null>(() => {
    // VINs never contain whitespace; strip it so pasted/padded input decodes at
    // the correct character positions instead of shifting every field.
    const normalized = vin.replace(/\s+/g, '').toUpperCase()
    if (normalized.length < MIN_VIN_LENGTH) return null
    const unknown = t('Unknown', 'Unknown')
    return {
      mfr: VIN_MANUFACTURERS[normalized.slice(0, 3)] ?? unknown,
      model: VIN_MODELS[normalized[3]] ?? unknown,
      drive: VIN_DRIVE[normalized[7]] ?? unknown,
      year: VIN_YEAR[normalized[9]] ?? unknown,
      plant: VIN_PLANT[normalized[10]] ?? unknown,
      serial: normalized.slice(11) || '—',
    }
  }, [vin, t])

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => setVin(e.target.value),
    [],
  )

  // Guide the user when they have started typing but there is not yet enough to
  // decode — never leave the panel silently empty mid-entry.
  const hint =
    vin.trim().length > 0 && !decoded
      ? t('devtools.utils.vin_hint', 'Enter at least 11 characters to decode a VIN')
      : undefined

  return (
    <ToolCard icon={Car} color="cyan" title={t('Vin Decoder')} description={t('Vin Decoder Desc')}>
      <div className="space-y-3">
        <Input
          label={t('Vin')}
          placeholder="5YJ3E1EA1NF000001"
          value={vin}
          onChange={handleChange}
          hint={hint}
          icon={<Car className="h-4 w-4" aria-hidden="true" />}
        />
        {decoded && (
          <dl
            aria-label={t('devtools.utils.vin_results', 'Decoded VIN')}
            className="grid gap-2 sm:grid-cols-2"
          >
            {VIN_FIELDS.map(({ key, label }) => (
              <div key={key} className="rounded bg-[var(--surface-overlay)] px-3 py-2">
                <dt className="text-xs text-[var(--text-secondary)]">
                  {t(`devtools.utils.vin_${key}`, label)}
                </dt>
                <dd className="text-sm font-medium text-[var(--text-primary)]">{decoded[key]}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </ToolCard>
  )
}
