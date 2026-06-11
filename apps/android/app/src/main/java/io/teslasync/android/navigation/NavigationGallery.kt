@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.navigation

import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import androidx.navigation.compose.rememberNavController
import io.teslasync.android.ui.theme.TeslaSyncTheme

/**
 * @Preview gallery proving the adaptive shell renders across the compact/medium/expanded width
 * layouts and the light / dark / high-contrast themes. The previews drive [AppScaffold] with a
 * fixed [WindowWidth] (the Activity computes the real one), exercising the bottom bar, rail, and
 * permanent drawer without a device.
 */
@Composable
private fun ShellPreview(
    width: WindowWidth,
    darkTheme: Boolean = true,
    highContrast: Boolean = false,
) {
    TeslaSyncTheme(darkTheme = darkTheme, highContrast = highContrast, dynamicColor = false) {
        AppScaffold(navController = rememberNavController(), width = width)
    }
}

@Preview(name = "Shell · compact · dark", showBackground = true, widthDp = 380, heightDp = 760)
@Composable
private fun ShellCompactDarkPreview() {
    ShellPreview(width = WindowWidth.Compact, darkTheme = true)
}

@Preview(name = "Shell · compact · light", showBackground = true, widthDp = 380, heightDp = 760)
@Composable
private fun ShellCompactLightPreview() {
    ShellPreview(width = WindowWidth.Compact, darkTheme = false)
}

@Preview(name = "Shell · compact · high contrast", showBackground = true, widthDp = 380, heightDp = 760)
@Composable
private fun ShellCompactHighContrastPreview() {
    ShellPreview(width = WindowWidth.Compact, highContrast = true)
}

@Preview(name = "Shell · medium rail", showBackground = true, widthDp = 720, heightDp = 720)
@Composable
private fun ShellMediumPreview() {
    ShellPreview(width = WindowWidth.Medium)
}

@Preview(name = "Shell · expanded drawer", showBackground = true, widthDp = 1100, heightDp = 760)
@Composable
private fun ShellExpandedPreview() {
    ShellPreview(width = WindowWidth.Expanded)
}
