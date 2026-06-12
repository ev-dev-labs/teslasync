// The native Jetpack Compose + Material 3 LiveTelemetry feature view — a parity port of
// web/src/features/dashboard/components/LiveTelemetry.tsx. The web component renders a "Live Telemetry"
// section divider above a responsive 1 → 2 → 3 column grid of six GlassPanels (Drivetrain, Climate,
// Security, Tire Pressure, Media, Navigation). Each panel shows a small header (icon + uppercase title) and
// then either its rows (when its data prop is present) or a four-line loading skeleton (when absent), and
// every value inside the rows degrades to the web `'—'` / "no active modes" / "no saved location" empty
// branch — so no surface is ever blank.
//
// This port keeps that contract: the grid reflows 1 → 2 → 3 columns at the web `sm` / `lg` breakpoints, each
// panel header tints its lucide-equivalent glyph with the web accent (cyan / purple / emerald), the loading
// panels render shimmering skeleton rows (never a blank box), and every label, value, badge, chip and the
// section title resolves through the generated i18n catalog (P1/S10) `telemetry.*` keys — there is no
// translatable English literal in this file (the only non-key strings are unit symbols the web also
// hard-codes — "Nm", "g", "kW", "min", "/6", the em dash — and the decorative status emojis). The one-shot
// `view.opened` diagnostic (P1/S11) is emitted on first composition. All SI→display conversion happens in
// the pure [LiveTelemetryProjection]; this composable is a thin render layer.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/LiveTelemetry) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livetelemetry

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Tailwind `sm` (640px) and `lg` (1024px) breakpoints — the web `sm:grid-cols-2 lg:grid-cols-3` reflow. */
private val GRID_SM_MIN_WIDTH: Dp = 640.dp
private val GRID_LG_MIN_WIDTH: Dp = 1024.dp
private const val GRID_COLUMNS_BASE = 1
private const val GRID_COLUMNS_SM = 2
private const val GRID_COLUMNS_LG = 3

/** The skeleton row count per loading panel (web `SkeletonRows` renders four bars). */
private const val SKELETON_ROW_COUNT = 4
private val SKELETON_ROW_HEIGHT: Dp = 20.dp
private val BAR_HEIGHT: Dp = 6.dp

/**
 * Stateful entry point — the faithful 1:1 port of the web `LiveTelemetry({ ...six data props })`. Records the
 * one-shot `view.opened` diagnostic on first composition (P1/S11), collects the live SI→display
 * [UnitFormatter] (the web `useUnits` boundary), projects the optional panel inputs onto a
 * [LiveTelemetryDisplay] via the pure [LiveTelemetryProjection], and renders.
 *
 * @param data the six optional panel inputs (web `motorData` / `climateData` / `securityData` / `tireData` /
 *   `mediaData` / `locationData`). The owning Dashboard page supplies them and owns each `/…/latest` query's
 *   loading / error / stale / offline handling, so this presentational surface renders only the per-panel
 *   rows-or-skeleton branches.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun LiveTelemetry(
    data: LiveTelemetryData,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { LiveTelemetryDiagnostics.recordViewOpened(logger) }
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    val display = remember(data, formatter) { LiveTelemetryProjection.project(data, formatter) }
    LiveTelemetryContent(display = display, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Renders the "Live Telemetry" section
 * divider and then the responsive grid of six panels; each panel renders its rows when its content is
 * present and the loading skeleton when it is `null` — never a hidden surface.
 */
@Composable
fun LiveTelemetryContent(
    display: LiveTelemetryDisplay,
    modifier: Modifier = Modifier,
) {
    FadeIn(modifier = modifier) {
        Column(modifier = Modifier.fillMaxWidth()) {
            SectionDivider(title = stringResource(R.string.translation_telemetry_title))
            Spacer(modifier = Modifier.height(Spacing.md))
            PanelGrid(display = display)
        }
    }
}

/** The web section divider: a faint rule on each side of the centered Cog + "Live Telemetry" title. */
@Composable
private fun SectionDivider(
    title: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        DividerRule(modifier = Modifier.weight(1f))
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(
                imageVector = LiveTelemetryGlyphs.Cog,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.info,
            )
            Text(
                text = title,
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        DividerRule(modifier = Modifier.weight(1f))
    }
}

@Composable
private fun DividerRule(modifier: Modifier = Modifier) {
    Box(
        modifier =
            modifier
                .height(1.dp)
                .background(MaterialTheme.colorScheme.outlineVariant),
    )
}

/**
 * The responsive 1 → 2 → 3 column grid (web `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`). Picks the column
 * count from the available width and lays the six panels out as weighted rows so every panel shares a uniform
 * width; a short final row is padded with empty weighted slots so its panels keep the same width.
 */
@Composable
private fun PanelGrid(
    display: LiveTelemetryDisplay,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns =
            when {
                maxWidth >= GRID_LG_MIN_WIDTH -> GRID_COLUMNS_LG
                maxWidth >= GRID_SM_MIN_WIDTH -> GRID_COLUMNS_SM
                else -> GRID_COLUMNS_BASE
            }
        val panels = panelRenderers(display)
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            panels.chunked(columns).forEach { rowPanels ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    rowPanels.forEach { panel ->
                        Box(modifier = Modifier.weight(1f)) { panel() }
                    }
                    repeat(columns - rowPanels.size) {
                        Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

/** The six panels in the web render order, each a composable lambda the grid lays out. */
private fun panelRenderers(display: LiveTelemetryDisplay): List<@Composable () -> Unit> =
    listOf(
        { DrivetrainPanel(display.drivetrain) },
        { ClimatePanel(display.climate) },
        { SecurityPanel(display.security) },
        { TirePressurePanel(display.tire) },
        { MediaPanel(display.media) },
        { NavigationPanel(display.navigation) },
    )

// ── Panels ──────────────────────────────────────────────────────────────────────────────────────────────

@Composable
private fun DrivetrainPanel(content: DrivetrainContent?) {
    TelemetryPanel(
        title = stringResource(R.string.translation_telemetry_drivetrain),
        icon = LiveTelemetryGlyphs.Cog,
        iconTint = TeslaTokens.chart.power,
    ) {
        if (content == null) {
            SkeletonRows()
            return@TelemetryPanel
        }
        TelemetryRow(label = stringResource(R.string.translation_telemetry_torque), value = content.torqueText)
        TelemetryRow(label = stringResource(R.string.translation_telemetry_motorTemp), value = content.motorTempText)
        GearRow(content.gearText, content.gearTone)
        TelemetryRow(label = stringResource(R.string.translation_telemetry_gforce), value = content.gforceText)
    }
}

@Composable
private fun ClimatePanel(content: ClimateContent?) {
    TelemetryPanel(
        title = stringResource(R.string.translation_telemetry_climate),
        icon = LiveTelemetryGlyphs.Thermometer,
        iconTint = TeslaTokens.status.info,
    ) {
        if (content == null) {
            SkeletonRows()
            return@TelemetryPanel
        }
        TelemetryRow(label = stringResource(R.string.translation_telemetry_cabin), value = content.cabinText)
        TelemetryRow(label = stringResource(R.string.translation_telemetry_outside), value = content.outsideText)
        TelemetryRow(label = stringResource(R.string.translation_telemetry_hvac), value = content.hvacPowerText)
        ProgressRow(
            label = stringResource(R.string.translation_telemetry_fan),
            valueLabel = content.fanLabel,
            fraction = content.fanFraction,
            gradient = listOf(TeslaTokens.status.info, TeslaTokens.chart.power),
        )
        ClimateChips(content.chips)
    }
}

@Composable
private fun SecurityPanel(content: SecurityContent?) {
    TelemetryPanel(
        title = stringResource(R.string.translation_telemetry_security),
        icon = DataDisplayGlyphs.Shield,
        iconTint = TeslaTokens.status.success,
    ) {
        if (content == null) {
            SkeletonRows()
            return@TelemetryPanel
        }
        val lockedText =
            stringResource(
                if (content.locked) R.string.translation_telemetry_locked else R.string.translation_telemetry_unlocked,
            )
        EmphasisRow(
            label = stringResource(R.string.translation_telemetry_lock),
            text = "${if (content.locked) EMOJI_LOCKED else EMOJI_UNLOCKED} $lockedText",
            tint = if (content.locked) TeslaTokens.status.success else TeslaTokens.status.danger,
        )
        val sentryText = stringResource(if (content.sentryOn) R.string.translation_telemetry_active else R.string.translation_telemetry_off)
        EmphasisRow(
            label = stringResource(R.string.translation_telemetry_sentry),
            text = "$EMOJI_SENTRY $sentryText",
            tint = if (content.sentryOn) TeslaTokens.status.info else MaterialTheme.colorScheme.onSurfaceVariant,
        )
        BadgeRow(
            label = stringResource(R.string.translation_telemetry_doors),
            text = openCountLabel(content.openDoors),
            tone = content.doorsTone,
        )
        BadgeRow(
            label = stringResource(R.string.translation_telemetry_windows),
            text = openCountLabel(content.openWindows),
            tone = content.windowsTone,
        )
    }
}

@Composable
private fun TirePressurePanel(content: TireContent?) {
    TelemetryPanel(
        title = stringResource(R.string.translation_telemetry_tirePressure),
        icon = LiveTelemetryGlyphs.CircleDot,
        iconTint = TeslaTokens.status.info,
    ) {
        if (content == null) {
            SkeletonRows()
            return@TelemetryPanel
        }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            content.cells.chunked(2).forEach { rowCells ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    rowCells.forEach { cell ->
                        TireCellView(cell = cell, unitLabel = content.unitLabel, modifier = Modifier.weight(1f))
                    }
                }
            }
            Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                TonedBadge(
                    text =
                        stringResource(
                            if (content.allNormal) {
                                R.string.translation_telemetry_allNormal
                            } else {
                                R.string.translation_telemetry_warning
                            },
                        ),
                    tone = if (content.allNormal) BadgeTone.Success else BadgeTone.Warning,
                    leadingIcon = LiveTelemetryGlyphs.ShieldCheck,
                )
            }
        }
    }
}

@Composable
private fun MediaPanel(content: MediaContent?) {
    TelemetryPanel(
        title = stringResource(R.string.translation_telemetry_media),
        icon = LiveTelemetryGlyphs.Headphones,
        iconTint = TeslaTokens.chart.power,
    ) {
        if (content == null) {
            SkeletonRows()
            return@TelemetryPanel
        }
        Text(
            text = content.title,
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = content.artist ?: stringResource(R.string.translation_telemetry_unknownArtist),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        BadgeRow(
            label = stringResource(R.string.translation_telemetry_status),
            text = content.statusText ?: EM_DASH,
            tone = content.statusTone,
        )
        ProgressRow(
            label = stringResource(R.string.translation_telemetry_volume),
            valueLabel = content.volumeText,
            fraction = content.volumeFraction,
            gradient = listOf(TeslaTokens.chart.power, TeslaTokens.status.info),
        )
    }
}

@Composable
private fun NavigationPanel(content: NavigationContent?) {
    TelemetryPanel(
        title = stringResource(R.string.translation_telemetry_navigation),
        icon = LiveTelemetryGlyphs.Navigation2,
        iconTint = TeslaTokens.status.info,
    ) {
        if (content == null) {
            SkeletonRows()
            return@TelemetryPanel
        }
        TelemetryRow(label = stringResource(R.string.translation_telemetry_destination), value = content.destinationText)
        TelemetryRow(label = stringResource(R.string.translation_telemetry_distance), value = content.distanceText)
        TelemetryRow(label = stringResource(R.string.translation_telemetry_eta), value = content.etaText)
        NavigationChips(content.locations)
    }
}

// ── Shared panel chrome ─────────────────────────────────────────────────────────────────────────────────

/** A GlassPanel with the web header (tinted glyph + uppercase title) above the panel [body]. */
@Composable
private fun TelemetryPanel(
    title: String,
    icon: ImageVector,
    iconTint: Color,
    body: @Composable () -> Unit,
) {
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(imageVector = icon, contentDescription = null, size = IconSize.Sm, tint = iconTint)
            Text(
                text = title,
                style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(modifier = Modifier.height(Spacing.sm))
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) { body() }
    }
}

/** The four shimmering bars the web `SkeletonRows` renders while a panel's data is loading. */
@Composable
private fun SkeletonRows() {
    repeat(SKELETON_ROW_COUNT) {
        Skeleton(height = SKELETON_ROW_HEIGHT)
    }
}

/** Web `TelemetryRow`: a secondary label on the left, a bold primary value filling the right (single node). */
@Composable
private fun TelemetryRow(
    label: String,
    value: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RowLabel(label)
        Text(
            text = value,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.End,
        )
    }
}

/** The drivetrain gear row: a colored badge when a gear is present, otherwise the em-dash fallback. */
@Composable
private fun GearRow(
    gearText: String?,
    tone: BadgeTone,
) {
    Row(
        modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RowLabel(stringResource(R.string.translation_telemetry_gear))
        if (gearText != null) {
            TonedBadge(text = gearText, tone = tone)
        } else {
            Text(
                text = EM_DASH,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** A row whose value is a single emphasized, tinted line (the lock + sentry rows). */
@Composable
private fun EmphasisRow(
    label: String,
    text: String,
    tint: Color,
) {
    Row(
        modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RowLabel(label)
        Text(
            text = text,
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold),
            color = tint,
        )
    }
}

/** A row whose value is a toned badge (the doors + windows + media-status rows). */
@Composable
private fun BadgeRow(
    label: String,
    text: String,
    tone: BadgeTone,
) {
    Row(
        modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RowLabel(label)
        TonedBadge(text = text, tone = tone)
    }
}

/** A label + a thin progress bar with a value caption (the fan + volume rows). */
@Composable
private fun ProgressRow(
    label: String,
    valueLabel: String,
    fraction: Float,
    gradient: List<Color>,
) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RowLabel(label)
            Text(
                text = valueLabel,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        GradientBar(fraction = fraction, gradient = gradient)
    }
}

/** A rounded track with a gradient-filled portion (web fan / volume bars). */
@Composable
private fun GradientBar(
    fraction: Float,
    gradient: List<Color>,
) {
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .height(BAR_HEIGHT)
                .clip(RoundedCornerShape(Radius.pill))
                .background(MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Box(
            modifier =
                Modifier
                    .fillMaxWidth(fraction.coerceIn(0f, 1f))
                    .height(BAR_HEIGHT)
                    .clip(RoundedCornerShape(Radius.pill))
                    .background(Brush.horizontalGradient(gradient)),
        )
    }
}

/** One tire corner cell: the corner abbreviation, the colored pressure value, and the unit label. */
@Composable
private fun TireCellView(
    cell: TireCornerCell,
    unitLabel: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .clip(RoundedCornerShape(Radius.sm))
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = TILE_BACKGROUND_ALPHA))
                .padding(Spacing.sm)
                .semantics(mergeDescendants = true) {},
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Text(
            text = cell.corner.label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = cell.valueText,
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold),
            color = tireColor(cell.color),
        )
        Text(
            text = unitLabel,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** The climate status chips (Defrost / Bat Heater), or the "No active modes" caption when none are active. */
@Composable
private fun ClimateChips(chips: List<ClimateChip>) {
    if (chips.isEmpty()) {
        Text(
            text = stringResource(R.string.translation_telemetry_noModes),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        return
    }
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
        chips.forEach { chip ->
            when (chip) {
                ClimateChip.Defrost ->
                    IconChip(
                        icon = DataDisplayGlyphs.Snowflake,
                        label = stringResource(R.string.translation_telemetry_defrost),
                        tint = TeslaTokens.chart.speed,
                    )

                ClimateChip.BatHeater ->
                    IconChip(
                        icon = DataDisplayGlyphs.Bolt,
                        label = stringResource(R.string.translation_telemetry_batHeater),
                        tint = TeslaTokens.status.warning,
                    )
            }
        }
    }
}

/** The navigation saved-location chips (Home / Work / Favorite), or the "No saved location" caption. */
@Composable
private fun NavigationChips(locations: List<NavLocation>) {
    if (locations.isEmpty()) {
        Text(
            text = stringResource(R.string.translation_telemetry_noSavedLocation),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        return
    }
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
        locations.forEach { location ->
            EmojiChip(
                emoji = location.emoji,
                label = stringResource(navLocationLabel(location)),
                tint = navLocationTint(location),
            )
        }
    }
}

// ── Small shared atoms ──────────────────────────────────────────────────────────────────────────────────

@Composable
private fun RowLabel(label: String) {
    Text(
        text = label,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/** A status badge mapped to the shared [Badge], optionally with a leading glyph (the tire "all normal" badge). */
@Composable
private fun TonedBadge(
    text: String,
    tone: BadgeTone,
    leadingIcon: ImageVector? = null,
) {
    if (leadingIcon == null) {
        Badge(text = text, variant = badgeVariant(tone))
        return
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Icon(imageVector = leadingIcon, contentDescription = null, size = IconSize.Xs, tint = toneColor(tone))
        Badge(text = text, variant = badgeVariant(tone))
    }
}

/** A small tinted pill with a leading glyph and a label (web climate chips). */
@Composable
private fun IconChip(
    icon: ImageVector,
    label: String,
    tint: Color,
) {
    Row(
        modifier =
            Modifier
                .clip(RoundedCornerShape(Radius.pill))
                .background(tint.copy(alpha = CHIP_BACKGROUND_ALPHA))
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs)
                .semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(imageVector = icon, contentDescription = null, size = IconSize.Xs, tint = tint)
        Text(text = label, style = MaterialTheme.typography.labelSmall, color = tint)
    }
}

/** A small tinted pill with a leading emoji and a label (web navigation location chips). */
@Composable
private fun EmojiChip(
    emoji: String,
    label: String,
    tint: Color,
) {
    Row(
        modifier =
            Modifier
                .clip(RoundedCornerShape(Radius.pill))
                .background(tint.copy(alpha = CHIP_BACKGROUND_ALPHA))
                .padding(horizontal = Spacing.sm, vertical = Spacing.xs)
                .semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Text(text = emoji, style = MaterialTheme.typography.labelSmall)
        Text(text = label, style = MaterialTheme.typography.labelSmall, color = tint)
    }
}

// ── Mapping helpers ─────────────────────────────────────────────────────────────────────────────────────

/** Composes the doors/windows badge text: "All Closed" at zero, otherwise "{n} Open" (web parity). */
@Composable
private fun openCountLabel(openCount: Int): String =
    if (openCount == 0) {
        stringResource(R.string.translation_telemetry_allClosed)
    } else {
        "$openCount ${stringResource(R.string.translation_telemetry_open)}"
    }

private fun badgeVariant(tone: BadgeTone): BadgeVariant =
    when (tone) {
        BadgeTone.Info -> BadgeVariant.Info
        BadgeTone.Success -> BadgeVariant.Success
        BadgeTone.Warning -> BadgeVariant.Warning
        BadgeTone.Danger -> BadgeVariant.Danger
        BadgeTone.Neutral -> BadgeVariant.Neutral
    }

@Composable
private fun toneColor(tone: BadgeTone): Color =
    when (tone) {
        BadgeTone.Info -> TeslaTokens.status.info
        BadgeTone.Success -> TeslaTokens.status.success
        BadgeTone.Warning -> TeslaTokens.status.warning
        BadgeTone.Danger -> TeslaTokens.status.danger
        BadgeTone.Neutral -> MaterialTheme.colorScheme.onSurfaceVariant
    }

@Composable
private fun tireColor(color: TireColor): Color =
    when (color) {
        TireColor.Normal -> TeslaTokens.status.success
        TireColor.Warn -> TeslaTokens.status.warning
        TireColor.Danger -> TeslaTokens.status.danger
        TireColor.Muted -> MaterialTheme.colorScheme.onSurfaceVariant
    }

private fun navLocationLabel(location: NavLocation): Int =
    when (location) {
        NavLocation.Home -> R.string.translation_telemetry_home
        NavLocation.Work -> R.string.translation_telemetry_work
        NavLocation.Favorite -> R.string.translation_telemetry_favorite
    }

@Composable
private fun navLocationTint(location: NavLocation): Color =
    when (location) {
        NavLocation.Home -> TeslaTokens.status.success
        NavLocation.Work -> TeslaTokens.chart.speed
        NavLocation.Favorite -> TeslaTokens.chart.power
    }

private const val TILE_BACKGROUND_ALPHA = 0.5f
private const val CHIP_BACKGROUND_ALPHA = 0.16f

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

private val PREVIEW_DISPLAY: LiveTelemetryDisplay by lazy {
    LiveTelemetryProjection.project(
        LiveTelemetryData(
            motor = MotorLive(diTorque = 280.0, diStatorTempC = 41.0, gear = "D", lateralAccel = 0.12, longitudinalAccel = -0.41),
            climate =
                ClimateLive(
                    insideTempC = 21.0,
                    outsideTempC = 8.0,
                    hvacPowerKw = 3.4,
                    hvacFanSpeed = 4.0,
                    defrostMode = "Front",
                    batteryHeaterOn = true,
                ),
            security =
                SecurityLive(
                    locked = true,
                    sentryMode = true,
                    doorState = "DriverFront:closed,PassengerFront:open",
                    fdWindow = "Closed",
                    rpWindow = "Open",
                ),
            tire = TirePressureLive(frontLeft = 2.8, frontRight = 2.6, rearLeft = 2.9, rearRight = 3.2),
            media =
                MediaLive(
                    nowPlayingTitle = "Starlight",
                    nowPlayingArtist = "Muse",
                    playbackStatus = "Playing",
                    audioVolume = 7.0,
                    audioVolumeMax = 11.0,
                ),
            location =
                LocationLive(
                    destinationName = "Supercharger",
                    metersToArrival = 12350.0,
                    minutesToArrival = 9.0,
                    locatedAtHome = false,
                ),
        ),
        UnitFormatter.default(),
    )
}

@Preview(name = "LiveTelemetry — data", showBackground = true, widthDp = 760)
@Composable
private fun LiveTelemetryDataPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveTelemetryContent(PREVIEW_DISPLAY)
    }
}

@Preview(name = "LiveTelemetry — wide (3-col)", showBackground = true, widthDp = 1100)
@Composable
private fun LiveTelemetryWidePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveTelemetryContent(PREVIEW_DISPLAY)
    }
}

@Preview(name = "LiveTelemetry — loading", showBackground = true, widthDp = 760)
@Composable
private fun LiveTelemetryLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveTelemetryContent(LiveTelemetryProjection.project(LiveTelemetryData(), UnitFormatter.default()))
    }
}
