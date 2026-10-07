import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Heading, HelperText, Text, Textarea } from '@/components/ui'

interface TypographySpecimenProps {
  sansName: string
  monoName: string
}

export function TypographySpecimen({ sansName, monoName }: TypographySpecimenProps) {
  const { t } = useTranslation('settings')
  const [sample, setSample] = useState('')
  const display = sample.trim() || t(
    'typography.preview.heading',
    'The quick brown fox jumps over the lazy dog',
  )

  return (
    <div
      role="group"
      aria-label={t('typography.preview.aria', 'Typography preview')}
      className="space-y-4 rounded-xl border border-[var(--glass-border)] bg-[var(--surface-2)] p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Text as="p" variant="label">{t('typography.preview.label', 'Live preview')}</Text>
        <HelperText>{sansName} · {monoName}</HelperText>
      </div>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <HelperText>{t('typography.preview.interface', 'Interface & headings')}</HelperText>
          <Heading level="section" as="p" className="break-words">{display}</Heading>
          <Text as="p" variant="body">
            {t('typography.preview.body', 'Sync your Tesla fleet, chart every drive, and read the numbers clearly in any theme.')}
          </Text>
        </div>
        <div className="min-w-0 space-y-2">
          <HelperText>{t('typography.preview.data', 'Data & code')}</HelperText>
          <Heading level="panel" as="p">82% · 245 km</Heading>
          <Text as="p" variant="code" className="break-all">
            0123456789 · kWh · °C · km/h · 2026-08-25T10:42:00Z
          </Text>
        </div>
      </div>
      <Textarea
        label={t('typography.preview.tryText', 'Try your own text')}
        value={sample}
        onChange={event => setSample(event.target.value)}
        placeholder={t('typography.preview.tryPlaceholder', 'Type here to see your text in the preview')}
        rows={2}
      />
    </div>
  )
}
