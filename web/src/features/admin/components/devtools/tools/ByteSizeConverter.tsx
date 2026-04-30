import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { HardDrive } from 'lucide-react'
import { Input, Select } from '@/components/ui'
import { cn } from '@/lib/cn'
import { fmtNumber } from '@/lib/numberFormat'
import { ToolCard } from '../ToolCard'
import { BYTE_UNITS } from '../constants'

export function ByteSizeConverterTool() {
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
