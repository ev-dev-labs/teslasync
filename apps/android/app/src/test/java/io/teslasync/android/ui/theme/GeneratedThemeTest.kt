package io.teslasync.android.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.teslasync.android.ui.theme.generated.BrandFontFamilies
import io.teslasync.android.ui.theme.generated.ChartPalette
import io.teslasync.android.ui.theme.generated.DarkColorScheme
import io.teslasync.android.ui.theme.generated.DarkStatusColors
import io.teslasync.android.ui.theme.generated.Elevation
import io.teslasync.android.ui.theme.generated.GeneratedShapes
import io.teslasync.android.ui.theme.generated.GeneratedTypography
import io.teslasync.android.ui.theme.generated.HighContrastColorScheme
import io.teslasync.android.ui.theme.generated.HighContrastStatusColors
import io.teslasync.android.ui.theme.generated.LightColorScheme
import io.teslasync.android.ui.theme.generated.LightStatusColors
import io.teslasync.android.ui.theme.generated.MotionDurations
import io.teslasync.android.ui.theme.generated.MotionEasing
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the generated Material 3 theme layer end to end: token parsing, light/dark/
 * high-contrast role completeness, typography/shape mapping, and chart/status palette
 * exposure. These assertions are the contract that `tokens.json` -> Kotlin produced the
 * expected values (the generator runs via the :android:generateDesignTokens task).
 */
class GeneratedThemeTest {
    // ── Token parsing ───────────────────────────────────────────────────────────
    @Test
    fun hexColorTokensParseToOpaqueColors() {
        assertEquals(Color(0xFF0891B2), LightColorScheme.primary)
        assertEquals(Color(0xFF00F0FF), DarkColorScheme.primary)
        assertEquals(Color(0xFF0E7490), HighContrastColorScheme.primary)
        assertEquals(1f, DarkColorScheme.primary.alpha)
    }

    @Test
    fun translucentTokensAreFlattenedOverTheSurface() {
        // dark surfaceVariant = rgba(255,255,255,0.04) over #0F1019; outline = rgba(...,0.12) over surface.
        assertEquals(Color(0xFF181922), DarkColorScheme.surfaceVariant)
        assertEquals(Color(0xFF2C2D35), DarkColorScheme.outline)
        assertEquals(Color(0xFFE0E0E0), LightColorScheme.outline)
        // every derived role is fully opaque so it renders as a solid elevated color.
        assertEquals(1f, DarkColorScheme.surfaceVariant.alpha)
        assertEquals(1f, LightColorScheme.outline.alpha)
    }

    // ── Light / dark / high-contrast role completeness ──────────────────────────
    @Test
    fun darkSchemeMapsEverySemanticRole() {
        val s = DarkColorScheme
        assertEquals(Color(0xFF00F0FF), s.primary)
        assertEquals(Color(0xFF0A0A0F), s.onPrimary)
        assertEquals(Color(0xFF00F0FF), s.secondary)
        assertEquals(Color(0xFF0A0A0F), s.onSecondary)
        assertEquals(Color(0xFF00F0FF), s.tertiary)
        assertEquals(Color(0xFF0A0A0F), s.onTertiary)
        assertEquals(Color(0xFF0A0A0F), s.background)
        assertEquals(Color(0xFFFFFFFF), s.onBackground)
        assertEquals(Color(0xFF0F1019), s.surface)
        assertEquals(Color(0xFFFFFFFF), s.onSurface)
        assertEquals(Color(0xFF181922), s.surfaceVariant)
        assertEquals(Color(0xFF9CA3AF), s.onSurfaceVariant)
        assertEquals(Color(0xFF00F0FF), s.surfaceTint)
        assertEquals(Color(0xFF2C2D35), s.outline)
        assertEquals(Color(0xFF8A95A6), s.outlineVariant)
        assertEquals(Color(0xFFEF4444), s.error)
        assertEquals(Color(0xFF0A0A0F), s.onError)
        assertEquals(Color(0xFFFFFFFF), s.inverseSurface)
        assertEquals(Color(0xFF0F1019), s.inverseOnSurface)
        assertEquals(Color(0xFF00F0FF), s.inversePrimary)
        assertEquals(Color(0xFF000000), s.scrim)
    }

    @Test
    fun lightAndHighContrastUseTheirOwnPalettes() {
        assertEquals(Color(0xFF0891B2), LightColorScheme.primary)
        assertEquals(Color(0xFFFFFFFF), LightColorScheme.surface)
        assertEquals(Color(0xFF0F172A), LightColorScheme.onBackground)
        assertEquals(Color(0xFFDC2626), LightColorScheme.error)

        assertEquals(Color(0xFF0E7490), HighContrastColorScheme.primary)
        assertEquals(Color(0xFFFFFFFF), HighContrastColorScheme.background)
        assertEquals(Color(0xFF000000), HighContrastColorScheme.onBackground)
        assertEquals(Color(0xFFB91C1C), HighContrastColorScheme.error)

        // The three schemes are genuinely distinct, not aliases of one palette.
        assertNotEquals(LightColorScheme.primary, DarkColorScheme.primary)
        assertNotEquals(LightColorScheme.primary, HighContrastColorScheme.primary)
        assertNotEquals(LightColorScheme.error, HighContrastColorScheme.error)
    }

    // ── Typography + shape mapping ──────────────────────────────────────────────
    @Test
    fun typographyMapsTheTokenRampOntoM3Slots() {
        val t = GeneratedTypography
        assertEquals(30.sp, t.displaySmall.fontSize)
        assertEquals(36.sp, t.displaySmall.lineHeight)
        assertEquals((-0.5).sp, t.displaySmall.letterSpacing)
        assertEquals(FontWeight.Bold, t.displaySmall.fontWeight)

        assertEquals(24.sp, t.titleLarge.fontSize)
        assertEquals(18.sp, t.titleMedium.fontSize)
        assertEquals(16.sp, t.titleSmall.fontSize)
        assertEquals(14.sp, t.bodyMedium.fontSize)

        assertEquals(12.sp, t.labelLarge.fontSize)
        assertEquals(0.6.sp, t.labelLarge.letterSpacing)
        assertEquals(FontWeight.Medium, t.labelLarge.fontWeight)
    }

    @Test
    fun shapesAndRadiiComeFromTokens() {
        assertEquals(8.dp, Radius.sm)
        assertEquals(12.dp, Radius.md)
        assertEquals(16.dp, Radius.lg)
        assertEquals(9999.dp, Radius.pill)

        assertEquals(RoundedCornerShape(8.dp), GeneratedShapes.small)
        assertEquals(RoundedCornerShape(12.dp), GeneratedShapes.medium)
        assertEquals(RoundedCornerShape(16.dp), GeneratedShapes.large)
    }

    // ── Spacing + elevation + motion ────────────────────────────────────────────
    @Test
    fun spacingElevationAndMotionComeFromTokens() {
        assertEquals(0.dp, Spacing.none)
        assertEquals(8.dp, Spacing.sm)
        assertEquals(24.dp, Spacing.xl2)
        assertEquals(48.dp, Spacing.xl4)

        assertEquals(0.dp, Elevation.base)
        assertEquals(1.dp, Elevation.raised)
        assertEquals(3.dp, Elevation.overlay)
        assertEquals(6.dp, Elevation.modal)

        assertEquals(150, MotionDurations.fast)
        assertEquals(250, MotionDurations.normal)
        assertEquals(400, MotionDurations.slow)
        assertEquals(0f, MotionEasing.standard.transform(0f), 1e-4f)
        assertEquals(1f, MotionEasing.standard.transform(1f), 1e-4f)
    }

    // ── Chart + status palette exposure ─────────────────────────────────────────
    @Test
    fun chartPaletteIsExposedAndIndexStable() {
        assertEquals(8, ChartPalette.categorical.size)
        assertEquals(Color(0xFF0072B2), ChartPalette.categorical.first())
        assertEquals(Color(0xFF4B4B4B), ChartPalette.categorical.last())
        assertEquals(Color(0xFF10B981), ChartPalette.battery)
        assertEquals(Color(0xFFF59E0B), ChartPalette.energy)
        assertEquals(Color(0xFF3B82F6), ChartPalette.speed)
        assertEquals(Color(0xFF06B6D4), ChartPalette.regen)
        assertEquals(Color(0xFFEF4444), ChartPalette.temperature)
        assertEquals(Color(0xFFA855F7), ChartPalette.power)
    }

    @Test
    fun statusPalettesAreExposedPerTheme() {
        assertEquals(Color(0xFF10B981), DarkStatusColors.success)
        assertEquals(Color(0xFFF59E0B), DarkStatusColors.warning)
        assertEquals(Color(0xFFEF4444), DarkStatusColors.danger)
        assertEquals(Color(0xFF00F0FF), DarkStatusColors.info)

        assertEquals(Color(0xFF15803D), LightStatusColors.success)
        assertEquals(Color(0xFFB45309), LightStatusColors.warning)

        assertEquals(Color(0xFFB91C1C), HighContrastStatusColors.danger)
        // Danger differs across themes -> palettes are theme-specific, not shared.
        assertNotEquals(LightStatusColors.danger, HighContrastStatusColors.danger)
    }

    @Test
    fun brandFontFamilyNamesComeFromTokens() {
        assertEquals("Inter", BrandFontFamilies.SANS)
        assertEquals("JetBrains Mono", BrandFontFamilies.MONO)
        assertTrue(BrandFontFamilies.SANS.isNotBlank())
    }
}
