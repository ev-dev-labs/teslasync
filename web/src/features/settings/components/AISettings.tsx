/**
 * Settings UI for AI.
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

import { useEffect, useId, useMemo, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Power, Server, Cloud } from 'lucide-react'
import { GlassPanel, Button, SectionTitle, RadioCard } from '@/components/ui'
import { InlineCallout } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { useSettings } from '@/api/hooks/useSettings'
import { useSaveAiSettings } from '@/api/hooks/useAiSettings'
import { AI_FEATURE_IDS, type AiFeatureId } from '@/ai/features'
import { AIProviderSection, type AIProviderDraft } from './AIProviderSection'
import { AIFeatureToggleList } from './AIFeatureToggleList'
import { AIRestorePanel } from './AIRestorePanel'
import { AIUsageCard } from './AIUsageCard'
import { AICostCapSpendBar } from './AICostCapSpendBar'
import { HelixStatusStrip } from './HelixStatusStrip'

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
  const enabledCount = useMemo(
    () => Object.values(features).filter(Boolean).length,
    [features],
  )
  const modeTitleId = useId()

  return (
    <section
      className="space-y-4 sm:space-y-5"
      data-testid="ai-settings-panel"
      data-ai-mode={mode}
      aria-label={t('ai.settings.title', 'Helix')}
    >
      {/* Status band — at-a-glance summary, full-width metric grid. */}
      <FadeIn>
        <HelixStatusStrip
          mode={mode}
          enabledCount={enabledCount}
          providerName={provider.provider}
        />
      </FadeIn>

      {/* Mode picker — the primary decision (hero control). */}
      <FadeIn delay={0.05}>
        <GlassPanel className="space-y-3 p-4 sm:p-5">
          <SectionTitle id={modeTitleId}>
            {t('ai.settings.modeLegend', 'Helix mode')}
          </SectionTitle>
          <div
            role="radiogroup"
            aria-labelledby={modeTitleId}
            className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          >
            <RadioCard
              name="ai-mode"
              value="off"
              accent="blue"
              checked={mode === 'off'}
              onChange={(v) => {
                if (isAiMode(v)) handleModeChange(v)
              }}
              icon={<Power className="h-4 w-4" aria-hidden="true" />}
              label={t('ai.settings.mode.off', 'Off (default)')}
              description={t(
                'ai.settings.mode.offHint',
                'No Helix features. The app works fully without them.',
              )}
              aria-label={t('ai.settings.mode.off', 'Off (default)')}
              data-testid="ai-mode-off"
            />
            <RadioCard
              name="ai-mode"
              value="local"
              accent="green"
              checked={mode === 'local'}
              onChange={(v) => {
                if (isAiMode(v)) handleModeChange(v)
              }}
              icon={<Server className="h-4 w-4" aria-hidden="true" />}
              label={t('ai.settings.mode.local', 'Local-only')}
              description={t(
                'ai.settings.mode.localHint',
                'Use a private model on your network (e.g. Ollama). No data leaves your install.',
              )}
              aria-label={t('ai.settings.mode.local', 'Local-only')}
              data-testid="ai-mode-local"
            />
            <RadioCard
              name="ai-mode"
              value="cloud"
              accent="cyan"
              checked={mode === 'cloud'}
              onChange={(v) => {
                if (isAiMode(v)) handleModeChange(v)
              }}
              icon={<Cloud className="h-4 w-4" aria-hidden="true" />}
              label={t('ai.settings.mode.cloud', 'Cloud')}
              description={t(
                'ai.settings.mode.cloudHint',
                'Use a cloud provider (e.g. OpenAI). Requires an API key.',
              )}
              aria-label={t('ai.settings.mode.cloud', 'Cloud')}
              data-testid="ai-mode-cloud"
            />
          </div>
          {mode === 'off' && (
            <InlineCallout
              variant="info"
              icon={<Power className="h-4 w-4" aria-hidden="true" />}
            >
              {t(
                'ai.settings.bannerOff',
                'Helix is off. Your app works fully without it. Enable a mode above to opt in.',
              )}
            </InlineCallout>
          )}
        </GlassPanel>
      </FadeIn>

      {/* Restore prompt — explicit re-enable of an archived selection. */}
      {showRestorePanel && (
        <FadeIn delay={0.1}>
          <AIRestorePanel
            archived={settings?.ai_features_archived ?? {}}
            onConfirm={handleRestoreConfirm}
            onDecline={handleRestoreDecline}
          />
        </FadeIn>
      )}

      {/* Configuration bento: provider form is the hero (spans two columns
          on wide screens); usage + cost-cap sit in the context rail. */}
      {showProviderSection && (
        <FadeIn delay={0.12}>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <AIProviderSection
                value={provider}
                isCloud={isCloud}
                onChange={handleProviderChange}
              />
            </div>
            <div className="space-y-4">
              <AIUsageCard />
              {/*
                Cost-cap spend bar. Cloud-only (local providers don't bill
                per token) and only when a non-zero cap is set. Reads
                today's spend from the same /ai/usage/today endpoint as
                AIUsageCard so the numbers match. Passive read — it does
                not gate saving the cap.
              */}
              {isCloud && provider.cost_cap_cents > 0 && (
                <AICostCapSpendBar capCents={provider.cost_cap_cents} />
              )}
            </div>
          </div>
        </FadeIn>
      )}

      {/* Feature opt-ins — full-width, flows into columns on wide screens. */}
      {showProviderSection && (
        <FadeIn delay={0.16}>
          <AIFeatureToggleList values={features} onToggle={handleFeatureToggle} />
        </FadeIn>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-4">
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
    </section>
  )
}
