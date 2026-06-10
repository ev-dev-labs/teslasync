// AUTO-GENERATED from apps/design/tokens.json by the :android generateDesignTokens task.
// DO NOT EDIT BY HAND. Regenerate with `./gradlew :android:generateDesignTokens`;
// `./gradlew :android:checkDesignTokensDrift` fails the build on drift (P3/A1).

package io.teslasync.android.ui.theme.generated

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color

// Color schemes — semantic tokens mapped onto Material 3 ColorScheme roles.
val LightColorScheme: ColorScheme =
    lightColorScheme(
        primary = Color(0xFF0891B2),
        onPrimary = Color(0xFFF8FAFC),
        secondary = Color(0xFF0891B2),
        onSecondary = Color(0xFFF8FAFC),
        tertiary = Color(0xFF0891B2),
        onTertiary = Color(0xFFF8FAFC),
        background = Color(0xFFF8FAFC),
        onBackground = Color(0xFF0F172A),
        surface = Color(0xFFFFFFFF),
        onSurface = Color(0xFF0F172A),
        surfaceVariant = Color(0xFFFFFFFF),
        onSurfaceVariant = Color(0xFF1E293B),
        surfaceTint = Color(0xFF0891B2),
        outline = Color(0xFFE0E0E0),
        outlineVariant = Color(0xFF64748B),
        error = Color(0xFFDC2626),
        onError = Color(0xFFF8FAFC),
        inverseSurface = Color(0xFF0F172A),
        inverseOnSurface = Color(0xFFFFFFFF),
        inversePrimary = Color(0xFF0891B2),
        scrim = Color(0xFF000000),
    )

val DarkColorScheme: ColorScheme =
    darkColorScheme(
        primary = Color(0xFF00F0FF),
        onPrimary = Color(0xFF0A0A0F),
        secondary = Color(0xFF00F0FF),
        onSecondary = Color(0xFF0A0A0F),
        tertiary = Color(0xFF00F0FF),
        onTertiary = Color(0xFF0A0A0F),
        background = Color(0xFF0A0A0F),
        onBackground = Color(0xFFFFFFFF),
        surface = Color(0xFF0F1019),
        onSurface = Color(0xFFFFFFFF),
        surfaceVariant = Color(0xFF181922),
        onSurfaceVariant = Color(0xFF9CA3AF),
        surfaceTint = Color(0xFF00F0FF),
        outline = Color(0xFF2C2D35),
        outlineVariant = Color(0xFF8A95A6),
        error = Color(0xFFEF4444),
        onError = Color(0xFF0A0A0F),
        inverseSurface = Color(0xFFFFFFFF),
        inverseOnSurface = Color(0xFF0F1019),
        inversePrimary = Color(0xFF00F0FF),
        scrim = Color(0xFF000000),
    )

val HighContrastColorScheme: ColorScheme =
    lightColorScheme(
        primary = Color(0xFF0E7490),
        onPrimary = Color(0xFFFFFFFF),
        secondary = Color(0xFF0E7490),
        onSecondary = Color(0xFFFFFFFF),
        tertiary = Color(0xFF0369A1),
        onTertiary = Color(0xFFFFFFFF),
        background = Color(0xFFFFFFFF),
        onBackground = Color(0xFF000000),
        surface = Color(0xFFFFFFFF),
        onSurface = Color(0xFF000000),
        surfaceVariant = Color(0xFFFFFFFF),
        onSurfaceVariant = Color(0xFF222222),
        surfaceTint = Color(0xFF0E7490),
        outline = Color(0xFFCCCCCC),
        outlineVariant = Color(0xFF555555),
        error = Color(0xFFB91C1C),
        onError = Color(0xFFFFFFFF),
        inverseSurface = Color(0xFF000000),
        inverseOnSurface = Color(0xFFFFFFFF),
        inversePrimary = Color(0xFF0E7490),
        scrim = Color(0xFF000000),
    )

// Semantic status colors (per theme), exposed to the app via a CompositionLocal.
data class StatusColors(
    val success: Color,
    val warning: Color,
    val danger: Color,
    val info: Color,
)

val LightStatusColors: StatusColors = StatusColors(success = Color(0xFF15803D), warning = Color(0xFFB45309), danger = Color(0xFFDC2626), info = Color(0xFF0891B2))
val DarkStatusColors: StatusColors = StatusColors(success = Color(0xFF10B981), warning = Color(0xFFF59E0B), danger = Color(0xFFEF4444), info = Color(0xFF00F0FF))
val HighContrastStatusColors: StatusColors = StatusColors(success = Color(0xFF15803D), warning = Color(0xFFB45309), danger = Color(0xFFB91C1C), info = Color(0xFF0369A1))

// Brand chart palette — theme-invariant and index-stable across platforms.
object ChartPalette {
    val categorical: List<Color> = listOf(
        Color(0xFF0072B2),
        Color(0xFFE69F00),
        Color(0xFF009E73),
        Color(0xFFF0E442),
        Color(0xFF56B4E9),
        Color(0xFFD55E00),
        Color(0xFFCC79A7),
        Color(0xFF4B4B4B),
    )
    val battery: Color = Color(0xFF10B981)
    val energy: Color = Color(0xFFF59E0B)
    val speed: Color = Color(0xFF3B82F6)
    val regen: Color = Color(0xFF06B6D4)
    val temperature: Color = Color(0xFFEF4444)
    val power: Color = Color(0xFFA855F7)
}
