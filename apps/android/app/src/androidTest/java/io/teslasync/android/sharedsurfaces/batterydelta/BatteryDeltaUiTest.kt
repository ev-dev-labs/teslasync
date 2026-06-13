package io.teslasync.android.sharedsurfaces.batterydelta

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device verification of the [BatteryDelta] view — the parity port of the web `BatteryDelta`
 * (web/src/components/data-display/BatteryDelta.tsx). Covers what the offline model test cannot: each web
 * state renders a single accessibility node speaking the localized `aria-label` (the web outer-span label
 * that overrides the decorative glyph + visible text), the `battery.delta.unknown` vs `battery.delta.aria`
 * keys resolve through the P1/S10 catalog, and the one-shot PII-safe `view.opened` diagnostic fires on mount.
 * The offline `:app:testReleaseUnitTest` gate covers the pure projection + the diagnostics emitter.
 */
class BatteryDeltaUiTest {
    @get:Rule
    val compose = createComposeRule()

    // ── State: a charge renders the localized "Battery {from}% to {to}%" readout ───────────────────────────

    @Test
    fun aChargeRendersTheKnownEndpointsAccessibleLabel() {
        mount(startPct = 20.0, endPct = 80.0)

        compose.onNodeWithContentDescription(CHARGE_LABEL).assertExists()
    }

    // ── State: a drain renders the same known-endpoints readout (the visible − sign is decorative) ─────────

    @Test
    fun aDrainRendersTheKnownEndpointsAccessibleLabel() {
        mount(startPct = 79.0, endPct = 78.0)

        compose.onNodeWithContentDescription(DRAIN_LABEL).assertExists()
    }

    // ── State: a flat pair still speaks both endpoints (web `aria` is independent of the zero delta) ───────

    @Test
    fun aFlatChangeRendersTheEqualEndpointsAccessibleLabel() {
        mount(startPct = 80.0, endPct = 80.0)

        compose.onNodeWithContentDescription(FLAT_LABEL).assertExists()
    }

    // ── State: missing data speaks the localized "unknown" label (web `battery.delta.unknown`) ────────────

    @Test
    fun missingDataRendersTheLocalizedUnknownAccessibleLabel() {
        mount(startPct = null, endPct = 50.0)

        compose.onNodeWithContentDescription(UNKNOWN_LABEL).assertExists()
        // No known-endpoints label leaked into the unknown branch.
        compose.onAllNodesWithContentDescription(CHARGE_LABEL).assertCountEquals(0)
    }

    // ── Variant: the pair variant keeps the same spoken endpoints label ───────────────────────────────────

    @Test
    fun thePairVariantSpeaksTheSameKnownEndpointsLabel() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                BatteryDelta(
                    startPct = 79.0,
                    endPct = 78.0,
                    variant = BatteryDeltaVariant.Pair,
                    logger = RecordingLogger(),
                )
            }
        }
        compose.waitForIdle()

        compose.onNodeWithContentDescription(DRAIN_LABEL).assertExists()
    }

    // ── Accessibility: the whole readout is one node (decorative glyph + visible text are not announced) ───

    @Test
    fun theReadoutCollapsesIntoExactlyOneAccessibleNode() {
        mount(startPct = 20.0, endPct = 80.0)

        compose.onAllNodesWithContentDescription(CHARGE_LABEL).assertCountEquals(1)
    }

    // ── Diagnostics: the one-shot PII-safe view.opened (P1/S11) ───────────────────────────────────────────

    @Test
    fun mountingEmitsThePiiSafeViewOpenedDiagnosticOnce() {
        val logger = RecordingLogger()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                BatteryDelta(startPct = 20.0, endPct = 80.0, logger = logger)
            }
        }
        compose.waitForIdle()

        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "BatteryDelta"), fields)
    }

    private fun mount(
        startPct: Double?,
        endPct: Double?,
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                BatteryDelta(startPct = startPct, endPct = endPct, logger = RecordingLogger())
            }
        }
        compose.waitForIdle()
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
        // The en catalog values (instrumentation default locale) for the accessible labels the surface speaks.
        const val CHARGE_LABEL = "Battery 20% to 80%"
        const val DRAIN_LABEL = "Battery 79% to 78%"
        const val FLAT_LABEL = "Battery 80% to 80%"
        const val UNKNOWN_LABEL = "Battery delta unknown"
    }
}
