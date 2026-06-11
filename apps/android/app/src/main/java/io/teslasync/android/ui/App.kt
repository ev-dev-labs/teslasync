package io.teslasync.android.ui

import androidx.compose.material3.windowsizeclass.ExperimentalMaterial3WindowSizeClassApi
import androidx.compose.material3.windowsizeclass.WindowSizeClass
import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import io.teslasync.android.navigation.TeslaSyncApp
import io.teslasync.android.ui.theme.TeslaSyncTheme

/**
 * App root: applies the Material 3 [TeslaSyncTheme] and hosts the adaptive navigation shell (P3/A3).
 * The Activity computes the [windowSizeClass]; the shell selects the bottom bar / rail / drawer
 * affordance and the list/detail pattern from it.
 */
@OptIn(ExperimentalMaterial3WindowSizeClassApi::class)
@Composable
fun App(windowSizeClass: WindowSizeClass) {
    TeslaSyncTheme {
        TeslaSyncApp(windowSizeClass = windowSizeClass)
    }
}

@OptIn(ExperimentalMaterial3WindowSizeClassApi::class)
@Preview(showBackground = true, widthDp = 380, heightDp = 760)
@Composable
private fun AppCompactPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TeslaSyncApp(windowSizeClass = WindowSizeClass.calculateFromSize(DpSize(380.dp, 760.dp)))
    }
}
