package io.teslasync.android.ui.theme

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.generated.ChartPalette
import io.teslasync.android.ui.theme.generated.Elevation
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Visual demo of the generated theme: type ramp, Material 3 color roles, semantic status
 * colors, the brand chart palette, and shapes/elevation. Used by the @Preview entry points
 * below to prove the light, dark, high-contrast and dynamic-color-disabled (brand) variants.
 */
@Composable
fun ThemeShowcase(modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier =
                Modifier
                    .verticalScroll(rememberScrollState())
                    .padding(Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            TypographyShowcase()
            ColorRoleShowcase()
            StatusShowcase()
            ChartPaletteShowcase()
            ShapeShowcase()
        }
    }
}

@Composable
private fun TypographyShowcase() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        SectionLabel("Typography")
        Text("Display", style = MaterialTheme.typography.displaySmall)
        Text("Headline", style = MaterialTheme.typography.headlineSmall)
        Text("Title", style = MaterialTheme.typography.titleLarge)
        Text("Body — the quick brown fox jumps over the lazy dog", style = MaterialTheme.typography.bodyMedium)
        Text("LABEL", style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
private fun ColorRoleShowcase() {
    val scheme = MaterialTheme.colorScheme
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        SectionLabel("Color roles")
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Swatch("Primary", scheme.primary)
            Swatch("Secondary", scheme.secondary)
            Swatch("Tertiary", scheme.tertiary)
            Swatch("Surface", scheme.surfaceVariant)
            Swatch("Error", scheme.error)
        }
    }
}

@Composable
private fun StatusShowcase() {
    val status = TeslaTokens.status
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        SectionLabel("Status")
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Swatch("Success", status.success)
            Swatch("Warning", status.warning)
            Swatch("Danger", status.danger)
            Swatch("Info", status.info)
        }
    }
}

@Composable
private fun ChartPaletteShowcase() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        SectionLabel("Chart palette")
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            ChartPalette.categorical.forEach { color -> ColorDot(color) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            listOf(
                ChartPalette.battery,
                ChartPalette.energy,
                ChartPalette.speed,
                ChartPalette.regen,
                ChartPalette.temperature,
                ChartPalette.power,
            ).forEach { color -> ColorDot(color) }
        }
    }
}

@Composable
private fun ShapeShowcase() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        SectionLabel("Shapes & elevation")
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            ShapeChip("sm", MaterialTheme.shapes.small)
            ShapeChip("md", MaterialTheme.shapes.medium)
            ShapeChip("lg", MaterialTheme.shapes.large)
            ShapeChip("pill", RoundedCornerShape(Radius.pill))
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text = text.uppercase(),
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.primary,
    )
}

@Composable
private fun Swatch(
    label: String,
    color: Color,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            modifier =
                Modifier
                    .size(56.dp)
                    .clip(MaterialTheme.shapes.medium)
                    .background(color),
        )
        Spacer(Modifier.height(Spacing.xs))
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

@Composable
private fun ColorDot(color: Color) {
    Box(
        modifier =
            Modifier
                .size(24.dp)
                .clip(RoundedCornerShape(Radius.pill))
                .background(color),
    )
}

@Composable
private fun ShapeChip(
    label: String,
    shape: Shape,
) {
    Surface(
        shape = shape,
        color = MaterialTheme.colorScheme.surfaceVariant,
        tonalElevation = Elevation.raised,
    ) {
        Text(
            text = label,
            modifier = Modifier.padding(horizontal = Spacing.md, vertical = Spacing.sm),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Preview(name = "Light", showBackground = true)
@Composable
private fun ThemeShowcaseLightPreview() {
    TeslaSyncTheme(darkTheme = false, dynamicColor = false) {
        ThemeShowcase()
    }
}

@Preview(name = "Dark", showBackground = true)
@Composable
private fun ThemeShowcaseDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        ThemeShowcase()
    }
}

@Preview(name = "High contrast", showBackground = true)
@Composable
private fun ThemeShowcaseHighContrastPreview() {
    TeslaSyncTheme(highContrast = true, dynamicColor = false) {
        ThemeShowcase()
    }
}

@Preview(name = "Brand (dynamic color disabled)", showBackground = true)
@Composable
private fun ThemeShowcaseBrandPreview() {
    // dynamicColor defaults to false, so this always resolves the TeslaSync brand palette
    // rather than Material You — the dynamic-color-disabled variant.
    TeslaSyncTheme {
        ThemeShowcase()
    }
}
