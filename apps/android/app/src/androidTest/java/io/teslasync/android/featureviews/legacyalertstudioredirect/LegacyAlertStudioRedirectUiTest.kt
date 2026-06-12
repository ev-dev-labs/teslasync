package io.teslasync.android.featureviews.legacyalertstudioredirect

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the LegacyAlertStudioRedirect surface, mirroring the web
 * spec (web/src/features/notifications/components/LegacyAlertStudioRedirect.tsx). Covers the single render branch
 * (the transient "redirecting" loader — never a blank box — carrying an accessible label), the one-shot redirect
 * the surface emits for the host (web `<Navigate to={…} replace />`) including verbatim query-string
 * preservation, and the PII-safe `view.opened` diagnostic emitted on first composition. The offline gate's
 * `testReleaseUnitTest` covers the pure target/projection + diagnostics; this covers render + a11y + wiring.
 */
class LegacyAlertStudioRedirectUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── Render + accessibility ───────────────────────────────────────────────────────

    @Test
    fun redirectingShowsAnAccessibleLoadingLabelNotABlankBox() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                LegacyAlertStudioRedirectContent()
            }
        }

        // The loader exposes a single accessible name ("Loading...") so TalkBack announces the transient
        // redirect rather than focusing a silent, unlabeled box.
        compose.onNodeWithContentDescription("Loading...").assertIsDisplayed()
    }

    // ── Redirect emission (web `<Navigate to={…} replace />`) ────────────────────────

    @Test
    fun emitsTheStudioRedirectExactlyOnceForAnEmptySearch() {
        val emitted = mutableListOf<LegacyAlertStudioRedirectTarget>()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                LegacyAlertStudioRedirect(
                    onRedirect = { emitted += it },
                    search = "",
                    logger = RecordingLogger(),
                )
            }
        }
        compose.waitForIdle()

        assertEquals(1, emitted.size)
        val target = emitted.single()
        assertEquals("notifications/studio", target.routeWithQuery)
        assertEquals("notificationsStudio", target.destinationId)
        assertTrue("redirect must replace the legacy history entry", target.replace)
    }

    @Test
    fun emitsARedirectThatPreservesTheLegacyQueryParams() {
        val emitted = mutableListOf<LegacyAlertStudioRedirectTarget>()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                LegacyAlertStudioRedirect(
                    onRedirect = { emitted += it },
                    search = "?rule=42",
                    logger = RecordingLogger(),
                )
            }
        }
        compose.waitForIdle()

        val target = emitted.single()
        assertEquals("notifications/studio?rule=42", target.routeWithQuery)
        assertEquals("/notifications/studio?rule=42", target.webPath)
    }

    // ── Diagnostics ────────────────────────────────────────────────────────────────

    @Test
    fun recordsThePiiSafeViewOpenedDiagnosticOnFirstComposition() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                LegacyAlertStudioRedirect(
                    onRedirect = {},
                    search = "?rule=42",
                    logger = logger,
                )
            }
        }
        compose.waitForIdle()

        val viewOpened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, viewOpened.size)
        assertEquals(LogLevel.Info, viewOpened.single().level)
        // PII-safe: the query string is never carried into diagnostics.
        assertEquals(mapOf("surface" to "LegacyAlertStudioRedirect"), viewOpened.single().fields)
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
