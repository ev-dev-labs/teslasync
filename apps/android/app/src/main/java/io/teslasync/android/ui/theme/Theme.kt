package io.teslasync.android.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalContext
import io.teslasync.android.ui.theme.generated.DarkColorScheme
import io.teslasync.android.ui.theme.generated.DarkStatusColors
import io.teslasync.android.ui.theme.generated.GeneratedShapes
import io.teslasync.android.ui.theme.generated.GeneratedTypography
import io.teslasync.android.ui.theme.generated.HighContrastColorScheme
import io.teslasync.android.ui.theme.generated.HighContrastStatusColors
import io.teslasync.android.ui.theme.generated.LightColorScheme
import io.teslasync.android.ui.theme.generated.LightStatusColors

/**
 * TeslaSync Material 3 theme, generated from `apps/design/tokens.json`.
 *
 * The TeslaSync brand light/dark schemes are the default. Material You [dynamicColor]
 * is opt-in and only honored on Android 12+, so the brand identity is what ships unless
 * a user/system setting explicitly enables dynamic color. [highContrast] selects the
 * accessibility-tuned palette. Typography, shapes, the semantic status palette and the
 * chart palette all come from the generated token layer — no brand colors are hardcoded
 * in app code.
 *
 * @param darkTheme follows the system setting by default.
 * @param highContrast use the high-contrast token palette (overrides [darkTheme] colors).
 * @param dynamicColor opt in to Material You wallpaper colors on Android 12+ (default off).
 */
@Composable
fun TeslaSyncTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    highContrast: Boolean = false,
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val colorScheme =
        when {
            dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
                if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)

            highContrast -> HighContrastColorScheme
            darkTheme -> DarkColorScheme
            else -> LightColorScheme
        }

    val statusColors =
        when {
            highContrast -> HighContrastStatusColors
            darkTheme -> DarkStatusColors
            else -> LightStatusColors
        }

    CompositionLocalProvider(LocalStatusColors provides statusColors) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = GeneratedTypography,
            shapes = GeneratedShapes,
            content = content,
        )
    }
}
