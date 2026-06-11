package io.teslasync.android.dashboard.widgets.medianowplaying

import io.teslasync.shared.core.api.generated.Vehicle
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

/**
 * JVM unit tests for the framework-free Now Playing surface logic: the media-snapshot → display
 * projection (the "data adapter"), the null/empty-string/non-number field guards reproduced from the web
 * source, the "Playing" flag, the source `??` fall-through, the progress/volume ratios, the millisecond
 * clock + raw-volume formatters, the footprint flags, the empty-snapshot predicate, the active-vehicle
 * resolution, and the registry footprint constraints. These run in the `:android:testReleaseUnitTest`
 * gate with no device, mirroring web/src/features/dashboard/widgets/MediaNowPlayingWidget.tsx.
 */
class MediaNowPlayingProjectionTest {
    private val tall = MediaNowPlayingRegistration.DEFAULT_SIZE
    private val compact = MediaNowPlayingSize(cols = 1, rows = 1)

    // ── empty / no-snapshot ─────────────────────────────────────────────────────
    @Test
    fun nullSnapshotIsEmpty() {
        val display = MediaNowPlayingProjection.project(null, tall)
        assertFalse(display.hasData)
        assertEquals(EM_DASH, display.title)
        assertEquals(EM_DASH, display.artist)
        assertNull(display.album)
        assertNull(display.source)
        assertFalse(display.isPlaying)
        assertFalse(display.showProgress)
        assertFalse(display.showVolume)
    }

    @Test
    fun jsonNullSnapshotIsEmpty() {
        assertFalse(MediaNowPlayingProjection.project(JsonNull, tall).hasData)
        assertTrue(MediaNowPlayingProjection.isEmptySnapshot(JsonNull))
    }

    @Test
    fun nonObjectSnapshotIsEmpty() {
        assertTrue(MediaNowPlayingProjection.isEmptySnapshot(JsonPrimitive(5)))
        assertTrue(MediaNowPlayingProjection.isEmptySnapshot(null))
    }

    @Test
    fun objectSnapshotIsNotEmpty() {
        assertFalse(MediaNowPlayingProjection.isEmptySnapshot(buildJsonObject { put("now_playing_title", "x") }))
    }

    // ── content / field reads ────────────────────────────────────────────────────
    @Test
    fun projectsTrackArtistAlbumSourceAndPlaying() {
        val display = MediaNowPlayingProjection.project(fullSnapshot(), tall)

        assertTrue(display.hasData)
        assertEquals("Starlight", display.title)
        assertEquals("Muse", display.artist)
        assertEquals("Black Holes and Revelations", display.album)
        assertEquals("Spotify", display.source)
        assertTrue(display.isPlaying)
        assertTrue(display.isTall)
        assertFalse(display.isCompact)
        assertEquals("Starlight, Muse", display.compactContentDescription)
    }

    @Test
    fun missingFieldsRenderEmDashAndHideRows() {
        val display = MediaNowPlayingProjection.project(buildJsonObject { put("vehicle_id", 1) }, tall)

        assertTrue(display.hasData)
        assertEquals(EM_DASH, display.title)
        assertEquals(EM_DASH, display.artist)
        assertNull(display.album)
        assertNull(display.source)
        assertFalse(display.isPlaying)
        assertFalse(display.showProgress)
        assertFalse(display.showVolume)
    }

    @Test
    fun nullFieldsRenderEmDash() {
        val display =
            MediaNowPlayingProjection.project(
                buildJsonObject {
                    put("now_playing_title", JsonNull)
                    put("now_playing_artist", JsonNull)
                },
                tall,
            )
        assertEquals(EM_DASH, display.title)
        assertEquals(EM_DASH, display.artist)
    }

    @Test
    fun nonStringTitleReadsAsMissing() {
        // The typed contract is a string; a non-string title reads as missing (em dash) rather than coercing.
        val display = MediaNowPlayingProjection.project(buildJsonObject { put("now_playing_title", 5) }, tall)
        assertEquals(EM_DASH, display.title)
    }

    // ── playback status ───────────────────────────────────────────────────────────
    @Test
    fun onlyPlayingStatusLightsTheChip() {
        assertTrue(playing("Playing"))
        assertFalse(playing("Paused"))
        assertFalse(playing("Stopped"))
        assertFalse(playing(null))
    }

    // ── source resolution (web `playback_source ?? now_playing_station`) ────────────
    @Test
    fun sourcePrefersPlaybackSourceThenStation() {
        assertEquals("Spotify", MediaNowPlayingProjection.resolveSource("Spotify", "92.5 FM"))
        assertEquals("92.5 FM", MediaNowPlayingProjection.resolveSource(null, "92.5 FM"))
        assertNull(MediaNowPlayingProjection.resolveSource(null, null))
    }

    @Test
    fun emptyPlaybackSourceShortCircuitsAndHidesRow() {
        // Web parity: `'' ?? station` is `''` (not nullish) → the truthy `source &&` guard hides the row.
        assertNull(MediaNowPlayingProjection.resolveSource("", "92.5 FM"))
        assertNull(MediaNowPlayingProjection.resolveSource(null, ""))
    }

    @Test
    fun stationFallbackReadFromSnapshot() {
        val display =
            MediaNowPlayingProjection.project(
                buildJsonObject { put("now_playing_station", "Hyperion Radio") },
                tall,
            )
        assertEquals("Hyperion Radio", display.source)
    }

    // ── progress ────────────────────────────────────────────────────────────────
    @Test
    fun progressShownWhenDurationPositive() {
        val display = MediaNowPlayingProjection.project(fullSnapshot(), tall)
        assertTrue(display.showProgress)
        assertEquals("1:12", display.elapsedText)
        assertEquals("4:00", display.durationText)
        assertEquals(0.3f, display.progressFraction, 0.001f)
    }

    @Test
    fun progressHiddenWhenDurationZeroOrMissing() {
        val display = MediaNowPlayingProjection.project(buildJsonObject { put("now_playing_elapsed", 1_000.0) }, tall)
        assertFalse(display.showProgress)
        assertEquals(0f, display.progressFraction, 0f)
    }

    @Test
    fun progressFractionClampsWhenElapsedExceedsDuration() {
        val display =
            MediaNowPlayingProjection.project(
                buildJsonObject {
                    put("now_playing_duration", 100_000.0)
                    put("now_playing_elapsed", 200_000.0)
                },
                tall,
            )
        assertEquals(1f, display.progressFraction, 0f)
    }

    // ── volume ────────────────────────────────────────────────────────────────────
    @Test
    fun volumeShownWithDefaultMaxWhenAbsent() {
        val display = MediaNowPlayingProjection.project(buildJsonObject { put("audio_volume", 5.5) }, tall)
        assertTrue(display.showVolume)
        assertEquals("5.5", display.volumeText)
        // Default max is 11 (web `audio_volume_max ?? 11`): 5.5 / 11 = 0.5.
        assertEquals(0.5f, display.volumeFraction, 0.001f)
    }

    @Test
    fun volumeHiddenWhenAbsent() {
        val display = MediaNowPlayingProjection.project(buildJsonObject { put("now_playing_title", "x") }, tall)
        assertFalse(display.showVolume)
        assertEquals(EM_DASH, display.volumeText)
    }

    @Test
    fun volumeHonoursExplicitMax() {
        val display =
            MediaNowPlayingProjection.project(
                buildJsonObject {
                    put("audio_volume", 5.0)
                    put("audio_volume_max", 10.0)
                },
                tall,
            )
        assertEquals(0.5f, display.volumeFraction, 0.001f)
        assertEquals("5", display.volumeText)
    }

    // ── pure formatters ─────────────────────────────────────────────────────────
    @Test
    fun formatDurationClockMatchesWeb() {
        assertEquals("0:00", MediaNowPlayingProjection.formatDurationClock(0.0))
        assertEquals("0:05", MediaNowPlayingProjection.formatDurationClock(5_000.0))
        assertEquals("1:05", MediaNowPlayingProjection.formatDurationClock(65_000.0))
        assertEquals("4:00", MediaNowPlayingProjection.formatDurationClock(240_000.0))
        assertEquals("10:05", MediaNowPlayingProjection.formatDurationClock(605_000.0))
    }

    @Test
    fun formatDurationClockEmDashForUnrenderable() {
        assertEquals(EM_DASH, MediaNowPlayingProjection.formatDurationClock(null))
        assertEquals(EM_DASH, MediaNowPlayingProjection.formatDurationClock(-1.0))
        assertEquals(EM_DASH, MediaNowPlayingProjection.formatDurationClock(Double.NaN))
        assertEquals(EM_DASH, MediaNowPlayingProjection.formatDurationClock(Double.POSITIVE_INFINITY))
    }

    @Test
    fun ratioClampsAndGuardsNonPositiveMax() {
        assertEquals(0.5f, MediaNowPlayingProjection.ratio(5.0, 10.0), 0.001f)
        assertEquals(1f, MediaNowPlayingProjection.ratio(20.0, 10.0), 0f)
        assertEquals(0f, MediaNowPlayingProjection.ratio(5.0, 0.0), 0f)
        assertEquals(0f, MediaNowPlayingProjection.ratio(Double.NaN, 10.0), 0f)
    }

    @Test
    fun formatVolumeTrimsWholeAndDecimals() {
        assertEquals("7", MediaNowPlayingProjection.formatVolume(7.0))
        assertEquals("0", MediaNowPlayingProjection.formatVolume(0.0))
        assertEquals("7.5", MediaNowPlayingProjection.formatVolume(7.5))
        assertEquals("5.25", MediaNowPlayingProjection.formatVolume(5.25))
    }

    // ── footprint flags ──────────────────────────────────────────────────────────
    @Test
    fun footprintFlagsFollowSize() {
        assertTrue(compact.isCompact)
        assertFalse(compact.isTall)
        assertFalse(tall.isCompact)
        assertTrue(tall.isTall)
        assertFalse(MediaNowPlayingSize(cols = 2, rows = 1).isCompact)
        assertFalse(MediaNowPlayingSize(cols = 2, rows = 1).isTall)
        assertFalse(MediaNowPlayingSize(cols = 1, rows = 2).isCompact)
        assertTrue(MediaNowPlayingSize(cols = 1, rows = 2).isTall)
    }

    @Test
    fun compactProjectionCarriesCompactFlag() {
        val display = MediaNowPlayingProjection.project(fullSnapshot(), compact)
        assertTrue(display.isCompact)
        assertFalse(display.isTall)
    }

    // ── registry / footprint ─────────────────────────────────────────────────────
    @Test
    fun registrationMatchesWebRegistry() {
        assertEquals("media-now-playing", MediaNowPlayingRegistration.ID)
        assertEquals("media", MediaNowPlayingRegistration.CATEGORY)
        assertEquals("MediaNowPlayingWidget", MediaNowPlayingRegistration.SLUG)
        assertEquals(5_000L, MediaNowPlayingRegistration.REFRESH_INTERVAL_MS)
        assertEquals(MediaNowPlayingSize(2, 2), MediaNowPlayingRegistration.DEFAULT_SIZE)
        assertEquals(MediaNowPlayingSize(1, 2), MediaNowPlayingRegistration.MIN_SIZE)
        assertEquals(MediaNowPlayingSize(4, 40), MediaNowPlayingRegistration.MAX_SIZE)
    }

    @Test
    fun footprintBoundsAndClamp() {
        assertTrue(MediaNowPlayingRegistration.isWithinBounds(MediaNowPlayingSize(1, 2)))
        assertTrue(MediaNowPlayingRegistration.isWithinBounds(MediaNowPlayingSize(4, 40)))
        assertFalse(MediaNowPlayingRegistration.isWithinBounds(MediaNowPlayingSize(5, 2)))
        assertFalse(MediaNowPlayingRegistration.isWithinBounds(MediaNowPlayingSize(1, 1)))
        assertEquals(MediaNowPlayingSize(4, 40), MediaNowPlayingRegistration.clamp(MediaNowPlayingSize(9, 99)))
        assertEquals(MediaNowPlayingSize(1, 2), MediaNowPlayingRegistration.clamp(MediaNowPlayingSize(0, 0)))
    }

    // ── active-vehicle resolution ────────────────────────────────────────────────
    @Test
    fun resolvesPreferredThenFirstThenNull() {
        assertEquals(7L, resolveVehicleId(7L, listOf(vehicle(3))))
        assertEquals(3L, resolveVehicleId(null, listOf(vehicle(3), vehicle(4))))
        assertEquals(3L, resolveVehicleId(0L, listOf(vehicle(3))))
        assertNull(resolveVehicleId(null, emptyList()))
        assertNull(resolveVehicleId(null, null))
    }

    // ── fixtures ──────────────────────────────────────────────────────────────────
    private fun playing(status: String?) =
        MediaNowPlayingProjection
            .project(
                buildJsonObject { status?.let { put("playback_status", it) } },
                tall,
            ).isPlaying

    private fun fullSnapshot() =
        buildJsonObject {
            put("now_playing_title", "Starlight")
            put("now_playing_artist", "Muse")
            put("now_playing_album", "Black Holes and Revelations")
            put("playback_source", "Spotify")
            put("playback_status", "Playing")
            put("now_playing_duration", 240_000.0)
            put("now_playing_elapsed", 72_000.0)
            put("audio_volume", 7.0)
            put("audio_volume_max", 11.0)
        }

    private fun vehicle(id: Long): Vehicle =
        Vehicle(
            createdAt = Instant.parse("2026-01-01T00:00:00Z"),
            displayName = "Car $id",
            enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
            id = id,
            teslaId = 1000 + id,
            timezone = "UTC",
            updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
            vin = "VIN$id",
        )
}
