package io.teslasync.android.featureviews.lifetimesummary

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * Instrumented Compose UI + accessibility verification of [LifetimeSummaryContent] across the branches the
 * web component renders: the resolved seven-tile grid, the host-loading skeleton, and the "No data" empty
 * branch. Asserts that the panel title, every tile label, and the formatted values are exposed to TalkBack,
 * that the empty branch shows the localized "No data" message rather than a blank box, and that the loading
 * state is announced rather than read as seven empty boxes. Runs under `connectedAndroidTest`; the offline
 * gate's `testReleaseUnitTest` covers the pure projection.
 */
class LifetimeSummaryUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private val title = context.getString(R.string.translation_costAnalysis_lifetime_title)
    private val totalSpentLabel = context.getString(R.string.translation_costAnalysis_lifetime_totalSpent)
    private val totalEnergyLabel = context.getString(R.string.translation_costAnalysis_lifetime_totalEnergy)
    private val totalSessionsLabel = context.getString(R.string.translation_costAnalysis_lifetime_totalSessions)
    private val avgSessionCostLabel = context.getString(R.string.translation_costAnalysis_lifetime_avgSessionCost)
    private val avgEnergyLabel = context.getString(R.string.translation_costAnalysis_lifetime_avgEnergy)
    private val avgDurationLabel = context.getString(R.string.translation_costAnalysis_lifetime_avgDuration)
    private val freeSessionsLabel = context.getString(R.string.translation_costAnalysis_lifetime_freeSessions)
    private val noDataMessage = context.getString(R.string.translation_costAnalysis_lifetime_noData)
    private val loadingLabel = context.getString(R.string.translation_a11y_loading)

    private val core =
        LifetimeCoreStats(totalCost = 1284.57, totalEnergy = 4210.6, count = 312.0)

    private val metrics =
        LifetimeMetricsData(
            avgSessionCost = 4.12,
            avgSessionEnergy = 13.5,
            avgDuration = 42.0,
            freeCount = 18.0,
            freeEnergy = 210.4,
        )

    private fun setContent(
        coreStats: LifetimeCoreStats? = core,
        lifetimeMetrics: LifetimeMetricsData? = metrics,
        loading: Boolean = false,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                LifetimeSummaryContent(
                    LifetimeSummaryProjection.project(
                        coreStats = coreStats,
                        lifetimeMetrics = lifetimeMetrics,
                        currency = LifetimeCurrencyPrefs.DEFAULT,
                        loading = loading,
                        locale = Locale.US,
                    ),
                )
            }
        }
    }

    @Test
    fun resolvedShowsTitleAndEverySevenLabel() {
        setContent()
        compose.onNodeWithText(title).assertIsDisplayed()
        compose.onNodeWithText(totalSpentLabel).assertExists()
        compose.onNodeWithText(totalEnergyLabel).assertExists()
        compose.onNodeWithText(totalSessionsLabel).assertExists()
        compose.onNodeWithText(avgSessionCostLabel).assertExists()
        compose.onNodeWithText(avgEnergyLabel).assertExists()
        compose.onNodeWithText(avgDurationLabel).assertExists()
        compose.onNodeWithText(freeSessionsLabel).assertExists()
    }

    @Test
    fun resolvedShowsEveryFormattedValue() {
        setContent()
        compose.onNodeWithText("$1,284.57").assertExists()
        compose.onNodeWithText("4,210.6 kWh").assertExists()
        compose.onNodeWithText("312").assertExists()
        compose.onNodeWithText("$4.12").assertExists()
        compose.onNodeWithText("13.5 kWh").assertExists()
        compose.onNodeWithText("42 min").assertExists()
        compose.onNodeWithText("18 (210.4 kWh)").assertExists()
    }

    @Test
    fun loadingAnnouncesItselfAndHidesValues() {
        setContent(loading = true)
        // The title chrome stays; the tiles swap to skeletons so no value or label is shown.
        compose.onNodeWithText(title).assertIsDisplayed()
        compose.onNodeWithText("$1,284.57").assertDoesNotExist()
        compose.onNodeWithText(totalSpentLabel).assertDoesNotExist()
        // The grid carries a single "Loading" description rather than reading as seven empty boxes.
        compose.onNodeWithContentDescription(loadingLabel).assertExists()
    }

    @Test
    fun missingDataShowsTitleAndNoDataEmptyState() {
        setContent(coreStats = null, lifetimeMetrics = null)
        compose.onNodeWithText(title).assertIsDisplayed()
        compose.onNodeWithText(noDataMessage).assertExists()
        // No tile values render in the empty branch.
        compose.onNodeWithText("$1,284.57").assertDoesNotExist()
        compose.onNodeWithText(totalSpentLabel).assertDoesNotExist()
    }
}
