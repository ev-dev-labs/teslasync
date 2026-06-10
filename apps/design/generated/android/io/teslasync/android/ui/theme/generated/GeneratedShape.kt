// AUTO-GENERATED from apps/design/tokens.json by the :android generateDesignTokens task.
// DO NOT EDIT BY HAND. Regenerate with `./gradlew :android:generateDesignTokens`;
// `./gradlew :android:checkDesignTokensDrift` fails the build on drift (P3/A1).

package io.teslasync.android.ui.theme.generated

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

// Corner radii (dp). `pill` is the fully-rounded token for chips/avatars.
object Radius {
    val sm: Dp = 8.dp
    val md: Dp = 12.dp
    val lg: Dp = 16.dp
    val pill: Dp = 9999.dp
}

val GeneratedShapes: Shapes =
    Shapes(
        extraSmall = RoundedCornerShape(Radius.sm),
        small = RoundedCornerShape(Radius.sm),
        medium = RoundedCornerShape(Radius.md),
        large = RoundedCornerShape(Radius.lg),
        extraLarge = RoundedCornerShape(Radius.lg),
    )
