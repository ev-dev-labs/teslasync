/**
 * HelixStatusStrip — at-a-glance KPI band for the Helix page.
 *
 * Summarises the current Helix configuration into a responsive metric
 * grid that fills the page width: mode, enabled-feature count, active
 * provider, and today's spend (from `/ai/usage/today`). Every tile is
 * null-safe and degrades to an em-dash when Helix is off or data has
 * not loaded.
 */

import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Power, Server, Cloud, Sparkles, Cpu, Wallet } from 'lucide-react'
import type { StatMetric } from '@/components/data-display'
import { SettingsSummaryBrief } from './operationalbrief-all/SettingsSummaryBrief'
import { type NeonColor } from '@/lib/tokens'
import { useAiUsageToday } from '@/api/hooks/useAiUsage'
import { useFormatting } from '@/hooks/useFormatting'
import { useDataState } from '@/hooks/useDataState'

type AiMode = 'off' | 'local' | 'cloud'

const PLACEHOLDER = '—'

const PROVIDER_LABELS: Record<string, string> = {
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  'llama-cpp': 'llama.cpp',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  azure: 'Azure AI',
  google: 'Google',
}

interface Props {
  mode: AiMode
  enabledCount: number
  providerName: string
  settingsLoading?: boolean
  settingsUnavailable?: boolean
  settingsRetained?: boolean
}

export function HelixStatusStrip({ mode, enabledCount, providerName,
  settingsLoading = false, settingsUnavailable = false, settingsRetained = false }: Props) {
  const { t } = useTranslation('settings')
  const { formatCurrency } = useFormatting()
  // Skip the fetch entirely when Helix is off — the endpoint 403s and the
  // spend tile shows an em-dash regardless.
  const query = useAiUsageToday({ enabled: mode !== 'off' })
  const usageState = useDataState(query, { provenance: 'historical' })
  const data = mode === 'off' ? undefined : usageState.data

  const status = useMemo<{ value: string; color: NeonColor; icon: ReactNode }>(() => {
    if (mode === 'local') {
      return {
        value: t('ai.settings.mode.local', 'Local-only'),
        color: 'green',
        icon: <Server className="h-5 w-5" aria-hidden="true" />,
      }
    }
    if (mode === 'cloud') {
      return {
        value: t('ai.settings.mode.cloud', 'Cloud'),
        color: 'cyan',
        icon: <Cloud className="h-5 w-5" aria-hidden="true" />,
      }
    }
    return {
      value: t('ai.settings.mode.off', 'Off (default)'),
      color: 'blue',
      icon: <Power className="h-5 w-5" aria-hidden="true" />,
    }
  }, [mode, t])

  // Normalise the provider key at the display boundary: trimming stray
  // whitespace lets a padded key still resolve against PROVIDER_LABELS and
  // degrades a whitespace-only value to the em-dash instead of rendering an
  // empty-looking tile.
  const providerKey = providerName.trim()
  const providerValue =
    mode === 'off' || providerKey === ''
      ? PLACEHOLDER
      : (PROVIDER_LABELS[providerKey] ?? providerKey)

  // Guard the count so a non-finite value never reaches the tile as a
  // literal "NaN".
  const unavailable = settingsLoading || settingsUnavailable
  const sourceCost = data?.cost_micro_cents
  const metrics: readonly StatMetric[] = [
    { metricId: 'status', occurrenceId: 'helix-mode', rawValue: unavailable ? null : status.value,
      label: t('helix.status.mode', 'Status'), context: status.icon },
    { metricId: 'count', occurrenceId: 'helix-features', rawValue: unavailable ? null : enabledCount,
      label: t('helix.status.features', 'Features enabled'),
      context: <Sparkles className="h-5 w-5" aria-hidden="true" /> },
    { metricId: 'text', occurrenceId: 'helix-provider', rawValue: unavailable || providerValue === PLACEHOLDER ? null : providerValue,
      label: t('helix.status.provider', 'Provider'), context: <Cpu className="h-5 w-5" aria-hidden="true" /> },
    { metricId: 'currency', occurrenceId: 'helix-spend', rawValue: sourceCost == null ? null : sourceCost / 1_000_000,
      label: t('helix.status.spendToday', 'Spend today'),
      display: { formatter: raw => ({ value: formatCurrency(raw), unit: '' }) },
      missingReason: mode === 'off' ? t('ai.settings.usage.off', 'Helix is off. Enable it and make a call to see usage.')
        : usageState.status === 'initial' ? t('ai.settings.usage.loading', 'Loading today’s usage…') : undefined,
      context: <><Wallet className="h-5 w-5" aria-hidden="true" />{t('ai.settings.usage.utc', 'Today · UTC')}</> },
  ]

  return (
    <section
      aria-label={t('helix.status.label', 'Helix status')}
      data-testid="helix-status-strip"
    >
      <SettingsSummaryBrief title={t('helix.brief.title', 'Helix configuration and spend')}
        description={t('helix.brief.description', 'Features and provider reflect the current draft; mode respects the saved off-mode guard. Spend is independently audited usage. Editing a draft does not save it.')}
        source={t('helix.brief.source', 'Configuration draft and audited usage')}
        scope={t('helix.brief.scope', 'Current draft · spend today in UTC; these sources do not share a historical range')}
        metrics={metrics} loading={settingsLoading}
        unavailable={settingsUnavailable || (mode !== 'off' && !data)}
        retained={settingsRetained || (mode !== 'off' && usageState.status === 'stale')}
        testId="helix-summary" />
    </section>
  )
}
