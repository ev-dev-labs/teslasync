package io.teslasync.android.featureviews.batterycomparison

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [BatteryComparisonContent] across every state the P3
 * surface contract mandates (content / empty / error), reproducing the web component's visible content
 * (web/src/features/vehicles/components/BatteryComparison.tsx). The titled panel is ALWAYS present (never the
 * web `null`), each bar is a single merged accessibility node announcing the name, level, and range together
 * (the meter is decorative), and the empty / error bodies announce their localized copy. Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure projection + adapter logic.
 */
class BatteryComparisonUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val formatter = UnitFormatter.default()
    private val strings = BatteryComparisonStrings(title = "Fleet Battery Status", empty = "No data available")

    private val rows =
        listOf(
            BatteryComparisonRow(1L, "Model 3", 82, BatteryBand.Good, 0.82f, 410_000.0),
            BatteryComparisonRow(2L, "Model Y", 47, BatteryBand.Warning, 0.47f, 230_000.0),
            BatteryComparisonRow(3L, "Cybertruck", 18, BatteryBand.Critical, 0.18f, 95_000.0),
        )

    private fun setContent(state: UiState<List<BatteryComparisonRow>>) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                BatteryComparisonContent(state = state, strings = strings, formatter = formatter)
            }
        }
    }

    /** The single accessible description each bar exposes: name, level, and formatted range together. */
    private fun description(row: BatteryComparisonRow): String =
        "${row.name}, ${BatteryComparisonProjection.percentLabel(row.level)}, ${formatter.distance(row.rangeMeters)}"

    @Test
    fun contentRendersTitleAndEveryBarAsOneAccessibleNode() {
        setContent(UiState(phase = UiPhase.Content, data = rows, fetchedAt = 1L))

        compose.onNodeWithText(strings.title).assertIsDisplayed()
        rows.forEach { row ->
            compose.onNodeWithContentDescription(description(row)).assertIsDisplayed()
        }
    }

    @Test
    fun emptyStateStillShowsTheTitledPanelAndMessage() {
        setContent(UiState(phase = UiPhase.Empty, data = emptyList(), fetchedAt = 1L))

        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithContentDescription(strings.empty).assertIsDisplayed()
    }

    @Test
    fun hardErrorShowsTheTitledPanelAndServerErrorCopy() {
        setContent(UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network))

        compose.onNodeWithText(strings.title).assertIsDisplayed()
        compose.onNodeWithText("Server error").assertIsDisplayed()
    }

    @Test
    fun offlineCachedStateKeepsBarsAccessible() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = rows,
                fetchedAt = 1L,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
        )

        compose.onNodeWithContentDescription(description(rows.first())).assertIsDisplayed()
    }
}
