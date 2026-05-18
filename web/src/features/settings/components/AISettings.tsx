/**
 * Phase-50 / 0003 — F2 Settings UI for AI.
 *
 * This is the **only** place in the SPA where AI ever turns on. Per
 * ADR-015 (the AI-Off Contract):
 *   §I1 Default-off: a fresh install never auto-enables AI.
 *   §I7 Per-feature opt-in: each feature toggle starts unchecked,
 *       and re-enabling a previously archived selection requires
 *       explicit confirmation (no silent restore).
 *   §I9 Off-mode redaction: the API key is never echoed back when
 *       `ai_mode === 'off'`; this component therefore never
 *       pre-populates the key field unless mode is local/cloud and
 *       the server returned a value.
 *
 * The Settings page itself MUST always render this component so the
 * user has a stable opt-in surface; we do NOT wrap it in
 * `withAiFeature`.
 *
 * Layout tree:
 *   AISettings.tsx              (this file — mode picker, archive
 *                                preview, save flow)
 *     ├── AIProviderSection      provider/baseURL/model/key/cost
 *     ├── AIFeatureToggleList    per-feature checkboxes generated
 *     │                          from the AI registry
 *     ├── AIRestorePanel         "Restore previous selection?" CTA
 *     └── AIUsageCard            usage placeholder (F3 wires real
 *                                numbers via /ai/usage)
 */

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { HelixMark } from '@/components/branding/HelixMark'
import {
  GlassPanel,
  IconBox,
  Button,
  PanelTitle,
  Subhead,
  HelperText,
  Caption,
} from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { Stack } from '@/components/layout'
import { useSettings } from '@/api/hooks/useSettings'
import { useSaveAiSettings } from '@/api/hooks/useAiSettings'
import { AI_FEATURE_IDS, type AiFeatureId } from '@/ai/features'
import { AIProviderSection, type AIProviderDraft } from './AIProviderSection'
import { AIFeatureToggleList } from './AIFeatureToggleList'
import { AIRestorePanel } from './AIRestorePanel'
import { AIUsageCard } from './AIUsageCard'
import { useAiUsageToday } from '@/api/hooks/useAiUsage'

type AiMode = 'off' | 'local' | 'cloud'

/**
 * Returns true when the supplied mode is one of the canonical
 * three. Defensive against legacy payloads that may arrive as the
 * empty string before F0's migration runs.
 */
function isAiMode(value: unknown): value is AiMode {
  return value === 'off' || value === 'local' || value === 'cloud'
}

/**
 * Pulls a `string` out of a loosely-typed JSON object. Returns the
 * supplied fallback when the key is missing or non-string.
 */
function readProviderString(
  cfg: Record<string, unknown> | undefined,
  key: string,
  fallback: string,
): string {
  if (cfg == null) return fallback
  const v = cfg[key]
  return typeof v === 'string' ? v : fallback
}

/**
 * Drills into the namespaced `ai_provider_config` and returns one
 * provider's typed sub-entry. The canonical shape (per F1 contract
 * in `internal/ai/provider/config.go::ParseProviderConfig`) is:
 *
 *   {
 *     "default":   "ollama",
 *     "ollama":    { "base_url": "...", "model": "...", "api_key": "..." },
 *     "openai":    { "base_url": "...", "model": "...", "api_key": "..." },
 *     ...
 *   }
 *
 * Migration `000208_ai_provider_config_renest.up.sql` converts the
 * legacy flat shape `{ provider, base_url, model }` to this shape on
 * the next API boot, so SPA reads can assume the namespaced form.
 */
function readProviderConfigEntry(
  cfg: Record<string, unknown> | undefined,
  providerName: string,
): Record<string, unknown> | undefined {
  if (cfg == null || providerName === '') return undefined
  const entry = cfg[providerName]
  return entry != null && typeof entry === 'object' && !Array.isArray(entry)
    ? (entry as Record<string, unknown>)
    : undefined
}

/**
 * Strips the four legacy top-level keys that the pre-fix SPA used
 * to write directly onto `ai_provider_config`. Defense-in-depth in
 * case migration 000208 missed a row (e.g. a settings export/import
 * round-trip from a legacy snapshot). The canonical namespaced
 * shape never has these keys at top level — they live under
 * `[providerName]`.
 */
const LEGACY_TOP_LEVEL_KEYS = ['provider', 'base_url', 'model', 'api_key'] as const

function stripLegacyTopLevelKeys(
  cfg: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (cfg == null) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(cfg)) {
    if ((LEGACY_TOP_LEVEL_KEYS as readonly string[]).includes(k)) continue
    out[k] = v
  }
  return out
}

/**
 * Normalises the loaded settings into a per-feature toggle map
 * keyed by every known feature ID. The server only persists IDs
 * the user has touched, so we backfill the rest with `false` to
 * keep the UI rendering deterministically.
 */
function normaliseFeatureMap(
  source: Record<string, boolean> | undefined,
): Record<AiFeatureId, boolean> {
  const out: Record<string, boolean> = {}
  for (const id of AI_FEATURE_IDS) {
    out[id] = Boolean(source?.[id])
  }
  return out as Record<AiFeatureId, boolean>
}

/**
 * Returns true when the archived selection contains at least one
 * `true` entry the user can plausibly want to restore. An empty
 * archive map should NOT trigger the restore panel (per ADR-015
 * §I7 — silent absence is fine, silent restore is not).
 */
function archiveHasRestorableEntries(
  archive: Record<string, boolean> | undefined,
): boolean {
  if (archive == null) return false
  for (const value of Object.values(archive)) {
    if (value) return true
  }
  return false
}

export function AISettings() {
  const { t } = useTranslation('settings')
  const { data: settings, isLoading } = useSettings()
  const saveAi = useSaveAiSettings()

  // ── Local form state ─────────────────────────────────────────────
  // The Settings page is single-document so we mirror the server
  // payload into local state only on first load (or when the cache
  // refetches a different snapshot). Saves push through
  // useSaveAiSettings which deep-merges back into the cache, so the
  // mirror stays in sync without two-way binding.

  const serverMode: AiMode = isAiMode(settings?.ai_mode)
    ? (settings!.ai_mode as AiMode)
    : 'off'

  const [mode, setMode] = useState<AiMode>(serverMode)
  const [features, setFeatures] = useState<Record<AiFeatureId, boolean>>(() =>
    normaliseFeatureMap(settings?.ai_features),
  )
  const [provider, setProvider] = useState<AIProviderDraft>(() => {
    const cfg = settings?.ai_provider_config
    // F1 contract: read the user's "current" provider name from the
    // `default` key (legacy flat shape stored it as `provider` —
    // migration 000208 converts that on the next API boot, so we
    // fall back to it here only for the unmigrated edge case).
    const providerName =
      readProviderString(cfg, 'default', '') ||
      readProviderString(cfg, 'provider', 'ollama')
    const entry = readProviderConfigEntry(cfg, providerName) ?? cfg
    return {
      provider: providerName,
      base_url: readProviderString(entry, 'base_url', ''),
      model: readProviderString(entry, 'model', ''),
      api_key: '',
      cost_cap_cents: settings?.ai_cost_cap_cents ?? 0,
      api_version: readProviderString(entry, 'api_version', ''),
      flavor: readProviderString(entry, 'flavor', ''),
      deployment: readProviderString(entry, 'deployment', ''),
      embedding_model: readProviderString(entry, 'embedding_model', ''),
      embedding_deployment: readProviderString(
        entry,
        'embedding_deployment',
        '',
      ),
    }
  })
  // ADR-015 §I7 — when the user re-enables AI and the server still
  // has an `ai_features_archived` snapshot, surface it as an
  // explicit "Restore previous selection?" prompt. Dismissed
  // (decline) sets this to false for the rest of the session;
  // confirming applies the archive into `features` and immediately
  // saves so the prior state is reified.
  const [restoreDismissed, setRestoreDismissed] = useState(false)

  // Reset local state when the underlying settings document changes
  // identity (e.g. after a save invalidates the query). We compare
  // the AI sub-tree by JSON shape rather than reference because
  // TanStack Query re-uses the same object across selectors.
  const aiSnapshot = useMemo(() => {
    if (settings == null) return null
    return JSON.stringify({
      mode: settings.ai_mode,
      features: settings.ai_features ?? {},
      provider: settings.ai_provider_config ?? null,
      cap: settings.ai_cost_cap_cents ?? 0,
    })
  }, [settings])

  useEffect(() => {
    if (settings == null) return
    setMode(serverMode)
    setFeatures(normaliseFeatureMap(settings.ai_features))
    const cfg = settings.ai_provider_config
    const providerName =
      readProviderString(cfg, 'default', '') ||
      readProviderString(cfg, 'provider', 'ollama')
    const entry = readProviderConfigEntry(cfg, providerName) ?? cfg
    setProvider({
      provider: providerName,
      base_url: readProviderString(entry, 'base_url', ''),
      model: readProviderString(entry, 'model', ''),
      // ADR-015 §I9 — never pre-populate the key when the server's
      // mode is off. The server already redacts in that case but we
      // double-guard here to make the invariant local-state safe.
      api_key:
        serverMode === 'off'
          ? ''
          : readProviderString(entry, 'api_key', ''),
      cost_cap_cents: settings.ai_cost_cap_cents ?? 0,
      api_version: readProviderString(entry, 'api_version', ''),
      flavor: readProviderString(entry, 'flavor', ''),
      deployment: readProviderString(entry, 'deployment', ''),
      embedding_model: readProviderString(entry, 'embedding_model', ''),
      embedding_deployment: readProviderString(
        entry,
        'embedding_deployment',
        '',
      ),
    })
    setRestoreDismissed(false)
    // Intentionally depend on the JSON snapshot, not the object
    // reference, to avoid infinite re-renders.
  }, [aiSnapshot])

  // ── Mode change ──────────────────────────────────────────────────
  // Switching to OFF clears every per-feature toggle in local state
  // (the visual "everything is off now" confirmation). The backend
  // performs the same clearing on PUT and additionally archives the
  // prior selection into `ai_features_archived`. We do NOT
  // auto-save on a mode flip — the user reviews the new state and
  // explicitly clicks Save (or Discard).

  function handleModeChange(next: AiMode) {
    if (next === mode) return
    setMode(next)
    if (next === 'off') {
      // Clear in-flight selections so the UI matches the post-save
      // server state. The backend re-clears too — this is purely
      // visual feedback.
      setFeatures(normaliseFeatureMap(undefined))
    }
  }

  // ── Save handler ─────────────────────────────────────────────────
  // Builds the AI patch the server expects. When mode is 'off' we
  // intentionally omit `ai_features` and `ai_provider_config` from
  // the patch so the backend's redaction path runs unchanged: the
  // settings handler clears + archives based on the mode flip
  // alone, and we don't want to leak the in-memory key back over
  // the wire.

  function handleSave() {
    if (mode === 'off') {
      saveAi.mutate({
        ai_mode: 'off',
        // Send empty maps explicitly so partial-merge in the hook
        // overwrites whatever was there. The backend's
        // applyAIArchiveOnModeFlip helper handles the archive.
        ai_features: {},
      })
      return
    }
    saveAi.mutate({
      ai_mode: mode,
      ai_features: features,
      // F1 contract: namespaced shape. The `default` key names the
      // currently-selected provider; each provider has its own
      // sub-object so users can pre-configure multiple providers and
      // swap between them without losing prior credentials. We
      // strip any legacy top-level keys (`provider`/`base_url`/etc.)
      // that a pre-fix snapshot may still carry — migration 000208
      // handles this at rest but defense-in-depth keeps the wire
      // format clean across export/import round-trips.
      //
      // Merge (not replace) the per-provider sub-object: a partial
      // form (e.g. one without the api_version input visible)
      // must NOT clobber provider-specific keys the user set
      // previously. The form state owns api_version / flavor /
      // deployment / embedding_* explicitly so they round-trip on
      // every save.
      ai_provider_config: {
        ...stripLegacyTopLevelKeys(settings?.ai_provider_config),
        default: provider.provider,
        [provider.provider]: {
          ...(readProviderConfigEntry(
            settings?.ai_provider_config,
            provider.provider,
          ) ?? {}),
          base_url: provider.base_url,
          model: provider.model,
          // Optional / provider-specific fields are only emitted
          // when non-empty so a config that doesn't use them
          // doesn't grow noise keys.
          ...(provider.api_version.trim() === ''
            ? {}
            : { api_version: provider.api_version }),
          ...(provider.flavor.trim() === ''
            ? {}
            : { flavor: provider.flavor }),
          ...(provider.deployment.trim() === ''
            ? {}
            : { deployment: provider.deployment }),
          ...(provider.embedding_model.trim() === ''
            ? {}
            : { embedding_model: provider.embedding_model }),
          ...(provider.embedding_deployment.trim() === ''
            ? {}
            : { embedding_deployment: provider.embedding_deployment }),
          // Only forward a non-empty key; an empty string would clobber
          // a previously-saved key (the server treats empty as
          // explicit clear).
          ...(provider.api_key.trim() === ''
            ? {}
            : { api_key: provider.api_key }),
        },
      },
      ai_cost_cap_cents: provider.cost_cap_cents,
    })
  }

  function handleFeatureToggle(id: AiFeatureId, value: boolean) {
    setFeatures((prev) => ({ ...prev, [id]: value }))
  }

  /**
   * Wraps the AIProviderSection `onChange` so a provider-name switch
   * pulls the new provider's stored base_url / model from the
   * namespaced config (multi-provider preservation per F1 contract).
   * Non-provider edits flow through unchanged.
   *
   * The api_key is intentionally NOT pre-filled on switch: the server
   * redacts on read (ADR-015 §I9) and the UX semantics treat an
   * empty key field as "leave existing key unchanged". Showing a key
   * we can't actually see would be misleading.
   */
  const handleProviderChange = useCallback(
    (next: AIProviderDraft) => {
      if (next.provider === provider.provider) {
        setProvider(next)
        return
      }
      const newEntry = readProviderConfigEntry(
        settings?.ai_provider_config,
        next.provider,
      )
      setProvider({
        provider: next.provider,
        base_url: readProviderString(newEntry, 'base_url', ''),
        model: readProviderString(newEntry, 'model', ''),
        api_key: '',
        cost_cap_cents: next.cost_cap_cents,
        api_version: readProviderString(newEntry, 'api_version', ''),
        flavor: readProviderString(newEntry, 'flavor', ''),
        deployment: readProviderString(newEntry, 'deployment', ''),
        embedding_model: readProviderString(newEntry, 'embedding_model', ''),
        embedding_deployment: readProviderString(
          newEntry,
          'embedding_deployment',
          '',
        ),
      })
    },
    [provider.provider, settings?.ai_provider_config],
  )

  function handleRestoreConfirm() {
    if (settings?.ai_features_archived == null) return
    const restored = normaliseFeatureMap(settings.ai_features_archived)
    setFeatures(restored)
    setRestoreDismissed(true)
    // Persist immediately so the archive snapshot itself is cleared
    // server-side on the next round-trip.
    saveAi.mutate({
      ai_mode: mode,
      ai_features: restored,
    })
  }

  function handleRestoreDecline() {
    setRestoreDismissed(true)
  }

  // ── Derived state ────────────────────────────────────────────────

  const showProviderSection = mode !== 'off'
  const showRestorePanel =
    mode !== 'off' &&
    !restoreDismissed &&
    archiveHasRestorableEntries(settings?.ai_features_archived)
  const isCloud = mode === 'cloud'

  return (
    <FadeIn delay={0.16}>
      <GlassPanel
        className="p-5 space-y-5"
        data-testid="ai-settings-panel"
        data-ai-mode={mode}
      >
        <div className="flex items-start gap-3">
          <IconBox color="purple">
            <HelixMark className="h-5 w-5" aria-hidden="true" />
          </IconBox>
          <div className="flex-1 min-w-0">
            <PanelTitle>{t('ai.settings.title', 'Helix')}</PanelTitle>
            <Subhead>
              {t(
                'ai.settings.subtitle',
                'Optional. Helix is off by default; nothing is enabled until you opt in here.',
              )}
            </Subhead>
          </div>
        </div>

        <fieldset
          className="space-y-2"
          aria-label={t('ai.settings.modeLegend', 'Helix mode')}
        >
          <Caption>
            {t('ai.settings.modeLegend', 'Helix mode')}
          </Caption>
          <div
            role="radiogroup"
            aria-label={t('ai.settings.modeLegend', 'Helix mode')}
            className="grid grid-cols-1 sm:grid-cols-3 gap-2"
          >
            <ModeRadio
              id="ai-mode-off"
              value="off"
              checked={mode === 'off'}
              onChange={handleModeChange}
              label={t('ai.settings.mode.off', 'Off (default)')}
              description={t(
                'ai.settings.mode.offHint',
                'No Helix features. The app works fully without them.',
              )}
            />
            <ModeRadio
              id="ai-mode-local"
              value="local"
              checked={mode === 'local'}
              onChange={handleModeChange}
              label={t('ai.settings.mode.local', 'Local-only')}
              description={t(
                'ai.settings.mode.localHint',
                'Use a private model on your network (e.g. Ollama). No data leaves your install.',
              )}
            />
            <ModeRadio
              id="ai-mode-cloud"
              value="cloud"
              checked={mode === 'cloud'}
              onChange={handleModeChange}
              label={t('ai.settings.mode.cloud', 'Cloud')}
              description={t(
                'ai.settings.mode.cloudHint',
                'Use a cloud provider (e.g. OpenAI). Requires an API key.',
              )}
            />
          </div>
          {mode === 'off' && (
            <HelperText>
              {t(
                'ai.settings.bannerOff',
                'Helix is off. Your app works fully without it. Enable a mode above to opt in.',
              )}
            </HelperText>
          )}
        </fieldset>

        {showProviderSection && (
          <AIProviderSection
            value={provider}
            isCloud={isCloud}
            onChange={handleProviderChange}
          />
        )}

        {showRestorePanel && (
          <AIRestorePanel
            archived={settings?.ai_features_archived ?? {}}
            onConfirm={handleRestoreConfirm}
            onDecline={handleRestoreDecline}
          />
        )}

        {showProviderSection && (
          <AIFeatureToggleList
            values={features}
            onToggle={handleFeatureToggle}
          />
        )}

        {showProviderSection && <AIUsageCard />}

        {/*
          Phase-50 / 0010 — F9 cost-cap spend bar. Lives only in cloud
          mode (local providers don't bill per token) and only when
          the user has set a non-zero cap. Reads today's spend from
          the same /ai/usage/today endpoint as AIUsageCard so the
          numbers match exactly. The bar is a passive read — it does
          not gate saving the cap.
        */}
        {isCloud && provider.cost_cap_cents > 0 && (
          <AICostCapSpendBar capCents={provider.cost_cap_cents} />
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
          <Button
            type="button"
            variant="primary"
            onClick={handleSave}
            disabled={isLoading || saveAi.isPending}
            data-testid="ai-settings-save"
          >
            {saveAi.isPending
              ? t('ai.settings.saving', 'Saving…')
              : t('ai.settings.save', 'Save Helix settings')}
          </Button>
        </div>
      </GlassPanel>
    </FadeIn>
  )
}

/**
 * Mode radio card — keeps AISettings.tsx readable. Each card is a
 * styled label wrapping a real `<input type="radio">` so keyboard
 * navigation (arrow keys within the radiogroup) works natively.
 */
function ModeRadio(props: {
  id: string
  value: AiMode
  checked: boolean
  onChange: (value: AiMode) => void
  label: string
  description: string
}) {
  const { id, value, checked, onChange, label, description } = props
  return (
    <label
      htmlFor={id}
      aria-label={label}
      className={
        'flex flex-col gap-1 rounded-md border px-3 py-2 cursor-pointer transition-colors ' +
        (checked
          ? 'border-purple-400/50 bg-purple-500/10'
          : 'border-[var(--border-subtle)] hover:border-[var(--border-strong)]')
      }
    >
      <div className="flex items-center gap-2">
        <input
          type="radio"
          id={id}
          name="ai-mode"
          value={value}
          checked={checked}
          onChange={() => onChange(value)}
          className="h-4 w-4"
          data-testid={id}
        />
        <span className="text-sm font-medium text-[var(--text-primary)]">
          {label}
        </span>
      </div>
      <Stack gap={1}>
        <span className="text-xs text-[var(--text-muted)]">{description}</span>
      </Stack>
    </label>
  )
}

/**
 * AICostCapSpendBar — Phase-50 / 0010 (F9) live "today" spend bar.
 *
 * Shows the user how close they are to their daily $ cap. The
 * cost-cap decorator on the backend rejects new calls once the cap
 * is reached; this bar lets the user see it coming. Visible only in
 * cloud mode AND when capCents > 0 (the parent component gates this).
 *
 * Color rules:
 *   pct < 80   → cyan-300  (informational)
 *   pct ≥ 80   → amber-300 (warn — same threshold as the backend's
 *                            BannerLevel:"warn")
 *   pct ≥ 100  → rose-300  (critical — calls are now being rejected)
 *
 * Reads from /ai/usage/today via the existing hook so the value
 * matches what AIUsageCard shows. When the API returns no rows yet,
 * cost_micro_cents is 0 and the bar renders empty.
 */
function AICostCapSpendBar({ capCents }: { capCents: number }) {
  const { t } = useTranslation('settings')
  const { data, isLoading } = useAiUsageToday()

  // Backend stores spend in micro-cents (1e-4 cent). Cap is supplied
  // in whole cents. Convert both to dollars for display.
  const todayMicroCents = data?.cost_micro_cents ?? 0
  const capMicroCents = capCents * 10_000 // 1 cent = 10_000 micro-cents
  const pct = capMicroCents > 0 ? Math.min(100, (todayMicroCents / capMicroCents) * 100) : 0
  const todayDollars = todayMicroCents / 1_000_000
  const capDollars = capCents / 100

  const level: 'ok' | 'warn' | 'critical' =
    pct >= 100 ? 'critical' : pct >= 80 ? 'warn' : 'ok'

  const fillClass =
    level === 'critical'
      ? 'bg-rose-300'
      : level === 'warn'
        ? 'bg-amber-300'
        : 'bg-cyan-300'
  const textClass =
    level === 'critical'
      ? 'text-rose-300'
      : level === 'warn'
        ? 'text-amber-300'
        : 'text-cyan-300'

  return (
    <div
      className="space-y-2 rounded-lg border border-[var(--border-subtle)] p-3"
      data-testid="ai-cost-cap-spend-bar"
      data-spend-level={level}
    >
      <div className="flex items-baseline justify-between gap-2">
        <Caption>
          {t('ai.settings.costCap.todayTitle', 'Today’s Helix spend')}
        </Caption>
        <span className={`text-xs font-medium ${textClass}`}>
          {isLoading
            ? t('ai.settings.costCap.loading', 'Loading…')
            : t('ai.settings.costCap.amount', '${{spent}} / ${{cap}}', {
                spent: todayDollars.toFixed(2),
                cap: capDollars.toFixed(2),
                defaultValue: `$${todayDollars.toFixed(2)} / $${capDollars.toFixed(2)}`,
              })}
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={t('ai.settings.costCap.barLabel', 'Helix cost cap usage')}
      >
        <div
          className={`h-full transition-all duration-500 ${fillClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {level === 'critical' && (
        <HelperText>
          {t(
            'ai.settings.costCap.criticalHint',
            'Cap reached — new Helix calls will be rejected until the cap resets at UTC midnight or you raise it.',
          )}
        </HelperText>
      )}
      {level === 'warn' && (
        <HelperText>
          {t(
            'ai.settings.costCap.warnHint',
            'You are nearing today’s cap. Calls will pause once you reach it.',
          )}
        </HelperText>
      )}
    </div>
  )
}
