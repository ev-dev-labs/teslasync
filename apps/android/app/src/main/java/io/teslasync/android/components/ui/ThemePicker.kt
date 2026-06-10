package io.teslasync.android.components.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Theme preferences UI mirroring web `components/ui/ThemePicker`, adapted to the Android theme
 * model (P3/A1): a [ThemeMode] segmented selector plus high-contrast and Material You toggles.
 * Mutating [controller] (default the ambient [LocalThemeController]) re-themes the app live via
 * [TeslaSyncThemeHost]. The web's accent/custom-color builder doesn't apply because the brand
 * palette is the single generated Material 3 scheme.
 */
@Composable
fun ThemePicker(
    modifier: Modifier = Modifier,
    controller: ThemeController = LocalThemeController.current,
    modeLabel: String = "Display mode",
    systemLabel: String = "System",
    lightLabel: String = "Light",
    darkLabel: String = "Dark",
    highContrastLabel: String = "High contrast",
    dynamicColorLabel: String = "Use wallpaper colors",
    showDynamicColor: Boolean = true,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        MetricLabel(modeLabel)
        val modes = ThemeMode.entries
        SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
            modes.forEachIndexed { index, mode ->
                SegmentedButton(
                    selected = controller.mode == mode,
                    onClick = { controller.mode = mode },
                    shape = SegmentedButtonDefaults.itemShape(index = index, count = modes.size),
                    label = { Text(modeName(mode, systemLabel, lightLabel, darkLabel)) },
                )
            }
        }
        Toggle(
            checked = controller.highContrast,
            onCheckedChange = { controller.highContrast = it },
            label = highContrastLabel,
        )
        if (showDynamicColor) {
            Toggle(
                checked = controller.dynamicColor,
                onCheckedChange = { controller.dynamicColor = it },
                label = dynamicColorLabel,
            )
        }
    }
}

private fun modeName(
    mode: ThemeMode,
    system: String,
    light: String,
    dark: String,
): String =
    when (mode) {
        ThemeMode.System -> system
        ThemeMode.Light -> light
        ThemeMode.Dark -> dark
    }
