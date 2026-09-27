import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { Button, Input, Label, HelperText, Text } from '@/components/ui'
import {
  DEFAULT_FONT_PREFS, fontStylesheetHref,
  type FontFamilyId, type MonoFamilyId,
} from '@/components/ui/FontProvider'
import { cn } from '@/lib/cn'

export interface FontChoice<Id extends FontFamilyId | MonoFamilyId> {
  id: Id
  name: string
  stack: string
  group?: string
}

interface FontFamilyPickerProps<Id extends FontFamilyId | MonoFamilyId> {
  kind: 'sans' | 'mono'
  label: string
  choices: FontChoice<Id>[]
  selected: Id
  onSelect: (id: Id) => void
}

export function FontFamilyPicker<Id extends FontFamilyId | MonoFamilyId>({
  kind, label, choices, selected, onSelect,
}: FontFamilyPickerProps<Id>) {
  const { t } = useTranslation('settings')
  const [query, setQuery] = useState('')
  const previewLinkId = `teslasync-font-preview-${kind}`
  const visible = choices.filter(choice =>
    `${choice.name} ${choice.group ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()),
  )

  useEffect(() => () => document.getElementById(previewLinkId)?.remove(), [previewLinkId])
  useEffect(() => setQuery(''), [selected])

  const preview = (id: Id) => {
    const prefs = kind === 'sans'
      ? { ...DEFAULT_FONT_PREFS, sans: id as FontFamilyId, mono: 'system' as const }
      : { ...DEFAULT_FONT_PREFS, mono: id as MonoFamilyId, sans: 'system' as const }
    const href = fontStylesheetHref(prefs)
    if (!href) return
    const link = document.getElementById(previewLinkId) as HTMLLinkElement | null
    if (link?.href === href) return
    const next = link ?? document.createElement('link')
    next.id = previewLinkId
    next.rel = 'stylesheet'
    next.href = href
    if (!link) document.head.appendChild(next)
  }

  return (
    <div role="group" aria-label={label} className="min-w-0 space-y-3">
      <div>
        <Label>{label}</Label>
        <HelperText>
          {t('typography.familyHint', 'Focus or hover to preview a font, then select it to use it everywhere.')}
        </HelperText>
      </div>
      <Input
        type="search"
        value={query}
        onChange={event => setQuery(event.target.value)}
        aria-label={t('typography.searchFont', 'Search {{kind}}', { kind: label })}
        placeholder={t('typography.searchPlaceholder', 'Search font families…')}
      />
      <div
        className="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3"
      >
        {visible.map(choice => (
          <Button
            key={choice.id}
            variant="ghost"
            aria-pressed={selected === choice.id}
            onFocus={() => preview(choice.id)}
            onMouseEnter={() => preview(choice.id)}
            onClick={() => onSelect(choice.id)}
            className={cn(
              'h-auto min-h-16 flex-col items-start gap-1 rounded-xl border p-3 text-left',
              selected === choice.id
                ? 'border-[var(--theme-primary)] bg-[var(--surface-3)]'
                : 'border-[var(--glass-border)] bg-[var(--surface-2)]',
            )}
          >
            <span className="flex w-full min-w-0 items-center justify-between gap-2">
              <Text as="span" variant="bodySm" className="truncate font-medium">{choice.name}</Text>
              {selected === choice.id && <Check className="h-4 w-4 shrink-0 text-[var(--theme-primary)]" aria-hidden="true" />}
            </span>
            <span className="text-sm text-[var(--text-secondary)]" style={{ fontFamily: choice.stack }}>
              {t('typography.cardSample', 'Aa 012345')}
            </span>
          </Button>
        ))}
        {visible.length === 0 && (
          <HelperText className="col-span-full py-6 text-center">
            {t('typography.noFonts', 'No font families match your search.')}
          </HelperText>
        )}
      </div>
    </div>
  )
}
