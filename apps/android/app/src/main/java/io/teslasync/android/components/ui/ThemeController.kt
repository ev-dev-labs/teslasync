package io.teslasync.android.components.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import io.teslasync.android.ui.theme.TeslaSyncTheme

/**
 * Display mode preference. [System] follows the OS dark-mode setting; [Light]/[Dark] pin it.
 * The Android-native counterpart to the web `ThemeProvider` mode list — the web's accent/
 * custom-color themes don't apply here because the brand palette is the generated Material 3
 * scheme (P3/A1); Android instead exposes mode + high-contrast + Material You (dynamic color).
 */
enum class ThemeMode { System, Light, Dark }

/**
 * Observable holder for the theme preferences a user can toggle at runtime (via [ThemePicker]).
 * Mutating any property recomposes [TeslaSyncThemeHost] and re-derives the active scheme.
 */
@Stable
class ThemeController(
    initialMode: ThemeMode = ThemeMode.System,
    initialHighContrast: Boolean = false,
    initialDynamicColor: Boolean = false,
) {
    var mode by mutableStateOf(initialMode)
    var highContrast by mutableStateOf(initialHighContrast)
    var dynamicColor by mutableStateOf(initialDynamicColor)
}

/** Ambient controller so any descendant (e.g. a settings screen) can read/update preferences. */
val LocalThemeController = staticCompositionLocalOf { ThemeController() }

/** Remembers a [ThemeController] across recompositions. */
@Composable
fun rememberThemeController(
    initialMode: ThemeMode = ThemeMode.System,
    initialHighContrast: Boolean = false,
    initialDynamicColor: Boolean = false,
): ThemeController = remember { ThemeController(initialMode, initialHighContrast, initialDynamicColor) }

/**
 * Applies [controller]'s preferences to [TeslaSyncTheme] and publishes the controller to
 * descendants. Resolve `darkTheme` from the mode here so `System` tracks the OS at runtime.
 */
@Composable
fun TeslaSyncThemeHost(
    controller: ThemeController = rememberThemeController(),
    content: @Composable () -> Unit,
) {
    val dark =
        when (controller.mode) {
            ThemeMode.System -> isSystemInDarkTheme()
            ThemeMode.Light -> false
            ThemeMode.Dark -> true
        }
    CompositionLocalProvider(LocalThemeController provides controller) {
        TeslaSyncTheme(
            darkTheme = dark,
            highContrast = controller.highContrast,
            dynamicColor = controller.dynamicColor,
            content = content,
        )
    }
}
