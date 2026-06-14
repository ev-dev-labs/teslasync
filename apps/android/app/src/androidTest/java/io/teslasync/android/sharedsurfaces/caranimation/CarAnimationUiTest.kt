package io.teslasync.android.sharedsurfaces.caranimation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
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
 * On-device Compose UI + accessibility verification of the CarAnimation surface across every state the web file
 * plays (web/src/components/motion/CarAnimation.tsx): the three labelled illustrations (CarAnimation /
 * ChargingBolt / WheelSpin) each expose their localized accessible name (web `aria-label`), the battery gauge is
 * decorative by default (web parity — no `aria-label`) yet can be announced when a caller supplies one, and the
 * one-shot PII-safe `view.opened` diagnostic fires once carrying only the surface slug. Every render forces
 * [LocalReducedMotion] = true (the deterministic clock the sibling MotionInteractionTest uses) so the infinite
 * WheelSpin loop never keeps the test clock busy and each illustration sits in its final frame. Runs under
 * `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure projection + diagnostics logic.
 */
class CarAnimationUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun label(resId: Int) = context.getString(resId)

    private fun render(content: @Composable () -> Unit) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    content()
                }
            }
        }
    }

    // ── each labelled illustration exposes its localized accessible name (web `aria-label`) ──────────────────

    @Test
    fun carIllustrationExposesTheTeslaLabel() {
        render { CarAnimation(logger = RecordingLogger()) }

        compose.onNodeWithContentDescription(label(R.string.translation_carAnimation_tesla)).assertIsDisplayed()
    }

    @Test
    fun chargingBoltExposesTheChargingLabel() {
        render { ChargingBolt(logger = RecordingLogger()) }

        compose.onNodeWithContentDescription(label(R.string.translation_carAnimation_charging)).assertIsDisplayed()
    }

    @Test
    fun wheelSpinExposesTheLoadingLabel() {
        render { WheelSpin(logger = RecordingLogger()) }

        compose.onNodeWithContentDescription(label(R.string.translation_carAnimation_loading)).assertIsDisplayed()
    }

    // ── battery: announced when labelled, decorative (web parity) by default ─────────────────────────────────

    @Test
    fun labelledBatteryExposesItsContentDescription() {
        render { BatteryFillAnimation(levelPercent = 72, contentDescription = BATTERY_LABEL, logger = RecordingLogger()) }

        compose.onNodeWithContentDescription(BATTERY_LABEL).assertIsDisplayed()
    }

    @Test
    fun decorativeBatteryIsHiddenFromAccessibility() {
        render { BatteryFillAnimation(levelPercent = 72, logger = RecordingLogger()) }

        // The default gauge carries no label (web parity): neither a caller label nor the atom's own default leaks.
        compose.onNodeWithContentDescription(BATTERY_LABEL).assertDoesNotExist()
        compose.onNodeWithContentDescription(ATOM_BATTERY_DEFAULT).assertDoesNotExist()
    }

    // ── diagnostics: one-shot view.opened carrying only the surface slug ─────────────────────────────────────

    @Test
    fun openingEmitsViewOpenedOnceWithOnlyTheSlug() {
        val logger = RecordingLogger()
        render { CarAnimation(logger = logger) }
        compose.waitForIdle()

        val opened = logger.records.filter { it.event == "view.opened" }
        assertEquals(1, opened.size)
        assertEquals(LogLevel.Info, opened.single().level)
        assertEquals("CarAnimation", opened.single().fields["surface"])
        assertEquals(setOf("surface"), opened.single().fields.keys)
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
        private const val BATTERY_LABEL = "Battery at 72 percent"

        // The motion atom's hard-coded English default for the gauge; the surface suppresses it when decorative.
        private const val ATOM_BATTERY_DEFAULT = "Battery level"
    }
}
