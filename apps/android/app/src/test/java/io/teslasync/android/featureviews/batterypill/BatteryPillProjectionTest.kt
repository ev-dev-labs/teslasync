package io.teslasync.android.featureviews.batterypill

import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the BatteryPill's pure logic — the native mirror of every derivation the web
 * component performs (web/src/features/analytics/components/weekly-digest/BatteryPill.tsx): the
 * `STATUS_COLORS` color band (`level >= 60` good, `level >= 30` warning, else critical), the
 * `Math.min(level, 100)` bar fill, and the `${fmtInt(level)}%` value text (locale-grouped, zero-fraction,
 * non-finite guarded). Because the surface is purely presentational each [BatteryPillDisplay] is exactly
 * what the thin composable renders, so these assertions double as the per-state "snapshot". Runs in the
 * :android:testReleaseUnitTest gate.
 */
class BatteryPillProjectionTest {
    private companion object {
        const val FRACTION_DELTA: Float = 1e-6f
    }

    // ── Color band (web `level >= 60 ? good : level >= 30 ? warning : critical`) ────────────────────

    @Test
    fun fromLevelClassifiesEachBand() {
        assertEquals(BatteryStatus.Good, BatteryStatus.fromLevel(100.0))
        assertEquals(BatteryStatus.Good, BatteryStatus.fromLevel(61.0))
        assertEquals(BatteryStatus.Warning, BatteryStatus.fromLevel(45.0))
        assertEquals(BatteryStatus.Warning, BatteryStatus.fromLevel(31.0))
        assertEquals(BatteryStatus.Critical, BatteryStatus.fromLevel(12.0))
        assertEquals(BatteryStatus.Critical, BatteryStatus.fromLevel(0.0))
    }

    @Test
    fun fromLevelThresholdsAreInclusiveLikeTheWebGreaterEquals() {
        // Web uses `>=`, so the exact threshold values land in the higher band.
        assertEquals(BatteryStatus.Good, BatteryStatus.fromLevel(BatteryStatus.GOOD_THRESHOLD))
        assertEquals(BatteryStatus.Warning, BatteryStatus.fromLevel(BatteryStatus.GOOD_THRESHOLD - 0.1))
        assertEquals(BatteryStatus.Warning, BatteryStatus.fromLevel(BatteryStatus.WARNING_THRESHOLD))
        assertEquals(BatteryStatus.Critical, BatteryStatus.fromLevel(BatteryStatus.WARNING_THRESHOLD - 0.1))
    }

    @Test
    fun fromLevelTreatsNegativeChargeAsCritical() {
        assertEquals(BatteryStatus.Critical, BatteryStatus.fromLevel(-10.0))
    }

    // ── Bar fill (web `Math.min(level, 100)%`, low-end clamped so width is never negative) ───────────

    @Test
    fun projectComputesBarFractionAsLevelOverHundred() {
        assertEquals(0.0f, BatteryPillProjection.project(0.0).barFraction, FRACTION_DELTA)
        assertEquals(0.5f, BatteryPillProjection.project(50.0).barFraction, FRACTION_DELTA)
        assertEquals(0.82f, BatteryPillProjection.project(82.0).barFraction, FRACTION_DELTA)
        assertEquals(1.0f, BatteryPillProjection.project(100.0).barFraction, FRACTION_DELTA)
    }

    @Test
    fun projectClampsBarFractionToTheZeroToOneRange() {
        // Web `Math.min(level, 100)` caps the upper end; a negative level would yield a negative CSS width,
        // which renders as an empty bar — reproduced here by clamping the low end to zero.
        assertEquals(1.0f, BatteryPillProjection.project(150.0).barFraction, FRACTION_DELTA)
        assertEquals(0.0f, BatteryPillProjection.project(-25.0).barFraction, FRACTION_DELTA)
    }

    @Test
    fun projectSelectsTheBandAndCarriesTheRawLevel() {
        val good = BatteryPillProjection.project(82.0)
        assertEquals(BatteryStatus.Good, good.status)
        assertEquals(82.0, good.level, 0.0)

        assertEquals(BatteryStatus.Warning, BatteryPillProjection.project(43.0).status)
        assertEquals(BatteryStatus.Critical, BatteryPillProjection.project(12.0).status)
    }

    // ── Value text (web `${fmtInt(level)}%`) ─────────────────────────────────────────────────────────

    @Test
    fun percentLabelRendersAWholePercentWithTrailingSign() {
        assertEquals("0%", BatteryPillProjection.percentLabel(0.0, Locale.US))
        assertEquals("43%", BatteryPillProjection.percentLabel(43.0, Locale.US))
        assertEquals("100%", BatteryPillProjection.percentLabel(100.0, Locale.US))
    }

    @Test
    fun percentLabelRoundsHalvesAwayFromZeroLikeToLocaleString() {
        // 72.5 -> 73 under HALF_UP (the JS `toLocaleString` default); the JVM default HALF_EVEN would give 72.
        assertEquals("73%", BatteryPillProjection.percentLabel(72.5, Locale.US))
        assertEquals("74%", BatteryPillProjection.percentLabel(73.5, Locale.US))
        assertEquals("73%", BatteryPillProjection.percentLabel(73.4, Locale.US))
    }

    @Test
    fun percentLabelGuardsNonFiniteToZeroLikeSafeNumber() {
        // fmtInt routes through `safeNumber`, which maps NaN / ±Infinity to 0.
        assertEquals("0%", BatteryPillProjection.percentLabel(Double.NaN, Locale.US))
        assertEquals("0%", BatteryPillProjection.percentLabel(Double.POSITIVE_INFINITY, Locale.US))
        assertEquals("0%", BatteryPillProjection.percentLabel(Double.NEGATIVE_INFINITY, Locale.US))
    }

    @Test
    fun percentLabelGroupsThousandsPerLocaleLikeFmtInt() {
        // fmtInt is locale-grouped; the band never exceeds 100 in practice, but the formatter parity holds.
        assertEquals("1,234%", BatteryPillProjection.percentLabel(1234.0, Locale.US))
        assertEquals("1.234%", BatteryPillProjection.percentLabel(1234.0, Locale.GERMANY))
    }
}
