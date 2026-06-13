// Instrumented Compose UI + accessibility verification of [VehiclePhotoUploadContent] across every branch the
// web component renders (the photo zone with a preview / with the placeholder prompt, the choose vs replace
// control, the "Uploading…" in-flight state, the remove control + its danger confirm dialog) plus the lifecycle
// chrome the host's feed implies (loading spinner/skeleton / hard error with retry / offline cached). Verifies
// the always-present heading, the drop prompt + constraints, the preview alt text, the control labels + their
// callbacks, the loading region's TalkBack label, the retry affordance, and the offline freshness chip. Runs
// under `connectedAndroidTest` (a device/emulator); the offline gate's `testReleaseUnitTest` covers the pure
// projection + Resource → UiState mapping + view-model.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclephotoupload

import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.vehiclephoto.VehiclePhotoMeta
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class VehiclePhotoUploadUiTest {
    @get:Rule
    val compose = createComposeRule()

    // Injected English labels so the assertions are locale-independent (mirrors ScheduledMaintenanceCardUiTest).
    private val strings =
        VehiclePhotoUploadStrings(
            title = "Vehicle photo",
            dropPrompt = "Drag a photo here or click to choose a file",
            constraints = "JPEG or PNG — up to 8 MB",
            previewAlt = "Vehicle photo preview",
            choose = "Choose photo",
            replace = "Replace photo",
            remove = "Remove photo",
            uploading = "Uploading…",
            confirmRemoveTitle = "Remove vehicle photo?",
            confirmRemoveMessage = "The hero card will fall back to the stock model render until a new photo is uploaded.",
            confirmRemoveLabel = "Remove",
            cancel = "Cancel",
            close = "Close",
            loadingLabel = "Loading",
            loadingState = "Loading...",
            offline = "Offline",
        )

    private fun content(hasPhoto: Boolean): UiState<VehiclePhotoMeta> =
        UiState(UiPhase.Content, data = VehiclePhotoMeta(hasPhoto = hasPhoto, uploadedAt = "2026-06-01T00:00:00Z"))

    private fun setContent(
        state: UiState<VehiclePhotoMeta>,
        actions: PhotoActions = PhotoActions(),
        previewBitmap: ImageBitmap? = null,
        showRemoveDialog: Boolean = false,
        onChoose: () -> Unit = {},
        onRemoveRequest: () -> Unit = {},
        onRetry: () -> Unit = {},
        onConfirmRemove: () -> Unit = {},
        onCancelRemove: () -> Unit = {},
        autoAdvance: Boolean = true,
    ) {
        compose.mainClock.autoAdvance = autoAdvance
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                VehiclePhotoUploadContent(
                    state = state,
                    actions = actions,
                    onChoose = onChoose,
                    onRemoveRequest = onRemoveRequest,
                    onRetry = onRetry,
                    hasPhoto = state.hasUploadedPhoto(),
                    previewBitmap = previewBitmap,
                    showRemoveDialog = showRemoveDialog,
                    onConfirmRemove = onConfirmRemove,
                    onCancelRemove = onCancelRemove,
                    strings = strings,
                )
            }
        }
    }

    @Test
    fun headingIsAlwaysVisible() {
        setContent(content(hasPhoto = false))
        compose.onNodeWithText(strings.title).assertIsDisplayed()
    }

    @Test
    fun noPhotoShowsDropPromptConstraintsAndChoose() {
        setContent(content(hasPhoto = false))
        compose.onNodeWithText(strings.dropPrompt).assertIsDisplayed()
        compose.onNodeWithText(strings.constraints).assertIsDisplayed()
        compose.onNodeWithText(strings.choose).assertIsDisplayed().assertHasClickAction()
        // No photo on file → no remove control.
        compose.onAllNodesWithText(strings.remove).assertCountEquals(0)
    }

    @Test
    fun chooseInvokesPicker() {
        var chosen = false
        setContent(content(hasPhoto = false), onChoose = { chosen = true })
        compose.onNodeWithText(strings.choose).performClick()
        assertTrue(chosen)
    }

    @Test
    fun photoOnFileShowsReplaceAndRemove() {
        setContent(content(hasPhoto = true))
        compose.onNodeWithText(strings.replace).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(strings.remove).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun previewImageCarriesAltText() {
        setContent(content(hasPhoto = true), previewBitmap = ImageBitmap(4, 4))
        compose.onNodeWithContentDescription(strings.previewAlt).assertExists()
    }

    @Test
    fun uploadingShowsUploadingLabelAndDisablesChoose() {
        setContent(content(hasPhoto = false), actions = PhotoActions(uploading = true), autoAdvance = false)
        compose.onNodeWithText(strings.uploading).assertIsDisplayed().assertIsNotEnabled()
    }

    @Test
    fun removeRequestOpensConfirmAndConfirmInvokesRemove() {
        var requested = false
        var removed = false
        setContent(content(hasPhoto = true), onRemoveRequest = { requested = true })
        compose.onNodeWithText(strings.remove).performClick()
        assertTrue(requested)

        // With the dialog open, the danger confirm runs the removal.
        setContent(content(hasPhoto = true), showRemoveDialog = true, onConfirmRemove = { removed = true })
        compose.onNodeWithText(strings.confirmRemoveTitle).assertIsDisplayed()
        compose.onNodeWithText(strings.confirmRemoveLabel).assertIsDisplayed().performClick()
        assertTrue(removed)
    }

    @Test
    fun loadingShowsAnAccessibleSpinner() {
        setContent(UiState.loading(), autoAdvance = false)
        compose.onAllNodesWithContentDescription(strings.loadingLabel).onFirst().assertExists()
    }

    @Test
    fun errorWithNoCacheShowsRetryAffordanceAndInvokesIt() {
        var retried = false
        setContent(UiState(UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = 500), onRetry = { retried = true })
        compose
            .onNodeWithText("Retry")
            .assertIsDisplayed()
            .assertHasClickAction()
            .performClick()
        assertTrue(retried)
    }

    @Test
    fun offlineShowsCachedZoneWithOfflineChip() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = VehiclePhotoMeta(hasPhoto = true, uploadedAt = "2026-06-01T00:00:00Z"),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            ),
        )
        compose.onNodeWithText(strings.replace).assertIsDisplayed()
        compose.onAllNodesWithContentDescription(strings.offline).onFirst().assertExists()
    }

    @Test
    fun staleNonErrorAutoRefreshes() {
        var retried = false
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = VehiclePhotoMeta(hasPhoto = false),
                stale = true,
                fetchedAt = 1_700_000_000_000L,
            ),
            onRetry = { retried = true },
        )
        compose.waitForIdle()
        assertTrue(retried)
    }
}
