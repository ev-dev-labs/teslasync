import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Type, RotateCcw, Sparkles } from 'lucide-react'

import {
  GlassPanel,
  IconBox,
  Button,
  Slider,
  Select,
  Input,
  Text,
  Heading,
  HelperText,
  Label,
  type SelectOption,
} from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { cn } from '@/lib/cn'
import {
  useFont,
  SANS_FAMILY_IDS,
  MONO_FAMILY_IDS,
  LEADING_OPTIONS,
  TRACKING_OPTIONS,
  HEADING_WEIGHT_OPTIONS,
  FONT_SCALE_MIN,
  FONT_SCALE_MAX,
  FONT_SCALE_STEP,
  type FontFamilyId,
  type MonoFamilyId,
  type ReadingPresetId,
} from '@/components/ui/FontProvider'

// Brand names are proper nouns rendered verbatim in the option lists; only the
// surrounding UI copy is translated.
const SANS_LABELS: Record<FontFamilyId, string> = {
  inter: 'Inter',
  system: 'System UI',
  roboto: 'Roboto',
  source: 'Source Sans 3',
  plex: 'IBM Plex Sans',
  atkinson: 'Atkinson Hyperlegible',
  custom: 'Custom',
}

const MONO_LABELS: Record<MonoFamilyId, string> = {
  jetbrains: 'JetBrains Mono',
  fira: 'Fira Code',
  'plex-mono': 'IBM Plex Mono',
  system: 'System Mono',
  custom: 'Custom',
}

/** Small block field label using the shared `label` typography role. */
function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <Text as="div" variant="label" className="mb-2">
      {children}
    </Text>
  )
}

interface SegmentedOption<T extends string | number> {
  value: T
  label: string
}

/** A 3-up segmented control built from shared Buttons + theme tokens. */
function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: SegmentedOption<T>[]
  value: T
  onChange: (v: T) => void
  /** Accessible group name so the mutually-exclusive toggles are announced together. */
  ariaLabel?: string
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="grid grid-cols-3 gap-2">
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <Button
            key={String(opt.value)}
            variant="ghost"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={cn(
              'h-auto justify-center rounded-xl border px-3 py-2.5 transition-colors duration-normal',
              active
                ? 'border-[var(--theme-primary)] bg-[var(--surface-3)] text-[var(--text-primary)]'
                : 'border-[var(--glass-border)] bg-[var(--surface-2)] text-[var(--text-secondary)] hover:border-[var(--theme-primary)]/30',
            )}
          >
            {opt.label}
          </Button>
        )
      })}
    </div>
  )
}

export function TypographySettings() {
  const { t } = useTranslation('settings')
  const {
    prefs,
    setSans,
    setMono,
    setCustomSans,
    setCustomMono,
    setScale,
    setLeading,
    setTracking,
    setHeadingWeight,
    applyPreset,
    reset,
  } = useFont()

  // Brand-name option lists are static; memoize so typing in a custom-font
  // field (which re-renders on every keystroke) doesn't rebuild them.
  const sansOptions = useMemo<SelectOption[]>(
    () => SANS_FAMILY_IDS.map((id) => ({ value: id, label: SANS_LABELS[id] })),
    [],
  )
  const monoOptions = useMemo<SelectOption[]>(
    () => MONO_FAMILY_IDS.map((id) => ({ value: id, label: MONO_LABELS[id] })),
    [],
  )

  // Each field label doubles as the accessible group name for its segmented
  // control, so the toggle buttons are announced under a single named group.
  const leadingLabel = t('typography.leading.label', 'Line height')
  const trackingLabel = t('typography.tracking.label', 'Letter spacing')
  const weightLabel = t('typography.weight.label', 'Heading weight')

  const leadingOptions = useMemo<SegmentedOption<number>[]>(
    () => [
      { value: LEADING_OPTIONS[0], label: t('typography.leading.tight', 'Tight') },
      { value: LEADING_OPTIONS[1], label: t('typography.leading.normal', 'Normal') },
      { value: LEADING_OPTIONS[2], label: t('typography.leading.relaxed', 'Relaxed') },
    ],
    [t],
  )
  const trackingOptions = useMemo<SegmentedOption<string>[]>(
    () => [
      { value: TRACKING_OPTIONS[0], label: t('typography.tracking.tight', 'Tight') },
      { value: TRACKING_OPTIONS[1], label: t('typography.tracking.normal', 'Normal') },
      { value: TRACKING_OPTIONS[2], label: t('typography.tracking.wide', 'Wide') },
    ],
    [t],
  )
  const weightOptions = useMemo<SegmentedOption<number>[]>(
    () => [
      { value: HEADING_WEIGHT_OPTIONS[0], label: t('typography.weight.medium', 'Medium') },
      { value: HEADING_WEIGHT_OPTIONS[1], label: t('typography.weight.semibold', 'Semibold') },
      { value: HEADING_WEIGHT_OPTIONS[2], label: t('typography.weight.bold', 'Bold') },
    ],
    [t],
  )

  const presets = useMemo<{ id: ReadingPresetId; label: string }[]>(
    () => [
      { id: 'default', label: t('typography.presets.default', 'Default') },
      { id: 'comfortable', label: t('typography.presets.comfortable', 'Comfortable') },
      { id: 'compact', label: t('typography.presets.compact', 'Compact') },
      { id: 'legible', label: t('typography.presets.legible', 'High legibility') },
    ],
    [t],
  )

  return (
    <FadeIn delay={0.2}>
      <GlassPanel className="space-y-6 p-6" data-tour="settings-typography">
        <div className="flex items-center gap-3">
          <IconBox color="cyan">
            <Type className="h-5 w-5" aria-hidden="true" />
          </IconBox>
          <div>
            <Heading level="panel">{t('typography.title', 'Typography')}</Heading>
            <HelperText>
              {t('typography.subtitle', 'Choose fonts and tune size, spacing, and weight — applied everywhere instantly.')}
            </HelperText>
          </div>
        </div>

        {/* Live preview — reflects the current font, scale, line-height,
            letter-spacing, and heading weight via the shared CSS vars. */}
        <div
          role="group"
          className="space-y-2 rounded-xl border border-[var(--glass-border)] bg-[var(--surface-2)] p-4"
          aria-label={t('typography.preview.aria', 'Typography preview')}
        >
          <Text as="div" variant="label">
            {t('typography.preview.label', 'Preview')}
          </Text>
          <Heading level="section" as="p">
            {t('typography.preview.heading', 'The quick brown fox jumps over the lazy dog')}
          </Heading>
          <Text as="p" variant="body">
            {t(
              'typography.preview.body',
              'Sync your Tesla fleet, chart every drive, and read the numbers clearly in any theme.',
            )}
          </Text>
          <Text as="p" variant="code">
            0123456789 · kWh · °C · km/h
          </Text>
        </div>

        {/* Reading presets — one-click bundles. */}
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
            <Label>{t('typography.presets.label', 'Reading presets')}</Label>
          </div>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <Button key={p.id} variant="secondary" size="sm" onClick={() => applyPreset(p.id)}>
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {/* UI font */}
          <div>
            <Select
              label={t('typography.uiFont.label', 'UI font')}
              options={sansOptions}
              value={prefs.sans}
              onChange={(e) => setSans(e.target.value as FontFamilyId)}
            />
            {prefs.sans === 'custom' && (
              <div className="mt-2">
                <Input
                  aria-label={t('typography.uiFont.customAria', 'Custom UI font stack')}
                  placeholder={t('typography.uiFont.customPlaceholder', "e.g. 'Nunito', system-ui, sans-serif")}
                  value={prefs.customSans}
                  onChange={(e) => setCustomSans(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Monospace font */}
          <div>
            <Select
              label={t('typography.monoFont.label', 'Monospace font')}
              options={monoOptions}
              value={prefs.mono}
              onChange={(e) => setMono(e.target.value as MonoFamilyId)}
            />
            {prefs.mono === 'custom' && (
              <div className="mt-2">
                <Input
                  aria-label={t('typography.monoFont.customAria', 'Custom monospace font stack')}
                  placeholder={t('typography.monoFont.customPlaceholder', "e.g. 'Cascadia Code', ui-monospace, monospace")}
                  value={prefs.customMono}
                  onChange={(e) => setCustomMono(e.target.value)}
                />
              </div>
            )}
          </div>
        </div>

        {/* Text scale */}
        <Slider
          label={t('typography.scale.label', 'Text scale')}
          min={FONT_SCALE_MIN}
          max={FONT_SCALE_MAX}
          step={FONT_SCALE_STEP}
          value={prefs.scale}
          onChange={setScale}
          formatValue={(n) => `${Math.round(n * 100)}%`}
        />

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          {/* Line height */}
          <div>
            <FieldLabel>{leadingLabel}</FieldLabel>
            <Segmented options={leadingOptions} value={prefs.leading} onChange={setLeading} ariaLabel={leadingLabel} />
          </div>

          {/* Letter spacing */}
          <div>
            <FieldLabel>{trackingLabel}</FieldLabel>
            <Segmented options={trackingOptions} value={prefs.tracking} onChange={setTracking} ariaLabel={trackingLabel} />
          </div>

          {/* Heading weight */}
          <div>
            <FieldLabel>{weightLabel}</FieldLabel>
            <Segmented options={weightOptions} value={prefs.headingWeight} onChange={setHeadingWeight} ariaLabel={weightLabel} />
          </div>
        </div>

        {/* Reset */}
        <div className="flex items-center justify-between gap-3 border-t border-[var(--glass-border)] pt-4">
          <HelperText>{t('typography.reset.help', 'Restore the default font, size, and spacing.')}</HelperText>
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('typography.reset.action', 'Reset to defaults')}
          </Button>
        </div>
      </GlassPanel>
    </FadeIn>
  )
}
