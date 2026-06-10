// AUTO-GENERATED from apps/design/tokens.json by the :android generateDesignTokens task.
// DO NOT EDIT BY HAND. Regenerate with `./gradlew :android:generateDesignTokens`;
// `./gradlew :android:checkDesignTokensDrift` fails the build on drift (P3/A1).

package io.teslasync.android.ui.theme.generated

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// Brand font-family names from tokens. Bundling the font files is out of scope here;
// sizes/weights use the platform default family so user font-scaling keeps working.
object BrandFontFamilies {
    const val SANS: String = "Inter"
    const val MONO: String = "JetBrains Mono"
}

val GeneratedTypography: Typography =
    Typography(
        displayLarge = TextStyle(fontSize = 30.sp, lineHeight = 36.sp, letterSpacing = (-0.5).sp, fontWeight = FontWeight.Bold),
        displayMedium = TextStyle(fontSize = 30.sp, lineHeight = 36.sp, letterSpacing = (-0.5).sp, fontWeight = FontWeight.Bold),
        displaySmall = TextStyle(fontSize = 30.sp, lineHeight = 36.sp, letterSpacing = (-0.5).sp, fontWeight = FontWeight.Bold),
        headlineLarge = TextStyle(fontSize = 24.sp, lineHeight = 32.sp, letterSpacing = (-0.25).sp, fontWeight = FontWeight.Bold),
        headlineMedium = TextStyle(fontSize = 24.sp, lineHeight = 32.sp, letterSpacing = (-0.25).sp, fontWeight = FontWeight.Bold),
        headlineSmall = TextStyle(fontSize = 18.sp, lineHeight = 28.sp, letterSpacing = (-0.15).sp, fontWeight = FontWeight.SemiBold),
        titleLarge = TextStyle(fontSize = 24.sp, lineHeight = 32.sp, letterSpacing = (-0.25).sp, fontWeight = FontWeight.Bold),
        titleMedium = TextStyle(fontSize = 18.sp, lineHeight = 28.sp, letterSpacing = (-0.15).sp, fontWeight = FontWeight.SemiBold),
        titleSmall = TextStyle(fontSize = 16.sp, lineHeight = 24.sp, letterSpacing = 0.sp, fontWeight = FontWeight.SemiBold),
        bodyLarge = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, letterSpacing = 0.sp, fontWeight = FontWeight.Normal),
        bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, letterSpacing = 0.sp, fontWeight = FontWeight.Normal),
        bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, letterSpacing = 0.sp, fontWeight = FontWeight.Normal),
        labelLarge = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, letterSpacing = 0.6.sp, fontWeight = FontWeight.Medium),
        labelMedium = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, letterSpacing = 0.sp, fontWeight = FontWeight.Normal),
        labelSmall = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, letterSpacing = 0.6.sp, fontWeight = FontWeight.Medium),
    )
