package io.teslasync.android.dashboard.widgets.mediahistory

import io.teslasync.android.components.datadisplay.FreshnessAge
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the MediaHistoryWidget's pure logic — the JSON parse (web-key-first with the
 * canonical `now_playing_*` / `playback_*` / `ts` fallbacks), the `sourceLabel` rule, the playing-vs-idle
 * accent test, the `WidgetEventFeed`-equivalent relative-time tiers, the projection (newest-first sort,
 * ten-row cap, `🎵 {title} — {artist}` row title, source subtitle, clean a11y label, compact raw-first
 * text), the registry metadata, the tolerant timestamp parse, and vehicle resolution. Mirrors the web spec
 * (web/src/features/dashboard/widgets/MediaHistoryWidget.tsx).
 */
class MediaHistoryProjectionTest {
    private val now = parseEpochMillis("2026-06-06T12:05:00Z")!!

    private fun strings(): MediaHistoryStrings =
        MediaHistoryStrings(
            title = "Media History",
            emptyMessage = "No tracks played",
            refreshLabel = "Refresh",
            refreshingLabel = "Loading",
            offlineLabel = "Offline",
            formatEventTime = ::renderEventTime,
            formatRelative = ::renderRelative,
        )

    private fun entry(
        title: String? = "Song",
        artist: String? = "Artist",
        source: String? = "spotify",
        playbackStatus: String? = "playing",
        timestamp: String? = "2026-06-06T12:00:00Z",
    ): MediaTrackEntry =
        MediaTrackEntry(
            id = 1,
            title = title,
            artist = artist,
            source = source,
            playbackStatus = playbackStatus,
            timestamp = timestamp,
        )

    private fun project(
        entries: List<MediaTrackEntry>,
        size: MediaHistorySize = MediaHistoryRegistration.defaultSize,
    ): MediaHistoryDisplay = MediaHistoryProjection.project(entries, size, strings(), now)

    // ---- JSON parse: canonical backend keys (web reads resolve via fallback) --------

    @Test
    fun parseListDecodesCanonicalBackendKeys() {
        val json =
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("id", 7L)
                        put("now_playing_title", "Bohemian Rhapsody")
                        put("now_playing_artist", "Queen")
                        put("playback_source", "spotify")
                        put("playback_status", "playing")
                        put("created_at", "2026-06-06T11:00:00Z")
                    },
                )
                add(JsonPrimitive("not-an-object"))
            }
        val parsed = MediaTrackEntry.parseList(json)
        assertEquals(1, parsed.size)
        assertEquals(
            MediaTrackEntry(7L, "Bohemian Rhapsody", "Queen", "spotify", "playing", "2026-06-06T11:00:00Z"),
            parsed.single(),
        )
    }

    @Test
    fun parseListPrefersWebKeysOverCanonicalFallback() {
        // When a web-named key is present it wins (literal web parity); otherwise the canonical key is used.
        val json =
            buildJsonArray {
                add(
                    buildJsonObject {
                        put("id", 3L)
                        put("title", "WebTitle")
                        put("now_playing_title", "BackendTitle")
                        put("playbackStatus", "playing")
                        put("playback_status", "paused")
                        put("timestamp", "2026-06-06T10:00:00Z")
                        put("ts", "2020-01-01T00:00:00Z")
                    },
                )
            }
        val parsed = MediaTrackEntry.parseList(json).single()
        assertEquals("WebTitle", parsed.title)
        assertEquals("playing", parsed.playbackStatus)
        assertEquals("2026-06-06T10:00:00Z", parsed.timestamp)
    }

    @Test
    fun parseListIsTolerantOfMissingNullFieldsAndNonArrays() {
        val json =
            buildJsonArray {
                add(
                    buildJsonObject {
                        // id absent -> 0; every track field absent/null -> null
                        put("now_playing_title", JsonNull)
                    },
                )
            }
        assertEquals(MediaTrackEntry(0L, null, null, null, null, null), MediaTrackEntry.parseList(json).single())
        assertTrue(MediaTrackEntry.parseList(JsonPrimitive("nope")).isEmpty())
        assertTrue(MediaTrackEntry.parseList(null).isEmpty())
    }

    // ---- sourceLabel (web sourceLabel) ----------------------------------------------

    @Test
    fun sourceLabelMatchesWeb() {
        assertEquals("USB", MediaHistoryProjection.sourceLabel("usb"))
        assertEquals("USB", MediaHistoryProjection.sourceLabel("USB"))
        assertEquals("Spotify", MediaHistoryProjection.sourceLabel("spotify"))
        assertEquals("Bluetooth", MediaHistoryProjection.sourceLabel("bluetooth"))
        assertNull(MediaHistoryProjection.sourceLabel(""))
        assertNull(MediaHistoryProjection.sourceLabel(null))
    }

    // ---- isPlaying (web color test) -------------------------------------------------

    @Test
    fun isPlayingIsCaseInsensitiveAndNullSafe() {
        assertTrue(MediaHistoryProjection.isPlaying("playing"))
        assertTrue(MediaHistoryProjection.isPlaying("Playing"))
        assertFalse(MediaHistoryProjection.isPlaying("paused"))
        assertFalse(MediaHistoryProjection.isPlaying(""))
        assertFalse(MediaHistoryProjection.isPlaying(null))
    }

    // ---- relative-time tiers (web WidgetEventFeed.formatRelativeTime) ----------------

    @Test
    fun eventTimeTiersMatchWebCutoffs() {
        assertEquals(MediaEventTime.JustNow, MediaHistoryProjection.computeEventTime("2026-06-06T12:04:30Z", now))
        assertEquals(MediaEventTime.MinutesAgo(5), MediaHistoryProjection.computeEventTime("2026-06-06T12:00:00Z", now))
        assertEquals(MediaEventTime.HoursAgo(2), MediaHistoryProjection.computeEventTime("2026-06-06T10:00:00Z", now))
        val twoDaysAgo = "2026-06-04T12:00:00Z"
        assertEquals(
            MediaEventTime.Absolute(parseEpochMillis(twoDaysAgo)!!),
            MediaHistoryProjection.computeEventTime(twoDaysAgo, now),
        )
    }

    @Test
    fun eventTimeNullIsEpochAndUnparseableIsUnknown() {
        // Web `item.timestamp ?? new Date(0)` -> a null timestamp is the epoch (always > 24h ago).
        assertEquals(MediaEventTime.Absolute(0L), MediaHistoryProjection.computeEventTime(null, now))
        // A present-but-unparseable timestamp renders the em dash rather than throwing.
        assertEquals(MediaEventTime.Unknown, MediaHistoryProjection.computeEventTime("garbage", now))
    }

    // ---- feed projection ------------------------------------------------------------

    @Test
    fun rowProjectsTitleSubtitleToneAndAccessibleName() {
        val display = project(listOf(entry(title = "Song", artist = "Artist", source = "spotify", playbackStatus = "playing")))
        val row = display.items.single()
        assertEquals("\uD83C\uDFB5 Song \u2014 Artist", row.title)
        assertEquals("Spotify", row.subtitle)
        assertEquals(MediaPlaybackTone.Playing, row.tone)
        assertEquals("5m ago", row.relativeTime)
        // The a11y phrase folds title/artist + source + time WITHOUT the decorative note emoji.
        assertEquals("Song \u2014 Artist, Spotify, 5m ago", row.contentDescription)
    }

    @Test
    fun idleTrackUsesIdleToneAndNoSubtitleWhenSourceBlank() {
        val display = project(listOf(entry(source = "", playbackStatus = "paused")))
        val row = display.items.single()
        assertEquals(MediaPlaybackTone.Idle, row.tone)
        assertNull(row.subtitle)
    }

    @Test
    fun nullTitleAndArtistFallBackToEmDash() {
        val display = project(listOf(entry(title = null, artist = null, source = null)))
        val row = display.items.single()
        assertEquals("\uD83C\uDFB5 \u2014 \u2014 \u2014", row.title)
        assertEquals("\u2014 \u2014 \u2014, 5m ago", row.contentDescription)
    }

    @Test
    fun feedSortsNewestFirstButCompactUsesRawFirstItem() {
        val older = entry(title = "Older", timestamp = "2026-06-06T09:00:00Z")
        val newer = entry(title = "Newer", timestamp = "2026-06-06T12:03:00Z")
        val display = project(listOf(older, newer))
        // Feed head is the newest track …
        assertEquals("\uD83C\uDFB5 Newer \u2014 Artist", display.items.first().title)
        // … but the compact row reads the raw first item (web list[0]), which is the older one.
        assertEquals("Older \u2014 Artist", display.compactText)
    }

    @Test
    fun feedCapsAtTenRows() {
        val entries = (1..12).map { entry(timestamp = "2026-06-06T%02d:00:00Z".format(it)) }
        val display = project(entries)
        assertEquals(MediaHistorySize.MAX_FEED_ITEMS, display.items.size)
    }

    @Test
    fun emptyEntriesYieldNoItemsAndEmptyCompactText() {
        val display = project(emptyList())
        assertFalse(display.hasItems)
        assertTrue(display.items.isEmpty())
        assertEquals("No tracks played", display.compactText)
        assertEquals("No tracks played", display.compactContentDescription)
    }

    // ---- compact text (web CompactView) ---------------------------------------------

    @Test
    fun compactTextMatchesWeb() {
        // Title present -> "title — artist".
        assertEquals("Song \u2014 Artist", MediaHistoryProjection.compactText(entry(), strings()))
        // Title present, artist null -> artist em-dash-defaulted.
        assertEquals("Song \u2014 \u2014", MediaHistoryProjection.compactText(entry(artist = null), strings()))
        // Title null -> the localized "No tracks played" message (web title === '—' branch).
        assertEquals("No tracks played", MediaHistoryProjection.compactText(entry(title = null), strings()))
        // No track at all -> the same empty message.
        assertEquals("No tracks played", MediaHistoryProjection.compactText(null, strings()))
    }

    @Test
    fun isCompactFollowsColumnCount() {
        assertTrue(project(listOf(entry()), MediaHistorySize(cols = 1, rows = 4)).isCompact)
        assertFalse(project(listOf(entry()), MediaHistorySize(cols = 2, rows = 4)).isCompact)
    }

    // ---- registry metadata (web registry/media.ts) ----------------------------------

    @Test
    fun registryMetadataMatchesWebRegistry() {
        assertEquals("media-history", MediaHistoryRegistration.ID)
        assertEquals("media", MediaHistoryRegistration.CATEGORY)
        assertEquals("MediaHistoryWidget", MediaHistoryRegistration.SLUG)
        assertEquals(MediaHistorySize(cols = 2, rows = 4), MediaHistoryRegistration.defaultSize)
        assertEquals(MediaHistorySize(cols = 1, rows = 2), MediaHistoryRegistration.minSize)
        assertEquals(MediaHistorySize(cols = 4, rows = 40), MediaHistoryRegistration.maxSize)
    }

    @Test
    fun registryBoundsAndClampHonourMinMax() {
        assertTrue(MediaHistoryRegistration.isWithinBounds(MediaHistorySize(cols = 2, rows = 4)))
        assertFalse(MediaHistoryRegistration.isWithinBounds(MediaHistorySize(cols = 0, rows = 1)))
        assertFalse(MediaHistoryRegistration.isWithinBounds(MediaHistorySize(cols = 5, rows = 50)))
        assertEquals(
            MediaHistorySize(cols = 1, rows = 2),
            MediaHistoryRegistration.clamp(MediaHistorySize(cols = 0, rows = 0)),
        )
        assertEquals(
            MediaHistorySize(cols = 4, rows = 40),
            MediaHistoryRegistration.clamp(MediaHistorySize(cols = 9, rows = 99)),
        )
    }

    // ---- vehicle resolution (web vehicleId ?? vehicles?.[0]?.id) ---------------------

    @Test
    fun resolveVehicleIdPrefersExplicitThenFirstVehicle() {
        assertEquals(42L, resolveVehicleId(42L, vehicles = null))
        assertNull(resolveVehicleId(null, vehicles = null))
        assertNull(resolveVehicleId(0L, vehicles = emptyList()))
        assertNull(firstVehicleId(null))
        assertNull(firstVehicleId(emptyList()))
    }

    // ---- tolerant timestamp parse ---------------------------------------------------

    @Test
    fun parseEpochMillisIsTolerant() {
        assertNull(parseEpochMillis(null))
        assertNull(parseEpochMillis(""))
        assertNull(parseEpochMillis("not-a-date"))
        assertEquals(0L, parseEpochMillis("1970-01-01T00:00:00Z"))
        assertEquals(
            parseEpochMillis("2026-06-06T12:00:00Z"),
            parseEpochMillis("2026-06-06T14:00:00+02:00"),
        )
    }

    private fun renderEventTime(time: MediaEventTime): String =
        when (time) {
            MediaEventTime.Unknown -> "\u2014"
            MediaEventTime.JustNow -> "just now"
            is MediaEventTime.MinutesAgo -> "${time.value}m ago"
            is MediaEventTime.HoursAgo -> "${time.value}h ago"
            is MediaEventTime.Absolute -> "abs:${time.epochMillis}"
        }

    private fun renderRelative(age: FreshnessAge): String =
        when (age) {
            FreshnessAge.Unknown -> "\u2014"
            FreshnessAge.JustNow -> "just now"
            is FreshnessAge.Seconds -> "${age.value}s ago"
            is FreshnessAge.Minutes -> "${age.value}m ago"
            is FreshnessAge.Hours -> "${age.value}h ago"
            is FreshnessAge.Days -> "${age.value}d ago"
            is FreshnessAge.Weeks -> "${age.value}w ago"
        }
}
