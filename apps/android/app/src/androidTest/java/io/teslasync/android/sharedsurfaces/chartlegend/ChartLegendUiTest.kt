package io.teslasync.android.sharedsurfaces.chartlegend

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertHasNoClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsToggleable
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the ChartLegend shared surface across every state
 * the web component renders (web/src/components/charts/ChartLegend.tsx): the empty legend (a friendly
 * empty state, never a blank box), the passive legend (entries shown, no toggling), and the interactive
 * legend whose entries toggle a series visible/hidden. It asserts the rendered i18n empty string and that
 * each entry exposes its series label as a TalkBack content description, plus that interactive entries are
 * Material checkboxes whose ticked state tracks visibility. The stateful path is exercised end to end
 * against the real store seam. Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers
 * the pure projection, this covers the render.
 */
class ChartLegendUiTest {
    @get:Rule
    val compose = createComposeRule()

    private object NoopLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private val series =
        listOf(
            LegendSeries(key = "speed", label = "Speed", colorArgb = 0xFF2DD4BFL),
            LegendSeries(key = "power", label = "Power", colorArgb = 0xFFF59E0BL),
            LegendSeries(key = "range", label = "Range", colorArgb = 0xFF818CF8L),
        )

    private fun chipTag(key: String) = CHART_LEGEND_CHIP_TAG_PREFIX + key

    @Test
    fun emptyLegendRendersAFriendlyEmptyState() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ChartLegendContent(items = emptyList(), onToggle = null)
            }
        }
        val noData =
            InstrumentationRegistry
                .getInstrumentation()
                .targetContext
                .getString(R.string.translation_chart_noData)

        compose.onNodeWithTag(CHART_LEGEND_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText(noData).assertIsDisplayed()
    }

    @Test
    fun passiveLegendShowsLabelledEntriesWithoutToggling() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ChartLegendContent(
                    items = ChartLegendProjection.project(series, hidden = emptySet(), interactive = false),
                    onToggle = null,
                )
            }
        }

        // Every series label is exposed to assistive tech (a11y label test).
        compose.onNodeWithContentDescription("Speed").assertIsDisplayed()
        compose.onNodeWithContentDescription("Power").assertIsDisplayed()
        compose.onNodeWithContentDescription("Range").assertIsDisplayed()
        // A passive legend exposes no toggle action (web "no resolved source" branch).
        compose.onNodeWithTag(chipTag("speed")).assertHasNoClickAction()
    }

    @Test
    fun interactiveEntriesAreLabelledToggleableCheckboxes() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ChartLegendContent(
                    items = ChartLegendProjection.project(series, hidden = setOf("power"), interactive = true),
                    onToggle = {},
                )
            }
        }

        // a11y label present + idiomatic checkbox role with ticked == visible.
        compose.onNodeWithContentDescription("Speed").assertIsDisplayed()
        compose.onNodeWithTag(chipTag("speed")).assertIsToggleable()
        compose.onNodeWithTag(chipTag("speed")).assertIsOn()
        // The hidden series renders as the un-ticked (visibility off) state.
        compose.onNodeWithTag(chipTag("power")).assertIsOff()
    }

    @Test
    fun tappingAnEntryTogglesItsVisibilityState() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    var hidden by remember { mutableStateOf(emptySet<String>()) }
                    ChartLegendContent(
                        items = ChartLegendProjection.project(series, hidden = hidden, interactive = true),
                        onToggle = { key -> hidden = ChartLegendProjection.toggleHidden(hidden, key) },
                    )
                }
            }
        }

        compose.onNodeWithTag(chipTag("speed")).assertIsOn()
        compose.onNodeWithTag(chipTag("speed")).performClick()
        compose.waitForIdle()
        compose.onNodeWithTag(chipTag("speed")).assertIsOff()
    }

    @Test
    fun statefulLegendPersistsTheToggleThroughTheSharedStore() {
        val store = InMemoryChartHiddenSeriesStore()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    ChartLegend(
                        chartKey = "drive-overview",
                        series = series,
                        store = store,
                        logger = NoopLogger,
                    )
                }
            }
        }

        compose.onNodeWithTag(chipTag("speed")).assertIsOn()
        compose.onNodeWithTag(chipTag("speed")).performClick()
        compose.waitForIdle()

        compose.onNodeWithTag(chipTag("speed")).assertIsOff()
        assertEquals(setOf("speed"), store.hidden("drive-overview").value)
    }
}
