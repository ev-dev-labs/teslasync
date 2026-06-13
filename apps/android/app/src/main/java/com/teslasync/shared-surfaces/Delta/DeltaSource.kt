// The unit-context seam the Delta surface binds to, plus the production source backed by the shared
// settings state holder — the native port of the web `useUnits` + `useFormatting` dependency that
// web/src/components/data-display/Delta.tsx reads (both derive from web/src/hooks/useSettings.ts, the
// S8 settings store). The view (composable) performs NO work of its own; it renders the routed
// [DeltaUnitContext] the ViewModel derives from this seam, satisfying the "data flows through the shared
// state holder, no direct HTTP from the view" contract (ADR-002).
//
// `useUnits` and `useFormatting` both read `useSettings()` and project it — one into a `UnitPref`, the
// other into a currency symbol + precision. This seam mirrors that 1:1: [DeltaUnitSource.context]
// streams the consolidated [DeltaUnitContext], the production [SettingsDeltaUnitSource] maps the shared
// `SettingsStore.settings()` cache-then-network feed (the same feed the app's live `UnitFormatter` is
// derived from), and [StaticDeltaUnitSource] is the throwaway test / preview instance so a unit test
// never touches the network.
//
// `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed because the file is named after
// the surface (Delta*) rather than its first top-level type; `InvalidPackageDeclaration` because the
// mandated surface directory (com/teslasync/shared-surfaces/Delta) cannot form a valid Kotlin package —
// exactly as the sibling surfaces do.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.delta

import io.teslasync.shared.core.data.repo.Resource
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonElement

/**
 * The single seam the [DeltaViewModel] depends on so it binds to an abstraction (the real settings-backed
 * source ↔ a throwaway test instance), never to a concrete client — the Android analogue of the web
 * `useUnits` + `useFormatting` settings dependency (the P1/S8 state-holder boundary for this surface).
 *
 * [context] streams the live [DeltaUnitContext] (display [io.teslasync.shared.core.units.UnitPref] +
 * currency glyph); a new preference emits a fresh context so every Delta re-renders. No HTTP touches the
 * view.
 */
interface DeltaUnitSource {
    /** The hot stream of the user's resolved display-unit context (web `useUnits` + `useFormatting`). */
    val context: Flow<DeltaUnitContext>
}

/**
 * The production [DeltaUnitSource] — maps the shared `SettingsStore.settings()` cache-then-network feed
 * (the S8 settings holder the web `useSettings` ports to) into a [DeltaUnitContext]. It performs no
 * networking itself: it projects the feed's last cached settings document into display units exactly as
 * the web `useUnits` / `useFormatting` derive `unitPrefs` / `currencySymbol` from `useSettings`.
 *
 * @param settings the shared settings feed (`DataContainer.settingsStore.settings()`).
 */
class SettingsDeltaUnitSource(
    settings: StateFlow<Resource<JsonElement>>,
) : DeltaUnitSource {
    override val context: Flow<DeltaUnitContext> =
        settings.map { resource -> DeltaUnitContext.fromSettings(resource.cached) }
}

/**
 * A throwaway [DeltaUnitSource] over a caller-supplied stream — used by previews (a single fixed context)
 * and unit tests (a `MutableStateFlow` whose emissions drive the ViewModel), so the production settings
 * feed is never polluted across cases.
 */
class StaticDeltaUnitSource(
    override val context: Flow<DeltaUnitContext>,
) : DeltaUnitSource {
    constructor(value: DeltaUnitContext = DeltaUnitContext.DEFAULT) : this(flowOf(value))
}
