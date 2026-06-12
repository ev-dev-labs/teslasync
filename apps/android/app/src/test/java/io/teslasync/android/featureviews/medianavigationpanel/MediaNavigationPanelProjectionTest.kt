package io.teslasync.android.featureviews.medianavigationpanel

import io.teslasync.android.data.UiPhase
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the MediaNavigationPanel pure logic — the native mirror of every derivation the
 * web component performs (web/src/features/vehicles/components/telemetry-panels/MediaNavigationPanel.tsx): the
 * `cleanNil` scrubbing, the Playing/Paused/neutral status mapping, the SINGLE SI→display distance conversion
 * at the render site, the localized minute formatting, and the home/work/favorite presence chips. Because the
 * surface is presentational, each [MediaNavDisplay] is exactly what the thin composable renders, so these
 * assertions double as the per-state adapter "snapshot".
 */
class MediaNavigationPanelProjectionTest {
    private fun prefs(
        distance: DistanceUnitPref = DistanceUnitPref.MI,
        precision: Int? = 2,
        locale: String? = "en-US",
    ): UnitPref =
        UnitPref(
            distance = distance,
            speed = SpeedUnitPref.MPH,
            temperature = TemperatureUnitPref.CELSIUS,
            pressure = PressureUnitPref.PSI,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
            locale = locale,
            precision = precision,
        )

    private fun navigation(
        location: LocationInfo,
        prefs: UnitPref = prefs(),
    ): NavigationDisplay = MediaNavigationPanelProjection.navigation(location, prefs, resolveDisplayLocale(prefs.locale))

    @Suppress("LongParameterList") // A test data builder mirroring the LocationSnapshot fields the section reads.
    private fun location(
        destinationName: String? = null,
        milesToArrival: Double? = null,
        minutesToArrival: Double? = null,
        home: Boolean = false,
        work: Boolean = false,
        favorite: Boolean = false,
    ): LocationInfo =
        LocationInfo(
            destinationName = destinationName,
            milesToArrival = milesToArrival,
            minutesToArrival = minutesToArrival,
            locatedAtHome = home,
            locatedAtWork = work,
            locatedAtFavorite = favorite,
        )

    // ── cleanNil (the Go nil-sentinel scrubber) ──────────────────────────────────

    @Test
    fun cleanNilScrubsNullEmptyAndGoSentinels() {
        assertNull(cleanNil(null))
        assertNull(cleanNil(""))
        assertNull(cleanNil("<nil>"))
        assertNull(cleanNil("nil"))
        assertNull(cleanNil("null"))
    }

    @Test
    fun cleanNilKeepsRealValuesVerbatim() {
        assertEquals("Spotify", cleanNil("Spotify"))
        // A blank-but-non-empty string is truthy in the web `!v` check, so it is kept.
        assertEquals(" ", cleanNil(" "))
        assertEquals("0", cleanNil("0"))
    }

    // ── Now Playing card (cleanNil + status badge) ───────────────────────────────

    @Test
    fun nowPlayingScrubsEveryFieldThroughCleanNil() {
        val card =
            MediaNavigationPanelProjection.nowPlaying(
                MediaInfo(
                    nowPlayingTitle = "Night Drive",
                    nowPlayingArtist = "<nil>",
                    playbackSource = "",
                    playbackStatus = "null",
                ),
            )
        assertEquals("Night Drive", card.title)
        assertNull(card.artist)
        assertNull(card.source)
        assertNull(card.status)
    }

    @Test
    fun nowPlayingPairsStatusWithItsBadge() {
        val card =
            MediaNavigationPanelProjection.nowPlaying(
                MediaInfo("Track", "Artist", "Streaming", "Playing"),
            )
        assertEquals("Streaming", card.source)
        assertEquals("Playing", card.status?.text)
        assertEquals(MediaBadge.Success, card.status?.badge)
    }

    @Test
    fun playbackBadgeMapsEachStatus() {
        assertEquals(MediaBadge.Success, MediaNavigationPanelProjection.playbackBadge("Playing"))
        assertEquals(MediaBadge.Warning, MediaNavigationPanelProjection.playbackBadge("Paused"))
        // Anything else (stopped / buffering / an unknown value) is neutral, like the web ternary's else arm.
        assertEquals(MediaBadge.Neutral, MediaNavigationPanelProjection.playbackBadge("Stopped"))
        assertEquals(MediaBadge.Neutral, MediaNavigationPanelProjection.playbackBadge(""))
    }

    // ── Navigation: destination presence (web `destination_name ?`) ──────────────

    @Test
    fun destinationPresentCarriesNameDistanceAndMinutes() {
        val nav = navigation(location(destinationName = "Downtown", milesToArrival = 1609.344, minutesToArrival = 9.0))
        assertEquals("Downtown", nav.destination?.name)
        // 1609.344 m = exactly 1 mile, formatted at the user's precision (2).
        assertEquals("1.00 mi", nav.destination?.distance)
        assertEquals("9", nav.destination?.etaMinutes)
    }

    @Test
    fun blankOrAbsentDestinationNameYieldsNoDestination() {
        assertNull(navigation(location(destinationName = null)).destination)
        // The web `destination_name ?` treats the empty string as absent.
        assertNull(navigation(location(destinationName = "")).destination)
    }

    @Test
    fun destinationKeepsNullDistanceAndMinutesSeparately() {
        val nav = navigation(location(destinationName = "Park", milesToArrival = null, minutesToArrival = null))
        assertEquals("Park", nav.destination?.name)
        assertNull(nav.destination?.distance)
        assertNull(nav.destination?.etaMinutes)
    }

    // ── Navigation: single SI→display distance conversion ────────────────────────

    @Test
    fun distanceConvertsOnceToMiles() {
        // 12875 m / 1609.344 = 8.0 mi exactly; the pre-fix double application would have shown a wrong figure.
        val nav = navigation(location(destinationName = "Charger", milesToArrival = 12875.0))
        assertEquals("8.00 mi", nav.destination?.distance)
    }

    @Test
    fun distanceConvertsOnceToKilometers() {
        val nav =
            navigation(
                location(destinationName = "Charger", milesToArrival = 12875.0),
                prefs = prefs(distance = DistanceUnitPref.KM),
            )
        // 12875 m = 12.875 km, HALF_UP rounded to 2 decimals = 12.88 km.
        assertEquals("12.88 km", nav.destination?.distance)
    }

    @Test
    fun distanceHonoursZeroPrecision() {
        val nav =
            navigation(
                location(destinationName = "Charger", milesToArrival = 1609.344),
                prefs = prefs(precision = 0),
            )
        assertEquals("1 mi", nav.destination?.distance)
    }

    @Test
    fun minutesRenderAsLocalizedInteger() {
        // Web `fmtInt` truncates to a whole number with grouping; 1234.6 → "1,235".
        val nav = navigation(location(destinationName = "Far", minutesToArrival = 1234.6))
        assertEquals("1,235", nav.destination?.etaMinutes)
    }

    // ── Navigation: presence chips (web home/work/favorite) ──────────────────────

    @Test
    fun placesAreEmittedInSourceOrderAndOnlyWhenSet() {
        assertEquals(
            listOf(MediaPlace.Home, MediaPlace.Work, MediaPlace.Favorite),
            MediaNavigationPanelProjection.places(location(home = true, work = true, favorite = true)),
        )
        assertEquals(
            listOf(MediaPlace.Home, MediaPlace.Favorite),
            MediaNavigationPanelProjection.places(location(home = true, work = false, favorite = true)),
        )
        assertTrue(MediaNavigationPanelProjection.places(location()).isEmpty())
    }

    @Test
    fun placesRenderEvenWithNoActiveDestination() {
        // The web place-chip row sits outside the destination conditional — chips show with or without a route.
        val nav = navigation(location(destinationName = null, home = true))
        assertNull(nav.destination)
        assertEquals(listOf(MediaPlace.Home), nav.places)
    }

    // ── display(): the two top-level branches (media / location nullability) ─────

    @Test
    fun displayCollapsesEachSectionWhenItsSnapshotIsNull() {
        val media = MediaInfo("T", "A", "S", "Playing")
        val mediaOnly = MediaNavigationPanelProjection.display(MediaNavSnapshot(media, null), prefs(), Locale.US)
        assertNull(mediaOnly.navigation)
        assertEquals("T", mediaOnly.nowPlaying?.title)

        val locationOnly =
            MediaNavigationPanelProjection.display(MediaNavSnapshot(null, location(home = true)), prefs(), Locale.US)
        assertNull(locationOnly.nowPlaying)
        assertEquals(listOf(MediaPlace.Home), locationOnly.navigation?.places)
    }

    // ── UiState projection (cache-then-network lifecycle) ────────────────────────

    @Test
    fun projectUiStateLoadingWinsOutright() {
        val state = MediaNavigationPanelProjection.projectUiState(MediaNavSnapshot(null, null), isLoading = true)
        assertEquals(UiPhase.Loading, state.phase)
    }

    @Test
    fun projectUiStateContentForAnyPresentSnapshot() {
        // A present snapshot — even media-null + location-null — is Content (the sections render their inline
        // empties), mirroring the web's always-present panel.
        val state = MediaNavigationPanelProjection.projectUiState(MediaNavSnapshot(null, null), isLoading = false)
        assertEquals(UiPhase.Content, state.phase)
    }

    @Test
    fun projectUiStateEmptyForNullSnapshot() {
        val state = MediaNavigationPanelProjection.projectUiState(snapshot = null, isLoading = false)
        assertEquals(UiPhase.Empty, state.phase)
    }

    // ── MediaInfo.fromJson (tolerant decode of the media snapshot) ───────────────

    @Test
    fun mediaFromJsonReadsSnakeCaseFields() {
        val obj =
            buildJsonObject {
                put("now_playing_title", "Night Drive")
                put("now_playing_artist", "Aurora Skies")
                put("playback_source", "Streaming")
                put("playback_status", "Playing")
            }
        val media = MediaInfo.fromJson(obj)!!
        assertEquals("Night Drive", media.nowPlayingTitle)
        assertEquals("Aurora Skies", media.nowPlayingArtist)
        assertEquals("Streaming", media.playbackSource)
        assertEquals("Playing", media.playbackStatus)
    }

    @Test
    fun mediaFromJsonTreatsNonObjectAsNull() {
        assertNull(MediaInfo.fromJson(null))
        assertNull(MediaInfo.fromJson(JsonPrimitive("nope")))
    }

    @Test
    fun mediaFromJsonTreatsAbsentNullAndWrongTypeAsNull() {
        val obj =
            buildJsonObject {
                put("now_playing_title", JsonNull)
                put("now_playing_artist", 5) // a number where a string is expected
                // source + status absent entirely
            }
        val media = MediaInfo.fromJson(obj)!!
        assertNull(media.nowPlayingTitle)
        assertNull(media.nowPlayingArtist)
        assertNull(media.playbackSource)
        assertNull(media.playbackStatus)
    }

    // ── LocationInfo.fromJson (tolerant decode of the location snapshot) ─────────

    @Test
    fun locationFromJsonReadsSnakeCaseFields() {
        val obj =
            buildJsonObject {
                put("destination_name", "Downtown")
                put("miles_to_arrival", 1609.344)
                put("minutes_to_arrival", 9.0)
                put("located_at_home", true)
                put("located_at_work", false)
                put("located_at_favorite", true)
            }
        val loc = LocationInfo.fromJson(obj)!!
        assertEquals("Downtown", loc.destinationName)
        assertEquals(1609.344, loc.milesToArrival!!, 1e-9)
        assertEquals(9.0, loc.minutesToArrival!!, 1e-9)
        assertTrue(loc.locatedAtHome)
        assertTrue(!loc.locatedAtWork)
        assertTrue(loc.locatedAtFavorite)
    }

    @Test
    fun locationFromJsonDefaultsAbsentFlagsToFalseAndWrongTypesToNull() {
        val obj =
            buildJsonObject {
                put("miles_to_arrival", "fast") // a string where a number is expected
                put("located_at_home", "yes") // a string where a boolean is expected
                // every other field absent
            }
        val loc = LocationInfo.fromJson(obj)!!
        assertNull(loc.destinationName)
        assertNull(loc.milesToArrival)
        assertNull(loc.minutesToArrival)
        assertTrue(!loc.locatedAtHome)
        assertTrue(!loc.locatedAtWork)
        assertTrue(!loc.locatedAtFavorite)
    }

    @Test
    fun locationFromJsonTreatsNonObjectAsNull() {
        assertNull(LocationInfo.fromJson(null))
        assertNull(LocationInfo.fromJson(JsonPrimitive(3)))
    }

    // ── Number formatting + locale ───────────────────────────────────────────────

    @Test
    fun formatNumberGroupsThousandsAndRoundsHalfUp() {
        assertEquals("1,235", MediaNavigationPanelProjection.formatNumber(1234.5, 0, Locale.US))
        assertEquals("12.88", MediaNavigationPanelProjection.formatNumber(12.875, 2, Locale.US))
    }

    @Test
    fun formatNumberCoercesNonFiniteToZero() {
        assertEquals("0", MediaNavigationPanelProjection.formatNumber(Double.NaN, 0, Locale.US))
        assertEquals("0", MediaNavigationPanelProjection.formatNumber(Double.POSITIVE_INFINITY, 0, Locale.US))
        assertEquals("0", MediaNavigationPanelProjection.formatNumber(-0.0, 0, Locale.US))
    }

    @Test
    fun resolveDisplayLocaleFallsBackToUsForBlankOrNull() {
        assertEquals(Locale.US, resolveDisplayLocale(null))
        assertEquals(Locale.US, resolveDisplayLocale(""))
        assertEquals(Locale.US, resolveDisplayLocale("   "))
    }

    @Test
    fun resolveDisplayLocaleParsesBcp47Tag() {
        assertEquals(Locale.US, resolveDisplayLocale("en-US"))
        assertEquals("de", resolveDisplayLocale("de-DE").language)
    }
}
