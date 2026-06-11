package io.teslasync.android.components.motion

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Visual gallery of the motion layer, used by the @Preview entry points below to prove every
 * primitive renders across light / dark / high-contrast and that the reduced-motion override
 * (the deterministic test clock) collapses animations to their final frame.
 */
@Composable
private fun MotionGallery() {
    Surface(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.verticalScroll(rememberScrollState()).padding(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            Section("Fade in") {
                FadeIn { GlassPanel { BodyText("Fades + slides in on mount.") } }
            }
            Section("Stagger") {
                StaggerContainer {
                    listOf("First", "Second", "Third").forEachIndexed { index, label ->
                        StaggerItem(index = index) { GlassPanel { BodyText(label) } }
                    }
                }
            }
            Section("Illustrations") {
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalAlignment = Alignment.CenterVertically) {
                    CarAnimation()
                    WheelSpin(sizeDp = 32)
                    ChargingBolt()
                    BatteryFillAnimation(levelPercent = 72)
                }
            }
            Section("Reduced motion (forced)") {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                        FadeIn { GlassPanel { BodyText("Renders in final state — no entry animation.") } }
                        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalAlignment = Alignment.CenterVertically) {
                            CarAnimation(sizeDp = 96)
                            WheelSpin(sizeDp = 28)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Section(
    title: String,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        SectionTitle(title)
        content()
    }
}

@Preview(name = "Motion \u00b7 Light", showBackground = true, heightDp = 900)
@Composable
private fun MotionGalleryLightPreview() {
    TeslaSyncTheme(darkTheme = false) { MotionGallery() }
}

@Preview(name = "Motion \u00b7 Dark", showBackground = true, heightDp = 900)
@Composable
private fun MotionGalleryDarkPreview() {
    TeslaSyncTheme(darkTheme = true) { MotionGallery() }
}

@Preview(name = "Motion \u00b7 High contrast", showBackground = true, heightDp = 900)
@Composable
private fun MotionGalleryHighContrastPreview() {
    TeslaSyncTheme(highContrast = true) { MotionGallery() }
}
