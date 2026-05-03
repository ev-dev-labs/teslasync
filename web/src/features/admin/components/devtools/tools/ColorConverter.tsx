import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Palette } from 'lucide-react'
import { Input } from '@/components/ui'
import { ToolCard } from '../ToolCard'
import { CopyButton } from '@/components/ui'
import { rgbToHsl } from '../helpers'

export function ColorConverterTool() {
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
            <div className="rounded bg-[var(--surface-overlay)] px-3 py-2">
              <span className="text-xs text-[var(--text-secondary)]">RGB</span>
              <p className="font-mono text-sm text-white">rgb({parsed.r}, {parsed.g}, {parsed.b})</p>
              <CopyButton text={`rgb(${parsed.r}, ${parsed.g}, ${parsed.b})`} />
            </div>
            <div className="rounded bg-[var(--surface-overlay)] px-3 py-2">
              <span className="text-xs text-[var(--text-secondary)]">HSL</span>
              <p className="font-mono text-sm text-white">hsl({parsed.h}, {parsed.s}%, {parsed.l}%)</p>
              <CopyButton text={`hsl(${parsed.h}, ${parsed.s}%, ${parsed.l}%)`} />
            </div>
            <div className="rounded bg-[var(--surface-overlay)] px-3 py-2">
              <span className="text-xs text-[var(--text-secondary)]">HEX</span>
              <p className="font-mono text-sm text-white">{hex}</p>
              <CopyButton text={hex} />
            </div>
          </div>
        )}
      </div>
    </ToolCard>
  )
}
