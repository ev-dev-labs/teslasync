package io.teslasync.android.featureviews.legacynotificationsredirect

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the LegacyNotificationsRedirect surface. The web component
 * (web/src/features/notifications/components/LegacyNotificationsRedirect.tsx) renders no text, so the surface's
 * observable variation is its RESOLUTION: which Notifications page the legacy query lands on. These tests cover
 * (1) the redirect-in-progress affordance rendered for each resolved tab — inbox / archived / channels, plus the
 * unknown-tab inbox fallback — each carrying an accessible destination name so it is never a blank box and
 * TalkBack announces where the redirect leads; and (2) the stateful entry's behaviour: it emits the resolved
 * target exactly once (web `<Navigate replace>`) and records the PII-safe `view.opened` diagnostic. The offline
 * gate's `testReleaseUnitTest` covers the pure resolution; this covers render + a11y + the side effects.
 */
class LegacyNotificationsRedirectUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(search: String?) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                LegacyNotificationsRedirectContent(LegacyNotificationsRedirectProjection.resolve(search))
            }
        }
    }

    // ── Per-tab render + accessibility (the affordance names its destination via a content description) ──

    @Test
    fun inboxRedirectAnnouncesItsDestination() {
        setContent("tab=inbox")
        compose.onNodeWithContentDescription("Inbox").assertIsDisplayed()
    }

    @Test
    fun archivedRedirectAnnouncesItsDestination() {
        setContent("tab=archived")
        compose.onNodeWithContentDescription("Archived").assertIsDisplayed()
    }

    @Test
    fun channelsRedirectAnnouncesItsDestination() {
        setContent("tab=channels")
        compose.onNodeWithContentDescription("Channels").assertIsDisplayed()
    }

    @Test
    fun bareLocationAnnouncesTheInboxFallback() {
        setContent(null)
        compose.onNodeWithContentDescription("Inbox").assertIsDisplayed()
    }

    @Test
    fun unknownTabAnnouncesTheInboxFallback() {
        setContent("tab=nope")
        compose.onNodeWithContentDescription("Inbox").assertIsDisplayed()
    }

    // ── Stateful entry: emits the resolved target once + records the diagnostic ──────────────────────

    @Test
    fun redirectEmitsTheResolvedTargetExactlyOnce() {
        val redirects = mutableListOf<LegacyNotificationsRedirectTarget>()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                LegacyNotificationsRedirect(
                    search = "tab=archived&keep=1",
                    onRedirect = { redirects += it },
                    logger = RecordingLogger(),
                )
            }
        }
        compose.waitForIdle()

        assertEquals(1, redirects.size)
        assertEquals(LegacyNotificationsTab.Archived, redirects.single().tab)
        assertEquals("notifications/archived?keep=1", redirects.single().routeWithQuery)
    }

    @Test
    fun statefulEntryRecordsPiiSafeViewOpened() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                LegacyNotificationsRedirect(search = "tab=channels", onRedirect = {}, logger = logger)
            }
        }
        compose.waitForIdle()

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "LegacyNotificationsRedirect", "tab" to "channels"), fields)
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
