/**
 * Per-vehicle settings section.
 *
 * Mounted in <VehicleDetailPage> as a section (this page uses the
 * sectional FadeIn pattern, not Tabs). Renders one row per supported
 * key with:
 *   • the human-readable label + help text
 *   • the current effective value rendered through a typed input
 *   • a "source" pill (Override | User default | Vehicle name | System default)
 *   • a Save button (only when the local draft differs from the
 *     effective value AND has actually been edited)
 *   • a "Reset to default" button (disabled when source !== 'override')
 *
 * Mute_until is rendered as a datetime-local input; the component
 * converts the value to RFC3339 (with seconds) before invoking
 * useUpsertVehicleSetting.
 *
 * The section short-circuits to a small skeleton + EmptyState while
 * loading or on error so it never blocks the rest of the page.
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, GlassPanel, Input, Select, type SelectOption } from '@/components/ui'
import { Heading, Text } from '@/components/ui'
import { Skeleton, ErrorDisplay } from '@/components/feedback'

import {
  findEffectiveSetting,
  useResetVehicleSetting,
  useUpsertVehicleSetting,
  useVehicleSettings,
  type VehicleSettingValue,
} from '@/api/hooks/useVehicleSettings'
import type { EffectiveSetting, EffectiveSettingSource } from '@/api/types'

/* ───── Whitelist + per-key UI metadata ───────────────────────── */

type VehicleSettingKind = 'text' | 'timestamp' | 'select'

interface VehicleSettingDescriptor {
  key: string
  kind: VehicleSettingKind
  /** For 'select' kind: the static option set. */
  options?: SelectOption[]
  /** For 'text' kind: optional max length / placeholder. */
  maxLength?: number
  /** For 'text' kind: HTML autocomplete hint. */
  autoComplete?: string
}

/**
 * The supported keys mirror vehicleSettingDefs in
 * internal/database/vehicle_settings_repo.go. The order here drives
 * row rendering order; do not reorder unless the i18n labels change.
 */
const VEHICLE_SETTING_DESCRIPTORS: VehicleSettingDescriptor[] = [
  { key: 'nickname', kind: 'text', maxLength: 64, autoComplete: 'off' },
  { key: 'mute_until', kind: 'timestamp' },
  { key: 'charge_cost_tariff_id', kind: 'text', maxLength: 64, autoComplete: 'off' },
  {
    key: 'units_distance',
    kind: 'select',
    options: [
      { value: 'mi', label: 'mi' },
      { value: 'km', label: 'km' },
    ],
  },
  {
    key: 'units_temperature',
    kind: 'select',
    options: [
      { value: 'C', label: '°C' },
      { value: 'F', label: '°F' },
    ],
  },
  {
    key: 'units_energy',
    kind: 'select',
    options: [
      { value: 'kWh', label: 'kWh' },
    ],
  },
]

/* ───── Datetime-local <-> RFC3339 helpers ────────────────────── */

/**
 * Convert an RFC3339 timestamp from the API into the
 * `YYYY-MM-DDTHH:MM` shape an `<input type="datetime-local">` accepts.
 * Returns the empty string when input cannot be parsed so the input
 * renders as "no value".
 */
function rfc3339ToLocalInput(value: unknown): string {
  if (typeof value !== 'string' || value === '') return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  // datetime-local needs YYYY-MM-DDTHH:MM in *local* time
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

/**
 * Convert the datetime-local string the user typed back into an
 * RFC3339 timestamp (UTC). Returns null when the input is empty or
 * unparseable so the caller can short-circuit.
 */
function localInputToRFC3339(local: string): string | null {
  if (!local) return null
  const d = new Date(local)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

/* ───── Section component ─────────────────────────────────────── */

export interface VehicleSettingsTabProps {
  vehicleId: number
}

export default function VehicleSettingsTab({ vehicleId }: VehicleSettingsTabProps) {
  const { t } = useTranslation()
  const { data, isLoading, isError, refetch } = useVehicleSettings(vehicleId)

  return (
    <GlassPanel className="p-6" data-testid="vehicle-settings-section">
      <div className="mb-4 space-y-1">
        <Heading level="section">{t('vehicleSettings.title', 'Per-vehicle settings')}</Heading>
        <Text variant="bodySm" className="text-[var(--text-secondary)]">
          {t(
            'vehicleSettings.subtitle',
            'Override individual settings for this vehicle. Resets fall back to your account-wide values.',
          )}
        </Text>
      </div>

      {isLoading ? (
        <div data-testid="vehicle-settings-loading" className="space-y-3">
          <Skeleton className="h-12 rounded-lg" />
          <Skeleton className="h-12 rounded-lg" />
          <Skeleton className="h-12 rounded-lg" />
        </div>
      ) : isError ? (
        <div data-testid="vehicle-settings-error">
          <ErrorDisplay
            error={new Error(t('vehicleSettings.error', 'Could not load vehicle settings.'))}
            onRetry={() => {
              void refetch()
            }}
            compact
          />
        </div>
      ) : (
        <ul className="divide-y divide-white/5" data-testid="vehicle-settings-rows">
          {VEHICLE_SETTING_DESCRIPTORS.map((desc) => {
            const effective = findEffectiveSetting(data, desc.key)
            return (
              <VehicleSettingRow
                key={desc.key}
                vehicleId={vehicleId}
                descriptor={desc}
                effective={effective}
              />
            )
          })}
        </ul>
      )}
    </GlassPanel>
  )
}

/* ───── Source pill ───────────────────────────────────────────── */

const SOURCE_PILL_VARIANT: Record<EffectiveSettingSource, 'success' | 'info' | 'neutral' | 'warning'> = {
  override: 'success',
  user: 'info',
  vehicle: 'neutral',
  default: 'warning',
}

function SourcePill({ source }: { source: EffectiveSettingSource }) {
  const { t } = useTranslation()
  const variant = SOURCE_PILL_VARIANT[source] ?? 'neutral'
  return (
    <Badge variant={variant} data-testid={`vehicle-settings-source-${source}`}>
      {t(`vehicleSettings.source.${source}`, source)}
    </Badge>
  )
}

/* ───── Per-row component ─────────────────────────────────────── */

interface VehicleSettingRowProps {
  vehicleId: number
  descriptor: VehicleSettingDescriptor
  effective: EffectiveSetting | undefined
}

function VehicleSettingRow({ vehicleId, descriptor, effective }: VehicleSettingRowProps) {
  const { t } = useTranslation()
  const upsert = useUpsertVehicleSetting(vehicleId)
  const reset = useResetVehicleSetting(vehicleId)

  const source: EffectiveSettingSource = effective?.source ?? 'default'
  const isOverride = source === 'override'

  // Local draft state — initialised from the effective value, kept in
  // sync when the effective value changes from outside (e.g. another
  // tab saved an override). The draft is always a string so the
  // input components can be rendered uniformly.
  const initialDraft = useMemo(() => effectiveToDraft(descriptor, effective), [descriptor, effective])
  const [draft, setDraft] = useState<string>(initialDraft)
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(initialDraft)
    setValidationError(null)
  }, [initialDraft])

  const dirty = draft !== initialDraft

  const handleSave = () => {
    setValidationError(null)
    const parsed = parseDraft(descriptor, draft)
    if (parsed.kind === 'invalid') {
      setValidationError(t(parsed.message, parsed.fallback))
      return
    }
    if (parsed.kind === 'empty') {
      setValidationError(t('vehicleSettings.validation.required', 'Value is required.'))
      return
    }
    upsert.mutate({ key: descriptor.key, value: parsed.value })
  }

  const handleReset = () => {
    if (!isOverride) return
    reset.mutate(descriptor.key)
  }

  return (
    <li className="py-4" data-testid={`vehicle-settings-row-${descriptor.key}`}>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12 lg:items-start">
        <div className="lg:col-span-4 space-y-1">
          <div className="flex items-center gap-2">
            <Text variant="bodySm" className="font-medium text-[var(--text-primary)]">
              {t(`vehicleSettings.keys.${descriptor.key}.label`, descriptor.key)}
            </Text>
            <SourcePill source={source} />
          </div>
          <Text variant="caption" className="text-[var(--text-muted)]">
            {t(`vehicleSettings.keys.${descriptor.key}.help`, '')}
          </Text>
        </div>

        <div className="lg:col-span-5">
          {renderInput(descriptor, draft, setDraft)}
          {validationError ? (
            <Text
              variant="caption"
              className="mt-1 text-rose-300"
              data-testid={`vehicle-settings-error-${descriptor.key}`}
            >
              {validationError}
            </Text>
          ) : null}
        </div>

        <div className="lg:col-span-3 flex items-center justify-start gap-2 lg:justify-end">
          <Button
            variant="primary"
            size="sm"
            disabled={!dirty || upsert.isPending}
            onClick={handleSave}
            data-testid={`vehicle-settings-save-${descriptor.key}`}
          >
            {upsert.isPending
              ? t('vehicleSettings.actions.saving', 'Saving…')
              : t('vehicleSettings.actions.save', 'Save')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!isOverride || reset.isPending}
            onClick={handleReset}
            data-testid={`vehicle-settings-reset-${descriptor.key}`}
          >
            {reset.isPending
              ? t('vehicleSettings.actions.resetting', 'Resetting…')
              : t('vehicleSettings.actions.reset', 'Reset to default')}
          </Button>
        </div>
      </div>
    </li>
  )
}

/* ───── Per-row helpers ───────────────────────────────────────── */

function effectiveToDraft(
  descriptor: VehicleSettingDescriptor,
  effective: EffectiveSetting | undefined,
): string {
  const v = effective?.value
  switch (descriptor.kind) {
    case 'timestamp':
      return rfc3339ToLocalInput(v)
    case 'select':
      return typeof v === 'string' ? v : ''
    case 'text':
    default:
      return typeof v === 'string' ? v : v == null ? '' : String(v)
  }
}

type ParseResult =
  | { kind: 'ok'; value: VehicleSettingValue }
  | { kind: 'empty' }
  | { kind: 'invalid'; message: string; fallback: string }

function parseDraft(descriptor: VehicleSettingDescriptor, draft: string): ParseResult {
  const trimmed = draft.trim()
  if (trimmed === '') {
    return { kind: 'empty' }
  }
  switch (descriptor.kind) {
    case 'timestamp': {
      const iso = localInputToRFC3339(trimmed)
      if (!iso) {
        return {
          kind: 'invalid',
          message: 'vehicleSettings.validation.invalidDate',
          fallback: 'Enter a valid date and time.',
        }
      }
      return { kind: 'ok', value: iso }
    }
    case 'select': {
      const allowed = descriptor.options?.some((o) => o.value === trimmed) ?? false
      if (!allowed) {
        return {
          kind: 'invalid',
          message: 'vehicleSettings.validation.invalid',
          fallback: 'Value is not valid for this setting.',
        }
      }
      return { kind: 'ok', value: trimmed }
    }
    case 'text':
    default:
      return { kind: 'ok', value: trimmed }
  }
}

function renderInput(
  descriptor: VehicleSettingDescriptor,
  draft: string,
  onChange: (value: string) => void,
) {
  switch (descriptor.kind) {
    case 'timestamp':
      return (
        <Input
          type="datetime-local"
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          data-testid={`vehicle-settings-input-${descriptor.key}`}
        />
      )
    case 'select':
      return (
        <Select
          options={descriptor.options ?? []}
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          data-testid={`vehicle-settings-input-${descriptor.key}`}
        />
      )
    case 'text':
    default:
      return (
        <Input
          type="text"
          value={draft}
          onChange={(e) => onChange(e.target.value)}
          maxLength={descriptor.maxLength}
          autoComplete={descriptor.autoComplete}
          data-testid={`vehicle-settings-input-${descriptor.key}`}
        />
      )
  }
}
