package io.teslasync.android.featureviews.statusheader

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * Instrumented Compose UI + accessibility verification of [StatusHeaderContent] across the branches the web
 * component renders (web/src/features/admin/components/dlq-inspector/StatusHeader.tsx): the resolved
 * summary with replay disabled (three cards + the warning banner), the resolved summary with replay enabled
 * (no banner), the loading skeleton (no values, no banner), and the wide responsive-grid layout. Every
 * asserted string is resolved from the app's i18n resources so the test follows the device locale rather
 * than hard-coding English. Runs under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate
 * covers the pure projection + formatting.
 */
class StatusHeaderUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val locale: Locale get() = context.resources.configuration.locales[0]

    private fun string(id: Int) = context.getString(id)

    private fun data(replayEnabled: Boolean) =
        DlqListResponse(
            count = 1234,
            replayEnabled = replayEnabled,
            entries = listOf(DlqEntrySummary(replayable = true), DlqEntrySummary(replayable = false)),
        )

    private fun setContent(
        display: StatusHeaderDisplay,
        width: Dp = PHONE_WIDTH,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = width, height = HOST_HEIGHT)) {
                    StatusHeaderContent(display = display)
                }
            }
        }
    }

    @Test
    fun resolvedDisabledShowsAllCardsCountsAndWarning() {
        setContent(StatusHeaderProjection.project(data(replayEnabled = false), loading = false))

        // Every card's accessible label is present (a11y label test).
        compose.onNodeWithText(string(R.string.translation_admin_dlq_stats_total)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_admin_dlq_stats_replayable)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_admin_dlq_stats_replayMode)).assertIsDisplayed()
        // The total renders through the locale-aware formatter.
        compose.onNodeWithText(StatusHeaderProjection.formatCount(1234, locale)).assertIsDisplayed()
        // Replay mode reads "Disabled" and the warning banner is shown.
        compose.onNodeWithText(string(R.string.translation_admin_dlq_stats_disabled)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_admin_dlq_banners_disabledTitle)).assertIsDisplayed()
    }

    @Test
    fun resolvedEnabledShowsEnabledModeAndHidesWarning() {
        setContent(StatusHeaderProjection.project(data(replayEnabled = true), loading = false))

        compose.onNodeWithText(string(R.string.translation_admin_dlq_stats_enabled)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_admin_dlq_banners_disabledTitle)).assertDoesNotExist()
    }

    @Test
    fun loadingHidesValuesAndWarning() {
        setContent(StatusHeaderProjection.project(data(replayEnabled = false), loading = true))

        // Skeleton chrome replaces the value, and the warning is withheld while loading.
        compose.onNodeWithText(StatusHeaderProjection.formatCount(1234, locale)).assertDoesNotExist()
        compose.onNodeWithText(string(R.string.translation_admin_dlq_banners_disabledTitle)).assertDoesNotExist()
    }

    @Test
    fun wideLayoutRendersAllThreeCards() {
        setContent(StatusHeaderProjection.project(data(replayEnabled = false), loading = false), width = WIDE_WIDTH)

        compose.onNodeWithText(string(R.string.translation_admin_dlq_stats_total)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_admin_dlq_stats_replayable)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_admin_dlq_stats_replayMode)).assertIsDisplayed()
    }

    private companion object {
        val PHONE_WIDTH = 360.dp
        val WIDE_WIDTH = 800.dp
        val HOST_HEIGHT = 640.dp
    }
}
