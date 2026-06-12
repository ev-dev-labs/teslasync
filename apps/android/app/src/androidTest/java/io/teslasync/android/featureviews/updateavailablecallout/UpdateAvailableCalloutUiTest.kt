package io.teslasync.android.featureviews.updateavailablecallout

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.time.ZoneId
import java.util.Locale

/**
 * Instrumented Compose UI + accessibility verification of [UpdateAvailableCalloutContent] across the branches
 * the web component renders (web/src/features/system/components/status/UpdateAvailableCallout.tsx): the full
 * callout (versioned title + "running" line + body + muted "last checked" tail + the "View notes" action), the
 * bare title (no target version), the hidden "running" line (no installed version), and the hidden "last
 * checked" tail (no timestamp). It also verifies the only interactive element — the "View notes" control —
 * exposes its label, has a click action (a11y), and invokes its callback. Every asserted string is resolved
 * from the app's i18n resources so the test follows the device locale rather than hard-coding English. Runs
 * under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the pure projection + formatting.
 */
class UpdateAvailableCalloutUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val locale: Locale get() = context.resources.configuration.locales[0]
    private val zone: ZoneId = ZoneId.of("UTC")

    private fun string(id: Int) = context.getString(id)

    private fun string(
        id: Int,
        arg: String,
    ) = context.getString(id, arg)

    private fun display(
        current: String?,
        latest: String?,
        checkedAt: String?,
    ) = UpdateAvailableCalloutProjection.project(current, latest, checkedAt, zone, locale)

    private fun setContent(
        display: UpdateAvailableCalloutDisplay,
        onViewNotes: () -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.width(PHONE_WIDTH)) {
                    UpdateAvailableCalloutContent(display = display, onViewNotes = onViewNotes)
                }
            }
        }
    }

    @Test
    fun fullInputShowsTitleRunningBodyLastCheckedAndButton() {
        val model = display(current = "2026.8.1", latest = "2026.12.0", checkedAt = CHECKED_AT)
        setContent(model)
        val title = string(R.string.translation_statusBar_version_calloutTitleVersion, "2026.12.0")
        val running = string(R.string.translation_statusBar_version_calloutRunning, "2026.8.1")
        val body = string(R.string.translation_statusBar_version_calloutBody)
        val lastChecked = string(R.string.translation_statusBar_version_calloutLastChecked, requireNotNull(model.checkedAtLabel))
        val viewNotes = string(R.string.translation_statusBar_version_calloutViewNotes)

        // Versioned title.
        compose.onNodeWithText(title).assertIsDisplayed()
        // The body paragraph carries the "running" sentence, the review sentence, and the "last checked" tail.
        compose.onNodeWithText(running, substring = true).assertIsDisplayed()
        compose.onNodeWithText(body, substring = true).assertIsDisplayed()
        compose.onNodeWithText(lastChecked, substring = true).assertIsDisplayed()
        // The interactive control exposes its label and a click action (a11y).
        compose.onNodeWithText(viewNotes).assertHasClickAction()
    }

    @Test
    fun withoutTargetVersionShowsTheBareTitle() {
        setContent(display(current = "2026.8.1", latest = null, checkedAt = null))

        compose.onNodeWithText(string(R.string.translation_statusBar_version_updateAvailable)).assertIsDisplayed()
    }

    @Test
    fun withoutInstalledVersionHidesTheRunningLine() {
        // No `current` → the body node is EXACTLY the review sentence (no "running" prefix, no tail).
        setContent(display(current = null, latest = "2026.12.0", checkedAt = null))

        compose.onNodeWithText(string(R.string.translation_statusBar_version_calloutBody)).assertIsDisplayed()
    }

    @Test
    fun withoutTimestampHidesTheLastCheckedTail() {
        // No `checkedAt` → the body node is EXACTLY "running + body" with no "· Last checked …" tail.
        setContent(display(current = "2026.8.1", latest = null, checkedAt = null))

        val expectedBody =
            string(R.string.translation_statusBar_version_calloutRunning, "2026.8.1") +
                " " + string(R.string.translation_statusBar_version_calloutBody)
        compose.onNodeWithText(expectedBody).assertIsDisplayed()
    }

    @Test
    fun viewNotesClickInvokesTheCallback() {
        var clicked = false
        setContent(display(current = "2026.8.1", latest = "2026.12.0", checkedAt = CHECKED_AT), onViewNotes = { clicked = true })

        compose.onNodeWithText(string(R.string.translation_statusBar_version_calloutViewNotes)).performClick()

        assertTrue("tapping View notes must invoke onViewNotes", clicked)
    }

    private companion object {
        val PHONE_WIDTH = 360.dp
        const val CHECKED_AT = "2026-04-04T21:30:00Z"
    }
}
