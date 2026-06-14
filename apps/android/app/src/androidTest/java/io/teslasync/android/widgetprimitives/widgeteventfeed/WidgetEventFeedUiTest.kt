// Instrumented Compose UI + accessibility verification of [WidgetEventFeedContent] across the states the web
// shared WidgetEventFeed renders: the populated feed (newest-first rows, each folding title + subtitle +
// relative time into one TalkBack phrase), the per-footprint cap (the `maxItems` and `compact` limits), the
// navigable row whose tap routes its href through the host navigator (the web `<Link>`), and the empty state
// (the default "No events yet" catalog copy and a host-supplied override). Runs under `connectedAndroidTest`
// (a device/emulator); the offline gate's `testReleaseUnitTest` covers the pure ordering / cap /
// relative-time logic and the diagnostic in WidgetEventFeedModelTest + WidgetEventFeedDiagnosticsTest.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/widget-primitives/WidgetEventFeed) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgeteventfeed

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import java.time.Instant

class WidgetEventFeedUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val now = Instant.parse("2026-06-06T12:05:00Z").toEpochMilli()

    private fun item(
        id: String,
        title: String,
        ts: String,
        subtitle: String? = null,
        href: String? = null,
    ): EventFeedItem =
        EventFeedItem(
            id = id,
            title = title,
            timestamp = ts,
            accent = Color(0xFF22D3EE),
            subtitle = subtitle,
            href = href,
        )

    private fun sample(): List<EventFeedItem> =
        listOf(
            item("a", "Charging started", "2026-06-06T12:00:00Z", subtitle = "Home"),
            item("b", "Drive completed", "2026-06-06T11:05:00Z"),
            item("c", "Sentry event", "2026-06-06T09:05:00Z"),
            item("d", "Software update", "2026-06-06T08:05:00Z", href = "/updates/4"),
        )

    private fun host(content: @Composable () -> Unit) {
        compose.setContent {
            TeslaSyncTheme {
                Box(modifier = Modifier.fillMaxWidth().height(400.dp)) { content() }
            }
        }
    }

    @Test
    fun contentRendersRowsWithFoldedAccessibleRelativeTimes() {
        host { WidgetEventFeedContent(items = sample(), nowMillis = now) }

        compose.onNodeWithContentDescription("Charging started, Home, 5m ago").assertIsDisplayed()
        compose.onNodeWithContentDescription("Drive completed, 1h ago").assertIsDisplayed()
    }

    @Test
    fun emptyFeedShowsTheDefaultCatalogMessage() {
        host { WidgetEventFeedContent(items = emptyList(), nowMillis = now) }

        compose.onNodeWithText("No events yet").assertIsDisplayed()
    }

    @Test
    fun emptyFeedHonoursACustomMessage() {
        host { WidgetEventFeedContent(items = emptyList(), emptyMessage = "Nothing recorded", nowMillis = now) }

        compose.onNodeWithText("Nothing recorded").assertIsDisplayed()
    }

    @Test
    fun maxItemsCapsTheNewestRows() {
        host { WidgetEventFeedContent(items = sample(), maxItems = 2, nowMillis = now) }

        // Newest two (12:00, 11:05) render; the 09:05 row is dropped by the cap.
        compose.onNodeWithContentDescription("Charging started, Home, 5m ago").assertIsDisplayed()
        compose.onNodeWithContentDescription("Sentry event, 3h ago").assertDoesNotExist()
    }

    @Test
    fun compactFootprintShowsThreeRows() {
        host { WidgetEventFeedContent(items = sample(), compact = true, nowMillis = now) }

        // Compact caps at three; the oldest (08:05) navigable row is dropped.
        compose.onNodeWithContentDescription("Sentry event, 3h ago").assertIsDisplayed()
        compose.onNodeWithContentDescription("Software update, 4h ago").assertDoesNotExist()
    }

    @Test
    fun tappingANavigableRowRoutesItsHref() {
        var navigated: String? = null
        host {
            WidgetEventFeedContent(
                items = listOf(item("d", "Software update", "2026-06-06T08:05:00Z", href = "/updates/4")),
                onNavigate = { navigated = it },
                nowMillis = now,
            )
        }

        compose
            .onNodeWithContentDescription("Software update, 4h ago")
            .assertHasClickAction()
            .performClick()
        assertEquals("/updates/4", navigated)
    }
}
