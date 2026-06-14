// Pure, framework-free model + projection + diagnostics + strings for the RoutePlayback shared surface —
// the native analogue of everything the web component derives before returning JSX
// (web/src/components/maps/RoutePlayback.tsx). No Compose, no Android, no HTTP: every declaration here is
// unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render
// layer over the shared atomic map widget.
//
// RoutePlayback is the self-contained route-replay widget. The web component is *controlled*: it receives
// the time-ordered `points: PlaybackPoint[]` as a prop. Those points are produced upstream from the drive's
// GPS feed — `useDrivePositions(driveId)` (`GET /drives/{id}/positions` → DrivePosition[]), filtered to
// finite, non-`(0,0)` coordinates and sorted ascending by timestamp (web `MapOverviewPage` `playbackPoints`).
// This file owns the native port of that path:
//   - [RoutePlaybackTrack.fromPositions] reproduces the web positions → points projection (parse, filter to
//     valid coordinates, sort by time) onto the shared [RouteSample] the atomic map widget consumes.
//   - [RoutePlaybackState] folds the upstream cache-then-network lifecycle so every prompt state —
//     loading / content / empty / stale / offline / error — renders from the REAL [Resource] of the
//     positions feed, never fabricated.
//   - [RoutePlaybackProjection] reproduces the failure classification the shared QueryError consumes.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/RoutePlayback — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen is illegal in a package identifier), so the package intentionally diverges from
// the path — exactly as the sibling shared surfaces do. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.routeplayback

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.maps.GeoPoint
import io.teslasync.android.components.maps.RouteSample
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset

/**
 * Canonical metadata for this surface — pinned so the native and web surfaces stay in lockstep. The web
 * replay route is `/drives/{id}/replay`; the points the widget replays come from the
 * `/drives/{driveID}/positions` feed (web `useDrivePositions`), bound through the shared S8 holder.
 */
object RoutePlaybackRegistration {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "RoutePlayback"
}

// ------------------------------------------------------------------
// Track
// ------------------------------------------------------------------

/**
 * The time-ordered GPS samples the widget replays — the native port of the web `points: PlaybackPoint[]`
 * prop. Samples are the shared [RouteSample] the atomic map widget consumes (SI metres / m·s⁻¹ / fraction,
 * formatted only at the render boundary). A track whose samples contain no valid coordinate is [isEmpty]
 * (web `trail.length === 0` → empty state).
 *
 * @property samples the ordered, valid-coordinate, time-sorted positions to play back.
 */
data class RoutePlaybackTrack(
    val samples: List<RouteSample>,
) {
    /** Whether there is nothing to draw — no sample carries a valid coordinate (web `trail.length === 0`). */
    val isEmpty: Boolean get() = samples.none { it.point.isValid() }

    /** Number of samples carrying a valid, renderable coordinate. */
    val validSampleCount: Int get() = samples.count { it.point.isValid() }

    companion object {
        /** The empty track — nothing loaded yet, or a drive with no replayable positions. */
        val EMPTY: RoutePlaybackTrack = RoutePlaybackTrack(emptyList())

        /**
         * Builds the track from the raw `/drives/{id}/positions` JSON — the native port of the web
         * `MapOverviewPage.playbackPoints` projection: read each position's coordinate + timestamp + optional
         * metrics, keep only finite, non-`(0,0)` coordinates with a parseable timestamp, then sort ascending
         * by time so playback runs forward. A bare array (`DrivePosition[]`) or a `{ positions: [...] }`
         * envelope are both accepted; anything else yields [EMPTY] (web `safeArray` → `[]`).
         */
        fun fromPositions(json: JsonElement?): RoutePlaybackTrack {
            val array = positionsArray(json) ?: return EMPTY
            val samples =
                array
                    .mapNotNull { element -> (element as? JsonObject)?.let(::sampleOf) }
                    .filter { it.point.isValid() && (it.point.lat != 0.0 || it.point.lng != 0.0) }
                    .sortedBy { it.timestampMs }
            return RoutePlaybackTrack(samples)
        }

        private fun positionsArray(json: JsonElement?): JsonArray? =
            when (json) {
                is JsonArray -> json
                is JsonObject -> json["positions"] as? JsonArray
                else -> null
            }

        /**
         * Projects one position object onto a [RouteSample], or `null` when it lacks a usable coordinate or
         * timestamp (web filters those out before building the trail). Both snake_case and camelCase keys are
         * read so the projection survives the API's `camelCaseKeys` dual-shape response.
         */
        private fun sampleOf(obj: JsonObject): RouteSample? {
            val lat = doubleField(obj, "latitude", "lat")
            val lng = doubleField(obj, "longitude", "lng", "lon")
            val timestampMs = stringField(obj, "timestamp", "created_at", "createdAt")?.let(::parseEpochMillis)
            return if (lat == null || lng == null || timestampMs == null) {
                null
            } else {
                RouteSample(
                    point = GeoPoint(lat, lng),
                    timestampMs = timestampMs,
                    speed = doubleField(obj, "speed"),
                    soc = doubleField(obj, "battery_level", "batteryLevel", "soc"),
                    power = doubleField(obj, "power"),
                )
            }
        }

        /** First finite numeric value across [names] (tolerant of numeric or string-numeric JSON), else null. */
        private fun doubleField(
            obj: JsonObject,
            vararg names: String,
        ): Double? =
            names
                .asSequence()
                .mapNotNull { (obj[it] as? JsonPrimitive)?.doubleOrNull }
                .firstOrNull { it.isFinite() }

        /** First non-blank string value across [names], else null. */
        private fun stringField(
            obj: JsonObject,
            vararg names: String,
        ): String? =
            names
                .asSequence()
                .mapNotNull { (obj[it] as? JsonPrimitive)?.contentOrNull }
                .firstOrNull { it.isNotBlank() }

        /**
         * Tolerant ISO-8601 → epoch-millis parse (the native `new Date(ts).getTime()`): an offset datetime
         * (`…Z` / `…+02:00`), a UTC instant, then a zoneless local datetime assumed UTC. Returns null on an
         * unparseable value so the caller can skip the sample (web `Number.isFinite` guard).
         */
        private fun parseEpochMillis(raw: String): Long? =
            runCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }
                .recoverCatching { Instant.parse(raw).toEpochMilli() }
                .recoverCatching { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC).toEpochMilli() }
                .getOrNull()
    }
}

// ------------------------------------------------------------------
// State
// ------------------------------------------------------------------

/**
 * The immutable, UI-thread-free state the ViewModel exposes. It folds the upstream positions-feed lifecycle
 * ([phase]/[stale]/[refreshing]/[errorKind]) — so loading / empty / error / stale / offline all render from
 * the REAL cache-then-network [io.teslasync.shared.core.data.repo.Resource], never fabricated — over the
 * resolved [track]. The replay clock itself lives in the atomic map widget (a Compose `remember`), so this
 * state carries only the lifecycle the surface chrome switches on. Pure data, so the whole surface is
 * exercised off-device.
 */
data class RoutePlaybackState(
    val phase: UiPhase,
    val track: RoutePlaybackTrack = RoutePlaybackTrack.EMPTY,
    val stale: Boolean = false,
    val refreshing: Boolean = false,
    val errorKind: ErrorKind? = null,
    val httpStatus: Int? = null,
) {
    /** The samples the atomic widget plays back (web `points`). */
    val samples: List<RouteSample> get() = track.samples

    /** True while a first load is in flight with nothing cached to show. */
    val isLoading: Boolean get() = phase == UiPhase.Loading

    /** True when the interactive map + replay should render. */
    val isContent: Boolean get() = phase == UiPhase.Content

    /** True when the drive resolved with no replayable positions (web `trail.length === 0`). */
    val isEmpty: Boolean get() = phase == UiPhase.Empty

    /** True on a hard failure with nothing cached to fall back on. */
    val isError: Boolean get() = phase == UiPhase.Error

    /** True when cached positions are shown because the network was unreachable / they are stale. */
    val isOffline: Boolean get() = stale && (phase == UiPhase.Content || phase == UiPhase.Empty)

    /** True when a retry affordance should be offered (hard error, or stale/offline last-known data). */
    val canRetry: Boolean get() = errorKind != null

    companion object {
        /** The pre-collection state: a first load with nothing cached. */
        fun loading(): RoutePlaybackState = RoutePlaybackState(phase = UiPhase.Loading)
    }
}

// ------------------------------------------------------------------
// Projection
// ------------------------------------------------------------------

/**
 * Pure projection for the surface — the failure classification the shared QueryError consumes. Side-effect
 * free, so the surface's error behavior is verified without Compose, coroutines, or network.
 */
object RoutePlaybackProjection {
    /**
     * Maps the folded [ErrorKind] + HTTP status onto the shared [QueryErrorKind] the QueryError view renders
     * (the native port of the web `<QueryError>` error taxonomy): a transient circuit-open → "waiting", a
     * network/timeout failure → "offline", otherwise the HTTP-status classification.
     */
    fun queryErrorKindFor(
        errorKind: ErrorKind?,
        httpStatus: Int?,
    ): QueryErrorKind {
        val waiting = errorKind == ErrorKind.CircuitOpen
        val online = errorKind != ErrorKind.Network && errorKind != ErrorKind.Timeout
        return classifyQueryError(status = httpStatus, online = online, transientWaiting = waiting)
    }
}

// ------------------------------------------------------------------
// Strings + diagnostics
// ------------------------------------------------------------------

/**
 * Localized labels the surface folds in — built from `stringResource` at the render boundary (tests pass a
 * deterministic instance), keeping the projection a pure, locale-stable function. Every string resolves
 * through the P1/S10 catalog; the error/empty recovery copy is owned by the shared QueryError/EmptyState.
 *
 * @property emptyMessage web `maps.routePlayback.empty` — the no-GPS-points empty line.
 * @property mapLabel web `maps.routePlayback.mapLabel` — the map `role="application"` aria-label.
 * @property resourceName the noun the QueryError names ("…couldn't load {resourceName}").
 * @property summaryLabel screen-reader route-summary prefix (the atomic accessible summary).
 * @property startLabel start-marker TalkBack title.
 * @property endLabel end-marker TalkBack title.
 * @property offlineLabel the stale/offline pill copy.
 * @property loadingLabel the refreshing pill copy.
 * @property retryLabel the retry affordance copy.
 */
data class RoutePlaybackStrings(
    val emptyMessage: String,
    val mapLabel: String,
    val resourceName: String,
    val summaryLabel: String,
    val startLabel: String,
    val endLabel: String,
    val offlineLabel: String,
    val loadingLabel: String,
    val retryLabel: String,
)

/**
 * The PII-safe diagnostics this surface emits (P1/S11). Every event carries only the surface [SLUG] — never
 * a drive id, position, or any user data — so a diagnostics line can never leak which drive the user is
 * replaying or where they are.
 */
object RoutePlaybackDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = RoutePlaybackRegistration.SLUG

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the one mandated `view.opened` diagnostic for this surface (P1/S11). Call once on first composition. */
    fun recordViewOpened(logger: Logger) = logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
}
