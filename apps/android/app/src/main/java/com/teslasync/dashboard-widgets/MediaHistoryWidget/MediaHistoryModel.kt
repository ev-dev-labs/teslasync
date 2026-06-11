// Pure, framework-free model + projection for the Media History dashboard widget — the native analogue
// of the data the web component computes via `useMemo` before returning JSX
// (web/src/features/dashboard/widgets/MediaHistoryWidget.tsx). No Compose, no Android, no HTTP: every
// type here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the composable a thin
// render layer. The track rows carry no display-unit-bearing values (ids/strings/timestamps), so there is
// no SI conversion at this boundary.
//
// Field-name reconciliation (documented, not silent — Honesty Covenant #9): the web component reads
// `item.title` / `item.artist` / `item.source` / `item.playbackStatus` / `item.timestamp` off the
// `camelCaseKeys()`-transformed `/media` document. On that document only `playbackStatus` (the camel
// alias of `playback_status`) and `id` actually resolve — the real track fields are
// `now_playing_title` / `now_playing_artist` / `playback_source` and the row stamp is `ts` / `created_at`
// (see internal/api/media/handler.go). The shared S7/S8 layer serves that same canonical document
// verbatim (no camel aliasing). To honour the registry contract ("Recently played tracks: title, artist,
// source, playback history") and ship a production-polished surface, each field is read web-key-first and
// then falls back to the canonical backend key, so parity is preserved when a web-named key is present and
// the surface still renders real tracks otherwise. All web fallbacks (em dash / empty source / epoch
// stamp), the `🎵 {title} — {artist}` row formatting, the source-label rule, the playing-vs-idle accent,
// the newest-first sort, the ten-row cap, and the compact raw-first pick are reproduced exactly.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/MediaHistoryWidget — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling CommandHistoryWidget does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.mediahistory

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.shared.core.api.generated.Vehicle
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.time.Instant
import java.time.OffsetDateTime
import java.util.Locale

private const val EM_DASH = "\u2014"

/** The musical-note emoji the web prepends to every feed-row title (`🎵 ${title} — ${artist}`). */
private const val MUSIC_NOTE = "\uD83C\uDFB5"

private const val COMMA_SPACE = ", "

// Wire playback-status value compared case-insensitively, mirroring the web
// `(item.playbackStatus ?? '').toLowerCase() === 'playing'` playing-vs-idle accent test.
private const val STATUS_PLAYING = "playing"

// The web `sourceLabel` special-cases a `usb` source to the upper-cased "USB"; every other source is
// capitalised (first letter upper, remainder verbatim).
private const val SOURCE_USB_LOWER = "usb"
private const val SOURCE_USB_LABEL = "USB"

private const val MILLIS_PER_MINUTE = 60_000L
private const val MINUTES_PER_HOUR = 60L
private const val HOURS_PER_DAY = 24L

// Field keys read from each `/media` history row. The first entry in each list is the web component's
// literal read; the remainder are the canonical backend keys the shared layer actually serves.
private val TITLE_KEYS = listOf("title", "now_playing_title")
private val ARTIST_KEYS = listOf("artist", "now_playing_artist")
private val SOURCE_KEYS = listOf("source", "playback_source")
private val PLAYBACK_STATUS_KEYS = listOf("playbackStatus", "playback_status")
private val TIMESTAMP_KEYS = listOf("timestamp", "ts", "created_at")

/**
 * The widget grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the `isCompact`
 * branch in the web source: a single column renders the compact last-track row, wider footprints render
 * the newest-first track feed. The feed is always capped at [MAX_FEED_ITEMS] (web `maxItems=10`).
 */
data class MediaHistorySize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `size.cols <= 1`): show the compact last-track row. */
    val isCompact: Boolean get() = cols <= 1

    companion object {
        /** Maximum feed rows rendered, independent of footprint (web `WidgetEventFeed maxItems={10}`). */
        const val MAX_FEED_ITEMS = 10
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/media.ts (`media-history`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay
 * in lockstep.
 */
object MediaHistoryRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "media-history"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "media"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "MediaHistoryWidget"

    /** Default footprint: 2 columns × 4 rows. */
    val defaultSize = MediaHistorySize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows. */
    val minSize = MediaHistorySize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize = MediaHistorySize(cols = 4, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: MediaHistorySize): Boolean = size.cols in minSize.cols..maxSize.cols && size.rows in minSize.rows..maxSize.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: MediaHistorySize): MediaHistorySize =
        MediaHistorySize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/** Whether a track row is currently playing (green accent) or idle (muted accent); web `isPlaying` color. */
enum class MediaPlaybackTone { Playing, Idle }

/**
 * One media-history row decoded from the `/media` JSON array — the native analogue of the loosely-typed
 * `MediaSnapshot` the web widget reads. Only the fields the widget renders are projected: the [id]
 * (row key), the [title]/[artist]/[source] strings, the [playbackStatus], and the raw wire [timestamp]
 * (parsed on demand, exactly as the web keeps the string). All but [id] are nullable so a partial row
 * never throws; each is read web-key-first then canonical-backend-key (see file header).
 */
data class MediaTrackEntry(
    val id: Long,
    val title: String?,
    val artist: String?,
    val source: String?,
    val playbackStatus: String?,
    val timestamp: String?,
) {
    companion object {
        /** Project a `/media` JSON array into a tolerant list of [MediaTrackEntry] (web `select: safeArray`). */
        fun parseList(element: JsonElement?): List<MediaTrackEntry> =
            (element as? JsonArray)
                ?.mapNotNull { item -> (item as? JsonObject)?.toEntry() }
                ?: emptyList()

        private fun JsonObject.toEntry(): MediaTrackEntry =
            MediaTrackEntry(
                id = longValue("id") ?: 0L,
                title = firstStringOf(TITLE_KEYS),
                artist = firstStringOf(ARTIST_KEYS),
                source = firstStringOf(SOURCE_KEYS),
                playbackStatus = firstStringOf(PLAYBACK_STATUS_KEYS),
                timestamp = firstStringOf(TIMESTAMP_KEYS),
            )

        private fun JsonObject.longValue(key: String): Long? = (this[key] as? JsonPrimitive)?.longOrNull

        private fun JsonObject.stringValue(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

        // Reads the first key that yields a JSON string, mirroring the web read with a canonical fallback.
        private fun JsonObject.firstStringOf(keys: List<String>): String? = keys.firstNotNullOfOrNull { stringValue(it) }
    }
}

/**
 * Coarse, i18n-friendly relative-time bucket for a track row — the native port of the web
 * `WidgetEventFeed.formatRelativeTime` cutoffs: under a minute "just now", under an hour minutes, under a
 * day hours, otherwise the absolute timestamp. The composable maps each bucket to a localized string (or
 * a locale/zone-aware absolute date) so the pure projection carries no microcopy.
 */
sealed interface MediaEventTime {
    /** Present-but-unparseable timestamp — rendered as an em dash. */
    data object Unknown : MediaEventTime

    /** Under one minute old (web `diffMin < 1`). */
    data object JustNow : MediaEventTime

    /** Under one hour old (web `diffMin < 60`), carrying whole minutes. */
    data class MinutesAgo(
        val value: Long,
    ) : MediaEventTime

    /** Under one day old (web `diffHrs < 24`), carrying whole hours. */
    data class HoursAgo(
        val value: Long,
    ) : MediaEventTime

    /** One day or older (web `formatDateTime` fallback), carrying the epoch-millis to format absolutely. */
    data class Absolute(
        val epochMillis: Long,
    ) : MediaEventTime
}

/**
 * One projected, render-ready track row consumed by the feed. Pure data (no Compose types): the resolved
 * playing/idle [tone], the visible [title] (`🎵 {title} — {artist}` with the web em-dash fallbacks), the
 * optional [subtitle] (the source label), the [relativeTime] label, and a clean TalkBack
 * [contentDescription] folding title/artist, source, and time into one phrase (without the decorative
 * note emoji).
 */
data class MediaTrackRow(
    val id: Long,
    val tone: MediaPlaybackTone,
    val title: String,
    val subtitle: String?,
    val relativeTime: String,
    val contentDescription: String,
)

/**
 * The fully projected, render-ready view of the media history for one footprint — the native analogue of
 * everything the web component computes before returning JSX (the `feedItems` memo, the `lastTrack` pick,
 * and the compact `CompactView` text). Pure data so the projection is unit-tested without a UI host. The
 * compact fields read the RAW first entry (web `list[0]`), while [items] is the newest-first, capped feed
 * (web `WidgetEventFeed`'s own sort).
 */
data class MediaHistoryDisplay(
    val isCompact: Boolean,
    val hasItems: Boolean,
    val items: List<MediaTrackRow>,
    val compactText: String,
    val compactContentDescription: String,
)

/**
 * Localized labels + the relative-time formatters the surface folds into its output. The pure
 * [MediaHistoryProjection] reads [emptyMessage] / [formatEventTime] / [emDash]; the composable chrome
 * additionally reads [title] / [refreshLabel] / [refreshingLabel] / [offlineLabel] / [formatRelative].
 * The composable builds this from `stringResource` + an absolute-date formatter; tests pass a
 * deterministic instance. Keeping i18n out of the projection lets the projection stay a pure,
 * locale-stable function.
 */
data class MediaHistoryStrings(
    val title: String,
    val emptyMessage: String,
    val refreshLabel: String,
    val refreshingLabel: String,
    val offlineLabel: String,
    val formatEventTime: (MediaEventTime) -> String,
    val formatRelative: (FreshnessAge) -> String,
    val emDash: String = EM_DASH,
)

/**
 * Pure projection from a decoded list of [MediaTrackEntry] to the [MediaHistoryDisplay] — the native port
 * of the web component's `feedItems` memo (title/artist/source/playing derivation, newest-first sort,
 * ten-row cap), its `lastTrack` pick, and the compact `CompactView` text. [nowMillis] is injected so the
 * relative-time tiers are unit-tested deterministically.
 */
object MediaHistoryProjection {
    /** Project [entries] for [size] at [nowMillis] using the localized [strings]. */
    fun project(
        entries: List<MediaTrackEntry>,
        size: MediaHistorySize,
        strings: MediaHistoryStrings,
        nowMillis: Long,
    ): MediaHistoryDisplay {
        // Web parity: the feed re-sorts newest-first and caps at ten, independent of the API order.
        val rows =
            entries
                .sortedByDescending { sortKey(it.timestamp) }
                .take(MediaHistorySize.MAX_FEED_ITEMS)
                .map { entry -> entry.toRow(strings, nowMillis) }

        // Web parity: the compact row reads the RAW first item (web `list[0]`), not the sorted feed head.
        val first = entries.firstOrNull()
        val compactText = compactText(first, strings)

        return MediaHistoryDisplay(
            isCompact = size.isCompact,
            hasItems = rows.isNotEmpty(),
            items = rows,
            compactText = compactText,
            compactContentDescription = compactText,
        )
    }

    /**
     * The compact-row text — the native port of the web `CompactView`: when the raw first track has a
     * title it reads "{title} — {artist}" (artist em-dash-defaulted); otherwise it reads the localized
     * "No tracks played" message (web `title !== '—' ? … : t('widget.noMediaPlayed')`).
     */
    fun compactText(
        first: MediaTrackEntry?,
        strings: MediaHistoryStrings,
    ): String {
        val title = first?.title
        return if (title.isNullOrEmpty()) {
            strings.emptyMessage
        } else {
            "$title ${strings.emDash} ${first.artist ?: strings.emDash}"
        }
    }

    /**
     * The web `sourceLabel`: a `usb` source (case-insensitive) becomes "USB"; any other non-empty source
     * is capitalised (first character upper-cased, the remainder kept verbatim). A blank source yields
     * `null` so no subtitle is rendered (web `source ? sourceLabel(source) : undefined`).
     */
    fun sourceLabel(source: String?): String? =
        when {
            source.isNullOrEmpty() -> null
            source.lowercase(Locale.US) == SOURCE_USB_LOWER -> SOURCE_USB_LABEL
            else -> source.replaceFirstChar { it.titlecase(Locale.US) }
        }

    /** Whether a wire playback-status is "playing" (case-insensitive) — the web green-accent test. */
    fun isPlaying(playbackStatus: String?): Boolean = (playbackStatus ?: "").lowercase(Locale.US) == STATUS_PLAYING

    /**
     * Bucket a row's wire timestamp into a [MediaEventTime] matching the web
     * `WidgetEventFeed.formatRelativeTime`: an absent timestamp is treated as the epoch (web
     * `item.timestamp ?? new Date(0)`), a present-but-unparseable one as [MediaEventTime.Unknown], and a
     * valid one tiered just-now / minutes / hours / absolute exactly as the web floors the deltas.
     */
    fun computeEventTime(
        timestamp: String?,
        nowMillis: Long,
    ): MediaEventTime {
        val epoch = effectiveEpoch(timestamp) ?: return MediaEventTime.Unknown
        val diffMinutes = (nowMillis - epoch).floorDiv(MILLIS_PER_MINUTE)
        return when {
            diffMinutes < 1L -> MediaEventTime.JustNow
            diffMinutes < MINUTES_PER_HOUR -> MediaEventTime.MinutesAgo(diffMinutes)
            else -> {
                val diffHours = diffMinutes / MINUTES_PER_HOUR
                if (diffHours < HOURS_PER_DAY) {
                    MediaEventTime.HoursAgo(diffHours)
                } else {
                    MediaEventTime.Absolute(epoch)
                }
            }
        }
    }

    private fun MediaTrackEntry.toRow(
        strings: MediaHistoryStrings,
        nowMillis: Long,
    ): MediaTrackRow {
        val trackTitle = title ?: strings.emDash
        val trackArtist = artist ?: strings.emDash
        val subtitle = sourceLabel(source)
        val relative = strings.formatEventTime(computeEventTime(timestamp, nowMillis))
        val accessibleTitle = "$trackTitle ${strings.emDash} $trackArtist"
        return MediaTrackRow(
            id = id,
            tone = if (isPlaying(playbackStatus)) MediaPlaybackTone.Playing else MediaPlaybackTone.Idle,
            title = "$MUSIC_NOTE $accessibleTitle",
            subtitle = subtitle,
            relativeTime = relative,
            contentDescription = listOfNotNull(accessibleTitle, subtitle, relative).joinToString(COMMA_SPACE),
        )
    }

    // Web `[...items].sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp))` over `timestamp ??
    // new Date(0)`: an absent timestamp sorts as the epoch (1970), a present-but-unparseable one sorts last.
    private fun sortKey(timestamp: String?): Long = parseEpochMillis(timestamp) ?: if (timestamp == null) 0L else Long.MIN_VALUE

    // Web `item.timestamp ?? new Date(0)`: null → epoch; present-but-unparseable → null (→ Unknown).
    private fun effectiveEpoch(timestamp: String?): Long? = if (timestamp == null) 0L else parseEpochMillis(timestamp)
}

/**
 * Tolerant ISO-8601 → epoch-millis parse for a wire timestamp (the web keeps the raw string and parses on
 * demand). Returns `null` for a blank/absent or unparseable value so a partial row never throws.
 */
internal fun parseEpochMillis(raw: String?): Long? {
    if (raw.isNullOrBlank()) return null
    return runCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }
        .recoverCatching { Instant.parse(raw).toEpochMilli() }
        .getOrNull()
}

/**
 * The active vehicle id the widget reads media history for — the native port of the web
 * `vid = vehicleId ?? vehicles?.[0]?.id`. A positive [preferredVehicleId] wins; otherwise the first
 * enrolled vehicle is used; `null` means neither is available (the surface shows its empty state).
 */
fun resolveVehicleId(
    preferredVehicleId: Long?,
    vehicles: List<Vehicle>?,
): Long? = preferredVehicleId?.takeIf { it > 0L } ?: firstVehicleId(vehicles)

/** The first enrolled vehicle's id, or `null` when the fleet list is absent or empty. */
fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id?.takeIf { it > 0L }
