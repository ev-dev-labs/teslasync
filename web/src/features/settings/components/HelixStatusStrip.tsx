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
import { MetricCard } from '@/components/data-display'
import { type NeonColor } from '@/lib/tokens'
import { useAiUsageToday } from '@/api/hooks/useAiUsage'
import { useFormatting } from '@/hooks/useFormatting'

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

function microCentsToDollars(mc: number | null | undefined): number {
  if (mc == null || !Number.isFinite(mc)) return 0
  return mc / 1_000_000
}

interface Props {
  mode: AiMode
  enabledCount: number
  providerName: string
}

export function HelixStatusStrip({ mode, enabledCount, providerName }: Props) {
  const { t } = useTranslation('settings')
  const { formatCurrency } = useFormatting()
  // Skip the fetch entirely when Helix is off — the endpoint 403s and the
  // spend tile shows an em-dash regardless.
  const { data } = useAiUsageToday({ enabled: mode !== 'off' })

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
  const featureCount = Number.isFinite(enabledCount) ? enabledCount : 0

  const spendValue =
    mode === 'off' || data == null
      ? PLACEHOLDER
      : formatCurrency(microCentsToDollars(data.cost_micro_cents))

  return (
    <section
      aria-label={t('helix.status.label', 'Helix status')}
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4"
      data-testid="helix-status-strip"
    >
      <MetricCard
        label={t('helix.status.mode', 'Status')}
        value={status.value}
        icon={status.icon}
        color={status.color}
      />
      <MetricCard
        label={t('helix.status.features', 'Features enabled')}
        value={featureCount}
        icon={<Sparkles className="h-5 w-5" aria-hidden="true" />}
        color="purple"
      />
      <MetricCard
        label={t('helix.status.provider', 'Provider')}
        value={providerValue}
        icon={<Cpu className="h-5 w-5" aria-hidden="true" />}
        color="amber"
      />
      <MetricCard
        label={t('helix.status.spendToday', 'Spend today')}
        value={spendValue}
        icon={<Wallet className="h-5 w-5" aria-hidden="true" />}
        color="cyan"
      />
    </section>
  )
}
