package io.teslasync.android.featureviews.batterypill

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test
import java.util.Locale

/**
 * On-device Compose UI + accessibility verification of [BatteryPillContent] across every band the surface
 * renders: good (`level >= 60`), warning (`level >= 30`), and critical (below). The whole pill is one
 * accessibility node that announces the label together with the `{fmtInt(level)}%` value (the battery glyph
 * and the meter are decorative), so each test asserts that merged TalkBack label is present — the web spec's
 * visible content (web/src/features/analytics/components/weekly-digest/BatteryPill.tsx). Runs under
 * `connectedAndroidTest`; the offline gate's `testReleaseUnitTest` covers the pure projection logic.
 */
class BatteryPillUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun setContent(
        level: Double,
        label: String,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                BatteryPillContent(level = level, label = label)
            }
        }
    }

    /** The single accessible description the pill exposes: the label followed by the formatted value. */
    private fun description(
        level: Double,
        label: String,
    ): String = "$label ${BatteryPillProjection.percentLabel(level, Locale.getDefault())}"

    @Test
    fun goodBandExposesLabelAndValueAsOneAccessibleNode() {
        val label = "Avg Battery at Charge Start"
        setContent(level = 82.0, label = label)
        compose.onNodeWithContentDescription(description(82.0, label)).assertIsDisplayed()
    }

    @Test
    fun warningBandExposesLabelAndValueAsOneAccessibleNode() {
        val label = "Avg Battery at Charge End"
        setContent(level = 43.0, label = label)
        compose.onNodeWithContentDescription(description(43.0, label)).assertIsDisplayed()
    }

    @Test
    fun criticalBandExposesLabelAndValueAsOneAccessibleNode() {
        val label = "Avg Battery at Charge End"
        setContent(level = 12.0, label = label)
        compose.onNodeWithContentDescription(description(12.0, label)).assertIsDisplayed()
    }

    @Test
    fun fullChargeStillExposesItsAccessibleNode() {
        val label = "Avg Battery at Charge Start"
        setContent(level = 100.0, label = label)
        compose.onNodeWithContentDescription(description(100.0, label)).assertIsDisplayed()
    }

    @Test
    fun theCallerSuppliedLabelIsReflectedInTheAccessibleNode() {
        // The label arrives already localized from the owning section (web parity); the surface renders it
        // verbatim, so a different label produces a different accessible description.
        val label = "Battery Now"
        setContent(level = 55.0, label = label)
        compose.onNodeWithContentDescription(description(55.0, label)).assertIsDisplayed()
    }
}
