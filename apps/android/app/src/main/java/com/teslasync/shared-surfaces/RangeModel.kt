// Pure, framework-free model + projection for the Range shared surface — the native analogue of the data
// the web component derives before returning JSX (web/src/components/data-display/format/Range.tsx: the
// `useUnits` + `usePreferredRange` + `useRangeLabel` composition). No Compose, no Android UI, no HTTP:
// every type here is exercised by the :android:testReleaseUnitTest gate so the composable stays a thin
// render layer.
//
// The web `Range` is a tiny presentational formatter: it reads the user's distance-unit preference
// (`useUnits` → `unit_of_length`) and `preferred_range` preference (`usePreferredRange` → rated vs ideal),
// selects `state.rated_range`/`state.ideal_range` (SI metres), and renders either the formatted distance
// or an em dash when the value is missing. `useRangeLabel` returns the localized "Rated Range"/"Ideal
// Range" label. This model reproduces that selection + formatting exactly (SI-floor, Phase-48), and folds
// in the cache-then-network lifecycle of the settings document (the genuine async dependency behind both
// hooks) so the surface can honestly render the prompt's loading / empty / error / stale / offline matrix
// without ever hiding a region.
//
// There is no native `selectPreferredRange` in the shared core (the web `lib/preferredRange.ts` helper has
// no KMP port), so its pure logic is reproduced here — the same approach the sibling surfaces take for
// their own per-surface projection logic. The settings document and the unit derivation come from the
// shared layers: `UnitPreferences.fromSettings` (the `useUnits` port) and the SI `formatDistance` (the
// `lib/unitConversion` port).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/Range — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen is illegal in a package identifier), so the package intentionally diverges from the
// path. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.range

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.units.formatDistance
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * Canonical registry metadata for this surface — the native mirror of the web component's contract. The
 * diagnostics slug, the settings key the range-type preference reads, and the SI snapshot keys are pinned
 * here so the native and web surfaces stay in lockstep.
 */
object RangeRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "Range"

    /** Settings-document key holding the user's range-type preference (web `useSettings().rangeType`). */
    const val PREFERRED_RANGE_KEY: String = "preferred_range"

    /** The `preferred_range` value that selects the ideal estimate; anything else falls back to rated. */
    const val RANGE_TYPE_IDEAL: String = "ideal"

    /** Snapshot key for the rated range in SI metres (web `PreferredRangeFields.rated_range`). */
    const val RATED_RANGE_KEY: String = "rated_range"

    /** Snapshot key for the ideal range in SI metres (web `PreferredRangeFields.ideal_range`). */
    const val IDEAL_RANGE_KEY: String = "ideal_range"

    /** The em dash the web renders when the selected range is missing (`<span>—</span>`). */
    const val EMPTY_VALUE: String = "\u2014"
}

/**
 * Which of Tesla's two range estimates the user treats as "the" range — the native port of the web
 * `RangeType` union ('rated' | 'ideal'). Rated is the fallback when the preference is missing or mistyped,
 * matching the backend default the web `useSettings` applies.
 */
enum class PreferredRangeType { Rated, Ideal }

/**
 * A vehicle/charge state snapshot carrying the two range estimates in SI metres — the native port of the
 * web `PreferredRangeFields` (`{ rated_range?, ideal_range? }`). A `null` field means "not reported yet",
 * which the projection renders as the em-dash empty state, exactly like the web `meters == null` branch.
 */
data class RangeSnapshot(
    val ratedRangeMeters: Double? = null,
    val idealRangeMeters: Double? = null,
) {
    companion object {
        /**
         * Builds a snapshot from a raw vehicle/charge state object (the shape a host already holds),
         * reading the SI-metre `rated_range`/`ideal_range` fields. A null/non-object element, or a missing
         * field, yields a null estimate. Pure, so it is covered by the off-device projection test.
         */
        fun fromState(state: JsonElement?): RangeSnapshot {
            val obj = state as? JsonObject ?: return RangeSnapshot()
            return RangeSnapshot(
                ratedRangeMeters = obj.metres(RangeRegistration.RATED_RANGE_KEY),
                idealRangeMeters = obj.metres(RangeRegistration.IDEAL_RANGE_KEY),
            )
        }

        private fun JsonObject.metres(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull
    }
}

/**
 * The mutually-exclusive render surface the Range card draws. [Content] and [Empty] reproduce the web's
 * two visible branches (the formatted value vs the em dash); [Loading] and [Error] surface the genuine
 * cold-start and hard-failure states of the settings document the unit + range-type preferences come from.
 */
enum class RangePhase {
    /** First settings load with nothing cached — render skeleton chrome (never a blank box). */
    Loading,

    /** A range value is available and formatted in the user's units — render it. */
    Content,

    /** Settings resolved but the selected range is missing (web `meters == null`) — render the em dash. */
    Empty,

    /** Settings failed with nothing cached to fall back on — render a classified error with retry. */
    Error,
}

/**
 * The immutable, render-ready projection the composable draws — everything the web `Range` + `useRangeLabel`
 * fold together: the resolved [rangeType] (for the label), the formatted [valueText] (null unless
 * [RangePhase.Content]), and the cache-then-network freshness envelope ([stale]/[offline]/[refreshing] +
 * [errorKind]) so the surface honestly flags last-known data instead of presenting it as live. Pure data
 * so [RangeProjection] is unit-tested without a UI host.
 *
 * @property stale cached prefs are past their TTL and a refresh is in flight (no failure yet).
 * @property offline cached prefs are shown because a refresh failed (network unreachable / "last known").
 * @property freshnessStamp the `fetchedAt` of the shown prefs; keys the stale auto-refresh effect.
 */
data class RangeDisplay(
    val phase: RangePhase,
    val rangeType: PreferredRangeType,
    val valueText: String? = null,
    val stale: Boolean = false,
    val offline: Boolean = false,
    val refreshing: Boolean = false,
    val errorKind: ErrorKind? = null,
    val httpStatus: Int? = null,
    val freshnessStamp: Long? = null,
) {
    /** The value to draw: the formatted distance for content, else the em dash (web `<span>—</span>`). */
    val displayValue: String get() = valueText ?: RangeRegistration.EMPTY_VALUE

    /** True when a freshness chip (stale or offline) should be shown over the cached value. */
    val showFreshnessChip: Boolean get() = stale || offline

    /** True when a retry affordance should be offered (the hard-error surface). */
    val canRetry: Boolean get() = phase == RangePhase.Error
}

/**
 * Pure projection + selection logic for the Range surface — the native port of the web
 * `selectPreferredRange` helper plus the `useUnits`/`useRangeLabel` derivation.
 */
object RangeProjection {
    private const val HTTP_UNAUTHORIZED = 401
    private const val HTTP_FORBIDDEN = 403
    private const val HTTP_NOT_FOUND = 404

    /**
     * Reads the user's range-type preference from the settings document — the native port of the web
     * `useSettings().rangeType` (`s.preferred_range`). `"ideal"` selects ideal; any other value, a missing
     * key, or an unresolved document falls back to rated (the web `rangeType === 'ideal' ? 'ideal' : 'rated'`).
     */
    fun rangeTypeOf(settings: JsonElement?): PreferredRangeType {
        val obj = settings as? JsonObject ?: return PreferredRangeType.Rated
        val raw = (obj[RangeRegistration.PREFERRED_RANGE_KEY] as? JsonPrimitive)?.contentOrNull
        return if (raw == RangeRegistration.RANGE_TYPE_IDEAL) PreferredRangeType.Ideal else PreferredRangeType.Rated
    }

    /**
     * Picks the preferred range value (SI metres) from a [snapshot] — the native port of the web
     * `selectPreferredRange`'s `type === 'ideal' ? state?.ideal_range : state?.rated_range`. A null snapshot
     * or a missing estimate yields null, which the projection renders as the empty em dash.
     */
    fun selectMetres(
        snapshot: RangeSnapshot?,
        type: PreferredRangeType,
    ): Double? =
        when (type) {
            PreferredRangeType.Ideal -> snapshot?.idealRangeMeters
            PreferredRangeType.Rated -> snapshot?.ratedRangeMeters
        }

    /**
     * Folds the settings [UiState] (the unit + range-type preference source), the provided [snapshot] (the
     * web `state` prop), and the display [precision] (web default 0) into the render-ready [RangeDisplay].
     *
     * Phase resolution honours both the web's two visible branches and the settings document's async
     * lifecycle: a hard settings failure with no cache → [RangePhase.Error]; a first load with nothing
     * cached → [RangePhase.Loading]; otherwise the user's prefs are available (fresh or cached) and the
     * selected range decides [RangePhase.Empty] (web `meters == null`) vs [RangePhase.Content]. The value is
     * formatted at the SI display boundary with the resolved [io.teslasync.shared.core.units.UnitPref], so a
     * km/mi preference change re-renders the value with no other change (the web `useUnits` contract).
     */
    fun project(
        settings: UiState<JsonElement>,
        snapshot: RangeSnapshot?,
        precision: Int,
    ): RangeDisplay {
        val type = rangeTypeOf(settings.data)
        val metres = selectMetres(snapshot, type)
        val prefs = UnitPreferences.fromSettings(settings.data)
        val phase =
            when {
                settings.isError -> RangePhase.Error
                settings.isLoading -> RangePhase.Loading
                metres == null -> RangePhase.Empty
                else -> RangePhase.Content
            }
        return RangeDisplay(
            phase = phase,
            rangeType = type,
            valueText = if (phase == RangePhase.Content) formatDistance(metres, prefs, precision) else null,
            stale = settings.stale && settings.errorKind == null,
            offline = settings.stale && settings.hasData && settings.errorKind != null,
            refreshing = settings.refreshing,
            errorKind = settings.errorKind,
            httpStatus = settings.httpStatus,
            freshnessStamp = settings.fetchedAt,
        )
    }

    /**
     * Maps the hard-error [display] onto the shared [QueryErrorKind] recovery bucket so the error surface
     * shows the right copy: an open breaker → [QueryErrorKind.Waiting]; a connectivity failure →
     * [QueryErrorKind.Network]; a 401/403 → [QueryErrorKind.Unauthorized]; a 404 → [QueryErrorKind.NotFound];
     * every other HTTP/decode/unknown failure → [QueryErrorKind.ServerError] with a retry affordance.
     */
    fun queryErrorKind(display: RangeDisplay): QueryErrorKind =
        when (display.errorKind) {
            ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
            ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
            ErrorKind.Http ->
                when (display.httpStatus) {
                    HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                    HTTP_NOT_FOUND -> QueryErrorKind.NotFound
                    else -> QueryErrorKind.ServerError
                }
            ErrorKind.Decode, ErrorKind.Unknown, null -> QueryErrorKind.ServerError
        }
}
