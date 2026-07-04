import { useState, useMemo, useCallback, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Palette } from 'lucide-react'
import { Input } from '@/components/ui'
import { ToolCard } from '../ToolCard'
import { CopyButton } from '@/components/ui'
import { rgbToHsl } from '../helpers'

export function ColorConverterTool() {
  const { t } = useTranslation()
  const [hex, setHex] = useState('#3b82f6')

  const handleChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setHex(e.target.value)
  }, [])

  // Strict 6-digit hex validation. parseInt() alone is too lenient — it
  // stops at the first non-hex character, so "#12345g" would silently parse
  // to a bogus rgb() instead of being rejected. Trim first so a pasted
  // "  #3b82f6  " still resolves.
  const parsed = useMemo(() => {
    const clean = hex.trim().replace(/^#/, '')
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null
    const r = parseInt(clean.slice(0, 2), 16)
    const g = parseInt(clean.slice(2, 4), 16)
    const b = parseInt(clean.slice(4, 6), 16)
    const [h, s, l] = rgbToHsl(r, g, b)
    return {
      r,
      g,
      b,
      h,
      s,
      l,
      rgb: `rgb(${r}, ${g}, ${b})`,
      hsl: `hsl(${h}, ${s}%, ${l}%)`,
    }
  }, [hex])

  return (
    <ToolCard icon={Palette} color="purple" title={t('Color Converter')} description={t('Color Converter Desc')}>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Input label={t('Hex Color')} placeholder="#3b82f6" value={hex} onChange={handleChange} icon={<Palette className="h-4 w-4" />} />
          <div
            role="img"
            aria-label={`${t('devtools.utils.colorPreview', 'Color preview')}: ${hex}`}
            className="mt-5 h-10 w-10 shrink-0 rounded-lg ring-1 ring-glass-border"
            style={{ backgroundColor: hex }}
          />
        </div>
        {parsed ? (
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded bg-[var(--surface-overlay)] px-3 py-2">
              <span className="text-xs text-[var(--text-secondary)]">RGB</span>
              <p className="font-mono text-sm text-[var(--text-primary)]">{parsed.rgb}</p>
              <CopyButton text={parsed.rgb} />
            </div>
            <div className="rounded bg-[var(--surface-overlay)] px-3 py-2">
              <span className="text-xs text-[var(--text-secondary)]">HSL</span>
              <p className="font-mono text-sm text-[var(--text-primary)]">{parsed.hsl}</p>
              <CopyButton text={parsed.hsl} />
            </div>
            <div className="rounded bg-[var(--surface-overlay)] px-3 py-2">
              <span className="text-xs text-[var(--text-secondary)]">HEX</span>
              <p className="font-mono text-sm text-[var(--text-primary)]">{hex}</p>
              <CopyButton text={hex} />
            </div>
          </div>
        ) : (
          <p role="status" className="text-xs text-[var(--text-muted)]">
            {t('devtools.utils.colorInvalidHex', 'Enter a valid 6-digit hex color, e.g. #3b82f6')}
          </p>
        )}
      </div>
    </ToolCard>
  )
}
