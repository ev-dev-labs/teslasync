// Framework-free registration + diagnostics + data seam for the PresetGallery page surface (P3/A7) — the thin
// page-layer wrapper over the shared PresetGallery feature view (com/teslasync/feature-views/PresetGallery,
// package io.teslasync.android.featureviews.presetgallery). The web source
// (web/src/features/automations/pages/PresetGallery.tsx) is an unrouted card grid the Automations builder
// embeds; its one data hook is `useAutomationPresets(category)` → GET /automations/presets[?category=]. This
// layer adds the page-prompt's `@Composable screen + ViewModel` seam around that one shared surface (DRY,
// ADR-006) without re-implementing any rendering.
//
// Because the page module cannot widen the feature-view directory (it is outside this prompt's allowed files),
// the shared-core → feature-view adaptation the fv model documents ("the host's shared P1/S8 state-holder adapts
// the /automations/presets response into [AutomationPresetData]") lives here: the [PresetGallerySource] seam +
// the pure [AutomationPreset] → [AutomationPresetData] projection. Both are logic-free / Android-free, so they
// are exercised by the off-device JVM gate without Compose. The view performs NO HTTP — the fetch lives entirely
// in the shared S7/S8 [AutomationsStore].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/automations — the
// page prompt's allowed-files path) diverges from the `io.teslasync.android.*` package the rest of the app uses,
// exactly as the sibling page surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.automations

import io.teslasync.android.featureviews.presetgallery.AutomationPresetData
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.automations.AutomationPreset
import io.teslasync.shared.core.presentation.automations.AutomationPresetsResponse
import io.teslasync.shared.core.presentation.automations.AutomationTriggerInput
import io.teslasync.shared.core.presentation.automations.AutomationsStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/** Stable diagnostics + registry identifiers for the PresetGallery page surface (P1/S11). */
object PresetGalleryPageRegistration {
    /** Stable surface id. */
    const val ID: String = "preset-gallery-page"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "PresetGalleryPage"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [PresetGalleryPageRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-testable with a recording [Logger]; the page composable calls
 * it from its first-composition effect. Carries no preset ids, names, or descriptions, so a diagnostics line
 * can never leak what a user is browsing or installing.
 */
fun recordPresetGalleryPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to PresetGalleryPageRegistration.SLUG))
}

/**
 * Streams the cache-then-network preset gallery the page renders — the native seam for the web
 * `useAutomationPresets(category)` hook. A single-method abstraction so the view-model depends on a seam
 * (real [AutomationsStore]-backed adapter ↔ test fake), never on a concrete store or the network. The stream
 * carries the already-projected [AutomationPresetData] the feature view consumes, with cache-then-network
 * freshness preserved end to end (ADR-013).
 */
fun interface PresetGallerySource {
    /** The cache-then-network preset feed (cached value first for an instant cold start, then refreshed). */
    fun stream(): Flow<Resource<List<AutomationPresetData>>>
}

/**
 * Binds the surface to the shared **S8** [AutomationsStore.automationPresets] feed — the
 * `GET /automations/presets[?category=]` gallery every Automations surface shares (web
 * `useAutomationPresets`). Re-collecting it performs a genuine cache-then-network re-fetch, backing the
 * surface's refresh/retry affordance. The shared-core [AutomationPreset] rows are projected to the feature
 * view's vendor-neutral [AutomationPresetData] at this boundary (see [toPresetCards]); no HTTP touches the
 * view — the store (S7/S8) owns it.
 *
 * @param store the shared Automations control-plane state holder (P1/S8).
 * @param category the optional category filter (web `category` prop); a null/blank value is "no filter".
 */
fun presetGallerySource(
    store: AutomationsStore,
    category: String? = null,
): PresetGallerySource =
    PresetGallerySource {
        store.automationPresets(category).map { resource -> resource.mapToPresetData() }
    }

/**
 * Projects a [AutomationPresetsResponse] envelope onto the feature view's card inputs, preserving the
 * received order (the web map order over `data.presets`). Pure and side-effect-free.
 */
internal fun AutomationPresetsResponse.toPresetCards(): List<AutomationPresetData> = presets.map { it.toPresetData() }

/**
 * Projects one shared-core [AutomationPreset] onto the feature view's [AutomationPresetData] — the native
 * analogue of the slice a web `PresetCard` reads: the install-target [AutomationPreset.id], name, description,
 * raw icon string, the ordered trigger wire-kinds (so the fv projection can take the first, web
 * `preset.triggers[0]`), and the action count (web `preset.actions.length`).
 */
internal fun AutomationPreset.toPresetData(): AutomationPresetData =
    AutomationPresetData(
        id = id,
        name = name,
        description = description,
        icon = icon,
        triggerKinds = triggers.map { it.wireKind() },
        actionCount = actions.size,
    )

/**
 * The `trigger_*` discriminator wire string for a trigger step — the same key the fv `PresetTriggerKind.from`
 * classifies (web `triggerLabels[preset.triggers[0].kind]`). Exhaustive over the sealed
 * [AutomationTriggerInput] hierarchy, so a new trigger kind is a compile error here rather than a silent
 * mis-label downstream.
 */
internal fun AutomationTriggerInput.wireKind(): String =
    when (this) {
        is AutomationTriggerInput.Signal -> "trigger_signal"
        is AutomationTriggerInput.Geofence -> "trigger_geofence"
        is AutomationTriggerInput.Schedule -> "trigger_schedule"
        is AutomationTriggerInput.Event -> "trigger_event"
    }

/**
 * Re-wraps a `Resource<AutomationPresetsResponse>` as a `Resource<List<AutomationPresetData>>`, mapping the
 * carried value (the cached one for Loading/Error, the fresh one for Success) while preserving the
 * cache-then-network freshness flags + error so the page ViewModel's [UiState] projection stays honest
 * (ADR-013).
 */
private fun Resource<AutomationPresetsResponse>.mapToPresetData(): Resource<List<AutomationPresetData>> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.toPresetCards(), fetchedAt, stale)
        is Resource.Success -> Resource.Success(data.toPresetCards(), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.toPresetCards(), fetchedAt, stale, error)
    }
