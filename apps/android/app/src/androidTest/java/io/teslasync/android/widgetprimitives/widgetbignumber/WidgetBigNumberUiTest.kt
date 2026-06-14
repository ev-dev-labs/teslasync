package io.teslasync.android.widgetprimitives.widgetbignumber

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of the WidgetBigNumber primitive across every state the web
 * source plays (web/src/features/dashboard/widgets/shared/WidgetBigNumber.tsx): a present value with unit / label
 * / subtitle / badge, and the absent value (the web `value === null` muted branch). Forces [LocalReducedMotion]
 * = true so the count-up settles instantly and assertions never wait on a real animation. Also asserts the
 * one-shot PII-safe `view.opened` diagnostic and the single coherent TalkBack label. Runs under
 * `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure projection + diagnostics logic. Locale
 * is pinned to US so grouping separators are deterministic.
 */
class WidgetBigNumberUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── present value: the coherent label carries value + unit + label + subtitle + badge ─────────────────────

    @Test
    fun presentValueRendersOneCoherentLabel() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    WidgetBigNumber(
                        value = 287.0,
                        unit = "mi",
                        label = "Range",
                        subtitle = "EPA est.",
                        badge = WidgetBigNumberBadge("Good", WidgetBigNumberBadgeVariant.Success),
                        locale = Locale.US,
                        logger = RecordingLogger(),
                    )
                }
            }
        }

        compose.onNodeWithContentDescription("287 mi, Range, EPA est., Good").assertIsDisplayed()
        compose.onNodeWithTag(WIDGET_BIG_NUMBER_TEST_TAG).assertIsDisplayed()
    }

    // ── absent value: a friendly muted fallback, never a blank box (the web `value === null` branch) ──────────

    @Test
    fun nullValueRendersTheFallbackLabel() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    WidgetBigNumber(
                        value = null,
                        label = "Range",
                        locale = Locale.US,
                        logger = RecordingLogger(),
                    )
                }
            }
        }

        compose.onNodeWithContentDescription("\u2014, Range").assertIsDisplayed()
        compose.onNodeWithTag(WIDGET_BIG_NUMBER_TEST_TAG).assertIsDisplayed()
    }

    // ── badge: the error intent maps to the danger chip and its text renders inside the merged unit ───────────

    @Test
    fun badgeRendersWithinThePrimitive() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    WidgetBigNumber(
                        value = 42.0,
                        badge = WidgetBigNumberBadge("Alert", WidgetBigNumberBadgeVariant.Error),
                        locale = Locale.US,
                        logger = RecordingLogger(),
                    )
                }
            }
        }

        compose.onNodeWithText("Alert", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithContentDescription("42, Alert").assertIsDisplayed()
    }

    // ── diagnostics: one-shot view.opened carrying only the surface slug ──────────────────────────────────────

    @Test
    fun openingEmitsViewOpenedOnceWithOnlyTheSlug() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    WidgetBigNumber(value = 287.0, unit = "mi", locale = Locale.US, logger = logger)
                }
            }
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().level)
        assertEquals("WidgetBigNumber", opened.single().fields["surface"])
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
