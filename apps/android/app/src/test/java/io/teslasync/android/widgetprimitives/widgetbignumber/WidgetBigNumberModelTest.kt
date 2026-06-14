package io.teslasync.android.widgetprimitives.widgetbignumber

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

/**
 * Off-device verification of the WidgetBigNumber adapter — the native mirror of every rendering decision the web
 * source makes (web/src/features/dashboard/widgets/shared/WidgetBigNumber.tsx) before Compose paints. Because the
 * composable is a thin render layer over [WidgetBigNumberModel.project], these per-input assertions double as the
 * primitive's per-state snapshot: a present value (formatted, with any combination of unit / label / subtitle /
 * badge) and the absent value (the web `value === null` muted branch). Runs in the :android:testReleaseUnitTest
 * gate. Locale is pinned to US so grouping separators are deterministic.
 */
class WidgetBigNumberModelTest {
    // ── present value: formatted with locale grouping, every fragment carried into the a11y label ──────────────

    @Test
    fun projectsPresentValueWithEveryFragment() {
        val content =
            WidgetBigNumberModel.project(
                WidgetBigNumberSpec(
                    value = 1_287.0,
                    unit = "mi",
                    label = "Rated range",
                    subtitle = "EPA estimate",
                    badge = WidgetBigNumberBadge("Healthy", WidgetBigNumberBadgeVariant.Success),
                ),
                locale = Locale.US,
            )

        assertEquals("1,287", content.displayText)
        assertFalse(content.isNullValue)
        assertEquals("mi", content.unit)
        assertEquals("RATED RANGE", content.labelDisplay)
        assertEquals("EPA estimate", content.subtitle)
        assertEquals("Healthy", content.badge?.text)
        assertEquals(WidgetBigNumberBadgeVariant.Success, content.badge?.variant)
        // a11y reads in web DOM order, with the label in its ORIGINAL case (never the uppercased display form).
        assertEquals("1,287 mi, Rated range, EPA estimate, Healthy", content.accessibilityLabel)
    }

    @Test
    fun honorsDecimalsAndLocaleGrouping() {
        val content =
            WidgetBigNumberModel.project(
                WidgetBigNumberSpec(value = 1_284.5),
                decimals = 1,
                locale = Locale.US,
            )

        assertEquals("1,284.5", content.displayText)
        assertEquals("1,284.5", content.accessibilityLabel)
    }

    // ── absent value: the web `value === null` muted branch renders the nullDisplay fallback ──────────────────

    @Test
    fun nullValueRendersTheFallbackAndIsFlaggedEmpty() {
        val content =
            WidgetBigNumberModel.project(
                WidgetBigNumberSpec(value = null, unit = "kWh", label = "Energy added"),
                locale = Locale.US,
            )

        assertTrue(content.isNullValue)
        assertEquals(WidgetBigNumberDefaults.NULL_DISPLAY, content.displayText)
        // the unit still renders beside the fallback, exactly as the web `{unit && …}` branch does.
        assertEquals("kWh", content.unit)
        assertEquals("\u2014 kWh, Energy added", content.accessibilityLabel)
    }

    @Test
    fun nonFiniteValueIsTreatedAsEmpty() {
        listOf(Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY).forEach { value ->
            val content = WidgetBigNumberModel.project(WidgetBigNumberSpec(value = value), locale = Locale.US)
            assertTrue("'$value' should be the empty branch", content.isNullValue)
            assertEquals(WidgetBigNumberDefaults.NULL_DISPLAY, content.displayText)
        }
    }

    @Test
    fun customNullDisplayOverridesTheFallback() {
        val content =
            WidgetBigNumberModel.project(
                WidgetBigNumberSpec(value = null),
                nullDisplay = "N/A",
                locale = Locale.US,
            )

        assertEquals("N/A", content.displayText)
        assertEquals("N/A", content.accessibilityLabel)
    }

    // ── normalization: blank optional props collapse to null so a stray empty string reserves no layout ───────

    @Test
    fun blankOptionalsAreNormalizedToNull() {
        val content =
            WidgetBigNumberModel.project(
                WidgetBigNumberSpec(
                    value = 5.0,
                    unit = "   ",
                    label = "",
                    subtitle = "  ",
                    badge = WidgetBigNumberBadge("   ", WidgetBigNumberBadgeVariant.Neutral),
                ),
                locale = Locale.US,
            )

        assertNull(content.unit)
        assertNull(content.labelDisplay)
        assertNull(content.subtitle)
        assertNull(content.badge)
        // with every optional blank, the a11y label is just the value.
        assertEquals("5", content.accessibilityLabel)
    }

    @Test
    fun trimsSurroundingWhitespaceOnOptionals() {
        val content =
            WidgetBigNumberModel.project(
                WidgetBigNumberSpec(value = 5.0, unit = " mi ", label = " range ", subtitle = " now "),
                locale = Locale.US,
            )

        assertEquals("mi", content.unit)
        assertEquals("RANGE", content.labelDisplay)
        assertEquals("now", content.subtitle)
        assertEquals("5 mi, range, now", content.accessibilityLabel)
    }

    // ── a11y label only joins the fragments that exist (no empty separators) ──────────────────────────────────

    @Test
    fun accessibilityLabelJoinsOnlyPresentFragments() {
        val valueOnly = WidgetBigNumberModel.project(WidgetBigNumberSpec(value = 42.0), locale = Locale.US)
        assertEquals("42", valueOnly.accessibilityLabel)

        val valueAndBadge =
            WidgetBigNumberModel.project(
                WidgetBigNumberSpec(value = 42.0, badge = WidgetBigNumberBadge("Alert", WidgetBigNumberBadgeVariant.Error)),
                locale = Locale.US,
            )
        assertEquals("42, Alert", valueAndBadge.accessibilityLabel)
    }

    // ── defaults pin the web parity knobs ─────────────────────────────────────────────────────────────────────

    @Test
    fun defaultsMatchTheWebSource() {
        assertEquals("\u2014", WidgetBigNumberDefaults.NULL_DISPLAY)
        assertEquals(0, WidgetBigNumberDefaults.DECIMALS)
        assertEquals(1_000, WidgetBigNumberDefaults.ANIMATION_MS)
        assertEquals("WidgetBigNumber", WidgetBigNumberRegistration.SLUG)
    }
}
