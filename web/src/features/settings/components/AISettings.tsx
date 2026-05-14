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

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles } from 'lucide-react'
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
 * Pulls a `string` out of the loosely-typed `ai_provider_config`
 * (declared `Record<string, unknown>` in `AppSettings`). Returns
 * the supplied fallback when the key is missing or non-string.
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
  const [provider, setProvider] = useState<AIProviderDraft>(() => ({
    provider: readProviderString(settings?.ai_provider_config, 'provider', 'ollama'),
    base_url: readProviderString(settings?.ai_provider_config, 'base_url', ''),
    model: readProviderString(settings?.ai_provider_config, 'model', ''),
    api_key: '',
    cost_cap_cents: settings?.ai_cost_cap_cents ?? 0,
  }))
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
    setProvider({
      provider: readProviderString(settings.ai_provider_config, 'provider', 'ollama'),
      base_url: readProviderString(settings.ai_provider_config, 'base_url', ''),
      model: readProviderString(settings.ai_provider_config, 'model', ''),
      // ADR-015 §I9 — never pre-populate the key when the server's
      // mode is off. The server already redacts in that case but we
      // double-guard here to make the invariant local-state safe.
      api_key:
        serverMode === 'off'
          ? ''
          : readProviderString(settings.ai_provider_config, 'api_key', ''),
      cost_cap_cents: settings.ai_cost_cap_cents ?? 0,
    })
    setRestoreDismissed(false)
    // Intentionally depend on the JSON snapshot, not the object
    // reference, to avoid infinite re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      ai_provider_config: {
        provider: provider.provider,
        base_url: provider.base_url,
        model: provider.model,
        // Only forward a non-empty key; an empty string would clobber
        // a previously-saved key (the server treats empty as
        // explicit clear).
        api_key: provider.api_key.trim() === '' ? undefined : provider.api_key,
      },
      ai_cost_cap_cents: provider.cost_cap_cents,
    })
  }

  function handleFeatureToggle(id: AiFeatureId, value: boolean) {
    setFeatures((prev) => ({ ...prev, [id]: value }))
  }

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
            <Sparkles className="h-5 w-5" />
          </IconBox>
          <div className="flex-1 min-w-0">
            <PanelTitle>{t('ai.settings.title', 'AI features')}</PanelTitle>
            <Subhead>
              {t(
                'ai.settings.subtitle',
                'Optional. AI is off by default; nothing is enabled until you opt in here.',
              )}
            </Subhead>
          </div>
        </div>

        <fieldset
          className="space-y-2"
          aria-label={t('ai.settings.modeLegend', 'AI mode')}
        >
          <Caption>
            {t('ai.settings.modeLegend', 'AI mode')}
          </Caption>
          <div
            role="radiogroup"
            aria-label={t('ai.settings.modeLegend', 'AI mode')}
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
                'No AI features. The app works fully without them.',
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
                'AI features are off. Your app works fully without them. Enable a mode above to opt in.',
              )}
            </HelperText>
          )}
        </fieldset>

        {showProviderSection && (
          <AIProviderSection
            value={provider}
            isCloud={isCloud}
            onChange={setProvider}
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
              : t('ai.settings.save', 'Save AI settings')}
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
