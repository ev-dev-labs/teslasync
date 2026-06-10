// AUTO-GENERATED from apps/design/tokens.json by the :android generateDesignTokens task.
// DO NOT EDIT BY HAND. Regenerate with `./gradlew :android:generateDesignTokens`;
// `./gradlew :android:checkDesignTokensDrift` fails the build on drift (P3/A1).

package io.teslasync.android.ui.theme.generated

import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

// Spacing scale on a 4 dp base grid (token keys 2xl/3xl/4xl -> xl2/xl3/xl4).
object Spacing {
    val none: Dp = 0.dp
    val xs: Dp = 4.dp
    val sm: Dp = 8.dp
    val md: Dp = 12.dp
    val lg: Dp = 16.dp
    val xl: Dp = 20.dp
    val xl2: Dp = 24.dp
    val xl3: Dp = 32.dp
    val xl4: Dp = 48.dp
}

// Tonal elevation (dp) per token elevation level (z-index {0,1,2,3} -> {0,1,3,6} dp).
object Elevation {
    val base: Dp = 0.dp
    val raised: Dp = 1.dp
    val overlay: Dp = 3.dp
    val modal: Dp = 6.dp
}
