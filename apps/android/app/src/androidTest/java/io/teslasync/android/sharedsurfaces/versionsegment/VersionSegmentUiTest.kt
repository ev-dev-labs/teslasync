// On-device Compose UI + accessibility verification of the VersionSegment shared surface across the states the
// web component renders (web/src/components/layout/status-bar/VersionSegment.tsx) plus the native modal
// lifecycle the platform contract adds: the always-rendered footer button (with the merged TalkBack label, the
// version + SHA, and the status dot), the About modal's provenance rows + update banner, and the loading /
// error / offline chrome with their labelled, clickable controls. The `testReleaseUnitTest` gate covers the
// pure projection + adapters; this runs under `connectedAndroidTest`.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.versionsegment

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
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class VersionSegmentUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun s(id: Int) = context.getString(id)

    private fun strings(): VersionSegmentStrings =
        VersionSegmentStrings(
            tooltipWord = s(R.string.translation_statusBar_version_tooltip),
            ariaWord = s(R.string.translation_statusBar_version_aria),
            updateAvailable = s(R.string.translation_statusBar_version_updateAvailable),
            unseenAria = s(R.string.translation_changelog_unseenAria),
            appVersionLabel = s(R.string.translation_statusBar_version_appVersion),
            commitLabel = s(R.string.translation_statusBar_version_commit),
            chartLabel = s(R.string.translation_statusBar_version_chart),
            goLabel = s(R.string.translation_statusBar_version_go),
            platformLabel = s(R.string.translation_statusBar_version_platform),
            uptimeRowLabel = s(R.string.translation_statusBar_version_uptimeLabel),
            modalTitle = s(R.string.translation_statusBar_version_modalTitle),
            updateBannerTitle = s(R.string.translation_statusBar_version_updateBanner),
            whatsNew = s(R.string.translation_changelog_openModal),
            releaseNotes = s(R.string.translation_statusBar_version_changelog),
            close = s(R.string.translation_statusBar_version_close),
            loading = s(R.string.translation_a11y_loading),
            stale = s(R.string.translation_mqtt_stale),
            offline = s(R.string.translation_error_network_offlineTitle),
            retry = s(R.string.translation_common_retry),
            errorMessage = s(R.string.translation_error_loadFailed),
            emptyMessage = s(R.string.translation_common_noData),
        )

    private fun button(
        dot: SegmentDot = SegmentDot.Update,
        sha: String? = "abc1234",
        freshness: SegmentFreshness = SegmentFreshness.Fresh,
    ): VersionButtonRender = VersionButtonRender(versionText = "v0.1.0", shaText = sha, dot = dot, freshness = freshness)

    private fun modal(
        phase: ModalPhase,
        banner: UpdateBanner? = null,
        stale: Boolean = false,
        offline: Boolean = false,
    ): VersionModalRender =
        VersionModalRender(
            phase = phase,
            rows =
                listOf(
                    VersionRow("App version", "v0.1.0", mono = true),
                    VersionRow("Commit", "abc1234", mono = true),
                ),
            updateBanner = banner,
            stale = stale,
            offline = offline,
            canRetry = offline || phase == ModalPhase.Error,
            chromeMessage = null,
        )

    private fun setSegment(
        button: VersionButtonRender = button(),
        modal: VersionModalRender = modal(ModalPhase.Content),
        tooltip: String = "TeslaSync version · v0.1.0",
        ariaLabel: String = "TeslaSync version: v0.1.0 (abc1234)",
        onWhatsNew: () -> Unit = {},
        onReleaseNotes: () -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    VersionSegmentContent(
                        button = button,
                        modal = modal,
                        tooltip = tooltip,
                        ariaLabel = ariaLabel,
                        strings = strings(),
                        iconOnly = false,
                        onWhatsNew = onWhatsNew,
                        onReleaseNotes = onReleaseNotes,
                        onRetry = onRetry,
                    )
                }
            }
        }
    }

    private fun setModal(
        modal: VersionModalRender,
        onWhatsNew: () -> Unit = {},
        onReleaseNotes: () -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    VersionAboutModal(
                        modal = modal,
                        strings = strings(),
                        onClose = {},
                        onWhatsNew = onWhatsNew,
                        onReleaseNotes = onReleaseNotes,
                        onRetry = onRetry,
                    )
                }
            }
        }
    }

    @Test
    fun buttonIsLabelledClickableAndShowsTheVersion() {
        setSegment()

        compose
            .onNodeWithTag(VERSION_SEGMENT_BUTTON_TAG)
            .assertIsDisplayed()
            .assertHasClickAction()
        compose.onNodeWithContentDescription("TeslaSync version: v0.1.0 (abc1234)").assertIsDisplayed()
        compose.onNodeWithText("v0.1.0", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(VERSION_SEGMENT_UPDATE_DOT_TAG, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun clickingTheButtonOpensTheAboutModal() {
        setSegment()

        compose.onNodeWithTag(VERSION_SEGMENT_BUTTON_TAG).performClick()

        compose.onNodeWithText(s(R.string.translation_statusBar_version_modalTitle)).assertIsDisplayed()
        compose.onNodeWithText("v0.1.0", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun modalShowsProvenanceTheUpdateBannerAndLabelledActions() {
        setModal(modal(ModalPhase.Content, banner = UpdateBanner("A newer release is available: v0.2.0", "Security fixes.")))

        compose.onNodeWithTag(VERSION_SEGMENT_MODAL_TAG).assertIsDisplayed()
        compose.onNodeWithText("App version", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("A newer release is available: v0.2.0", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(VERSION_SEGMENT_WHATS_NEW_TAG).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithTag(VERSION_SEGMENT_RELEASE_NOTES_TAG).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithTag(VERSION_SEGMENT_CLOSE_TAG).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun whatsNewFiresItsCallback() {
        var opened = false
        setModal(modal(ModalPhase.Content), onWhatsNew = { opened = true })

        compose.onNodeWithTag(VERSION_SEGMENT_WHATS_NEW_TAG).performClick()

        assertTrue("What's new delegates to the changelog opener (web openChangelogModal)", opened)
    }

    @Test
    fun loadingModalAnnouncesTheLoadingState() {
        setModal(modal(ModalPhase.Loading))

        compose.onNodeWithContentDescription(s(R.string.translation_a11y_loading)).assertIsDisplayed()
    }

    @Test
    fun errorModalShowsTheFailureCopyAndAClickableRetry() {
        var retried = false
        setModal(modal(ModalPhase.Error), onRetry = { retried = true })

        compose.onNodeWithText(s(R.string.translation_error_loadFailed), useUnmergedTree = true).assertIsDisplayed()
        compose
            .onNodeWithTag(VERSION_SEGMENT_RETRY_TAG)
            .assertIsDisplayed()
            .assertHasClickAction()
            .performClick()

        assertTrue("the error surface retry re-collects the feed (web refetch)", retried)
    }

    @Test
    fun offlineModalShowsTheOfflineChipAndRetry() {
        setModal(modal(ModalPhase.Content, stale = true, offline = true))

        compose.onNodeWithText(s(R.string.translation_error_network_offlineTitle), useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(VERSION_SEGMENT_RETRY_TAG).assertIsDisplayed().assertHasClickAction()
    }
}
