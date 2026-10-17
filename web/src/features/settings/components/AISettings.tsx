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

import { useEffect, useId, useMemo, useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Power, Server, Cloud } from 'lucide-react'
import { GlassPanel, Button, SectionTitle, RadioCard } from '@/components/ui'
import { DataStateNotice, InlineCallout, QueryError } from '@/components/feedback'
import { deriveDataState } from '@/api/dataState'
import { FadeIn } from '@/components/motion'
import { useSettings } from '@/api/hooks/useSettings'
import { useSaveAiSettings } from '@/api/hooks/useAiSettings'
import { AI_FEATURE_IDS, type AiFeatureId } from '@/ai/features'
import { AIProviderSection, type AIProviderDraft } from './AIProviderSection'
import { AIFeatureToggleList } from './AIFeatureToggleList'
import { AIRestorePanel } from './AIRestorePanel'
import { AIUsageCard } from './AIUsageCard'
import { AICostCapSpendBar } from './AICostCapSpendBar'
import { AIFeatureSpendPanel } from './AIFeatureSpendPanel'
import { HelixStatusStrip } from './HelixStatusStrip'

type AiMode = 'off' | 'local' | 'cloud'

const MODE_PROVIDERS = {
  local: ['ollama', 'lmstudio', 'llama-cpp'],
  cloud: ['openai', 'anthropic', 'azure', 'google'],
} as const

function providerSupportsMode(providerName: string, mode: AiMode): boolean {
  return mode === 'off' || MODE_PROVIDERS[mode].some(name => name === providerName)
}

function providerDraftEntry(draft: AIProviderDraft): Record<string, unknown> {
  return {
    base_url: draft.base_url,
    model: draft.model,
    ...(draft.provider === 'azure' ? { api_protocol: draft.api_protocol || 'auto' } : {}),
    ...(draft.provider === 'azure' || draft.embedding_model.trim() !== ''
      ? { embedding_model: draft.embedding_model.trim() } : {}),
    ...(draft.api_key.trim() === '' ? {} : { api_key: draft.api_key }),
  }
}

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
  const value = entry != null && typeof entry === 'object' && !Array.isArray(entry)
    ? (entry as Record<string, unknown>)
    : undefined
  if (providerName !== 'azure' || value == null) return value
  // One-time config migration: move the effective identities into visible
  // fields and discard obsolete controls before either validation or saving.
  const result = { ...value }
  const previousDeployment = readProviderString(value, 'deployment', '')
  const previousEmbedding = readProviderString(value, 'embedding_deployment', '')
  if (!value.api_protocol && value.flavor !== 'foundry' && previousDeployment !== '') {
    result.model = previousDeployment
  }
  if (!value.api_protocol && previousEmbedding !== '') result.embedding_model = previousEmbedding
  for (const key of ['flavor', 'api_version', 'deployment', 'embedding_deployment']) {
    delete result[key]
  }
  return result
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
    out[k] = k === 'azure' ? readProviderConfigEntry(cfg, k) : v
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
  const settingsQuery = useSettings()
  const settingsState = deriveDataState(settingsQuery)
  const { data: settings } = settingsQuery
  const saveAi = useSaveAiSettings()
  const draftDirty = useRef(false)
  const providerDrafts = useRef<Record<string, AIProviderDraft>>({})
  const [restorePending, setRestorePending] = useState(false)

  // ── Local form state ─────────────────────────────────────────────
  // The Settings page is single-document so we mirror the server
  // payload into local state on first load or a changed snapshot,
  // unless an editable draft needs to survive a background refresh.

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
      api_protocol: readProviderString(entry, 'api_protocol', 'auto'),
      embedding_model: readProviderString(entry, 'embedding_model', ''),
    }
  })
  // ADR-015 §I7 — when the user re-enables AI and the server still
  // has an `ai_features_archived` snapshot, surface it as an
  // explicit "Restore previous selection?" prompt. Dismissed
  // (decline) sets this to false for the rest of the session;
  // confirming applies the archive into `features` and immediately
  // saves; only a successful write dismisses the confirmation.
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
    if (settings == null || draftDirty.current) return
    providerDrafts.current = {}
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
      api_protocol: readProviderString(entry, 'api_protocol', 'auto'),
      embedding_model: readProviderString(entry, 'embedding_model', ''),
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
    draftDirty.current = true
    setMode(next)
    if (!providerSupportsMode(provider.provider, next) && next !== 'off') {
      const compatibleNames = MODE_PROVIDERS[next]
      const providerName = compatibleNames.find(name => providerDrafts.current[name] != null)
        ?? compatibleNames.find(name => readProviderConfigEntry(settings?.ai_provider_config, name) != null)
        ?? compatibleNames[0]
      handleProviderChange({ ...provider, provider: providerName })
    }
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
    if (!settingsState.hasData || saveAi.isPending || restorePending || !providerSupportsMode(provider.provider, mode)) return
    if (mode === 'off') {
      saveAi.mutate({
        ai_mode: 'off',
        // Send empty maps explicitly so partial-merge in the hook
        // overwrites whatever was there. The backend's
        // applyAIArchiveOnModeFlip helper handles the archive.
        ai_features: {},
      }, { onSuccess: () => { draftDirty.current = false } })
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
      // form must not clobber other providers or their saved credentials.
      // readProviderConfigEntry removes obsolete Azure controls.
      ai_provider_config: buildProviderConfig(),
      ai_cost_cap_cents: provider.cost_cap_cents,
    }, { onSuccess: () => { draftDirty.current = false } })
  }

  function buildProviderConfig(): Record<string, unknown> {
    return {
      ...stripLegacyTopLevelKeys(settings?.ai_provider_config),
      ...Object.fromEntries(Object.entries(providerDrafts.current).map(([name, draft]) => [
        name,
        {
          ...readProviderConfigEntry(settings?.ai_provider_config, name),
          ...providerDraftEntry(draft),
        },
      ])),
      default: provider.provider,
      [provider.provider]: {
        ...(readProviderConfigEntry(settings?.ai_provider_config, provider.provider) ?? {}),
        ...providerDraftEntry(provider),
      },
    }
  }

  function handleFeatureToggle(id: AiFeatureId, value: boolean) {
    draftDirty.current = true
    setFeatures((prev) => ({ ...prev, [id]: value }))
  }

  /**
   * Wraps the AIProviderSection `onChange` so a provider-name switch
   * pulls the new provider's stored base_url / model from the
   * namespaced config (multi-provider preservation per F1 contract).
   * Non-provider edits flow through unchanged.
   *
   * Saved api_key values are intentionally NOT pre-filled on switch: the server
   * redacts on read (ADR-015 §I9) and the UX semantics treat an
   * empty key field as "leave existing key unchanged". Showing a key
   * we can't actually see would be misleading.
   */
  const handleProviderChange = useCallback(
    (next: AIProviderDraft) => {
      draftDirty.current = true
      if (next.provider === provider.provider) {
        setProvider(next)
        return
      }
      providerDrafts.current[provider.provider] = provider
      const previousDraft = providerDrafts.current[next.provider]
      if (previousDraft != null) {
        setProvider({ ...previousDraft, cost_cap_cents: next.cost_cap_cents })
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
        api_protocol: readProviderString(newEntry, 'api_protocol', 'auto'),
        embedding_model: readProviderString(newEntry, 'embedding_model', ''),
      })
    },
    [provider, settings?.ai_provider_config],
  )

  function handleRestoreConfirm() {
    if (settings?.ai_features_archived == null || saveAi.isPending || restorePending || !providerSupportsMode(provider.provider, mode)) return
    const restored = normaliseFeatureMap(settings.ai_features_archived)
    draftDirty.current = true
    setFeatures(restored)
    setRestorePending(true)
    // Persist immediately so the archive snapshot itself is cleared
    // server-side on the next round-trip.
    saveAi.mutate({
      ai_mode: mode,
      ai_features: restored,
      ...(mode !== serverMode || provider.provider !== (
        readProviderString(settings.ai_provider_config, 'default', '') ||
        readProviderString(settings.ai_provider_config, 'provider', 'ollama')
      ) ? {
        ai_provider_config: buildProviderConfig(),
        ai_cost_cap_cents: provider.cost_cap_cents,
      } : {}),
    }, {
      onSuccess: () => {
        // Keep the draft for review; only a mode/provider switch also saves configuration.
        setRestoreDismissed(true)
      },
      onSettled: () => setRestorePending(false),
    })
  }

  function handleRestoreDecline() {
    if (saveAi.isPending || restorePending) return
    setRestoreDismissed(true)
  }

  // ── Derived state ────────────────────────────────────────────────

  const showProviderSection = mode !== 'off'
  const showRestorePanel =
    mode !== 'off' &&
    !restoreDismissed &&
    archiveHasRestorableEntries(settings?.ai_features_archived)
  const isCloud = mode === 'cloud'
  const savedCapCents = settings?.ai_cost_cap_cents ?? 0
  const hasUnsavedEnforcement = mode !== serverMode || provider.cost_cap_cents !== savedCapCents
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
      {settingsState.fatalError && <QueryError error={settingsState.fatalError} onRetry={() => void settingsQuery.refetch()} />}
      {settingsState.status === 'stale' && (
        <DataStateNotice state="stale" preserveSeverity>
          <p>{t('common:dataState.stale.message', 'The latest values are temporarily unavailable. Previously loaded data remains visible.')}</p>
          <Button variant="ghost" onClick={() => void settingsQuery.refetch()} disabled={settingsQuery.isFetching}>
            {t('common:retry', 'Retry')}
          </Button>
        </DataStateNotice>
      )}
      {settingsState.isRefreshBlocked && !settingsState.hasData && (
        <InlineCallout variant="info">
          {t('common:dataSources.status.paused', 'Refresh paused')}
        </InlineCallout>
      )}
      {saveAi.error && <QueryError error={saveAi.error} />}
      {/* Status band — at-a-glance summary, full-width metric grid. */}
      <FadeIn>
        <HelixStatusStrip
          mode={serverMode}
          enabledCount={enabledCount}
          providerName={provider.provider}
          settingsLoading={settingsQuery.isLoading}
          settingsUnavailable={!settingsState.hasData}
          settingsRetained={settingsState.status === 'stale'}
        />
      </FadeIn>

      <fieldset
        aria-label={t('ai.settings.title', 'Helix')}
        disabled={!settingsState.hasData || saveAi.isPending || restorePending}
        aria-busy={saveAi.isPending || restorePending}
        className="min-w-0 space-y-4 border-0 p-0 sm:space-y-5"
      >
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
          {hasUnsavedEnforcement && (
            <InlineCallout variant="info" testId="ai-settings-unsaved">
              {t('forms.unsavedSettings', 'You have unsaved settings.')}
            </InlineCallout>
          )}
          {serverMode === 'off' && mode === 'off' && (
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
          <fieldset disabled={!providerSupportsMode(provider.provider, mode)} className="min-w-0 border-0 p-0">
            <AIRestorePanel
              archived={settings?.ai_features_archived ?? {}}
              onConfirm={handleRestoreConfirm}
              onDecline={handleRestoreDecline}
            />
          </fieldset>
          {restorePending && (
            <InlineCallout variant="info" testId="ai-restore-pending">
              {t('ai.settings.saving', 'Saving…')}
            </InlineCallout>
          )}
        </FadeIn>
      )}

      {/* Configuration bento: provider form is the hero (spans two columns
          on wide screens); usage + cost-cap sit in the context rail. */}
      {(showProviderSection || serverMode !== 'off') && (
        <FadeIn delay={0.12}>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            {showProviderSection && (
              <div className="xl:col-span-2">
                {!providerSupportsMode(provider.provider, mode) && (
                  <InlineCallout variant="warning" testId="ai-provider-incompatible">
                    {t('ai.settings.provider.providerLabel', 'Provider')}
                    {': '}
                    {isCloud
                      ? t('ai.settings.mode.cloudHint', 'Use a cloud provider (e.g. OpenAI). Requires an API key.')
                      : t('ai.settings.mode.localHint', 'Use a private model on your network (e.g. Ollama). No data leaves your install.')}
                  </InlineCallout>
                )}
                <AIProviderSection
                  value={provider}
                  isCloud={isCloud}
                  onChange={handleProviderChange}
                />
              </div>
            )}
            <div className="space-y-4">
              <AIUsageCard enabled={settings?.ai_mode === 'local' || settings?.ai_mode === 'cloud'} />
              {/*
                Cost-cap spend bar. Saved cloud mode and cap govern enforcement;
                draft edits do not change the live spend readout. Reads
                today's spend from the same /ai/usage/today endpoint as
                AIUsageCard so the numbers match. Passive read — it does
                not gate saving the cap.
              */}
              {serverMode === 'cloud' && savedCapCents > 0 && (
                <AICostCapSpendBar capCents={savedCapCents} />
              )}
            </div>
          </div>
        </FadeIn>
      )}

      {(showProviderSection || serverMode !== 'off') && (
        <FadeIn delay={0.14}>
          <AIFeatureSpendPanel
            enabled={serverMode !== 'off'}
            capCents={savedCapCents}
          />
        </FadeIn>
      )}

      {/* Feature opt-ins — full-width, flows into columns on wide screens. */}
      {showProviderSection && (
        <FadeIn delay={0.16}>
          <AIFeatureToggleList values={features} onToggle={handleFeatureToggle} />
        </FadeIn>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-4">
        <Button
          type="button"
          variant="primary"
          wrapLabel
          onClick={handleSave}
          disabled={!settingsState.hasData || saveAi.isPending || restorePending || !providerSupportsMode(provider.provider, mode)}
          data-testid="ai-settings-save"
        >
          {saveAi.isPending
            ? t('ai.settings.saving', 'Saving…')
            : t('ai.settings.save', 'Save Helix settings')}
        </Button>
      </div>
      </fieldset>
    </section>
  )
}
