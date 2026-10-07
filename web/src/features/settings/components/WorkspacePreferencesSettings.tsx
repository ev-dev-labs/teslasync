import { RotateCcw, SlidersHorizontal } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { PersonaSelect } from '@/components/forms'
import {
  Badge,
  Button,
  GlassPanel,
  HelperText,
  IconBox,
  SectionTitle,
  Select,
  Text,
  Toggle,
} from '@/components/ui'
import { useToast } from '@/components/feedback'
import { useProductPreferences } from '@/hooks/useProductPreferences'
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle'
import {
  PRODUCT_LANDING_PAGES,
  type ProductLandingPage,
} from '@/lib/productPreferences'
import {
  WORKSPACE_RANGE_PRESETS,
  dispatchWorkspaceRangePreset,
  isWorkspaceRangePreset,
} from '@/lib/workspacePreferences'

const LANDING_PAGE_LABELS: Record<
  ProductLandingPage,
  { key: string; fallback: string }
> = {
  '/': {
    key: 'productPreferences.landing.options.dashboard',
    fallback: 'Dashboard',
  },
  '/action-center': {
    key: 'productPreferences.landing.options.actionCenter',
    fallback: 'Action Center',
  },
  '/vehicles': {
    key: 'productPreferences.landing.options.vehicles',
    fallback: 'Vehicles',
  },
  '/battery': {
    key: 'productPreferences.landing.options.battery',
    fallback: 'Battery',
  },
  '/charging': {
    key: 'productPreferences.landing.options.charging',
    fallback: 'Charging',
  },
  '/drives': {
    key: 'productPreferences.landing.options.drives',
    fallback: 'Driving',
  },
  '/analytics': {
    key: 'productPreferences.landing.options.analytics',
    fallback: 'Analytics',
  },
}

const RANGE_LABELS: Record<
  (typeof WORKSPACE_RANGE_PRESETS)[number],
  { key: string; fallback: string }
> = {
  live: {
    key: 'workspaceContext.ranges.live',
    fallback: 'Live',
  },
  '24h': {
    key: 'workspaceContext.ranges.24h',
    fallback: 'Last 24 hours',
  },
  today: {
    key: 'workspaceContext.ranges.today',
    fallback: 'Today',
  },
  '7d': {
    key: 'workspaceContext.ranges.7d',
    fallback: 'Last 7 days',
  },
  '30d': {
    key: 'workspaceContext.ranges.30d',
    fallback: 'Last 30 days',
  },
  '90d': {
    key: 'workspaceContext.ranges.90d',
    fallback: 'Last 90 days',
  },
  '1y': {
    key: 'workspaceContext.ranges.1y',
    fallback: 'Last year',
  },
  all: {
    key: 'workspaceContext.ranges.all',
    fallback: 'All time',
  },
}

export function WorkspacePreferencesSettings() {
  const { t } = useTranslation()
  const toast = useToast()
  const { preferences, updatePreferences, resetPreferences } =
    useProductPreferences()
  const { vehicles, setVehicleId } = useSelectedVehicle()

  const landingOptions = useMemo(
    () =>
      PRODUCT_LANDING_PAGES.map((path) => ({
        value: path,
        label: t(
          LANDING_PAGE_LABELS[path].key,
          LANDING_PAGE_LABELS[path].fallback,
        ),
      })),
    [t],
  )

  const rangeOptions = useMemo(
    () =>
      WORKSPACE_RANGE_PRESETS.map((range) => ({
        value: range,
        label: t(RANGE_LABELS[range].key, RANGE_LABELS[range].fallback),
      })),
    [t],
  )

  const vehicleOptions = useMemo(() => {
    const options = [
      {
        value: '',
        label: t(
          'productPreferences.defaultVehicle.lastActive',
          'Use the last active vehicle',
        ),
      },
      ...vehicles.map((vehicle) => ({
        value: String(vehicle.id),
        label:
          vehicle.display_name ||
          t('productPreferences.defaultVehicle.unnamed', 'Vehicle {{id}}', {
            id: vehicle.id,
          }),
      })),
    ]
    if (
      preferences.defaultVehicleId != null &&
      !vehicles.some(
        (vehicle) => vehicle.id === preferences.defaultVehicleId,
      )
    ) {
      options.push({
        value: String(preferences.defaultVehicleId),
        label: t(
          'productPreferences.defaultVehicle.unavailable',
          'Unavailable vehicle {{id}}',
          { id: preferences.defaultVehicleId },
        ),
      })
    }
    return options
  }, [preferences.defaultVehicleId, t, vehicles])

  const handleReset = () => {
    const defaults = resetPreferences()
    dispatchWorkspaceRangePreset(defaults.defaultAnalysisRange)
    toast.info(
      t(
        'productPreferences.reset.done',
        'Workspace preferences restored to defaults.',
      ),
    )
  }

  return (
    <GlassPanel className="p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <IconBox color="cyan" size="md">
            <SlidersHorizontal className="h-5 w-5" aria-hidden />
          </IconBox>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <SectionTitle>
                {t(
                  'productPreferences.title',
                  'Workspace preferences',
                )}
              </SectionTitle>
              <Badge variant="neutral" size="sm">
                {t(
                  'productPreferences.deviceLocal',
                  'This browser',
                )}
              </Badge>
            </div>
            <Text as="p" variant="bodySm" className="mt-1 max-w-3xl">
              {t(
                'productPreferences.description',
                'Choose how TeslaSync prioritizes information when this browser opens. These presentation preferences never change permissions or backend authorization.',
              )}
            </Text>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleReset}
          icon={<RotateCcw className="h-4 w-4" aria-hidden />}
        >
          {t('productPreferences.reset.label', 'Reset defaults')}
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <PersonaSelect
          value={preferences.persona}
          onChange={(persona) => updatePreferences({ persona })}
        />
        <Select
          id="preferred-landing-page"
          label={t(
            'productPreferences.landing.label',
            'Preferred landing page',
          )}
          value={preferences.landingPage}
          onChange={(event) =>
            updatePreferences({
              landingPage: event.target.value as ProductLandingPage,
            })
          }
          options={landingOptions}
          hint={t(
            'productPreferences.landing.hint',
            'Applied only when TeslaSync first opens at the root URL; Dashboard remains available from navigation.',
          )}
          size="auto"
        />
        <Select
          id="default-active-vehicle"
          label={t(
            'productPreferences.defaultVehicle.label',
            'Default active vehicle',
          )}
          value={
            preferences.defaultVehicleId == null
              ? ''
              : String(preferences.defaultVehicleId)
          }
          onChange={(event) => {
            const nextId =
              event.target.value === ''
                ? null
                : Number(event.target.value)
            updatePreferences({ defaultVehicleId: nextId })
            if (nextId != null) setVehicleId(nextId)
          }}
          options={vehicleOptions}
          hint={t(
            'productPreferences.defaultVehicle.hint',
            'Used on a fresh app load. Selecting a vehicle here also applies it to the current global vehicle scope.',
          )}
          size="auto"
        />
        <Select
          id="default-analysis-range"
          label={t(
            'productPreferences.defaultRange.label',
            'Default analysis window',
          )}
          value={preferences.defaultAnalysisRange}
          onChange={(event) => {
            const next = event.target.value
            if (!isWorkspaceRangePreset(next)) return
            updatePreferences({ defaultAnalysisRange: next })
            dispatchWorkspaceRangePreset(next)
          }}
          options={rangeOptions}
          hint={t(
            'productPreferences.defaultRange.hint',
            'Becomes the active global analysis window immediately and is reused when no more specific range is stored.',
          )}
          size="auto"
        />
      </div>

      <div className="mt-6 divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)]">
        <PreferenceToggleRow
          title={t(
            'productPreferences.contextualHelp.label',
            'Contextual inline help',
          )}
          description={t(
            'productPreferences.contextualHelp.hint',
            'Show concise explanations beside advanced settings and analytical metrics. Help remains available from the status line.',
          )}
          checked={preferences.contextualHelp}
          onChange={(contextualHelp) =>
            updatePreferences({ contextualHelp })
          }
        />
        <PreferenceToggleRow
          title={t(
            'productPreferences.releaseHighlights.label',
            'Contextual release highlights',
          )}
          description={t(
            'productPreferences.releaseHighlights.hint',
            'Surface relevant product changes after an update. Full release notes remain available from Help & support.',
          )}
          checked={preferences.releaseHighlights}
          onChange={(releaseHighlights) =>
            updatePreferences({ releaseHighlights })
          }
        />
      </div>
    </GlassPanel>
  )
}

interface PreferenceToggleRowProps {
  title: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}

function PreferenceToggleRow({
  title,
  description,
  checked,
  onChange,
}: PreferenceToggleRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-4">
      <div className="min-w-0">
        <Text as="p" variant="label">
          {title}
        </Text>
        <HelperText className="mt-1 max-w-3xl">{description}</HelperText>
      </div>
      <Toggle
        checked={checked}
        onChange={onChange}
        aria-label={title}
        size="sm"
      />
    </div>
  )
}
