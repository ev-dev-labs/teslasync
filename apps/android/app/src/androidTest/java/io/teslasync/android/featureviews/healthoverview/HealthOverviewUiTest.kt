package io.teslasync.android.featureviews.healthoverview

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
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
 * Instrumented Compose UI + accessibility verification of [HealthOverviewContent] across the branches the
 * web component renders (web/src/features/driving/components/drivetrain-health/HealthOverview.tsx): the
 * healthy summary (title + badge + score, no alert), the warning summary (warm title + "elevated" banner),
 * and the critical summary (overheating title + "critical" banner), plus the blank-motor em-dash edge and
 * the title's accessibility-heading role. Every asserted string is resolved from the app's i18n resources so
 * the test follows the device locale rather than hard-coding English. The settled score is asserted through
 * its stable content description (the count-up is suppressed for accessibility). Runs under
 * `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the pure projection + formatting.
 */
class HealthOverviewUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private val locale: Locale get() = context.resources.configuration.locales[0]

    private fun string(id: Int) = context.getString(id)

    private fun setContent(
        display: HealthOverviewDisplay,
        width: Dp = PHONE_WIDTH,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Box(modifier = Modifier.size(width = width, height = HOST_HEIGHT)) {
                    HealthOverviewContent(display = display)
                }
            }
        }
    }

    @Test
    fun goodStateRendersHealthyTitleScoreAndBadgeWithoutAlert() {
        setContent(HealthOverviewProjection.project(HealthStatus.Good, GOOD_SCORE, MOTOR))

        compose.onNodeWithText(string(R.string.translation_drivetrain_healthGood)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_drivetrain_health_good)).assertIsDisplayed()
        // The settled score is announced via a stable content description (a11y label test).
        compose
            .onNodeWithContentDescription(HealthOverviewProjection.scorePercentLabel(GOOD_SCORE, locale))
            .assertIsDisplayed()
        // Motor line shows the localized label + value.
        compose
            .onNodeWithText(string(R.string.translation_drivetrain_motorState) + ": " + MOTOR)
            .assertIsDisplayed()
        // Healthy band raises no temperature alert.
        compose.onNodeWithText(string(R.string.translation_drivetrain_alert_criticalTitle)).assertDoesNotExist()
        compose.onNodeWithText(string(R.string.translation_drivetrain_alert_warningTitle)).assertDoesNotExist()
    }

    @Test
    fun warningStateShowsWarmTitleBadgeAndWarningAlert() {
        setContent(HealthOverviewProjection.project(HealthStatus.Warning, WARNING_SCORE, MOTOR))

        compose.onNodeWithText(string(R.string.translation_drivetrain_healthWarn)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_drivetrain_health_warning)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_drivetrain_alert_warningTitle)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_drivetrain_alert_criticalTitle)).assertDoesNotExist()
    }

    @Test
    fun criticalStateShowsOverheatingTitleBadgeAndCriticalAlert() {
        setContent(HealthOverviewProjection.project(HealthStatus.Critical, CRITICAL_SCORE, MOTOR))

        compose.onNodeWithText(string(R.string.translation_drivetrain_healthCrit)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_drivetrain_health_critical)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_drivetrain_alert_criticalTitle)).assertIsDisplayed()
        compose.onNodeWithText(string(R.string.translation_drivetrain_alert_warningTitle)).assertDoesNotExist()
    }

    @Test
    fun blankMotorStatusRendersEmDash() {
        setContent(HealthOverviewProjection.project(HealthStatus.Critical, CRITICAL_SCORE, ""))

        compose
            .onNodeWithText(string(R.string.translation_drivetrain_motorState) + ": \u2014")
            .assertIsDisplayed()
    }

    @Test
    fun titleIsExposedAsAnAccessibilityHeading() {
        setContent(HealthOverviewProjection.project(HealthStatus.Good, GOOD_SCORE, MOTOR))

        compose
            .onNodeWithText(string(R.string.translation_drivetrain_healthGood))
            .assert(SemanticsMatcher.keyIsDefined(SemanticsProperties.Heading))
    }

    private companion object {
        const val GOOD_SCORE = 95.0
        const val WARNING_SCORE = 60.0
        const val CRITICAL_SCORE = 25.0
        const val MOTOR = "Drive"
        val PHONE_WIDTH = 360.dp
        val HOST_HEIGHT = 640.dp
    }
}
