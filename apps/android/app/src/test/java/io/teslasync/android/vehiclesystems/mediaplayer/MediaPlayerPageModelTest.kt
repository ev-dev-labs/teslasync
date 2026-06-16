package io.teslasync.android.vehiclesystems.mediaplayer

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device JVM unit tests for the framework-free [MediaPlayerPageModel] — the verbatim port of the web page's
 * derivations (the `/media/latest` + `/media` decode, the stats / volume-series / source-distribution useMemo chain,
 * the now-playing progress + play-time formatters, and the locale number helpers). Exercised by the
 * `:android:testDebugUnitTest` gate so the page composable can stay a thin render layer.
 */
class MediaPlayerPageModelTest {
    private fun json(text: String) = Json.parseToJsonElement(text)

    private val sampleLatest =
        """
        {
          "id": 7, "playback_status": "Playing", "playback_source": "Spotify",
          "now_playing_title": "Song A", "now_playing_artist": "Artist A", "now_playing_album": "Album A",
          "now_playing_station": "Station", "now_playing_elapsed": 30000, "now_playing_duration": 180000,
          "audio_volume": 7, "audio_volume_max": 11, "audio_volume_increment": 0.5,
          "created_at": "2024-01-01T00:00:00Z"
        }
        """.trimIndent()

    /* ---- parseLatestMedia ---- */

    @Test
    fun parseLatestMedia_decodesEveryField() {
        val snapshot = parseLatestMedia(json(sampleLatest))
        assertEquals(7L, snapshot?.id)
        assertEquals("Playing", snapshot?.playbackStatus)
        assertEquals("Spotify", snapshot?.playbackSource)
        assertEquals("Song A", snapshot?.nowPlayingTitle)
        assertEquals("Artist A", snapshot?.nowPlayingArtist)
        assertEquals("Album A", snapshot?.nowPlayingAlbum)
        assertEquals(7.0, snapshot?.audioVolume)
        assertEquals(11.0, snapshot?.audioVolumeMax)
        assertEquals(0.5, snapshot?.audioVolumeIncrement)
    }

    @Test
    fun parseLatestMedia_nullOnNonObjectOrNull() {
        assertNull(parseLatestMedia(null))
        assertNull(parseLatestMedia(JsonNull))
        assertNull(parseLatestMedia(json("[]")))
    }

    /* ---- parseMediaHistory ---- */

    @Test
    fun parseMediaHistory_decodesBareArray() {
        val history = parseMediaHistory(json("""[$sampleLatest, $sampleLatest]"""))
        assertEquals(2, history.size)
        assertEquals(7L, history.first().id)
    }

    @Test
    fun parseMediaHistory_decodesDataEnvelope() {
        val history = parseMediaHistory(json("""{"data": [$sampleLatest]}"""))
        assertEquals(1, history.size)
    }

    @Test
    fun parseMediaHistory_emptyOnNonArray() {
        assertTrue(parseMediaHistory(json("""{"foo": 1}""")).isEmpty())
        assertTrue(parseMediaHistory(json("5")).isEmpty())
        assertTrue(parseMediaHistory(null).isEmpty())
    }

    /* ---- mediaStats ---- */

    @Test
    fun mediaStats_emptyHistoryUsesDefaults() {
        val stats = mediaStats(emptyList())
        assertEquals(0, stats.uniqueTracks)
        assertEquals(MEDIA_DOUBLE_DASH, stats.topSource)
        assertEquals(0.0, stats.avgVolume, 0.0)
    }

    @Test
    fun mediaStats_computesUniqueTopAndAverage() {
        val history =
            parseMediaHistory(
                json(
                    """
                    [
                      {"id":1,"now_playing_title":"A","playback_source":"Spotify","audio_volume":6,"created_at":"2024-01-01T00:00:00Z"},
                      {"id":2,"now_playing_title":"A","playback_source":"Spotify","audio_volume":8,"created_at":"2024-01-01T00:01:00Z"},
                      {"id":3,"now_playing_title":"B","playback_source":"Bluetooth","audio_volume":10,"created_at":"2024-01-01T00:02:00Z"}
                    ]
                    """.trimIndent(),
                ),
            )
        val stats = mediaStats(history)
        assertEquals(2, stats.uniqueTracks)
        assertEquals("Spotify", stats.topSource)
        assertEquals(8.0, stats.avgVolume, 0.0001)
    }

    /* ---- volumePoints ---- */

    @Test
    fun volumePoints_sortedOldestFirstWithVolumeDefault() {
        val history =
            parseMediaHistory(
                json(
                    """
                    [
                      {"id":1,"audio_volume":9,"created_at":"2024-01-02T00:00:00Z"},
                      {"id":2,"created_at":"2024-01-01T00:00:00Z"}
                    ]
                    """.trimIndent(),
                ),
            )
        val points = volumePoints(history)
        assertEquals(2, points.size)
        // Oldest (01-01, missing volume → 0) first, then the 01-02 point (volume 9).
        assertEquals(0.0, points[0].volume, 0.0)
        assertEquals(9.0, points[1].volume, 0.0)
    }

    /* ---- sourceSlices ---- */

    @Test
    fun sourceSlices_countsSortedDescendingWithShares() {
        val history =
            parseMediaHistory(
                json(
                    """
                    [
                      {"id":1,"playback_source":"Spotify","created_at":"2024-01-01T00:00:00Z"},
                      {"id":2,"playback_source":"Spotify","created_at":"2024-01-01T00:01:00Z"},
                      {"id":3,"playback_source":"Bluetooth","created_at":"2024-01-01T00:02:00Z"}
                    ]
                    """.trimIndent(),
                ),
            )
        val slices = sourceSlices(history)
        assertEquals(2, slices.size)
        assertEquals("Spotify", slices[0].name)
        assertEquals(2, slices[0].value)
        assertEquals(2.0 / 3.0, slices[0].fraction, 0.0001)
        assertEquals(1.0, slices.sumOf { it.fraction }, 0.0001)
    }

    @Test
    fun sourceSlices_blankSourceFallsToUnknown() {
        val history = parseMediaHistory(json("""[{"id":1,"created_at":"2024-01-01T00:00:00Z"}]"""))
        val slices = sourceSlices(history)
        assertEquals(1, slices.size)
        assertEquals("Unknown", slices[0].name)
    }

    /* ---- progress + volume max ---- */

    @Test
    fun mediaProgressPercent_handlesDurations() {
        val playing = parseLatestMedia(json("""{"id":1,"now_playing_elapsed":50000,"now_playing_duration":200000,"created_at":""}"""))
        assertEquals(25.0, mediaProgressPercent(playing), 0.0001)
        val noDuration = parseLatestMedia(json("""{"id":1,"now_playing_duration":0,"created_at":""}"""))
        assertEquals(0.0, mediaProgressPercent(noDuration), 0.0)
        assertEquals(0.0, mediaProgressPercent(null), 0.0)
    }

    @Test
    fun volumeMaxOf_fallsBackToDefault() {
        assertEquals(11.0, volumeMaxOf(null), 0.0)
        val withMax = parseLatestMedia(json("""{"id":1,"audio_volume_max":8,"created_at":""}"""))
        assertEquals(8.0, volumeMaxOf(withMax), 0.0)
        val zeroMax = parseLatestMedia(json("""{"id":1,"audio_volume_max":0,"created_at":""}"""))
        assertEquals(11.0, volumeMaxOf(zeroMax), 0.0)
    }

    /* ---- formatPlayTime ---- */

    @Test
    fun formatPlayTime_formatsMinutesAndPadsSeconds() {
        assertEquals("1:05", formatPlayTime(65_000.0))
        assertEquals("2:05", formatPlayTime(125_000.0))
        assertEquals("0:00", formatPlayTime(0.0))
        assertEquals("0:00", formatPlayTime(-100.0))
    }

    /* ---- status kind ---- */

    @Test
    fun statusKind_mapsRawStatus() {
        assertEquals(MediaStatusKind.Playing, MediaStatusKind.fromStatus("is_playing"))
        assertEquals(MediaStatusKind.Paused, MediaStatusKind.fromStatus("Paused"))
        assertEquals(MediaStatusKind.Stopped, MediaStatusKind.fromStatus("idle"))
        assertEquals(MediaStatusKind.Stopped, MediaStatusKind.fromStatus(null))
    }

    /* ---- display prefs ---- */

    @Test
    fun displayPrefs_formatsIntegerAndDecimalForLocale() {
        val prefs = MediaPlayerDisplayPrefs("en-US")
        assertEquals("8", prefs.integer(7.6))
        assertEquals("1,234", prefs.integer(1234.0))
        assertEquals("5", prefs.integer(5))
        assertEquals("0.50", prefs.decimal(0.5, 2))
    }

    @Test
    fun displayPrefs_fromSettingsResolvesLocale() {
        val prefs = MediaPlayerDisplayPrefs.fromSettings(json("""{"locale":"de-DE"}"""))
        assertEquals("de-DE", prefs.locale)
    }
}
