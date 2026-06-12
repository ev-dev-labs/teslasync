// Pure, framework-free model + projection for the AddressInput feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/driving/components/AddressInput.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// AddressInput is the trip-planner's geocoded address autocomplete. The web component owns the raw text
// via `value`/`onChange`, debounces it (400ms) into a geocode query, and — only once the query reaches
// three characters (`enabled: query.length >= 3`) — calls `useGeocodeSearch` and renders the resolved
// `GeocodeResult[]` inside the shared `Combobox`, firing `onSelect` with the picked coordinates. This
// native surface keeps that contract: it binds the geocode read through the shared S8 state-holder seam
// (DrivingStore.geocodeSearch → a cache-then-network Resource, ADR-013) — never HTTP of its own — and
// projects that Resource onto the full lifecycle the prompt mandates (idle / loading / results / empty /
// error, plus the stale·refreshing·offline freshness flags the ADR-013 contract carries).
//
// The geocoder rows arrive as a raw SI [JsonElement] array (the web `safeArray`-guarded `GeocodeResult[]`;
// the shared DrivingRepository carries it verbatim with no generated DTO), so [AddressInputProjection.parse]
// reproduces the `safeArray` guard structurally: each row contributes a suggestion only when it is an
// object with a non-blank `display_name` string and numeric `lat`/`lng`, and any malformed row is skipped
// rather than throwing. The lifecycle mapping is delegated to the canonical
// [io.teslasync.android.data.toUiState] projection so the cache-then-network contract is interpreted in
// exactly one place (DRY) — this surface only adds the web `query.length >= 3` idle gate on top.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/AddressInput — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located
// supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.addressinput

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/**
 * The web `query.length >= 3` `enabled` gate on `useGeocodeSearch`: the geocoder is queried only once the
 * (debounced) query reaches three characters. Below it the surface is idle — no request, no dropdown.
 */
const val MIN_QUERY_LENGTH: Int = 3

/** The web 400ms debounce between a keystroke and the geocode query (`setTimeout(..., 400)`). */
const val DEBOUNCE_MILLIS: Long = 400

/**
 * One resolved geocoder suggestion — the native mirror of the web `GeocodeResult`
 * (`web/src/types/driving.ts`: `display_name` + `lat` + `lng`), already narrowed to non-null fields by
 * [AddressInputProjection.parse]. Pure data so the projection is unit-tested without a UI host.
 */
data class AddressSuggestion(
    val displayName: String,
    val lat: Double,
    val lng: Double,
) {
    /** The location handed to `onSelect`, mirroring the web `{ lat, lng, name: display_name }`. */
    fun toLocation(): AddressLocation = AddressLocation(lat = lat, lng = lng, name = displayName)
}

/**
 * The picked location emitted on selection — the native mirror of the web `TripLocation`
 * (`web/src/types/driving.ts`: `lat` + `lng` + `name`). The owning trip-planner page consumes it exactly
 * as the web `onSelect({ lat, lng, name })` callback does.
 */
data class AddressLocation(
    val lat: Double,
    val lng: Double,
    val name: String,
)

/**
 * The mutually-exclusive surface the autocomplete dropdown renders for the current query. Mirrors the web
 * Combobox behaviour (a loading indicator, the options list, or an empty "No results" row) extended with
 * the explicit error surface the prompt's state matrix mandates; freshness (stale/refreshing/offline) is
 * carried as orthogonal flags on [AddressSuggestions] so cached rows stay visible while a chip is shown.
 */
enum class AddressInputStatus {
    /** The query is shorter than [MIN_QUERY_LENGTH] (web `enabled` is false) — no request, no dropdown. */
    Idle,

    /** A first geocode is in flight with nothing cached — a loading row. */
    Loading,

    /** One or more resolved suggestions are available (fresh or cached). */
    Results,

    /** The geocoder resolved with zero matches — a friendly "No results" row, never a blank menu. */
    Empty,

    /** A hard geocode failure with nothing cached to fall back on — an error row with a retry affordance. */
    Error,
}

/**
 * The fully projected, render-ready dropdown state — everything the web component computes before handing
 * options to the Combobox, plus the ADR-013 freshness flags.
 *
 * @property status the primary dropdown surface to render.
 * @property suggestions the resolved rows to show (cached or fresh); empty for every non-[Results] status.
 * @property stale whether [suggestions] are flagged stale/offline (never presented as live).
 * @property refreshing whether a geocode refresh is currently running over already-shown [suggestions].
 * @property offline whether cached [suggestions] are shown because the network was unreachable.
 * @property canRetry whether a retry affordance should be offered (hard error, or stale/offline cache).
 */
data class AddressSuggestions(
    val status: AddressInputStatus,
    val suggestions: List<AddressSuggestion> = emptyList(),
    val stale: Boolean = false,
    val refreshing: Boolean = false,
    val offline: Boolean = false,
    val canRetry: Boolean = false,
)

/**
 * Pure projection from the debounced query + the shared geocode [Resource] to the render-ready
 * [AddressSuggestions] — a 1:1 port of the web `useGeocodeSearch` consumption: the `query.length >= 3`
 * `enabled` gate, the `safeArray` row guard, and the `results ?? []` / `isLoading` reads, with the
 * cache-then-network lifecycle interpreted by the shared [toUiState] so it is honoured identically here
 * and on every other native surface.
 */
object AddressInputProjection {
    /**
     * Selects the dropdown state for the [query] and its [resource] (the shared geocode feed, or `null`
     * before any feed exists). A query below [MIN_QUERY_LENGTH] is [AddressInputStatus.Idle] (the web
     * disabled query) regardless of any stale feed value.
     */
    fun project(
        query: String,
        resource: Resource<JsonElement>?,
    ): AddressSuggestions {
        if (query.length < MIN_QUERY_LENGTH || resource == null) {
            return AddressSuggestions(AddressInputStatus.Idle)
        }
        val ui = resource.toUiState { parse(it).isEmpty() }
        val suggestions = ui.data?.let(::parse).orEmpty()
        val status =
            when (ui.phase) {
                UiPhase.Loading -> AddressInputStatus.Loading
                UiPhase.Empty -> AddressInputStatus.Empty
                UiPhase.Error -> AddressInputStatus.Error
                UiPhase.Content -> AddressInputStatus.Results
            }
        return AddressSuggestions(
            status = status,
            suggestions = suggestions,
            stale = ui.stale,
            refreshing = ui.refreshing,
            offline = ui.isOffline,
            canRetry = ui.canRetry,
        )
    }

    /**
     * Parses the geocoder's raw SI JSON array into suggestions, reproducing the web `safeArray` guard: a
     * non-array yields no rows, and each row contributes a suggestion only when it is an object carrying a
     * non-blank `display_name` string and numeric `lat`/`lng` — any malformed row is skipped, never thrown.
     */
    fun parse(json: JsonElement?): List<AddressSuggestion> =
        (json as? JsonArray).orEmpty().mapNotNull { element ->
            val obj = element as? JsonObject ?: return@mapNotNull null
            val name = (obj["display_name"] as? JsonPrimitive)?.takeIf { it.isString }?.content
            val lat = (obj["lat"] as? JsonPrimitive)?.doubleOrNull
            val lng = (obj["lng"] as? JsonPrimitive)?.doubleOrNull
            if (name.isNullOrBlank() || lat == null || lng == null) {
                null
            } else {
                AddressSuggestion(displayName = name, lat = lat, lng = lng)
            }
        }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * typed query text or any resolved address/coordinate — so a diagnostics line can never leak where the
 * user is searching for or routing to.
 */
object AddressInputDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "AddressInput"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
