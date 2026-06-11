package io.teslasync.android.ui

import androidx.compose.material3.windowsizeclass.ExperimentalMaterial3WindowSizeClassApi
import androidx.compose.material3.windowsizeclass.WindowSizeClass
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import io.teslasync.android.auth.AuthContainer
import io.teslasync.android.auth.AuthScaffold
import io.teslasync.android.auth.LocalAuthController
import io.teslasync.android.navigation.TeslaSyncApp
import io.teslasync.android.ui.theme.TeslaSyncTheme

/**
 * App root: applies the Material 3 [TeslaSyncTheme], gates the shell behind the auth state machine
 * (P3/A4, ADR-008), and hosts the adaptive navigation shell (P3/A3). The Activity computes the
 * [windowSizeClass] and supplies the process [AuthContainer]; only an authenticated session reaches
 * [TeslaSyncApp], and the onboarding gate (also from the container) routes a first-run session.
 */
@OptIn(ExperimentalMaterial3WindowSizeClassApi::class)
@Composable
fun App(
    windowSizeClass: WindowSizeClass,
    container: AuthContainer,
) {
    TeslaSyncTheme {
        CompositionLocalProvider(LocalAuthController provides container.authController) {
            AuthScaffold(controller = container.authController) {
                TeslaSyncApp(windowSizeClass = windowSizeClass, gate = container.onboardingGate)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3WindowSizeClassApi::class)
@Preview(showBackground = true, widthDp = 380, heightDp = 760)
@Composable
private fun AppCompactPreview() {
    // Previews the signed-in shell directly; the auth gate needs a process container (Keystore /
    // cache), which Compose tooling cannot provide.
    TeslaSyncTheme(dynamicColor = false) {
        TeslaSyncApp(windowSizeClass = WindowSizeClass.calculateFromSize(DpSize(380.dp, 760.dp)))
    }
}
