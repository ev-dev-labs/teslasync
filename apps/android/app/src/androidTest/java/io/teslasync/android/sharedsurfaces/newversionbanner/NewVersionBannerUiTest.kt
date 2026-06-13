package io.teslasync.android.sharedsurfaces.newversionbanner

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the NewVersionBanner shared surface across every state the
 * web component renders (web/src/components/feedback/NewVersionBanner.tsx) plus the native-only loading / error /
 * resolved / stale / offline surfaces the platform contract adds: the active reload banner with its two actions,
 * the up-to-date and deferred recorded panels, the skeleton chrome, and the failure/freshness affordances. It
 * asserts the rendered i18n labels, the merged TalkBack descriptions, and that the interactive controls are
 * labelled + clickable and fire their callbacks. Reduced motion keeps the FadeIn from holding the test clock busy.
 * Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure projection + watcher.
 */
class NewVersionBannerUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun s(id: Int) = context.getString(id)

    private fun strings(): NewVersionBannerStrings =
        NewVersionBannerStrings(
            title = s(R.string.translation_pwa_newVersion),
            message = s(R.string.translation_app_newVersion_message),
            detail = s(R.string.translation_error_chunkLoad_body),
            later = s(R.string.translation_app_newVersion_later),
            reload = s(R.string.translation_app_newVersion_reload),
            upToDate = s(R.string.translation_widget_upToDate),
            loading = s(R.string.translation_a11y_loading),
            stale = s(R.string.translation_mqtt_stale),
            offline = s(R.string.translation_error_network_offlineTitle),
            retry = s(R.string.translation_common_retry),
            errorTitle = s(R.string.translation_error_network_title),
            errorBody = s(R.string.translation_error_loadFailed),
        )

    private fun render(
        phase: NewVersionPhase,
        newVersionAvailable: Boolean = true,
        dismissedVersion: String? = null,
        stale: Boolean = false,
        offline: Boolean = false,
        errorKind: ErrorKind? = null,
    ): NewVersionRender =
        NewVersionRender(
            phase = phase,
            watcher =
                VersionWatcherState(
                    bootVersion = "v1",
                    latestVersion = if (newVersionAvailable) "v2" else "v1",
                    newVersionAvailable = newVersionAvailable,
                ),
            dismissedVersion = dismissedVersion,
            stale = stale,
            offline = offline,
            errorKind = errorKind,
        )

    private fun setSurface(
        render: NewVersionRender,
        onReload: () -> Unit = {},
        onLater: () -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    NewVersionBannerContent(
                        render = render,
                        strings = strings(),
                        onReload = onReload,
                        onLater = onLater,
                        onRetry = onRetry,
                    )
                }
            }
        }
    }

    @Test
    fun promptShowsTheMessageAndBothActions() {
        setSurface(render(NewVersionPhase.Prompt))

        compose.onNodeWithTag(NEW_VERSION_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_app_newVersion_message), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(NEW_VERSION_LATER_TAG).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithTag(NEW_VERSION_RELOAD_TAG).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun reloadAndLaterFireTheirCallbacks() {
        var reloaded = false
        var deferred = false
        setSurface(render(NewVersionPhase.Prompt), onReload = { reloaded = true }, onLater = { deferred = true })

        compose.onNodeWithTag(NEW_VERSION_RELOAD_TAG).performClick()
        compose.onNodeWithTag(NEW_VERSION_LATER_TAG).performClick()

        assertTrue("Reload forwards to onReload (web handleReload)", reloaded)
        assertTrue("Later forwards to onLater (web handleLater)", deferred)
    }

    @Test
    fun upToDateShowsTheRecordedPanelWithoutActions() {
        setSurface(render(NewVersionPhase.Resolved, newVersionAvailable = false))

        compose.onNodeWithTag(NEW_VERSION_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithContentDescription(s(R.string.translation_widget_upToDate)).assertIsDisplayed()
        compose.onNodeWithTag(NEW_VERSION_RELOAD_TAG).assertDoesNotExist()
        compose.onNodeWithTag(NEW_VERSION_LATER_TAG).assertDoesNotExist()
    }

    @Test
    fun deferredShowsTheDeferredPanelWithoutActions() {
        setSurface(render(NewVersionPhase.Resolved, newVersionAvailable = true, dismissedVersion = "v2"))

        compose.onNodeWithText(s(R.string.translation_app_newVersion_later), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_app_newVersion_message), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(NEW_VERSION_RELOAD_TAG).assertDoesNotExist()
    }

    @Test
    fun loadingShowsTheLoadingDescription() {
        setSurface(render(NewVersionPhase.Loading))

        compose.onNodeWithContentDescription(s(R.string.translation_a11y_loading)).assertIsDisplayed()
        compose.onNodeWithTag(NEW_VERSION_RELOAD_TAG).assertDoesNotExist()
    }

    @Test
    fun errorShowsTheFailureCopyAndAClickableRetry() {
        var retried = false
        setSurface(render(NewVersionPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })

        compose.onNodeWithText(s(R.string.translation_error_network_title), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(s(R.string.translation_error_loadFailed), useUnmergedTree = true).assertIsDisplayed()
        compose
            .onNodeWithTag(NEW_VERSION_RETRY_TAG)
            .assertIsDisplayed()
            .assertHasClickAction()
            .performClick()

        assertTrue("the error surface retry re-collects the feed (web refetch)", retried)
    }

    @Test
    fun staleShowsTheStaleChipOverTheLastKnownPrompt() {
        setSurface(render(NewVersionPhase.Prompt, stale = true))

        compose.onNodeWithText(s(R.string.translation_mqtt_stale), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(NEW_VERSION_RELOAD_TAG).assertIsDisplayed()
    }

    @Test
    fun offlineShowsTheOfflineChipAndRetry() {
        setSurface(render(NewVersionPhase.Prompt, stale = true, offline = true, errorKind = ErrorKind.Network))

        compose.onNodeWithText(s(R.string.translation_error_network_offlineTitle), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(NEW_VERSION_RETRY_TAG).assertIsDisplayed().assertHasClickAction()
    }
}
