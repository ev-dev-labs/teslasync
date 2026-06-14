package io.teslasync.android.widgetprimitives.widgetgaugehero

import androidx.compose.material3.Text
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the WidgetGaugeHero primitive across every branch the web
 * component renders (web/src/features/dashboard/widgets/shared/WidgetGaugeHero.tsx): the always-present gauge, the
 * `!compact && stats.length > 0` stats row, and the `!compact` children slot. Asserts the gauge's merged TalkBack
 * description (label + value), each stat cell's single accessible description, the show/hide of the stats row and
 * the children slot per `compact`, and the one-shot PII-safe `view.opened` diagnostic. Runs under
 * `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure projection + diagnostics off-device.
 */
class WidgetGaugeHeroUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val gauge =
        GaugeHeroConfig(value = 72.0, max = 100.0, label = LABEL, unit = "%", color = Color(0xFF10B981))

    private val stats =
        listOf(
            GaugeHeroStat(label = "Range", value = "248", unit = "mi"),
            GaugeHeroStat(label = "Cycles", value = "312"),
        )

    // ── Standard: gauge + stats + children all render; gauge + stats are accessible ───────────────────────

    @Test
    fun standardRendersTheGaugeStatsRowAndChildren() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                WidgetGaugeHeroContent(gauge = gauge, stats = stats) { Text(CHILD) }
            }
        }

        // The gauge is named for TalkBack by its label (RadialGauge merges label + value into one description).
        compose.onNodeWithContentDescription(LABEL, substring = true).assertIsDisplayed()
        // The stats row shows and each cell exposes one accessible phrase (label + value + unit).
        compose.onNodeWithTag(WIDGET_GAUGE_HERO_STATS_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithContentDescription("Range: 248 mi").assertIsDisplayed()
        compose.onNodeWithContentDescription("Cycles: 312").assertIsDisplayed()
        // The children slot renders at the standard size.
        compose.onNodeWithText(CHILD).assertIsDisplayed()
    }

    @Test
    fun standardWithoutStatsHidesTheStatsRowButKeepsTheGauge() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                WidgetGaugeHeroContent(gauge = gauge)
            }
        }

        compose.onNodeWithContentDescription(LABEL, substring = true).assertIsDisplayed()
        compose.onNodeWithTag(WIDGET_GAUGE_HERO_STATS_TEST_TAG).assertDoesNotExist()
    }

    // ── Compact: the gauge still renders; the stats row and the children slot are suppressed ──────────────

    @Test
    fun compactSuppressesTheStatsRowAndChildrenButStillShowsTheGauge() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                WidgetGaugeHeroContent(gauge = gauge, stats = stats, compact = true) { Text(CHILD) }
            }
        }

        compose.onNodeWithContentDescription(LABEL, substring = true).assertIsDisplayed()
        compose.onNodeWithTag(WIDGET_GAUGE_HERO_STATS_TEST_TAG).assertDoesNotExist()
        compose.onNodeWithText(CHILD).assertDoesNotExist()
    }

    // ── Diagnostics: one-shot view.opened carrying only the surface slug ──────────────────────────────────

    @Test
    fun mountingEmitsViewOpenedOnceWithOnlyTheSlug() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                WidgetGaugeHero(gauge = gauge, stats = stats, logger = logger)
            }
        }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().level)
        assertEquals(mapOf("surface" to "WidgetGaugeHero"), opened.single().fields)
        assertTrue("the label must never leak", logger.records.none { it.fields.containsValue(LABEL) })
        assertTrue("no stat value may leak", logger.records.none { it.fields.containsValue("248") })
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

    private companion object {
        private const val LABEL = "Battery"
        private const val CHILD = "child-content"
    }
}
