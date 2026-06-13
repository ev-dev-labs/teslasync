package io.teslasync.android.sharedsurfaces.installprompt

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

/**
 * On-device Compose UI + accessibility verification of the InstallPrompt shared surface across the states the web
 * component renders (web/src/components/feedback/InstallPrompt.tsx): the install card with its localized title +
 * subtitle, the merged POLITE live-region announcement (so the prompt announces itself when it slides in), the
 * labelled + clickable install + dismiss controls (the web `Install` button + `onClose` X), and the hidden surface
 * that renders nothing (web `null`). It reuses the pure model helper [installPromptAccessibilityLabel] so the expected
 * announcement is derived exactly as the composable derives it, and forces reduced motion so the shared [FadeIn]
 * entrance settles deterministically. Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the
 * pure classifier + state holder, this covers the render.
 */
class InstallPromptUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun s(id: Int) = context.getString(id)

    private fun setSurface(
        surface: InstallPromptSurface,
        onInstall: () -> Unit = {},
        onDismiss: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    InstallPromptContent(surface = surface, onInstall = onInstall, onDismiss = onDismiss)
                }
            }
        }
    }

    @Test
    fun activeRendersTitleSubtitleInstallAndLabelledDismiss() {
        setSurface(InstallPromptSurface.Active)

        compose.onNodeWithTag(INSTALL_PROMPT_TEST_TAG).assertIsDisplayed()
        compose
            .onNodeWithText(s(R.string.translation_installPrompt_title), useUnmergedTree = true)
            .assertIsDisplayed()
        compose
            .onNodeWithText(s(R.string.translation_installPrompt_subtitle), useUnmergedTree = true)
            .assertIsDisplayed()
        compose
            .onNodeWithText(s(R.string.translation_installPrompt_install))
            .assertIsDisplayed()
            .assertHasClickAction()
        compose
            .onNodeWithContentDescription(s(R.string.translation_installPrompt_dismiss))
            .assertIsDisplayed()
            .assertHasClickAction()
    }

    @Test
    fun messageRegionExposesTheMergedPoliteAnnouncement() {
        setSurface(InstallPromptSurface.Active)

        val announcement =
            installPromptAccessibilityLabel(
                s(R.string.translation_installPrompt_title),
                s(R.string.translation_installPrompt_subtitle),
            )
        compose.onNodeWithContentDescription(announcement).assertIsDisplayed()
    }

    @Test
    fun installControlInvokesTheCallback() {
        var installed = false
        setSurface(InstallPromptSurface.Active, onInstall = { installed = true })

        compose.onNodeWithTag(INSTALL_PROMPT_INSTALL_TAG).performClick()
        assertTrue("tapping the install control invokes onInstall", installed)
    }

    @Test
    fun dismissControlInvokesTheCallback() {
        var dismissed = false
        setSurface(InstallPromptSurface.Active, onDismiss = { dismissed = true })

        compose.onNodeWithTag(INSTALL_PROMPT_DISMISS_TAG).performClick()
        assertTrue("tapping the dismiss control invokes onDismiss", dismissed)
    }

    @Test
    fun hiddenRendersNothing() {
        setSurface(InstallPromptSurface.Hidden)
        compose.onNodeWithTag(INSTALL_PROMPT_TEST_TAG).assertDoesNotExist()
    }
}
