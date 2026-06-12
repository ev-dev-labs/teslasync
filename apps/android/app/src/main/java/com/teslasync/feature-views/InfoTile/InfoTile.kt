// The native Jetpack Compose + Material 3 InfoTile feature view — a parity port of
// web/src/features/vehicles/components/telemetry-panels/InfoTile.tsx. The web component is a compact glass
// tile for one live-telemetry reading: an icon+label line (muted, `text-xs`, the icon at `h-3.5 w-3.5` and
// the label truncated), a bold `text-lg font-semibold` value tinted by the `color` prop and truncated, and an
// optional tiny `text-[10px]` muted sub line. It binds NO data hook and reads NO i18n catalog of its own for
// the label/value/sub — every string arrives pre-localized from the owning TelemetryGrid.
//
// Because the surface has zero data sources, there is no loading / error / stale / offline lifecycle to render
// here — that lives on the owning page (modelling it here would invent behaviour the spec does not have). What
// the web source genuinely varies, and what this port reproduces, is the boolean value rendered as Yes/No, the
// optional sub line, and the never-blank value box. Every derivation flows through the pure
// [InfoTileProjection]; the composable is a thin render layer.
//
// The one string the web generates itself — `value ? 'Yes' : 'No'` — resolves here through the generated i18n
// catalog (P1/S10) `common.yes` / `common.no` keys via `stringResource`, so there is no English literal in the
// shipped code; the resolved labels are handed to the pure projection.
//
// Geometry + token mapping (P1/S9 tokens, no ported Tailwind): the web glass card maps to the shared native
// `GlassPanel`; web `p-4` (16px) → `PanelPadding.Lg` (Spacing.lg = 16dp); `gap-2` (8px) → `Spacing.sm`; the
// `h-3.5 w-3.5` icon → `IconSize.Sm` (14dp); the `text-xs` muted label → `labelMedium` on `onSurfaceVariant`;
// the `text-lg font-semibold` value → `headlineSmall` (18sp SemiBold — the exact match in the generated type
// ramp) tinted by the accent; the `text-[10px]` muted sub → the `HelperText` role (the smallest muted body
// role). The sub-grid web margins (`mb-1.5` / `mt-0.5`) snap to a single `Spacing.xs` (4dp) vertical rhythm.
// The whole tile is one accessibility node announcing label + value (+ sub); the icon is decorative.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/InfoTile) cannot form a valid Kotlin package, so the package intentionally
// diverges from the path — exactly as the sibling HighlightCard / BatteryPill surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.infotile

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

private const val LABEL_MAX_LINES = 1
private const val VALUE_MAX_LINES = 1

/**
 * Stateful entry point — the faithful 1:1 port of the web `InfoTile({ icon, label, value, color, sub })`
 * props. Records the one-shot PII-safe `view.opened` diagnostic on first composition (P1/S11) and renders the
 * tile. The surface binds no data of its own; the caller supplies the already-localized [label]/[sub], the
 * [value] (a [InfoTileValue] mirroring the web `string | number | boolean` union), and the [icon] glyph.
 *
 * @param icon the leading glyph (web `icon`); decorative — tinted as the muted label text.
 * @param label the secondary label beside the icon (web `label`), already localized by the caller.
 * @param value the reading to render (web `value`); see [InfoTileValue].
 * @param color the value-text accent (web `color`, default primary); see [InfoTileColor].
 * @param sub the optional caption (web `sub`); when `null`/empty the caption row is skipped.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun InfoTile(
    icon: ImageVector,
    label: String,
    value: InfoTileValue,
    modifier: Modifier = Modifier,
    color: InfoTileColor = InfoTileColor.Primary,
    sub: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { InfoTileDiagnostics.recordViewOpened(logger) }
    InfoTileContent(icon = icon, label = label, value = value, modifier = modifier, color = color, sub = sub)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Reproduces the web layout exactly: a
 * [GlassPanel] (web `p-4 overflow-hidden`) holding the icon+label line, the bold accent-tinted value, and the
 * optional sub. The boolean Yes/No labels are resolved from the catalog here and handed to the pure
 * projection. The whole tile merges into a single accessibility node so TalkBack announces it as one phrase.
 */
@Composable
fun InfoTileContent(
    icon: ImageVector,
    label: String,
    value: InfoTileValue,
    modifier: Modifier = Modifier,
    color: InfoTileColor = InfoTileColor.Primary,
    sub: String? = null,
) {
    val yesLabel = stringResource(R.string.translation_common_yes)
    val noLabel = stringResource(R.string.translation_common_no)
    val display =
        remember(value, sub, yesLabel, noLabel) {
            InfoTileProjection.project(value, yesLabel, noLabel, sub)
        }
    val valueColor = infoTileColor(color)
    val description = remember(label, display) { InfoTileProjection.describe(label, display) }

    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .semantics(mergeDescendants = true) { contentDescription = description },
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    text = label,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = LABEL_MAX_LINES,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
            }
            Text(
                text = display.value,
                style = MaterialTheme.typography.headlineSmall,
                color = valueColor,
                maxLines = VALUE_MAX_LINES,
                overflow = TextOverflow.Ellipsis,
            )
            display.sub?.let { subText -> HelperText(subText) }
        }
    }
}

/** Maps an [InfoTileColor] accent onto a P1/S9 design-token color — the web `color` Tailwind class resolved. */
@Composable
private fun infoTileColor(color: InfoTileColor): Color =
    when (color) {
        InfoTileColor.Primary -> MaterialTheme.colorScheme.onSurface
        InfoTileColor.Success -> TeslaTokens.status.success
        InfoTileColor.Warning -> TeslaTokens.status.warning
        InfoTileColor.Danger -> TeslaTokens.status.danger
        InfoTileColor.Muted -> MaterialTheme.colorScheme.onSurfaceVariant
    }

// ── Previews (tooling-only; each @Preview exercises a render branch) ─────────────────────────────────────

@Preview(name = "Primary — string value + sub", showBackground = true)
@Composable
private fun InfoTilePrimaryPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InfoTileContent(
            icon = DataDisplayGlyphs.Battery,
            label = "Battery",
            value = InfoTileValue.Text("82%"),
            color = InfoTileColor.Primary,
            sub = "412 km range",
        )
    }
}

@Preview(name = "Success — string value + sub", showBackground = true)
@Composable
private fun InfoTileSuccessPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InfoTileContent(
            icon = DataDisplayGlyphs.BatteryCharging,
            label = "Charger",
            value = InfoTileValue.Text("11 kW"),
            color = InfoTileColor.Success,
            sub = "Full in 2h",
        )
    }
}

@Preview(name = "Warning — string value", showBackground = true)
@Composable
private fun InfoTileWarningPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InfoTileContent(
            icon = DataDisplayGlyphs.Gauge,
            label = "Speed",
            value = InfoTileValue.Text("64 km/h"),
            color = InfoTileColor.Warning,
            sub = "Driving",
        )
    }
}

@Preview(name = "Danger — boolean true → Yes", showBackground = true)
@Composable
private fun InfoTileBooleanTruePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InfoTileContent(
            icon = DataDisplayGlyphs.Shield,
            label = "Sentry",
            value = InfoTileValue.Flag(true),
            color = InfoTileColor.Danger,
        )
    }
}

@Preview(name = "Muted — boolean false → No", showBackground = true)
@Composable
private fun InfoTileBooleanFalsePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InfoTileContent(
            icon = DataDisplayGlyphs.Bolt,
            label = "Charging",
            value = InfoTileValue.Flag(false),
            color = InfoTileColor.Muted,
        )
    }
}

@Preview(name = "Primary — numeric value", showBackground = true)
@Composable
private fun InfoTileNumericPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InfoTileContent(
            icon = DataDisplayGlyphs.Snowflake,
            label = "Doors open",
            value = InfoTileValue.Numeric(2.0),
            color = InfoTileColor.Primary,
        )
    }
}

@Preview(name = "Empty — blank value folds to em-dash", showBackground = true)
@Composable
private fun InfoTileBlankPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InfoTileContent(
            icon = DataDisplayGlyphs.Info,
            label = "Odometer",
            value = InfoTileValue.Text(""),
            color = InfoTileColor.Muted,
        )
    }
}

@Preview(name = "Truncation — long label + value", showBackground = true)
@Composable
private fun InfoTileTruncationPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        InfoTileContent(
            icon = DataDisplayGlyphs.MapPin,
            label = "Destination charging location name",
            value = InfoTileValue.Text("San Francisco International Airport Supercharger"),
            color = InfoTileColor.Primary,
            sub = "Arriving 18:42",
        )
    }
}
