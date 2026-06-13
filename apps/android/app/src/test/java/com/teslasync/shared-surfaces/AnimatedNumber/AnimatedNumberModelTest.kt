// Off-device unit coverage for the AnimatedNumber surface's pure model (P3 acceptance: adapter + per-state +
// a11y-label tests). Exercises the prompt-mandated registration slug, the ease-out-quad curve that mirrors the
// web `1 - (1 - progress) * (1 - progress)`, the count-from-zero projection, the `fmtNumber`-parity formatter
// (locale grouping, fixed decimals, non-finite → 0), the prefix/suffix display assembly, the per-frame
// projection (cached → projection adapter), the settled string the composable exposes as its accessibility
// label, and the PII-safe `view.opened` diagnostic. No Compose / Android framework / HTTP — runs in
// :android:testReleaseUnitTest. A fixed Locale.US pins the grouping separators so the assertions never depend on
// the host machine's locale. Reference values are the strings + behaviour the web `AnimatedNumber` produces.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.animatednumber

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class AnimatedNumberModelTest {
    // ── registration metadata mirrors the prompt-mandated surface slug ────────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("animated-number", AnimatedNumberRegistration.ID)
        assertEquals("AnimatedNumber", AnimatedNumberRegistration.SLUG)
    }

    @Test
    fun defaultsMatchTheWebSource() {
        // web `from = 0`, `decimals = 0`, `duration = 1` second.
        assertEquals(0.0, AnimatedNumberDefaults.FROM, 1e-9)
        assertEquals(0, AnimatedNumberDefaults.DECIMALS)
        assertEquals(1_000, AnimatedNumberDefaults.DURATION_MS)
    }

    // ── ease-out-quad curve (web `1 - (1 - progress) * (1 - progress)`) ───────────────

    @Test
    fun easeOutQuadMatchesWebCurve() {
        assertEquals(0.0, easeOutQuad(0.0), 1e-9)
        assertEquals(0.75, easeOutQuad(0.5), 1e-9) // 1 - 0.5^2
        assertEquals(0.99, easeOutQuad(0.9), 1e-9) // 1 - 0.1^2
        assertEquals(1.0, easeOutQuad(1.0), 1e-9)
    }

    @Test
    fun easeOutQuadClampsProgressOutOfRange() {
        // web clamps progress with `Math.min(elapsed / durationMs, 1)`; the negative guard keeps it total.
        assertEquals(0.0, easeOutQuad(-1.0), 1e-9)
        assertEquals(1.0, easeOutQuad(2.0), 1e-9)
    }

    @Test
    fun easeOutQuadLeadsLinearProgress() {
        // ease-out is front-loaded: the eased value is at or ahead of linear progress at every interior point.
        for (i in 1..9) {
            val p = i / 10.0
            assertTrue("eased >= linear at p=$p", easeOutQuad(p) >= p)
        }
        assertTrue(easeOutQuad(0.3) < easeOutQuad(0.6))
    }

    // ── count from zero (web `from + (to - from) * eased`, from = 0) ──────────────────

    @Test
    fun animatedValueCountsFromZeroToTarget() {
        assertEquals(0.0, animatedValueAt(200.0, 0.0), 1e-9)
        assertEquals(150.0, animatedValueAt(200.0, 0.5), 1e-9) // 200 * 0.75
        assertEquals(200.0, animatedValueAt(200.0, 1.0), 1e-9)
    }

    @Test
    fun animatedValueHandlesNegativeTarget() {
        assertEquals(0.0, animatedValueAt(-50.0, 0.0), 1e-9)
        assertEquals(-50.0, animatedValueAt(-50.0, 1.0), 1e-9)
    }

    // ── fmtNumber parity: locale grouping, fixed decimals, non-finite → 0 ─────────────

    @Test
    fun formatNumberGroupsAndFixesDecimals() {
        assertEquals("1,234", AnimatedNumberProjection.formatNumber(1234.0, 0, Locale.US))
        assertEquals("1,234,567.89", AnimatedNumberProjection.formatNumber(1234567.89, 2, Locale.US))
        assertEquals("0", AnimatedNumberProjection.formatNumber(0.0, 0, Locale.US))
    }

    @Test
    fun formatNumberCoercesNonFiniteToZero() {
        // web `safeNumber` → 0 for NaN / Infinity, so a mid-flight count never renders NaN.
        assertEquals("0", AnimatedNumberProjection.formatNumber(Double.NaN, 0, Locale.US))
        assertEquals("0.00", AnimatedNumberProjection.formatNumber(Double.POSITIVE_INFINITY, 2, Locale.US))
    }

    @Test
    fun formatNumberKeepsSignForNegatives() {
        assertEquals("-42.5", AnimatedNumberProjection.formatNumber(-42.5, 1, Locale.US))
    }

    // ── prefix/suffix display assembly (web `{prefix}{…}{suffix}`) ─────────────────────

    @Test
    fun formatDisplayWrapsWithPrefixAndSuffix() {
        val spec = AnimatedNumberSpec(value = 1284.5, decimals = 2, prefix = "\$", suffix = " USD")
        assertEquals("\$1,284.50 USD", AnimatedNumberProjection.formatDisplay(spec, 1284.5, Locale.US))
    }

    // ── cached → projection adapter: the render-ready frame at a given progress ────────

    @Test
    fun projectProducesEasedFrameAtProgress() {
        val spec = AnimatedNumberSpec(value = 200.0, decimals = 0)
        assertEquals("0", AnimatedNumberProjection.project(spec, 0.0, Locale.US).text)
        assertEquals("150", AnimatedNumberProjection.project(spec, 0.5, Locale.US).text)
        assertEquals(150.0, AnimatedNumberProjection.project(spec, 0.5, Locale.US).value, 1e-9)
        assertEquals("200", AnimatedNumberProjection.project(spec, 1.0, Locale.US).text)
    }

    @Test
    fun projectClampsProgressIntoRange() {
        val spec = AnimatedNumberSpec(value = 200.0)
        val frame = AnimatedNumberProjection.project(spec, 5.0, Locale.US)
        assertEquals(1.0, frame.progress, 1e-9)
        assertEquals("200", frame.text)
    }

    @Test
    fun reducedMotionSettleEqualsSettledFrame() {
        // Reduced motion (and durationMillis <= 0) snaps straight to `value`; that settled frame reads the same
        // text the count-up lands on, so the surface is honest whether or not it animates.
        val spec = AnimatedNumberSpec(value = 9_876.0, decimals = 0)
        val settled = AnimatedNumberProjection.settledText(spec, Locale.US)
        val finalFrame = AnimatedNumberProjection.project(spec, 1.0, Locale.US).text
        assertEquals("9,876", settled)
        assertEquals(settled, finalFrame)
    }

    // ── a11y label: the settled value IS the node's content description ────────────────

    @Test
    fun settledTextIsTheAccessibleLabel() {
        // The composable sets the node's contentDescription to this exact settled string, so asserting it
        // off-device is the a11y-label coverage for the surface.
        val spec = AnimatedNumberSpec(value = 87.0, suffix = " %")
        assertEquals("87 %", AnimatedNumberProjection.settledText(spec, Locale.US))
    }

    // ── diagnostics: one PII-safe view.opened ─────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeSurfaceSlug() {
        val records = mutableListOf<LogRecord>()
        val logger =
            object : Logger {
                override fun log(
                    level: LogLevel,
                    event: String,
                    fields: Map<String, String>,
                ) {
                    records += LogRecord(level, event, fields)
                }
            }
        AnimatedNumberDiagnostics.recordViewOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        // Only the surface slug — no rendered number / prefix / suffix can leak through the diagnostic.
        assertEquals(mapOf("surface" to "AnimatedNumber"), records[0].fields)
    }
}
