package io.teslasync.android.widgets

import android.os.Build
import androidx.compose.runtime.Composable
import androidx.glance.GlanceTheme
import androidx.glance.material3.ColorProviders
import io.teslasync.android.ui.theme.generated.DarkColorScheme
import io.teslasync.android.ui.theme.generated.LightColorScheme

/**
 * The TeslaSync brand color providers for Glance, mapped from the generated design-token Material 3
 * schemes (`apps/design/tokens.json` → GeneratedColor). Used as the widget color fallback on devices
 * without Material You, so widgets carry the brand identity rather than a generic baseline palette
 * (P3/A8, ADR-005 design-system; ADR-012 token lock — no brand colors hardcoded here).
 */
val TeslaSyncGlanceColors = ColorProviders(light = LightColorScheme, dark = DarkColorScheme)

/**
 * Wraps widget content in a [GlanceTheme] that honors Material You dynamic color on Android 12+ and
 * falls back to the [TeslaSyncGlanceColors] brand palette below it — the documented Glance dynamic-
 * color pattern (ADR-015 contrast + dynamic). Every widget composes through this so light/dark and
 * dynamic theming work without any widget knowing how colors are resolved.
 */
@Composable
fun TeslaSyncGlanceTheme(content: @Composable () -> Unit) {
    GlanceTheme(
        colors = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) GlanceTheme.colors else TeslaSyncGlanceColors,
        content = content,
    )
}
