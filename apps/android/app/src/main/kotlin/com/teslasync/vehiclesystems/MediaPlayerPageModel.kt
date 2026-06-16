// Pure, framework-free model + projections for the MediaPlayerPage vehicle-systems surface (P3/A7) — the native
// analogue of everything web/src/features/vehicle-systems/pages/MediaPlayerPage.tsx derives before composing its
// "now playing / volume / listening history" dashboard. No Compose, no Android UI, no HTTP: every declaration here is
// plain Kotlin (it references only the kotlinx-serialization JSON model, the framework-free UnitPreferences locale
// resolver, the JVM number/date formatters, and the diagnostics Logger), so the composable stays a thin render layer
// and all of this is exercised off-device by the :android:testDebugUnitTest gate.
//
// The web page reads two backend feeds — `GET /media/latest` (the now-playing snapshot, web `useQuery(['media',
// 'latest'])`) and `GET /media?limit=500` (the listening history, web `useQuery(['media','history'])`) — then folds the
// history through a useMemo chain: derived stats (unique tracks / top source / average volume), the volume-over-time
// series, and the source-distribution slices. This file ports that decode ([parseLatestMedia]/[parseMediaHistory]) and
// every derivation ([mediaStats]/[volumePoints]/[sourceSlices]/[mediaProgressPercent]/[formatPlayTime]) verbatim, plus
// the page's display helpers ([MediaPlayerDisplayPrefs]: locale-aware integer + fixed-decimal number formatting, the
// web `fmtInt`/`fmtNumber`). Audio volume is a raw 0–max scale (not an SI quantity), so there is no unit conversion —
// only the locale formatting the web applies at the render boundary.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
// `TooManyFunctions` is suppressed for the parity-complete derivation set.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.vehiclesystems.mediaplayer

import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `MediaPlayerPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("mediaPlayer", "/media-player", NavGroup.VehicleSystems)`, so [io.teslasync.android.navigation.PageHosts]
 * binds this surface to that destination (and its `/media-player` deep link) without the nav module depending on it.
 */
object MediaPlayerPageRegistration {
    /** The navigation destination id (Destinations.kt `page("mediaPlayer", "/media-player", …)`). */
    const val ROUTE_ID: String = "mediaPlayer"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/media-player"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no media payload. */
    const val SLUG: String = "MediaPlayerPage"

    /** The history page size the listening-history read requests (web `?limit=500`). */
    const val HISTORY_LIMIT: Int = 500

    /** The default volume-gauge maximum when a snapshot omits `audio_volume_max` (web `|| 11`). */
    const val DEFAULT_VOLUME_MAX: Double = 11.0
}

/** Em dash shown for a missing data value (web `?? '—'`). */
const val MEDIA_EM_DASH: String = "\u2014"

/** The two-dash fallback the web uses for a missing top-source / track / artist (web `'--'`). */
const val MEDIA_DOUBLE_DASH: String = "--"

private const val MILLIS_PER_SECOND = 1000L
private const val SECONDS_PER_MINUTE = 60L
private const val PERCENT = 100.0
private const val UNKNOWN_SOURCE = "Unknown"
private const val MEDIA_DEFAULT_LOCALE = "en-US"

/* ------------------------------------------------------------------ */
/*  Domain model (the web MediaSnapshot shape)                        */
/* ------------------------------------------------------------------ */

/** One decoded media snapshot — a row of `GET /media` / the `GET /media/latest` payload (web `MediaSnapshot`). */
data class MediaSnapshot(
    val id: Long,
    val playbackStatus: String?,
    val playbackSource: String?,
    val nowPlayingTitle: String?,
    val nowPlayingArtist: String?,
    val nowPlayingAlbum: String?,
    val nowPlayingStation: String?,
    val nowPlayingElapsedMs: Double?,
    val nowPlayingDurationMs: Double?,
    val audioVolume: Double?,
    val audioVolumeMax: Double?,
    val audioVolumeIncrement: Double?,
    val createdAt: String,
)

/** The playback status bucket the web `statusVariant`/`statusLabel` collapse a raw status string into. */
enum class MediaStatusKind {
    Playing,
    Paused,
    Stopped,
    ;

    companion object {
        /** Maps a raw `playback_status` to its bucket (web: contains "playing" → Playing, "paused" → Paused, else). */
        fun fromStatus(status: String?): MediaStatusKind {
            val s = (status ?: "").lowercase(Locale.ROOT)
            return when {
                s.contains("playing") -> Playing
                s.contains("paused") -> Paused
                else -> Stopped
            }
        }
    }
}

/** The derived listening stats over the history (web `stats` useMemo). */
data class MediaStats(
    val uniqueTracks: Int,
    val topSource: String,
    val avgVolume: Double,
)

/** One volume-over-time sample — an audio volume at a formatted timestamp (web `volumeChartData`). */
data class MediaVolumePoint(
    val timeLabel: String,
    val volume: Double,
)

/** One source-distribution slice — a playback source, its snapshot count, and its share (web `SourceSlice`). */
data class MediaSourceSlice(
    val name: String,
    val value: Int,
    val fraction: Double,
)

/* ------------------------------------------------------------------ */
/*  Display preferences (web fmtInt / fmtNumber at the render boundary)*/
/* ------------------------------------------------------------------ */

/**
 * The display-boundary number helpers the page applies — the Kotlin port of the web page's `fmtInt`/`fmtNumber`
 * (web/src/lib/numberFormat.ts), bound to the user's locale (web `useFormatting`/`Intl.NumberFormat`). Audio volume
 * is a raw device scale, not an SI quantity, so there is no unit conversion here — only locale-aware formatting.
 */
data class MediaPlayerDisplayPrefs(
    val locale: String,
) {
    private val resolvedLocale: Locale get() = Locale.forLanguageTag(locale)

    /** Rounds a double to a whole number in the user's locale (web `fmtInt`). */
    fun integer(value: Double): String {
        if (!value.isFinite()) return MEDIA_EM_DASH
        return NumberFormat.getIntegerInstance(resolvedLocale).format(value.roundToLong())
    }

    /** Formats an integer count in the user's locale (web `fmtInt`). */
    fun integer(value: Int): String = NumberFormat.getIntegerInstance(resolvedLocale).format(value.toLong())

    /** Formats with a fixed number of fraction digits in the user's locale (web `fmtNumber(value, digits)`). */
    fun decimal(
        value: Double,
        digits: Int,
    ): String {
        if (!value.isFinite()) return MEDIA_EM_DASH
        val nf =
            NumberFormat.getNumberInstance(resolvedLocale).apply {
                minimumFractionDigits = digits
                maximumFractionDigits = digits
            }
        return nf.format(value)
    }

    companion object {
        /** The metric/en-US default, for previews / cold start before the settings document loads. */
        val DEFAULT: MediaPlayerDisplayPrefs = fromSettings(null)

        /** Resolves the display locale from the raw `/settings` document (web `useFormatting`). */
        fun fromSettings(settings: JsonElement?): MediaPlayerDisplayPrefs =
            MediaPlayerDisplayPrefs(UnitPreferences.fromSettings(settings).locale ?: MEDIA_DEFAULT_LOCALE)
    }
}

/* ------------------------------------------------------------------ */
/*  JSON decode (web useQuery queryFn payloads)                        */
/* ------------------------------------------------------------------ */

/**
 * Decodes the `GET /media/latest` payload into a single [MediaSnapshot] (web `useQuery(['media','latest'])`). Returns
 * `null` when the payload is absent or not a JSON object (web `latest?` optional chaining everywhere downstream).
 */
fun parseLatestMedia(payload: JsonElement?): MediaSnapshot? {
    val obj = payload as? JsonObject ?: return null
    return readSnapshot(obj)
}

/**
 * Decodes the `GET /media?limit=500` payload into the listening-history list (web `useQuery(['media','history'])`).
 * Accepts either a bare JSON array or a `{ "data": [...] }`/`{ "items": [...] }` envelope; anything else is an empty
 * history (web `history?.length` guards). Non-object rows are skipped.
 */
fun parseMediaHistory(payload: JsonElement?): List<MediaSnapshot> {
    val array =
        when (payload) {
            is JsonArray -> payload
            is JsonObject -> (payload["data"] as? JsonArray) ?: (payload["items"] as? JsonArray)
            else -> null
        } ?: return emptyList()
    return array.mapNotNull { element -> (element as? JsonObject)?.let(::readSnapshot) }
}

private fun readSnapshot(obj: JsonObject): MediaSnapshot =
    MediaSnapshot(
        id = obj.long("id") ?: 0L,
        playbackStatus = obj.string("playback_status"),
        playbackSource = obj.string("playback_source"),
        nowPlayingTitle = obj.string("now_playing_title"),
        nowPlayingArtist = obj.string("now_playing_artist"),
        nowPlayingAlbum = obj.string("now_playing_album"),
        nowPlayingStation = obj.string("now_playing_station"),
        nowPlayingElapsedMs = obj.double("now_playing_elapsed"),
        nowPlayingDurationMs = obj.double("now_playing_duration"),
        audioVolume = obj.double("audio_volume"),
        audioVolumeMax = obj.double("audio_volume_max"),
        audioVolumeIncrement = obj.double("audio_volume_increment"),
        createdAt = obj.string("created_at").orEmpty(),
    )

/* ------------------------------------------------------------------ */
/*  Derivations (web useMemo chain over the history)                  */
/* ------------------------------------------------------------------ */

/**
 * The unique-tracks / top-source / average-volume stats over [history] (web `stats` useMemo). An empty history yields
 * zero unique tracks, the [MEDIA_DOUBLE_DASH] top source, and zero average volume (web's `{ uniqueTracks: 0,
 * topSource: '--', avgVolume: 0 }`).
 */
fun mediaStats(history: List<MediaSnapshot>): MediaStats {
    if (history.isEmpty()) {
        return MediaStats(uniqueTracks = 0, topSource = MEDIA_DOUBLE_DASH, avgVolume = 0.0)
    }
    val uniqueTitles = history.mapNotNull { it.nowPlayingTitle?.takeIf { title -> title.isNotBlank() } }.toSet()
    val sourceCounts = countBySource(history) { it.playbackSource?.takeIf(String::isNotBlank) }
    val topSource = sourceCounts.entries.maxByOrNull { it.value }?.key ?: MEDIA_DOUBLE_DASH
    val avgVolume = history.sumOf { it.audioVolume ?: 0.0 } / history.size
    return MediaStats(uniqueTracks = uniqueTitles.size, topSource = topSource, avgVolume = avgVolume)
}

/**
 * The volume-over-time series (web `volumeChartData` useMemo): the history sorted oldest-first, each point a formatted
 * timestamp ([clockLabel]) and its audio volume (missing volume → 0, web `?? 0`).
 */
fun volumePoints(
    history: List<MediaSnapshot>,
    zone: ZoneId = ZoneId.systemDefault(),
): List<MediaVolumePoint> {
    if (history.isEmpty()) return emptyList()
    return history
        .sortedBy { epochMillisOf(it.createdAt) }
        .map { MediaVolumePoint(timeLabel = clockLabel(it.createdAt, zone), volume = it.audioVolume ?: 0.0) }
}

/**
 * The source-distribution slices (web `sourceData` useMemo): one slice per playback source (a blank source falls to
 * "Unknown", web `|| 'Unknown'`), sorted by descending snapshot count, each carrying its share of the total.
 */
fun sourceSlices(history: List<MediaSnapshot>): List<MediaSourceSlice> {
    if (history.isEmpty()) return emptyList()
    val counts = countBySource(history) { it.playbackSource?.takeIf(String::isNotBlank) ?: UNKNOWN_SOURCE }
    val total = counts.values.fold(0.0) { sum, count -> sum + count }
    return counts.entries
        .sortedByDescending { it.value }
        .map { (name, value) ->
            MediaSourceSlice(name = name, value = value, fraction = if (total > 0) value / total else 0.0)
        }
}

/** The now-playing progress as a 0–100 percentage (web `progressPct`); 0 when there is no positive duration. */
fun mediaProgressPercent(latest: MediaSnapshot?): Double {
    val duration = latest?.nowPlayingDurationMs ?: return 0.0
    if (duration <= 0.0) return 0.0
    return ((latest.nowPlayingElapsedMs ?: 0.0) / duration) * PERCENT
}

/** The effective volume-gauge maximum: the snapshot's `audio_volume_max` or the [DEFAULT_VOLUME_MAX] (web `|| 11`). */
fun volumeMaxOf(latest: MediaSnapshot?): Double {
    val max = latest?.audioVolumeMax ?: return MediaPlayerPageRegistration.DEFAULT_VOLUME_MAX
    return if (max > 0.0) max else MediaPlayerPageRegistration.DEFAULT_VOLUME_MAX
}

/**
 * Formats a playback position from milliseconds as `m:ss` (web `fmtPlayTime`): floor to whole seconds, then minutes
 * and zero-padded seconds. Negative / non-finite input renders `0:00`.
 */
fun formatPlayTime(milliseconds: Double): String {
    if (!milliseconds.isFinite() || milliseconds < 0.0) return "0:00"
    val totalSeconds = (milliseconds / MILLIS_PER_SECOND).toLong()
    val minutes = totalSeconds / SECONDS_PER_MINUTE
    val seconds = totalSeconds % SECONDS_PER_MINUTE
    return "$minutes:${seconds.toString().padStart(2, '0')}"
}

private inline fun countBySource(
    history: List<MediaSnapshot>,
    key: (MediaSnapshot) -> String?,
): Map<String, Int> {
    val counts = LinkedHashMap<String, Int>()
    for (snapshot in history) {
        val source = key(snapshot) ?: continue
        counts[source] = (counts[source] ?: 0) + 1
    }
    return counts
}

/* ------------------------------------------------------------------ */
/*  Resource mapping + diagnostics                                    */
/* ------------------------------------------------------------------ */

/** Projects a decode over a cache-then-network [Resource] (the sibling A7 page-model helper). */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [MediaPlayerPageRegistration.SLUG] (P1/S11). Kept
 * free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first composition.
 * Carries no track title, artist, or vehicle payload.
 */
fun recordMediaPlayerPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to MediaPlayerPageRegistration.SLUG))
}

/* ------------------------------------------------------------------ */
/*  Timestamp + JSON helpers                                          */
/* ------------------------------------------------------------------ */

private val CLOCK_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("MM/dd HH:mm", Locale.ROOT)

/** Epoch millis for ordering; un-parseable timestamps sort last (web `new Date(...).getTime()`). */
private fun epochMillisOf(createdAt: String): Long = instantOf(createdAt)?.toEpochMilli() ?: Long.MAX_VALUE

/** A compact local `MM/dd HH:mm` label for a chart x-axis (web `formatDateTime`); falls back to the raw string. */
private fun clockLabel(
    createdAt: String,
    zone: ZoneId,
): String {
    val instant = instantOf(createdAt) ?: return createdAt
    return CLOCK_FORMAT.format(instant.atZone(zone))
}

/** Parses an ISO-8601 timestamp (with or without an explicit offset, falling back to UTC) to an [Instant]. */
private fun instantOf(createdAt: String): Instant? {
    if (createdAt.isBlank()) return null
    runCatching { return Instant.parse(createdAt) }
    runCatching { return OffsetDateTime.parse(createdAt).toInstant() }
    runCatching { return LocalDateTime.parse(createdAt).atZone(ZoneId.of("UTC")).toInstant() }
    return null
}

private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

private fun JsonObject.double(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

private fun JsonObject.long(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull

/** Rounds a 0–100 ratio for an accessible description (web `Math.round`). */
fun roundedPercent(value: Double): Int = value.roundToInt()
