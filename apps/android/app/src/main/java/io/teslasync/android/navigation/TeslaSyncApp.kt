package io.teslasync.android.navigation

import androidx.compose.material3.windowsizeclass.ExperimentalMaterial3WindowSizeClassApi
import androidx.compose.material3.windowsizeclass.WindowSizeClass
import androidx.compose.material3.windowsizeclass.WindowWidthSizeClass
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.compose.rememberNavController

/**
 * Top-level navigation entry point: hosts the adaptive [AppScaffold] and provides the navigation
 * seams (the onboarding [gate] for A4). Theme is applied by the caller ([io.teslasync.android.ui.App]).
 *
 * @param windowSizeClass current window size class (computed in the Activity).
 * @param navController hoisted controller; defaults to a remembered one but is injectable for tests.
 * @param gate onboarding gate seam; defaults to [NoOpOnboardingGate] until A4 wires real state.
 */
@OptIn(ExperimentalMaterial3WindowSizeClassApi::class)
@Composable
fun TeslaSyncApp(
    windowSizeClass: WindowSizeClass,
    modifier: Modifier = Modifier,
    navController: NavHostController = rememberNavController(),
    gate: OnboardingGate = NoOpOnboardingGate,
) {
    CompositionLocalProvider(LocalOnboardingGate provides gate) {
        AppScaffold(
            navController = navController,
            width = windowWidthOf(windowSizeClass.widthSizeClass),
            modifier = modifier,
        )
    }
}

/** Maps the Material 3 [WindowWidthSizeClass] onto the framework-free [WindowWidth] bucket. */
@OptIn(ExperimentalMaterial3WindowSizeClassApi::class)
fun windowWidthOf(widthSizeClass: WindowWidthSizeClass): WindowWidth =
    when (widthSizeClass) {
        WindowWidthSizeClass.Compact -> WindowWidth.Compact
        WindowWidthSizeClass.Medium -> WindowWidth.Medium
        else -> WindowWidth.Expanded
    }
