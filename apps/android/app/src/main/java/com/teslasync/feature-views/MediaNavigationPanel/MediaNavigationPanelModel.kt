// Pure, framework-free model + projection for the MediaNavigationPanel feature view — the native analogue of
// every derivation the web component performs before it returns JSX
// (web/src/features/vehicles/components/telemetry-panels/MediaNavigationPanel.tsx). No Compose, no Android, no
// HTTP: every declaration here is exercised off-device by the :app:testReleaseUnitTest gate, so the composable
// stays a thin render layer over these pure functions.
//
// The web component is presentational — its parent (a vehicle telemetry page) owns the media + location
// queries and their loading / error handling, then hands this panel the latest `MediaSnapshot` and
// `LocationSnapshot` (either may be null). From those it derives two sections: "Now Playing" (track title,
// artist, an optional source chip, and a Playing/Paused status badge) and "Navigation" (an active destination
// with distance-to-arrival + minutes-to-arrival, plus home / work / favorite presence chips). Every
// user-facing string is fed through `cleanNil` first (the Go `"<nil>"` scrubber, web `lib/cleanNil`) so a
// stored nil sentinel never leaks into the UI.
//
// The distance is the unit-sensitive part: the web reads `miles_to_arrival` (SI metres on the wire, despite
// the legacy field name) and converts it to the user's display unit EXACTLY ONCE at the render site
// (`convertDistanceFromSI` = web `toDistanceDisplay`), then formats with the global `fmtNumber` precision and
// appends the unit label. This port reproduces that single-conversion seam in [navigation]; minutes are shown
// as a localized integer (web `fmtInt`).
//
// [MediaInfo] / [LocationInfo] mirror the slices of those snapshots the web reads in snake_case (the Go JSON
// tags served verbatim, no camelCaseKeys transform in the shared layer), so the projection runs straight off
// the cached API JSON. A present snapshot — even one whose fields are all null — renders the section content
// with the web's inline empty fallbacks; a null snapshot selects the friendly top-level empty state so the
// panel never collapses to a blank box.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/MediaNavigationPanel — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.medianavigationpanel

import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Locale

/** Web `fmtNumber`'s global precision default — the user's `decimal_precision`, 2 when unset (distance). */
internal const val DEFAULT_DECIMAL_PRECISION: Int = 2

/** Minutes-to-arrival render as a whole number in display units (web `fmtInt` = `fmtNumber(v, 0)`). */
private const val MINUTES_DECIMALS: Int = 0

/** Playback-status codes from `MediaSnapshot.playback_status` that drive the status badge variant. */
private const val STATUS_PLAYING: String = "Playing"
private const val STATUS_PAUSED: String = "Paused"

/**
 * The literal nil sentinels the web `cleanNil` scrubs to "absent" (`!v` covers the empty string; Go's
 * `fmt.Sprintf("%v", nil)` produces `"<nil>"`, which the DB stores and the API returns verbatim). A value in
 * this set is treated exactly like a missing field.
 */
private val NIL_TOKENS: Set<String> = setOf("", "<nil>", "nil", "null")

// Raw document keys read by the surface — snake_case, served verbatim by the Go handlers (no camelCaseKeys
// transform in the shared layer), so the native reads match the wire contract.
private const val FIELD_NOW_PLAYING_TITLE = "now_playing_title"
private const val FIELD_NOW_PLAYING_ARTIST = "now_playing_artist"
private const val FIELD_PLAYBACK_SOURCE = "playback_source"
private const val FIELD_PLAYBACK_STATUS = "playback_status"
private const val FIELD_DESTINATION_NAME = "destination_name"
private const val FIELD_MILES_TO_ARRIVAL = "miles_to_arrival"
private const val FIELD_MINUTES_TO_ARRIVAL = "minutes_to_arrival"
private const val FIELD_LOCATED_AT_HOME = "located_at_home"
private const val FIELD_LOCATED_AT_WORK = "located_at_work"
private const val FIELD_LOCATED_AT_FAVORITE = "located_at_favorite"

/**
 * The slice of `MediaSnapshot` (web/src/api/types.ts) the "Now Playing" section reads — the native mirror of
 * the four fields the web consumes. Field names keep their snake_case wire form so the projection runs
 * directly off the cached API JSON; each is the raw decoded string (still subject to [cleanNil] at projection
 * time, exactly like the web reads `cleanNil(mediaData.field)` at render).
 */
data class MediaInfo(
    val nowPlayingTitle: String?,
    val nowPlayingArtist: String?,
    val playbackSource: String?,
    val playbackStatus: String?,
) {
    public companion object {
        /**
         * Decode a media body into a tolerant snapshot, or `null` when the body is absent / not a JSON object
         * — web parity: `mediaData` is `MediaSnapshot | null` and the section then renders its "No media data"
         * fallback. A present object — even one whose fields are all null — decodes to a snapshot so the card
         * renders with the web's per-field fallbacks.
         */
        public fun fromJson(element: JsonElement?): MediaInfo? {
            val obj = element as? JsonObject ?: return null
            return MediaInfo(
                nowPlayingTitle = obj.stringField(FIELD_NOW_PLAYING_TITLE),
                nowPlayingArtist = obj.stringField(FIELD_NOW_PLAYING_ARTIST),
                playbackSource = obj.stringField(FIELD_PLAYBACK_SOURCE),
                playbackStatus = obj.stringField(FIELD_PLAYBACK_STATUS),
            )
        }
    }
}

/**
 * The slice of `LocationSnapshot` (web/src/api/types.ts) the "Navigation" section reads. `milesToArrival` is
 * SI metres on the wire (the legacy field name notwithstanding — it is the input to `convertDistanceFromSI`,
 * exactly as the web feeds `toDistanceDisplay`); `minutesToArrival` is minutes. The three presence flags
 * default to `false` when absent (web reads `located_at_* &&`), so an absent flag simply hides its chip.
 */
data class LocationInfo(
    val destinationName: String?,
    val milesToArrival: Double?,
    val minutesToArrival: Double?,
    val locatedAtHome: Boolean,
    val locatedAtWork: Boolean,
    val locatedAtFavorite: Boolean,
) {
    public companion object {
        /**
         * Decode a location body into a tolerant snapshot, or `null` when the body is absent / not a JSON
         * object — web parity: `locationData` is `LocationSnapshot | null` and the section then renders its
         * "No location data" fallback.
         */
        public fun fromJson(element: JsonElement?): LocationInfo? {
            val obj = element as? JsonObject ?: return null
            return LocationInfo(
                destinationName = obj.stringField(FIELD_DESTINATION_NAME),
                milesToArrival = obj.doubleField(FIELD_MILES_TO_ARRIVAL),
                minutesToArrival = obj.doubleField(FIELD_MINUTES_TO_ARRIVAL),
                locatedAtHome = obj.boolField(FIELD_LOCATED_AT_HOME),
                locatedAtWork = obj.boolField(FIELD_LOCATED_AT_WORK),
                locatedAtFavorite = obj.boolField(FIELD_LOCATED_AT_FAVORITE),
            )
        }
    }
}

/**
 * The native "snapshot" the host supplies — the union of the web component's two props (`mediaData` +
 * `locationData`). A present snapshot (even one with a null [media] and a null [location]) renders both
 * sections with the web's inline fallbacks; a null snapshot selects the friendly top-level empty state so the
 * panel never collapses to a blank box. The host owns the feed lifecycle (P1/S8); this type carries no
 * Compose/HTTP.
 */
data class MediaNavSnapshot(
    val media: MediaInfo?,
    val location: LocationInfo?,
)

/** The status-badge variant beside the track — web `Playing`→green, `Paused`→amber, anything else→neutral. */
enum class MediaBadge { Success, Warning, Neutral }

/** A presence chip rendered under the destination, in the web's source order (home, work, favorite). */
enum class MediaPlace { Home, Work, Favorite }

/**
 * The render-ready "Now Playing" card. Each string is the [cleanNil]-scrubbed value or `null` when absent; the
 * Compose boundary applies the localized fallback (web `… || t('telemetry.nothingPlaying')` etc.) so this type
 * stays free of any i18n dependency and remains unit-testable off-device.
 *
 * @property title the track title, or `null` → view renders the "Nothing playing" fallback.
 * @property artist the track artist, or `null` → view renders the "Unknown artist" fallback.
 * @property source the playback source chip text, or `null` → the source chip is hidden.
 * @property status the playback status + its badge variant, or `null` → the status badge is hidden.
 */
data class NowPlayingDisplay(
    val title: String?,
    val artist: String?,
    val source: String?,
    val status: PlaybackStatusDisplay?,
)

/** The playback-status badge: its already-scrubbed [text] and the resolved [badge] variant. */
data class PlaybackStatusDisplay(
    val text: String,
    val badge: MediaBadge,
)

/**
 * The render-ready active destination. [distance] is the SI metres converted once to the user's display unit
 * and formatted with its unit suffix (web `fmtNumber(toDistanceDisplay(m))` + unit), or `null` when the wire
 * figure is absent; [etaMinutes] is the localized integer minutes (web `fmtInt`), or `null` when absent — the
 * view appends the localized "min" label.
 */
data class DestinationDisplay(
    val name: String,
    val distance: String?,
    val etaMinutes: String?,
)

/**
 * The render-ready "Navigation" section. [destination] is `null` when there is no active destination (web
 * `destination_name ?`), in which case the view renders the "No active destination" fallback; [places] is the
 * ordered list of presence chips to render.
 */
data class NavigationDisplay(
    val destination: DestinationDisplay?,
    val places: List<MediaPlace>,
)

/**
 * The fully projected, render-ready view — everything the web component computes before returning JSX. Pure
 * data (no Compose types) so the projection is unit-tested without a UI host, and each instance doubles as the
 * surface's per-state snapshot.
 *
 * @property nowPlaying the "Now Playing" card, or `null` when there is no media snapshot (→ "No media data").
 * @property navigation the "Navigation" section, or `null` when there is no location snapshot
 *   (→ "No location data").
 */
data class MediaNavDisplay(
    val nowPlaying: NowPlayingDisplay?,
    val navigation: NavigationDisplay?,
)

/**
 * Pure projection from the panel's inputs to its render state — a 1:1 port of the web component's derivations:
 * the `cleanNil` scrubbing, the `Playing`/`Paused`/neutral status mapping, the SINGLE SI→display distance
 * conversion at the render site, the localized minute formatting, and the home/work/favorite presence chips.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate; the composable only
 * resolves localized strings + token colors and draws what these return.
 */
object MediaNavigationPanelProjection {
    /**
     * Maps the panel's `(snapshot, isLoading)` onto the shared cache-then-network [UiState] (P1/S8): loading
     * wins outright (skeleton chrome), a present snapshot renders [UiPhase.Content], and an absent snapshot
     * renders [UiPhase.Empty] (a friendly no-data state). The host's stateful binding can additionally carry
     * refreshing/stale/offline/error; the composable renders those too.
     */
    fun projectUiState(
        snapshot: MediaNavSnapshot?,
        isLoading: Boolean,
    ): UiState<MediaNavSnapshot> =
        when {
            isLoading -> UiState.loading()
            snapshot != null -> UiState(phase = UiPhase.Content, data = snapshot)
            else -> UiState(phase = UiPhase.Empty)
        }

    /**
     * The render-ready [MediaNavDisplay] for the given [snapshot], [prefs] (the user's display units, web
     * `useUnits`), and [locale] (the grouping/separator locale, web `fmtNumber`'s active locale). Mirrors the
     * web's two top-level branches: a null [MediaNavSnapshot.media] / [MediaNavSnapshot.location] collapses
     * the corresponding section to its inline fallback (a `null` here), a present one is projected in full.
     */
    fun display(
        snapshot: MediaNavSnapshot,
        prefs: UnitPref,
        locale: Locale,
    ): MediaNavDisplay =
        MediaNavDisplay(
            nowPlaying = snapshot.media?.let(::nowPlaying),
            navigation = snapshot.location?.let { navigation(it, prefs, locale) },
        )

    /**
     * Web "Now Playing" card derivation: every field is `cleanNil`-scrubbed; the status (when present) is
     * paired with its badge variant. A null title/artist surfaces as `null` so the view can apply the
     * localized "Nothing playing" / "Unknown artist" fallback.
     */
    fun nowPlaying(media: MediaInfo): NowPlayingDisplay {
        val status = cleanNil(media.playbackStatus)
        return NowPlayingDisplay(
            title = cleanNil(media.nowPlayingTitle),
            artist = cleanNil(media.nowPlayingArtist),
            source = cleanNil(media.playbackSource),
            status = status?.let { PlaybackStatusDisplay(text = it, badge = playbackBadge(it)) },
        )
    }

    /**
     * Web "Navigation" section derivation: the active destination (web `destination_name ?`, treating a blank
     * name as absent) carries the single-conversion distance and the localized minutes; the presence chips are
     * collected in source order.
     */
    fun navigation(
        location: LocationInfo,
        prefs: UnitPref,
        locale: Locale,
    ): NavigationDisplay {
        val precision = (prefs.precision ?: DEFAULT_DECIMAL_PRECISION).coerceAtLeast(0)
        val destination =
            location.destinationName
                ?.takeIf { it.isNotEmpty() }
                ?.let { name ->
                    DestinationDisplay(
                        name = name,
                        distance = location.milesToArrival?.let { distanceDisplay(it, prefs, precision, locale) },
                        etaMinutes = location.minutesToArrival?.let { formatNumber(it, MINUTES_DECIMALS, locale) },
                    )
                }
        return NavigationDisplay(destination = destination, places = places(location))
    }

    /** Web `Playing`→green badge, `Paused`→amber badge, anything else (incl. an unknown status)→neutral. */
    fun playbackBadge(status: String): MediaBadge =
        when (status) {
            STATUS_PLAYING -> MediaBadge.Success
            STATUS_PAUSED -> MediaBadge.Warning
            else -> MediaBadge.Neutral
        }

    /** Web presence chips: home / work / favorite, each shown only when its flag is set, in source order. */
    fun places(location: LocationInfo): List<MediaPlace> =
        buildList {
            if (location.locatedAtHome) add(MediaPlace.Home)
            if (location.locatedAtWork) add(MediaPlace.Work)
            if (location.locatedAtFavorite) add(MediaPlace.Favorite)
        }

    /**
     * Web `{fmtNumber(toDistanceDisplay(meters))} {distanceUnit}`. The SI metres are converted to the user's
     * display unit ONCE here (web `toDistanceDisplay` = `convertDistanceFromSI`), formatted at the user's
     * precision, and suffixed with the unit label.
     */
    private fun distanceDisplay(
        meters: Double,
        prefs: UnitPref,
        precision: Int,
        locale: Locale,
    ): String = "${formatNumber(convertDistanceFromSI(meters, prefs.distance), precision, locale)} ${prefs.distance.label}"

    /**
     * Format a number the way the web `fmtNumber(value, decimals)` does:
     * `Number.toLocaleString(locale, { minimumFractionDigits, maximumFractionDigits })` with grouping
     * separators and ECMAScript `halfExpand` rounding (round half away from zero). A non-finite input is
     * coerced to 0 (web `safeNumber`) and a signed zero normalized to positive zero so a `-0.0` renders "0",
     * matching `Intl.NumberFormat`.
     */
    fun formatNumber(
        value: Double,
        decimals: Int,
        locale: Locale,
    ): String {
        val finite = if (value.isFinite()) value else 0.0
        val normalized = if (finite == 0.0) 0.0 else finite
        val formatter =
            NumberFormat.getNumberInstance(locale).apply {
                minimumFractionDigits = decimals
                maximumFractionDigits = decimals
                roundingMode = RoundingMode.HALF_UP
                isGroupingUsed = true
            }
        return formatter.format(normalized)
    }
}

/**
 * Web `cleanNil`: returns the value unless it is the empty string or a Go nil sentinel (`"<nil>"` / `"nil"` /
 * `"null"`), in which case it is treated as absent (`null`). A `null` input stays `null`.
 */
fun cleanNil(value: String?): String? = value?.takeUnless { it in NIL_TOKENS }

/**
 * Resolve the BCP-47 [tag] from the user's settings (web `useUnits` locale) to a [Locale], falling back to
 * en-US for a blank/absent tag — the same default the web `fmtNumber` applies when no locale is configured.
 */
internal fun resolveDisplayLocale(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a track
 * title, an artist, a destination, or the owner's home/work presence — so a diagnostics line can never leak
 * media metadata or owner movement.
 */
object MediaNavigationPanelDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "MediaNavigationPanel"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

/** Read a numeric field, or `null` when absent / JSON `null` / not a JSON number (web typed `number`). */
private fun JsonObject.doubleField(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

/** Read a boolean field, defaulting to `false` when absent / JSON `null` / not a JSON boolean. */
private fun JsonObject.boolField(key: String): Boolean = (this[key] as? JsonPrimitive)?.booleanOrNull ?: false

/** Read a JSON string field, or `null` when absent / JSON `null` / not a quoted string (web typed `string`). */
private fun JsonObject.stringField(key: String): String? =
    (this[key] as? JsonPrimitive)?.let { if (it.isString) it.contentOrNull else null }
