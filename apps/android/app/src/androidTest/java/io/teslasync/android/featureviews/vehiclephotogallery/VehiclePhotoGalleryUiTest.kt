package io.teslasync.android.featureviews.vehiclephotogallery

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [VehiclePhotoGalleryContent] across every state the
 * surface renders: the loading skeleton chrome, the hard-error retry surface, the dashed empty-state card, the
 * populated thumbnail grid that opens the shared lightbox, and the stale/offline cached views. Asserts the
 * rendered i18n strings and the TalkBack content descriptions (the accessible loading skeleton, the gallery
 * group label, each thumbnail's "Open photo n of total" button, the freshness chip), and that tapping a
 * thumbnail opens the lightbox at that index. The offline gate's `testReleaseUnitTest` covers the pure logic;
 * this covers render + a11y. Mirrors the web spec
 * (web/src/features/vehicles/components/VehiclePhotoGallery.tsx).
 */
class VehiclePhotoGalleryUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun photos(): List<VehiclePhoto> =
        listOf(
            VehiclePhoto(src = "front.jpg", alt = "Front three-quarter", caption = "Front"),
            VehiclePhoto(src = "side.jpg", alt = "Driver side"),
            VehiclePhoto(src = "rear.jpg", alt = "Rear three-quarter"),
        )

    private fun setContent(
        state: UiState<List<VehiclePhoto>>,
        vehicleName: String? = null,
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                VehiclePhotoGalleryContent(state = state, vehicleName = vehicleName, onRetry = onRetry)
            }
        }
    }

    @Test
    fun loadingShowsAccessibleSkeletonNotABlankBox() {
        setContent(UiState(UiPhase.Loading))
        compose.onNodeWithContentDescription("Loading", substring = true).assertIsDisplayed()
    }

    @Test
    fun errorShowsRetryAffordanceAndInvokesRetry() {
        var retried = false
        setContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun emptyShowsFriendlyMessageAndHelpNotABlankBox() {
        setContent(UiState(UiPhase.Empty, data = emptyList()))
        compose.onNodeWithText("No photos uploaded yet.").assertIsDisplayed()
        compose.onNodeWithText("Photos uploaded for this vehicle will appear here.").assertIsDisplayed()
    }

    @Test
    fun populatedExposesNamedGalleryGroupLabel() {
        setContent(UiState(UiPhase.Content, data = photos()), vehicleName = "Model Y")
        compose.onNodeWithContentDescription("Model Y photo gallery").assertExists()
    }

    @Test
    fun populatedFallsBackToGenericGalleryLabelWithoutVehicleName() {
        setContent(UiState(UiPhase.Content, data = photos()))
        compose.onNodeWithContentDescription("Photo gallery").assertExists()
    }

    @Test
    fun thumbnailsExposeOpenPhotoAccessibilityLabels() {
        setContent(UiState(UiPhase.Content, data = photos()))
        compose.onNodeWithContentDescription("Open photo 1 of 3").assertIsDisplayed()
        compose.onNodeWithContentDescription("Open photo 2 of 3").assertIsDisplayed()
        compose.onNodeWithContentDescription("Open photo 3 of 3").assertIsDisplayed()
    }

    @Test
    fun tappingThumbnailOpensLightboxAtThatIndex() {
        setContent(UiState(UiPhase.Content, data = photos()))

        // The lightbox is closed until a thumbnail is tapped (web `open` defaults to false).
        compose.onNodeWithText("1 / 3").assertDoesNotExist()

        compose.onNodeWithContentDescription("Open photo 1 of 3").performClick()
        compose.waitForIdle()

        compose.onNodeWithText("1 / 3").assertExists()
        compose.onNodeWithContentDescription("Close image viewer").assertExists()
    }

    @Test
    fun offlineShowsCachedGridWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = photos(),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.waitForIdle()
        compose.onNodeWithContentDescription("Photo gallery").assertExists()
        compose.onNodeWithContentDescription("Offline").assertExists()
    }

    @Test
    fun staleContentAutoRefreshesAndKeepsCachedGrid() {
        var refreshed = false
        setContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = photos(),
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                ),
            onRetry = { refreshed = true },
        )
        compose.waitForIdle()
        compose.onNodeWithContentDescription("Photo gallery").assertExists()
        assertTrue(refreshed)
    }
}
