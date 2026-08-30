import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Select } from '@/components/ui'
import {
  PRODUCT_PERSONAS,
  type ProductPersona,
} from '@/lib/productPreferences'

export interface PersonaSelectProps {
  value: ProductPersona
  onChange: (persona: ProductPersona) => void
  id?: string
  label?: string
}

const PERSONA_LABELS: Record<
  ProductPersona,
  { key: string; fallback: string }
> = {
  owner: {
    key: 'productPreferences.personas.owner.label',
    fallback: 'Owner',
  },
  fleet_operator: {
    key: 'productPreferences.personas.fleetOperator.label',
    fallback: 'Fleet operator',
  },
  analyst: {
    key: 'productPreferences.personas.analyst.label',
    fallback: 'Analyst',
  },
  administrator: {
    key: 'productPreferences.personas.administrator.label',
    fallback: 'Administrator',
  },
}

const PERSONA_DESCRIPTIONS: Record<
  ProductPersona,
  { key: string; fallback: string }
> = {
  owner: {
    key: 'productPreferences.personas.owner.description',
    fallback:
      'Prioritizes daily vehicle status, charging, battery health, and ownership costs.',
  },
  fleet_operator: {
    key: 'productPreferences.personas.fleetOperator.description',
    fallback:
      'Prioritizes fleet readiness, alerts, automations, commands, and service operations.',
  },
  analyst: {
    key: 'productPreferences.personas.analyst.description',
    fallback:
      'Prioritizes reports, trends, efficiency, driving evidence, and data exports.',
  },
  administrator: {
    key: 'productPreferences.personas.administrator.description',
    fallback:
      'Prioritizes system health, diagnostics, integrations, data controls, and settings.',
  },
}

export function PersonaSelect({
  value,
  onChange,
  id = 'product-persona',
  label,
}: PersonaSelectProps) {
  const { t } = useTranslation()
  const options = useMemo(
    () =>
      PRODUCT_PERSONAS.map((persona) => ({
        value: persona,
        label: t(
          PERSONA_LABELS[persona].key,
          PERSONA_LABELS[persona].fallback,
        ),
      })),
    [t],
  )
  const description = PERSONA_DESCRIPTIONS[value]

  return (
    <Select
      id={id}
      label={
        label ??
        t('productPreferences.persona.label', 'Workspace profile')
      }
      value={value}
      onChange={(event) => onChange(event.target.value as ProductPersona)}
      options={options}
      hint={t(description.key, description.fallback)}
      size="auto"
    />
  )
}
