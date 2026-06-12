package io.teslasync.android.featureviews.medianavigationpanel

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import io.teslasync.android.R
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [MediaNavigationPanelContent] across every state the
 * surface renders: the first-load skeleton (its "Loading" a11y label, with no section label leaking), the
 * hard-error retry surface (title + working retry), the friendly empty state (the catalog "no data" message,
 * never a blank box), the populated two-section content (the title, both section labels, the track + status +
 * destination + single-converted distance + minutes, and the favorite presence chip's a11y label), the inline
 * empties (a present-but-null snapshot still shows "No media data" + "No location data" rather than collapsing),
 * and the offline/stale surface (the cached track stays visible behind an "Offline" freshness chip). Strings
 * are resolved from the catalog via the host activity so the assertions can never drift from the i18n wording,
 * and the panel is hosted under reduced motion so the FadeIn entrance collapses to its final state and every
 * label is present immediately. Runs under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate
 * covers the pure projection. Mirrors the web spec
 * (web/src/features/vehicles/components/telemetry-panels/MediaNavigationPanel.tsx).
 */
class MediaNavigationPanelUiTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun str(id: Int): String = compose.activity.getString(id)

    private fun miPrefs(): UnitPref =
        UnitPref(
            distance = DistanceUnitPref.MI,
            speed = SpeedUnitPref.MPH,
            temperature = TemperatureUnitPref.CELSIUS,
            pressure = PressureUnitPref.PSI,
            energy = EnergyUnitPref.KWH,
            duration = DurationUnitPref.HOURS,
            power = PowerUnitPref.KW,
            locale = "en-US",
            precision = 2,
        )

    private fun populated(): MediaNavSnapshot =
        MediaNavSnapshot(
            media = MediaInfo("Night Drive", "Aurora Skies", "Streaming", "Playing"),
            location = LocationInfo("Downtown", 1609.344, 9.0, locatedAtHome = false, locatedAtWork = false, locatedAtFavorite = true),
        )

    private fun setContent(
        state: UiState<MediaNavSnapshot>,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                        MediaNavigationPanelContent(state = state, onRetry = onRetry, prefs = miPrefs())
                    }
                }
            }
        }
    }

    /** Scrolls the panel so [text] is in view, then asserts it is displayed. */
    private fun assertShown(text: String) {
        compose.onNodeWithText(text).performScrollTo().assertIsDisplayed()
    }

    @Test
    fun loadingStateRendersSkeletonWithTheLoadingA11yLabelAndNoSectionLabels() {
        setContent(UiState(UiPhase.Loading))
        // The title chrome is always present; the skeleton is announced as a single "Loading" region.
        assertShown(str(R.string.translation_telemetry_mediaNav))
        compose.onNodeWithContentDescription(str(R.string.translation_a11y_loading)).assertIsDisplayed()
        // No section label leaks while loading.
        compose.onNodeWithText(str(R.string.translation_telemetry_nowPlaying)).assertDoesNotExist()
        compose.onNodeWithText(str(R.string.translation_telemetry_navigation)).assertDoesNotExist()
    }

    @Test
    fun errorStateRendersTitleAndAWorkingRetry() {
        var retried = false
        setContent(UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })

        assertShown(str(R.string.translation_telemetry_mediaNav))
        assertShown(str(R.string.translation_error_serverError_title))
        compose.onNodeWithText(str(R.string.translation_common_retry)).performScrollTo().performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyStateRendersTheNoDataMessageNeverABlankBox() {
        setContent(MediaNavigationPanelProjection.projectUiState(snapshot = null, isLoading = false))

        assertShown(str(R.string.translation_telemetry_mediaNav))
        assertShown(str(R.string.translation_common_noData))
        // No section label leaks in the empty state.
        compose.onNodeWithText(str(R.string.translation_telemetry_nowPlaying)).assertDoesNotExist()
    }

    @Test
    fun populatedContentRendersTitleSectionsTrackDestinationAndSingleConvertedDistance() {
        setContent(MediaNavigationPanelProjection.projectUiState(populated(), isLoading = false))

        assertShown(str(R.string.translation_telemetry_mediaNav))
        // Both section labels render (TalkBack reads each) — accessibility coverage.
        assertShown(str(R.string.translation_telemetry_nowPlaying))
        assertShown(str(R.string.translation_telemetry_navigation))
        // The track card: title, artist, source chip, and the verbatim status badge.
        assertShown("Night Drive")
        assertShown("Aurora Skies")
        assertShown("Streaming")
        assertShown("Playing")
        // The destination card: name, the single-conversion distance (1609.344 m = 1.00 mi), and the minutes.
        assertShown("Downtown")
        assertShown("1.00 mi")
        assertShown("9 ${str(R.string.translation_common_minShort)}")
    }

    @Test
    fun favoritePresenceChipExposesItsLabelToTalkBack() {
        setContent(MediaNavigationPanelProjection.projectUiState(populated(), isLoading = false))

        // The chip renders its localized label and announces it as a single contentDescription node.
        assertShown(str(R.string.translation_telemetry_placeFavorite))
        compose
            .onNodeWithContentDescription(str(R.string.translation_telemetry_placeFavorite))
            .performScrollTo()
            .assertIsDisplayed()
    }

    @Test
    fun inlineEmptiesRenderWhenSnapshotPresentButBothSectionsNull() {
        // A present snapshot with no media and no location still renders the panel + both inline empties.
        setContent(
            MediaNavigationPanelProjection.projectUiState(
                MediaNavSnapshot(media = null, location = null),
                isLoading = false,
            ),
        )

        assertShown(str(R.string.translation_telemetry_nowPlaying))
        assertShown(str(R.string.translation_telemetry_noMediaData))
        assertShown(str(R.string.translation_telemetry_navigation))
        assertShown(str(R.string.translation_telemetry_noLocationData))
        // The track content never renders without a media snapshot.
        compose.onNodeWithText("Night Drive").assertDoesNotExist()
    }

    @Test
    fun offlineStateKeepsCachedContentBehindAnOfflineChip() {
        // Stale + a failed refresh = "last known" — the cached track stays visible, never blanked, under the
        // Offline freshness chip; the surface does NOT auto-refresh while offline (hasError is set).
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = populated(),
                stale = true,
                errorKind = ErrorKind.Network,
                fetchedAt = System.currentTimeMillis(),
            ),
        )

        compose.onNodeWithContentDescription(str(R.string.translation_common_offline)).assertIsDisplayed()
        assertShown("Night Drive")
        assertShown("Downtown")
    }
}
