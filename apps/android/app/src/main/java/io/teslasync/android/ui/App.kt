package io.teslasync.android.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.windowsizeclass.ExperimentalMaterial3WindowSizeClassApi
import androidx.compose.material3.windowsizeclass.WindowSizeClass
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import io.teslasync.android.auth.AuthContainer
import io.teslasync.android.auth.AuthScaffold
import io.teslasync.android.auth.LocalAuthController
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.components.ui.DensityProvider
import io.teslasync.android.components.ui.ThemeMode
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.navigation.TeslaSyncApp
import io.teslasync.android.notifications.ForegroundNotificationBanner
import io.teslasync.android.notifications.LocalDeepLinkRouter
import io.teslasync.android.notifications.LocalForegroundBannerSink
import io.teslasync.android.notifications.LocalNotificationPreferences
import io.teslasync.android.notifications.NotificationPermissionEffect
import io.teslasync.android.settings.LocalAppSettings
import io.teslasync.android.settings.LocalHapticsEnabled
import io.teslasync.android.settings.LocalSettingsEnvironment
import io.teslasync.android.settings.SettingsEnvironment
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
    val push = container.push
    val appSettings = container.appSettings
    val settings = appSettings.settings
    val darkTheme =
        when (settings.themeMode) {
            ThemeMode.System -> isSystemInDarkTheme()
            ThemeMode.Light -> false
            ThemeMode.Dark -> true
        }
    val settingsEnvironment = remember(container) { SettingsEnvironment(clearOfflineCache = container::clearOfflineCache) }

    TeslaSyncTheme(
        darkTheme = darkTheme,
        highContrast = settings.highContrast,
        dynamicColor = settings.dynamicColor,
    ) {
        DensityProvider(density = settings.density) {
            CompositionLocalProvider(
                LocalAuthController provides container.authController,
                LocalDataContainer provides container.data,
                LocalDeepLinkRouter provides push.deepLinkRouter,
                LocalForegroundBannerSink provides push.bannerSink,
                LocalAppSettings provides appSettings,
                LocalNotificationPreferences provides container.notificationPreferences,
                LocalSettingsEnvironment provides settingsEnvironment,
                // Provide `true` only when the user opted in; `null` lets the platform setting decide.
                LocalReducedMotion provides true.takeIf { settings.reduceMotion },
                LocalHapticsEnabled provides settings.haptics,
            ) {
                AuthScaffold(controller = container.authController) {
                    Box(modifier = Modifier.fillMaxSize()) {
                        TeslaSyncApp(windowSizeClass = windowSizeClass, gate = container.onboardingGate)
                        // Request the runtime notification permission (Android 13+) once signed in, and
                        // overlay foreground push banners (ADR-009: foreground in-app, background OS).
                        NotificationPermissionEffect()
                        ForegroundNotificationBanner(
                            sink = push.bannerSink,
                            onOpen = { uri -> push.deepLinkRouter.request(uri) },
                            modifier = Modifier.align(Alignment.TopCenter),
                        )
                    }
                }
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
