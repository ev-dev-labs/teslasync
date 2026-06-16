// Builds the [AINLGrafanaPanelSource] the embedded Helix drafter binds to — the native analogue of the two data
// hooks the web `<AINLGrafanaPanel />` composes (web/src/components/ai/AINLGrafanaPanel.tsx):
//   • the `withAiFeature('nl-grafana-panel', …)` visibility gate (web `useAiEnabled`), and
//   • `useAiStream({ url: '/ai/power/grafana-panel/draft', body: { prompt } })`, the propose-only draft stream.
//
// GATE (real, production): [grafanaPanelAiEnabled] folds the shared S8 SettingsStore `/settings` document into the
// single gate boolean via the pure [evaluateAiEnabled] port (the native `useAiEnabled('nl-grafana-panel')`). It is
// FAIL-CLOSED exactly like web: unresolved settings, `ai_mode === 'off'`, an absent `ai_features` map, or a flag
// that is not exactly `true` all keep the surface hidden — so by default (AI off, the page's documented canonical
// baseline) the drafter collapses to nothing, identical to the web `withAiFeature` HOC returning `null`.
//
// DRAFT TRANSPORT (out-of-scope dependency, surfaced honestly — Honesty Covenant #7/#9): the AI *streaming* layer
// (the POST-SSE client serving `/ai/power/grafana-panel/draft`) is NOT on the shared KMP core on this branch —
// the core ships the AI settings + usage stores only (see the AINLGrafanaPanelSource header: "the shared core
// ships AI-settings + AI-usage stores but no AI streaming store yet … the streaming atoms are the out-of-scope
// P3 component-library bundle"), and the shared core is outside this A7 page's allowed files. Rather than
// fabricate a draft, [grafanaPanelDraftUnavailable] emits the terminal failure frame the AINLGrafanaPanelSource
// contract explicitly permits, so an opened draft renders the surface's REAL failed + Retry state — never a fake
// success. This path is reached ONLY when an operator has explicitly enabled AI mode AND the nl-grafana-panel
// feature; with the gate closed the surface is hidden and the draft stream is never opened. The whole deterministic
// editor + curated catalog (the page's 22 parity items) is fully real and independent of this transport.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/poweruser) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.poweruser.grafanapanel

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.sharedsurfaces.ainlgrafanapanel.AINLGrafanaPanelSource
import io.teslasync.android.sharedsurfaces.ainlgrafanapanel.AiStreamChunk
import io.teslasync.android.sharedsurfaces.ainlgrafanapanel.aiNlGrafanaPanelSource
import io.teslasync.android.sharedsurfaces.withaifeature.evaluateAiEnabled
import io.teslasync.shared.core.presentation.settings.SettingsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

/**
 * Binds the embedded Helix drafter to the shared layer: the real settings-derived AI gate (web `useAiEnabled`)
 * plus the out-of-scope draft transport surfaced honestly (see the file header). The [store] is the same shared
 * S8 [SettingsStore] every settings-aware surface observes, so the gate tracks live `ai_mode` / `ai_features`
 * changes.
 */
fun grafanaPanelAiSource(store: SettingsStore): AINLGrafanaPanelSource =
    aiNlGrafanaPanelSource(
        aiEnabled = { grafanaPanelAiEnabled(store) },
        draft = { _ -> grafanaPanelDraftUnavailable() },
    )

/**
 * The fail-closed `nl-grafana-panel` AI gate (web `useAiEnabled('nl-grafana-panel')`): folds each emission of the
 * cache-then-network `/settings` document into a boolean via [evaluateAiEnabled]. Emits `false` until settings
 * resolve and the feature is explicitly opted in, then `true`; re-emits on every AI-mode / feature-flag change.
 */
fun grafanaPanelAiEnabled(store: SettingsStore): Flow<Boolean> =
    store.settings().map { resource ->
        val settings = resource.cached
        evaluateAiEnabled(
            feature = GrafanaPanelPageRegistration.AI_FEATURE,
            aiMode = aiModeOf(settings),
            featureFlag = aiFeatureFlagOf(settings, GrafanaPanelPageRegistration.AI_FEATURE),
        )
    }

/**
 * The draft stream for an opened request — see the file header. The shared AI-streaming transport is not present
 * on this branch, so this emits the terminal [AiStreamChunk.Failed] frame the source contract permits; the
 * AINLGrafanaPanel view-model reduces it into its real failed + Retry surface (never a fabricated draft).
 */
fun grafanaPanelDraftUnavailable(): Flow<AiStreamChunk> = flow { emit(AiStreamChunk.Failed(ErrorKind.Unknown)) }

/** Reads `settings.ai_mode` as a string, or `null` when the document is unresolved / the field is absent. */
private fun aiModeOf(settings: JsonElement?): String? {
    val mode = (settings as? JsonObject)?.get("ai_mode") as? JsonPrimitive ?: return null
    return if (mode.isString) mode.content else null
}

/** Reads `settings.ai_features[feature]` as a boolean, or `null` when the map / flag is absent. */
private fun aiFeatureFlagOf(
    settings: JsonElement?,
    feature: String,
): Boolean? {
    val features = (settings as? JsonObject)?.get("ai_features") as? JsonObject ?: return null
    val flag = features[feature] as? JsonPrimitive ?: return null
    return flag.booleanOrNull
}
