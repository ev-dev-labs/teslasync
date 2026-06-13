package io.teslasync.android.sharedsurfaces.alertbanner

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.toneGlyph
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [AlertBannerContent] across every branch the web
 * component renders (web/src/components/feedback/AlertBanner.tsx): the four severity variants, the title + body
 * regions, the optional leading icon, the optional dismiss affordance, and the empty-body fallback that keeps
 * the surface from ever painting a blank box. Asserts the rendered text, the merged TalkBack announcement on the
 * text region, and the labelled, clickable dismiss button. Also covers the one-shot PII-safe `view.opened`
 * diagnostic on the stateful [AlertBanner]. Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate
 * covers the pure [classify] + diagnostics logic.
 */
class AlertBannerUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── Variants × the title + body + icon + dismiss branches all render ──────────────────────────────

    @Test
    fun infoVariantShowsTitleBodyAndDismiss() {
        var dismissed = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AlertBannerContent(
                    variant = AlertVariant.Info,
                    title = "Tesla connection expired",
                    message = "Reconnect to resume live telemetry.",
                    icon = toneGlyph(Tone.Info),
                    onClose = { dismissed = true },
                )
            }
        }

        compose.onNodeWithText("Tesla connection expired", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Reconnect to resume live telemetry.", useUnmergedTree = true).assertIsDisplayed()

        val dismiss = compose.onNodeWithContentDescription("Dismiss notification")
        dismiss.assertIsDisplayed().assertHasClickAction()
        dismiss.performClick()
        assertTrue(dismissed)
    }

    @Test
    fun successVariantRendersBodyOnly() {
        setContent(AlertVariant.Success, message = "Settings saved.")
        compose.onNodeWithText("Settings saved.", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun warningVariantRendersTitleAndBody() {
        setContent(AlertVariant.Warning, title = "Vehicle is offline", message = "Showing the last known state.")
        compose.onNodeWithText("Vehicle is offline", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Showing the last known state.", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun dangerVariantRendersCriticalNotice() {
        setContent(AlertVariant.Danger, title = "Charging fault", message = "The session stopped unexpectedly.")
        compose.onNodeWithText("Charging fault", useUnmergedTree = true).assertIsDisplayed()
    }

    // ── Empty body → the localized fallback, never a blank box ────────────────────────────────────────

    @Test
    fun emptyBodyShowsTheLocalizedFallbackCaption() {
        setContent(AlertVariant.Info)
        compose.onNodeWithText("No data available", useUnmergedTree = true).assertIsDisplayed()
    }

    // ── Non-dismissible banner exposes no dismiss affordance (web `{onClose && …}`) ────────────────────

    @Test
    fun nonDismissibleBannerHasNoDismissButton() {
        setContent(AlertVariant.Info, title = "Notice", message = "Read-only notice.")
        compose.onAllNodesWithContentDescription("Dismiss notification").assertCountEquals(0)
    }

    // ── Accessibility: the title + body are exposed as one merged announcement ────────────────────────

    @Test
    fun textRegionExposesAMergedSpokenLabel() {
        setContent(AlertVariant.Warning, title = "Vehicle is offline", message = "Showing the last known state.")
        compose
            .onNodeWithContentDescription("Vehicle is offline. Showing the last known state.")
            .assertIsDisplayed()
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) ───────────────────────────────────────

    @Test
    fun mountingTheStatefulBannerEmitsViewOpenedOnce() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AlertBanner(
                    variant = AlertVariant.Info,
                    title = "Notice",
                    message = "Body",
                    logger = logger,
                )
            }
        }
        compose.waitForIdle()

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "AlertBanner"), fields)
    }

    private fun setContent(
        variant: AlertVariant,
        title: String? = null,
        message: String? = null,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                AlertBannerContent(variant = variant, title = title, message = message)
            }
        }
    }

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }
}
