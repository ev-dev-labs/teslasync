// The unit-context seam the InsightsEngine surface binds to, plus the production source backed by the
// shared settings state holder — the native port of the single hook web
// web/src/components/data-display/InsightsEngine.tsx reads, `useFormatting()`
// (web/src/hooks/useFormatting.ts, which itself derives from web/src/hooks/useSettings.ts, the S8
// settings store). The view (composable) performs NO work of its own; it renders the
// [InsightsFormatting] the ViewModel derives from this seam over caller-supplied data, satisfying the
// "data flows through the shared state holder, no direct HTTP from the view" contract (ADR-002).
//
// This mirrors the sibling `DeltaUnitSource` 1:1: [InsightsFormattingSource.context] streams the
// consolidated [InsightsFormatting], the production [SettingsInsightsFormattingSource] maps the
// shared `SettingsStore.settings()` cache-then-network feed (the same feed the app's live formatter
// is derived from), and [StaticInsightsFormattingSource] is the throwaway test / preview instance so
// a unit test never touches the network.
//
// `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed because the file is named
// after the surface (InsightsEngine*) rather than its first top-level type; `InvalidPackageDeclaration`
// because the mandated surface directory (com/teslasync/shared-surfaces/InsightsEngine) cannot form a
// valid Kotlin package — exactly as the sibling surfaces do.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.insightsengine

import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [InsightsEngineViewModel] depends on so it binds to an abstraction (the real
 * settings-backed source ↔ a throwaway test instance), never to a concrete client — the Android
 * analogue of the web `useFormatting` settings dependency (the P1/S8 state-holder boundary for this
 * surface).
 *
 * [context] streams the live [InsightsFormatting] (currency glyph + precision + grouping locale); a
 * new preference emits a fresh context so every insight re-renders. No HTTP touches the view.
 */
interface InsightsFormattingSource {
    /** The hot stream of the user's resolved display-formatting context (web `useFormatting`). */
    val context: Flow<InsightsFormatting>
}

/**
 * The production [InsightsFormattingSource] — maps the shared `SettingsStore.settings()`
 * cache-then-network feed (the S8 settings holder the web `useSettings` ports to) into an
 * [InsightsFormatting]. It performs no networking itself: it projects the feed's last cached settings
 * document into a currency glyph + precision + locale exactly as the web `useFormatting` derives
 * `currencySymbol` / the user precision from `useSettings`.
 *
 * @param settings the shared settings feed (`DataContainer.settingsStore.settings()`).
 */
class SettingsInsightsFormattingSource(
    settings: StateFlow<Resource<JsonElement>>,
) : InsightsFormattingSource {
    override val context: Flow<InsightsFormatting> =
        settings.map { resource -> InsightsFormatting.fromSettings(resource.cached) }
}

/**
 * A throwaway [InsightsFormattingSource] over a caller-supplied stream — used by previews (a single
 * fixed context) and unit tests (a `MutableStateFlow` whose emissions drive the ViewModel), so the
 * production settings feed is never polluted across cases.
 */
class StaticInsightsFormattingSource(
    override val context: Flow<InsightsFormatting>,
) : InsightsFormattingSource {
    constructor(value: InsightsFormatting = InsightsFormatting.DEFAULT) : this(flowOf(value))
}
