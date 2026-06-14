// On-device Compose UI + accessibility verification of the Lightbox shared surface across the states the web
// component renders (web/src/components/ui/Lightbox.tsx) plus the platform contract's full state matrix: the
// immersive content viewer (counter, labelled close, bounded prev/next, zoom out/level/in/reset), the
// empty / loading / error chrome with their labelled controls, and the offline freshness chip + retry. The
// `testReleaseUnitTest` gate covers the pure projection + adapters; this runs under `connectedAndroidTest`.
package io.teslasync.android.sharedsurfaces.lightbox

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class LightboxUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun s(id: Int) = context.getString(id)

    private fun strings(): LightboxStrings =
        LightboxStrings(
            close = s(R.string.translation_lightbox_close),
            previous = s(R.string.translation_lightbox_previous),
            next = s(R.string.translation_lightbox_next),
            zoomOut = s(R.string.translation_lightbox_zoomOut),
            zoomIn = s(R.string.translation_lightbox_zoomIn),
            zoomReset = s(R.string.translation_lightbox_zoomReset),
            loading = s(R.string.translation_common_loading),
            empty = s(R.string.translation_common_noData),
            error = s(R.string.translation_error_loadFailed),
            stale = s(R.string.translation_mqtt_stale),
            offline = s(R.string.translation_common_offline),
            retry = s(R.string.translation_common_retry),
            counter = { current, total -> context.getString(R.string.translation_lightbox_counter, current.toString(), total.toString()) },
            zoomPercent = { value -> context.getString(R.string.translation_lightbox_zoomPercent, value.toString()) },
        )

    private fun gallery(count: Int = 3): LightboxGallery =
        LightboxGallery(List(count) { LightboxSlide(src = "img-$it", alt = "Sample image ${it + 1}", caption = "Caption ${it + 1}") })

    private fun setChrome(
        state: UiState<LightboxGallery>,
        onClose: () -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    LightboxChrome(state = state, strings = strings(), onClose = onClose, onRetry = onRetry)
                }
            }
        }
    }

    private fun content(
        count: Int = 3,
        stale: Boolean = false,
        errorKind: ErrorKind? = null,
    ): UiState<LightboxGallery> = UiState(UiPhase.Content, data = gallery(count), fetchedAt = STAMP, stale = stale, errorKind = errorKind)

    @Test
    fun contentShowsCounterLabelledCloseAndBoundedNavigation() {
        setChrome(content())

        compose.onNodeWithTag(LIGHTBOX_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText("1 / 3", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(s(R.string.translation_lightbox_close)).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithTag(LIGHTBOX_PREV_TAG).assertIsNotEnabled()
        compose.onNodeWithTag(LIGHTBOX_NEXT_TAG).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun clickingNextAdvancesTheCounter() {
        setChrome(content())

        compose.onNodeWithTag(LIGHTBOX_NEXT_TAG).performClick()

        compose.onNodeWithText("2 / 3", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun zoomInUpdatesTheZoomLevelReadout() {
        setChrome(content())

        compose.onNodeWithText("100%", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(s(R.string.translation_lightbox_zoomIn)).performClick()

        compose.onNodeWithText("150%", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun closeFiresItsCallback() {
        var closed = false
        setChrome(content(), onClose = { closed = true })

        compose.onNodeWithTag(LIGHTBOX_CLOSE_TAG).performClick()

        assertTrue("close affordance invokes onClose (web onClose)", closed)
    }

    @Test
    fun captionIsRenderedForTheActiveImage() {
        setChrome(content())

        compose.onNodeWithTag(LIGHTBOX_CAPTION_TAG, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun emptyShowsAFriendlyMessageAndAClose() {
        setChrome(UiState(UiPhase.Empty, data = LightboxGallery(emptyList()), fetchedAt = STAMP))

        compose.onNodeWithText(s(R.string.translation_common_noData), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription(s(R.string.translation_lightbox_close)).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun loadingAnnouncesTheLoadingState() {
        setChrome(UiState.loading())

        compose.onNodeWithContentDescription(s(R.string.translation_common_loading)).assertIsDisplayed()
    }

    @Test
    fun errorShowsAClickableRetryThatRefetches() {
        var retried = false
        setChrome(UiState(UiPhase.Error, errorKind = ErrorKind.Unknown), onRetry = { retried = true })

        compose
            .onNodeWithText(s(R.string.translation_common_retry), useUnmergedTree = true)
            .assertIsDisplayed()
            .performClick()

        assertTrue("the error surface retry re-fetches the gallery (web refetch)", retried)
    }

    @Test
    fun offlineShowsTheOfflineChipAndRetry() {
        var retried = false
        setChrome(content(stale = true, errorKind = ErrorKind.Network), onRetry = { retried = true })

        compose.onNodeWithText(s(R.string.translation_common_offline), useUnmergedTree = true).assertIsDisplayed()
        compose
            .onNodeWithTag(LIGHTBOX_RETRY_TAG)
            .assertIsDisplayed()
            .assertHasClickAction()
            .performClick()

        assertTrue("the offline chip's retry re-fetches the gallery", retried)
    }

    private companion object {
        const val STAMP = 1_700_000_000_000L
    }
}
