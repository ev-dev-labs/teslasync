// Pure, framework-free model + projection for the Now Playing dashboard widget — the native analogue of
// the data the web component derives before returning JSX
// (web/src/features/dashboard/widgets/MediaNowPlayingWidget.tsx). No Compose, no Android framework, no
// HTTP: every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer. Media carries no SI units (title/artist/source are strings, volume is a
// raw level, elapsed/duration are millisecond clocks), so unlike the temperature/energy surfaces this
// projection needs no UnitFormatter — it reproduces the web's field reads, null fallbacks and clock
// formatting verbatim.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/MediaNowPlayingWidget — the P3 prompt's allowed-files path) cannot
// form a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so
// the package intentionally diverges from the path — exactly as the sibling ClimateStatusWidget does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.medianowplaying

import io.teslasync.shared.core.api.generated.Vehicle
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale
import kotlin.math.floor

/** Em dash shown for a missing title/artist — the web `'—'` fallback and the shared formatter empty value. */
internal const val EM_DASH: String = "\u2014"

private const val FIELD_TITLE = "now_playing_title"
private const val FIELD_ARTIST = "now_playing_artist"
private const val FIELD_ALBUM = "now_playing_album"
private const val FIELD_STATION = "now_playing_station"
private const val FIELD_DURATION = "now_playing_duration"
private const val FIELD_ELAPSED = "now_playing_elapsed"
private const val FIELD_PLAYBACK_STATUS = "playback_status"
private const val FIELD_PLAYBACK_SOURCE = "playback_source"
private const val FIELD_AUDIO_VOLUME = "audio_volume"
private const val FIELD_AUDIO_VOLUME_MAX = "audio_volume_max"

/** The `playback_status` value that lights the "Playing" chip (web `status === 'Playing'`). */
private const val STATUS_PLAYING = "Playing"

/** Default volume scale when `audio_volume_max` is absent (web `audio_volume_max ?? 11`). */
private const val DEFAULT_VOLUME_MAX = 11.0

private const val MILLIS_PER_SECOND = 1000.0
private const val SECONDS_PER_MINUTE = 60L
private const val SECONDS_PAD_WIDTH = 2
private const val VOLUME_MAX_DECIMALS = 2

/**
 * The widget grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the `isCompact` /
 * `isTall` branches in the web source: a single 1×1 cell renders the centered compact hero, otherwise the
 * standard layout, and two-or-more rows ([isTall]) additionally show the album line and the source +
 * volume rows.
 */
data class MediaNowPlayingSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at exactly a 1×1 cell (web `size.cols === 1 && size.rows === 1`): show the compact hero. */
    val isCompact: Boolean get() = cols == 1 && rows == 1

    /** True at two or more rows (web `size.rows >= 2`): add the album line and the source + volume rows. */
    val isTall: Boolean get() = rows >= 2
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/media.ts (`media-now-playing`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay
 * in lockstep.
 */
object MediaNowPlayingRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "media-now-playing"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "media"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "MediaNowPlayingWidget"

    /** Live poll cadence the web hook requests (web `useMediaLatest(id, 5_000)`). */
    const val REFRESH_INTERVAL_MS: Long = 5_000

    /** Default footprint: 2 columns × 2 rows. */
    val DEFAULT_SIZE: MediaNowPlayingSize = MediaNowPlayingSize(cols = 2, rows = 2)

    /** Minimum footprint: 1 column × 2 rows. */
    val MIN_SIZE: MediaNowPlayingSize = MediaNowPlayingSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows. */
    val MAX_SIZE: MediaNowPlayingSize = MediaNowPlayingSize(cols = 4, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: MediaNowPlayingSize): Boolean =
        size.cols in MIN_SIZE.cols..MAX_SIZE.cols && size.rows in MIN_SIZE.rows..MAX_SIZE.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: MediaNowPlayingSize): MediaNowPlayingSize =
        MediaNowPlayingSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/**
 * The fully projected, render-ready view of the media snapshot for one footprint — the native analogue of
 * everything the web component computes before returning JSX (the title/artist/album/source reads, the
 * "Playing" flag, the progress + volume fractions and the clock strings). Pure data (no Compose types) so
 * every branch is unit-tested directly.
 *
 * @property hasData whether a media snapshot object was decoded (web `media` truthy); when false the
 *   surface renders its empty state instead of the now-playing body.
 * @property isCompact whether the compact 1×1 hero is shown (web `isCompact`).
 * @property isTall whether the album line and source + volume rows are shown (web `isTall`).
 * @property title the track title (web `now_playing_title ?? '—'`), em dash when absent.
 * @property artist the track artist (web `now_playing_artist ?? '—'`), em dash when absent.
 * @property album the album, or `null` when absent (web `now_playing_album`); shown only when [isTall].
 * @property source the playback source or station (web `playback_source ?? now_playing_station`), or
 *   `null` when neither resolves to a non-empty string (web's truthy `source &&` row guard).
 * @property isPlaying whether playback is active (web `playback_status === 'Playing'`) → the "Playing" chip.
 * @property showProgress whether the progress bar + clock are shown (web `duration > 0`).
 * @property progressFraction the elapsed/duration ratio clamped to 0..1 (web `min((elapsed/duration)*100, 100)`).
 * @property elapsedText the elapsed clock "m:ss" (web `formatDurationClock(elapsed)`).
 * @property durationText the duration clock "m:ss" (web `formatDurationClock(duration)`).
 * @property showVolume whether the volume row is shown (web `volume != null`).
 * @property volumeFraction the volume/volumeMax ratio clamped to 0..1 (web `min((volume/volumeMax)*100, 100)`).
 * @property volumeText the raw volume level readout (web `{volume}`).
 * @property compactContentDescription the merged TalkBack description for the compact hero ("title, artist").
 */
data class MediaNowPlayingDisplay(
    val hasData: Boolean,
    val isCompact: Boolean,
    val isTall: Boolean,
    val title: String,
    val artist: String,
    val album: String?,
    val source: String?,
    val isPlaying: Boolean,
    val showProgress: Boolean,
    val progressFraction: Float,
    val elapsedText: String,
    val durationText: String,
    val showVolume: Boolean,
    val volumeFraction: Float,
    val volumeText: String,
    val compactContentDescription: String,
) {
    companion object {
        /** The no-snapshot projection (web `media` falsy): the surface shows its empty state. */
        fun empty(size: MediaNowPlayingSize): MediaNowPlayingDisplay =
            MediaNowPlayingDisplay(
                hasData = false,
                isCompact = size.isCompact,
                isTall = size.isTall,
                title = EM_DASH,
                artist = EM_DASH,
                album = null,
                source = null,
                isPlaying = false,
                showProgress = false,
                progressFraction = 0f,
                elapsedText = EM_DASH,
                durationText = EM_DASH,
                showVolume = false,
                volumeFraction = 0f,
                volumeText = EM_DASH,
                compactContentDescription = EM_DASH,
            )
    }
}

/**
 * Pure projection from a decoded media snapshot [JsonElement] to the render-ready [MediaNowPlayingDisplay]
 * — the native port of the field reads + null guards + clock/ratio derivations in
 * `MediaNowPlayingWidget.tsx`. The web reads the snake_case fields off the `/media/latest` document; this
 * reproduces those exact reads against the typed JSON contract (a field that is absent, `null`, or not of
 * the expected JSON kind reads as missing → em dash / row hidden), so the native surface reproduces the
 * web's observable output without any unit conversion.
 */
object MediaNowPlayingProjection {
    /**
     * Project [snapshot] for the given [size]. A `null`/`JsonNull`/non-object snapshot yields
     * [MediaNowPlayingDisplay.empty] (web's falsy-`media` branch → the empty state).
     */
    fun project(
        snapshot: JsonElement?,
        size: MediaNowPlayingSize,
    ): MediaNowPlayingDisplay {
        val obj = snapshot as? JsonObject ?: return MediaNowPlayingDisplay.empty(size)

        val duration = obj.doubleField(FIELD_DURATION) ?: 0.0
        val elapsed = obj.doubleField(FIELD_ELAPSED) ?: 0.0
        val volume = obj.doubleField(FIELD_AUDIO_VOLUME)
        val volumeMax = obj.doubleField(FIELD_AUDIO_VOLUME_MAX) ?: DEFAULT_VOLUME_MAX
        val title = obj.stringField(FIELD_TITLE) ?: EM_DASH
        val artist = obj.stringField(FIELD_ARTIST) ?: EM_DASH

        return MediaNowPlayingDisplay(
            hasData = true,
            isCompact = size.isCompact,
            isTall = size.isTall,
            title = title,
            artist = artist,
            album = obj.stringField(FIELD_ALBUM),
            source = resolveSource(obj.stringField(FIELD_PLAYBACK_SOURCE), obj.stringField(FIELD_STATION)),
            isPlaying = obj.stringField(FIELD_PLAYBACK_STATUS) == STATUS_PLAYING,
            showProgress = duration > 0.0,
            progressFraction = ratio(elapsed, duration),
            elapsedText = formatDurationClock(elapsed),
            durationText = formatDurationClock(duration),
            showVolume = volume != null,
            volumeFraction = ratio(volume ?: 0.0, volumeMax),
            volumeText = volume?.let(::formatVolume) ?: EM_DASH,
            compactContentDescription = "$title, $artist",
        )
    }

    /** True when [snapshot] carries no media object (web `media` falsy) → render the empty state. */
    fun isEmptySnapshot(snapshot: JsonElement?): Boolean = snapshot !is JsonObject

    /**
     * The playback source label (web `playback_source ?? now_playing_station`), or `null` when the
     * resolved value is missing or empty (web's truthy `source &&` row guard hides an empty source). The
     * `?:` fall-through matches JS `??`: only a missing source defers to the station; a present-but-empty
     * source short-circuits exactly as in the web source.
     */
    fun resolveSource(
        playbackSource: String?,
        station: String?,
    ): String? = (playbackSource ?: station)?.takeIf { it.isNotEmpty() }

    /**
     * Format a millisecond position as the web `formatDurationClock` does — "m:ss" with a zero-padded
     * seconds field — returning the em dash for non-finite/negative input (web `FALLBACK`). Media positions
     * arrive in milliseconds, exactly as the web treats `now_playing_elapsed` / `now_playing_duration`.
     */
    fun formatDurationClock(ms: Double?): String {
        if (ms == null || !ms.isFinite() || ms < 0.0) return EM_DASH
        val totalSeconds = floor(ms / MILLIS_PER_SECOND).toLong()
        val minutes = totalSeconds / SECONDS_PER_MINUTE
        val seconds = totalSeconds % SECONDS_PER_MINUTE
        return "$minutes:${seconds.toString().padStart(SECONDS_PAD_WIDTH, '0')}"
    }

    /**
     * The fill ratio (0..1) for the progress / volume bars — the native analogue of the web
     * `Math.min((value / max) * 100, 100)` width, clamped into the track and guarded against a
     * non-positive [max] (no fill) and non-finite arithmetic.
     */
    fun ratio(
        value: Double,
        max: Double,
    ): Float {
        if (!value.isFinite() || !max.isFinite() || max <= 0.0) return 0f
        return (value / max).coerceIn(0.0, 1.0).toFloat()
    }

    /**
     * Render a raw volume level the way the web prints `{volume}`: a whole number drops its fraction
     * ("5"), otherwise up to two trailing-zero-trimmed decimals, locale-stable (en-US decimal point) so
     * the readout is deterministic regardless of device locale.
     */
    fun formatVolume(value: Double): String =
        when {
            !value.isFinite() -> EM_DASH
            value == floor(value) -> value.toLong().toString()
            else -> String.format(Locale.US, "%.${VOLUME_MAX_DECIMALS}f", value).trimEnd('0').trimEnd('.')
        }
}

/** Read a numeric field, or `null` when absent / `JsonNull` / not a JSON number (web typed `number`). */
private fun JsonObject.doubleField(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

/** Read a JSON string field, or `null` when absent / `JsonNull` / not a quoted string (web typed `string`). */
private fun JsonObject.stringField(key: String): String? =
    (this[key] as? JsonPrimitive)?.let { if (it.isString) it.contentOrNull else null }

/**
 * The active vehicle id the widget reads media for — the native port of the web
 * `id = vehicleId ?? vehicles?.[0]?.id ?? 0`. A positive [preferredVehicleId] wins; otherwise the first
 * enrolled vehicle is used; `null` means neither is available (the surface shows its empty state).
 */
fun resolveVehicleId(
    preferredVehicleId: Long?,
    vehicles: List<Vehicle>?,
): Long? = preferredVehicleId?.takeIf { it > 0L } ?: firstVehicleId(vehicles)

/** The first enrolled vehicle's id, or `null` when the fleet list is absent or empty. */
fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id?.takeIf { it > 0L }
