package io.teslasync.android.featureviews.legacyalertsredirect

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
 * On-device Compose UI + accessibility verification of the LegacyAlertsRedirect surface. Mirrors the web spec
 * (web/src/features/notifications/components/LegacyAlertsRedirect.tsx): the redirect fired for each legacy tab
 * (web `<Navigate to={to} replace />`), the forwarded query, the transient route-transition affordance the
 * surface renders while the host redirects (never a blank box), and the accessible "Loading" name on it. The
 * offline gate's `testReleaseUnitTest` covers the pure resolver + diagnostics; this covers render + a11y +
 * the one-shot redirect/diagnostic effects.
 */
class LegacyAlertsRedirectUiTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun contentShowsAccessibleLoadingAffordanceNotABlankBox() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                LegacyAlertsRedirectContent()
            }
        }

        // The redirect affordance carries a single accessible "Loading" name for TalkBack (a11y label test).
        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
    }

    @Test
    fun historyTabRedirectsToInboxForwardingTheQuery() {
        val redirect = redirectTargets(search = "?tab=history&filter=unread")

        assertEquals(1, redirect.size)
        assertEquals(LegacyAlertsDestination.Inbox, redirect.single().destination)
        assertEquals("/notifications/inbox?filter=unread", redirect.single().webTo)
    }

    @Test
    fun preferencesTabRedirectsToQuietHours() {
        val redirect = redirectTargets(search = "?tab=preferences")

        assertEquals(1, redirect.size)
        assertEquals(LegacyAlertsDestination.QuietHours, redirect.single().destination)
    }

    @Test
    fun missingTabRedirectsToAlerts() {
        val redirect = redirectTargets(search = null)

        assertEquals(1, redirect.size)
        assertEquals(LegacyAlertsDestination.Alerts, redirect.single().destination)
        assertEquals("/notifications/alerts", redirect.single().webTo)
    }

    @Test
    fun redirectRecordsViewOpenedAndShowsTheAffordance() {
        val logger = RecordingLogger()
        val redirect = mutableListOf<LegacyAlertsTarget>()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                LegacyAlertsRedirect(search = "?tab=alerts", onRedirect = { redirect += it }, logger = logger)
            }
        }
        compose.waitForIdle()

        compose.onNodeWithContentDescription("Loading").assertIsDisplayed()
        assertEquals(1, redirect.size)
        assertEquals(LegacyAlertsDestination.Alerts, redirect.single().destination)
        assertTrue(logger.records.any { it.event == "view.opened" && it.fields["surface"] == "LegacyAlertsRedirect" })
    }

    private fun redirectTargets(search: String?): List<LegacyAlertsTarget> {
        val captured = mutableListOf<LegacyAlertsTarget>()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                LegacyAlertsRedirect(search = search, onRedirect = { captured += it }, logger = RecordingLogger())
            }
        }
        compose.waitForIdle()
        return captured
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
