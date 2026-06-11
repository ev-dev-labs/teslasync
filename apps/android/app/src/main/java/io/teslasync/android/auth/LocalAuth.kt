package io.teslasync.android.auth

import androidx.compose.runtime.staticCompositionLocalOf

/**
 * Ambient [AuthController] for the auth surfaces and (later) any page that needs to trigger sign-out.
 * Provided once at the app root from the [AuthContainer]; reading it without a provider is a wiring
 * error and fails fast.
 */
val LocalAuthController =
    staticCompositionLocalOf<AuthController> {
        error("LocalAuthController not provided — wrap the app in App(windowSizeClass, container)")
    }
