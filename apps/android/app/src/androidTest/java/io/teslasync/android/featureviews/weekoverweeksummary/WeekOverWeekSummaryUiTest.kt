package io.teslasync.android.featureviews.weekoverweeksummary

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * Instrumented Compose UI + accessibility verification of [WeekOverWeekSummaryContent] across the branches
 * the web component renders: the resolved six-card comparison grid, the host-loading skeleton, and the
 * always-render empty-week contract. Asserts that the panel title, every metric label, the formatted
 * values / units, and every week-over-week trend chip are exposed to TalkBack (the trend chip merges its
 * arrow + text into one accessible label), and that the loading state is announced rather than read as six
 * empty boxes. Runs under `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure
 * projection.
 */
class WeekOverWeekSummaryUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private val title = context.getString(R.string.translation_analytics_weeklyDigest_weekOverWeek)
    private val distanceLabel = context.getString(R.string.translation_analytics_weeklyDigest_distance)
    private val drivesLabel = context.getString(R.string.translation_analytics_weeklyDigest_drives)
    private val energyLabel = context.getString(R.string.translation_analytics_weeklyDigest_energy)
    private val costLabel = context.getString(R.string.translation_analytics_weeklyDigest_cost)
    private val efficiencyLabel = context.getString(R.string.translation_analytics_weeklyDigest_efficiency)
    private val co2Label = context.getString(R.string.translation_analytics_weeklyDigest_co2)
    private val loadingLabel = context.getString(R.string.translation_a11y_loading)

    private val sample =
        WeekOverWeekMetrics(
            distance = WeekComparison(current = 412.6, previous = 380.2),
            drives = WeekComparison(current = 23.0, previous = 25.0),
            energy = WeekComparison(current = 78.4, previous = 81.0),
            cost = WeekComparison(current = 14.27, previous = 12.5),
            efficiency = WeekComparison(current = 168.3, previous = 171.0),
            co2 = WeekComparison(current = 31.7, previous = 29.1),
        )

    private fun setContent(
        metrics: WeekOverWeekMetrics = sample,
        loading: Boolean = false,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                WeekOverWeekSummaryContent(
                    WeekOverWeekSummaryProjection.project(
                        metrics = metrics,
                        currency = WeekDigestCurrencyPrefs.DEFAULT,
                        loading = loading,
                        locale = Locale.US,
                    ),
                )
            }
        }
    }

    @Test
    fun resolvedShowsTitleAndEverySixLabel() {
        setContent()
        compose.onNodeWithText(title).assertIsDisplayed()
        // Every metric label is exposed to TalkBack (a non-lazy column composes all six).
        compose.onNodeWithText(distanceLabel).assertIsDisplayed()
        compose.onNodeWithText(drivesLabel).assertExists()
        compose.onNodeWithText(energyLabel).assertExists()
        compose.onNodeWithText(costLabel).assertExists()
        compose.onNodeWithText(efficiencyLabel).assertExists()
        compose.onNodeWithText(co2Label).assertExists()
    }

    @Test
    fun resolvedShowsFormattedValuesAndUnits() {
        setContent()
        compose.onNodeWithText("412.6").assertIsDisplayed()
        compose.onNodeWithText("23").assertExists()
        compose.onNodeWithText("78.4").assertExists()
        compose.onNodeWithText("$14.27").assertExists()
        compose.onNodeWithText("168.3").assertExists()
        compose.onNodeWithText("31.7").assertExists()
        compose.onNodeWithText("km").assertExists()
        compose.onNodeWithText("kWh").assertExists()
        compose.onNodeWithText("Wh/km").assertExists()
        compose.onNodeWithText("kg").assertExists()
    }

    @Test
    fun resolvedExposesEveryTrendChipToTalkBack() {
        setContent()
        // The StatCard trend chip merges its arrow + percentage into one accessible content description.
        compose.onNodeWithContentDescription("+8.5%").assertExists()
        compose.onNodeWithContentDescription("-8.0%").assertExists()
        compose.onNodeWithContentDescription("-3.2%").assertExists()
        compose.onNodeWithContentDescription("+14.2%").assertExists()
        compose.onNodeWithContentDescription("-1.6%").assertExists()
        compose.onNodeWithContentDescription("+8.9%").assertExists()
    }

    @Test
    fun loadingAnnouncesItselfAndHidesValues() {
        setContent(loading = true)
        // The title chrome stays; the cards swap to skeletons so no value is shown.
        compose.onNodeWithText(title).assertIsDisplayed()
        compose.onNodeWithText("412.6").assertDoesNotExist()
        compose.onNodeWithText(distanceLabel).assertDoesNotExist()
        // The grid carries a single "Loading" description rather than reading as six empty boxes.
        compose.onNodeWithContentDescription(loadingLabel).assertExists()
    }

    @Test
    fun emptyWeekRendersZerosNotBlankCards() {
        setContent(metrics = WeekOverWeekMetrics.EMPTY)
        compose.onNodeWithText(distanceLabel).assertExists()
        compose.onNodeWithText(costLabel).assertExists()
        // Cost shows "$0.00" and the four decimal cards each show "0.0" — never a blank card.
        compose.onNodeWithText("$0.00").assertExists()
        compose.onAllNodesWithText("0.0").assertCountEquals(4)
    }
}
