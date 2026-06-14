// The native Jetpack Compose + Material 3 Climate Control Panel dashboard surface — a parity port of
// web/src/features/dashboard/widgets/ClimateControlPanelWidget.tsx. It mirrors the web `WidgetShell`
// (a skeleton while the first load is in flight, otherwise a thermometer-iconed title + freshness header)
// wrapping either the compact inside-temperature hero (1×1) or the full HVAC-status / Cabin·Outside /
// Fan·Wheel-heat panel with seat-heater and Defrost / Bat-Heater status chips, or a friendly empty state
// when no climate snapshot is present. All data flows through the shared [ClimateControlPanelWidgetViewModel]
// (P1/S8); the view never performs HTTP. Temperatures are SI→display converted at this render boundary via
// the shared [UnitFormatter] (web `useUnits()`), every string resolves through the i18n catalog (P1/S10),
// and every interactive element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/ClimateControlPanelWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.climatecontrolpanel

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Stateful entry point. Binds the shared vehicles + latest-climate feeds via [source] into a
 * [ClimateControlPanelWidgetViewModel], resolves the live display-[UnitFormatter] from the app container
 * ([LocalDataContainer]; web `useUnits()`), records the one-shot `view.opened` diagnostic, and renders the
 * surface for the given [size]. A dashboard host supplies [source] (an adapter over the shared S8 vehicles
 * data layer) and a unique [instanceKey] per placement; an explicit [vehicleId] pins the surface to one
 * vehicle (web `WidgetProps.vehicleId`), otherwise the first enrolled vehicle is used.
 */
@Composable
fun ClimateControlPanelWidget(
    source: ClimateControlPanelSource,
    modifier: Modifier = Modifier,
    size: ClimateControlPanelSize = ClimateControlPanelRegistration.DEFAULT_SIZE,
    vehicleId: Long? = null,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = ClimateControlPanelRegistration.ID,
) {
    val viewModel: ClimateControlPanelWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = ClimateControlPanelWidgetViewModel.factory(source, logger, vehicleId),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()

    ClimateControlPanelWidgetContent(
        state = state,
        formatter = formatter,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuit (a first load → full skeleton) and otherwise the compact temperature hero
 * (1×1) or the full thermometer-title + freshness header over the HVAC / temperature / fan / seat-heater
 * panel, or the empty state. The web climate widget does not pass `WidgetShell`'s `error` prop, so a hard
 * failure is surfaced honestly through the header freshness chip (offline) + the refresh control (the retry
 * affordance) above the empty body — never a blanked panel — and a stale/offline cached snapshot keeps its
 * rows visible with the freshness chip flagged.
 */
@Composable
fun ClimateControlPanelWidgetContent(
    state: UiState<JsonElement>,
    formatter: UnitFormatter,
    size: ClimateControlPanelSize = ClimateControlPanelRegistration.DEFAULT_SIZE,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
) {
    val strings = rememberClimateControlPanelStrings()
    when {
        state.isLoading -> PanelLoading(modifier)
        else -> {
            val display =
                remember(state.data, strings, formatter) {
                    ClimateControlPanelProjection.project(state.data, strings, formatter)
                }
            if (size.isCompact) {
                CompactShell(state = state, display = display, strings = strings, onRefresh = onRefresh, modifier = modifier)
            } else {
                FullShell(state = state, display = display, strings = strings, onRefresh = onRefresh, modifier = modifier)
            }
        }
    }
}

@Composable
private fun FullShell(
    state: UiState<JsonElement>,
    display: ClimateControlPanelDisplay,
    strings: ClimateControlPanelStrings,
    onRefresh: () -> Unit,
    modifier: Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        PanelHeader(state = state, strings = strings, onRefresh = onRefresh)
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            if (display.hasData) {
                HvacStatusRow(display)
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    MetricCell(
                        icon = ClimateThermometerGlyph,
                        tint = TeslaTokens.status.info,
                        label = display.cabinLabel,
                        value = display.cabinTempText,
                        modifier = Modifier.weight(1f),
                    )
                    MetricCell(
                        icon = ClimateThermometerGlyph,
                        tint = MaterialTheme.colorScheme.primary,
                        label = display.outsideLabel,
                        value = display.outsideTempText,
                        modifier = Modifier.weight(1f),
                    )
                }
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                    MetricCell(
                        icon = ClimateFanGlyph,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        label = display.fanSpeedLabel,
                        value = display.fanSpeedText,
                        modifier = Modifier.weight(1f),
                    )
                    MetricCell(
                        icon = ClimateWheelGlyph,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        label = display.wheelHeatLabel,
                        value = display.wheelHeatText,
                        modifier = Modifier.weight(1f),
                    )
                }
                ClimateChipsRow(display = display, strings = strings)
            } else {
                PanelEmpty(strings = strings)
            }
        }
    }
}

@Composable
private fun CompactShell(
    state: UiState<JsonElement>,
    display: ClimateControlPanelDisplay,
    strings: ClimateControlPanelStrings,
    onRefresh: () -> Unit,
    modifier: Modifier,
) {
    Box(modifier = modifier.fillMaxSize().padding(Spacing.sm)) {
        Row(
            modifier = Modifier.align(Alignment.TopEnd),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            PanelFreshness(state, strings)
            RefreshButton(onRefresh, state.refreshing, strings)
        }
        if (display.hasData) {
            CompactHero(display = display, label = strings.cabin, modifier = Modifier.align(Alignment.Center))
        } else {
            PanelEmpty(strings = strings, modifier = Modifier.align(Alignment.Center))
        }
    }
}

@Composable
private fun PanelHeader(
    state: UiState<*>,
    strings: ClimateControlPanelStrings,
    onRefresh: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = ClimateThermometerGlyph,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.info,
        )
        PanelTitle(strings.title, modifier = Modifier.weight(1f).semantics { heading() })
        PanelFreshness(state, strings)
        RefreshButton(onRefresh, state.refreshing, strings)
    }
}

@Composable
private fun PanelFreshness(
    state: UiState<*>,
    strings: ClimateControlPanelStrings,
) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = strings.refreshingLabel,
        errorLabel = strings.offlineLabel,
        formatAge = strings.formatRelative,
    )
}

@Composable
private fun RefreshButton(
    onRefresh: () -> Unit,
    refreshing: Boolean,
    strings: ClimateControlPanelStrings,
) {
    IconButton(
        imageVector = FeedbackGlyphs.Refresh,
        contentDescription = strings.refreshLabel,
        onClick = onRefresh,
        enabled = !refreshing,
        size = IconSize.Sm,
    )
}

@Composable
private fun HvacStatusRow(display: ClimateControlPanelDisplay) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(
                imageVector = ClimatePowerGlyph,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Badge(
                text = display.hvacStatusText,
                variant = if (display.hvacOn) BadgeVariant.Success else BadgeVariant.Neutral,
            )
        }
        if (display.hvacPowerText != null) {
            Caption(display.hvacPowerText)
        }
    }
}

@Composable
private fun MetricCell(
    icon: ImageVector,
    tint: Color,
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.semantics(mergeDescendants = true) { contentDescription = "$label, $value" },
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            size = IconSize.Sm,
            tint = tint,
            modifier = Modifier.padding(top = METRIC_ICON_TOP_PADDING),
        )
        Column(modifier = Modifier.weight(1f)) {
            Caption(label)
            Text(
                text = value,
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ClimateChipsRow(
    display: ClimateControlPanelDisplay,
    strings: ClimateControlPanelStrings,
) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (display.hasSeatHeaters) {
            display.seatHeaters.forEach { seat -> SeatHeaterChipView(seat) }
        } else {
            Caption(display.noSeatHeatLabel)
        }
        display.chips.forEach { kind -> StatusChip(kind, strings) }
    }
}

@Composable
private fun SeatHeaterChipView(seat: SeatHeaterChip) {
    ToneChip(
        icon = ClimateSeatGlyph,
        tone = TeslaTokens.status.warning,
        text = "${seat.label} ${seat.levelText}",
    )
}

@Composable
private fun StatusChip(
    kind: ClimateChipKind,
    strings: ClimateControlPanelStrings,
) {
    when (kind) {
        ClimateChipKind.Defrost ->
            ToneChip(icon = DataDisplayGlyphs.Snowflake, tone = TeslaTokens.status.info, text = strings.defrost)
        ClimateChipKind.BatHeater ->
            ToneChip(icon = DataDisplayGlyphs.Bolt, tone = TeslaTokens.status.warning, text = strings.batHeater)
    }
}

@Composable
private fun ToneChip(
    icon: ImageVector,
    tone: Color,
    text: String,
) {
    Surface(
        shape = RoundedCornerShape(Radius.pill),
        color = tone.copy(alpha = CHIP_WASH_ALPHA),
        contentColor = tone,
        modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = text },
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(imageVector = icon, contentDescription = null, size = IconSize.Xs, tint = tone)
            Text(text = text, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun CompactHero(
    display: ClimateControlPanelDisplay,
    label: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.clearAndSetSemantics { contentDescription = "$label, ${display.cabinTempText}" },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = ClimateThermometerGlyph,
            contentDescription = null,
            size = IconSize.Lg,
            tint = TeslaTokens.status.info,
        )
        MetricValue(display.cabinTempText)
    }
}

@Composable
private fun PanelEmpty(
    strings: ClimateControlPanelStrings,
    modifier: Modifier = Modifier,
) {
    EmptyState(
        message = strings.noData,
        icon = ClimateThermometerGlyph,
        modifier = modifier.fillMaxWidth(),
    )
}

@Composable
private fun PanelLoading(modifier: Modifier) {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(LOADING_BAR_COUNT) {
            Skeleton(height = LOADING_BAR_HEIGHT, rounded = true)
        }
    }
}

/**
 * Builds the localized [ClimateControlPanelStrings] from the i18n catalog (P1/S10): every label the surface
 * renders, the chrome labels (refresh / refreshing / offline / loading), and the `translation_freshness_*`
 * relative-time formatter the header freshness chip folds [FreshnessAge] buckets through, so the pure
 * projection + freshness logic carry no English microcopy.
 */
@Composable
private fun rememberClimateControlPanelStrings(): ClimateControlPanelStrings {
    val title = stringResource(R.string.translation_widget_climatePanel_title)
    val noData = stringResource(R.string.translation_widget_climatePanel_noData)
    val hvacOn = stringResource(R.string.translation_widget_climatePanel_hvacOn)
    val hvacOff = stringResource(R.string.translation_widget_climatePanel_hvacOff)
    val cabin = stringResource(R.string.translation_widget_climatePanel_cabin)
    val outside = stringResource(R.string.translation_widget_climatePanel_outside)
    val fanSpeed = stringResource(R.string.translation_widget_climatePanel_fanSpeed)
    val steeringHeat = stringResource(R.string.translation_widget_climatePanel_steeringHeat)
    val off = stringResource(R.string.translation_widget_climatePanel_off)
    val seatFL = stringResource(R.string.translation_widget_climatePanel_seatFL)
    val seatFR = stringResource(R.string.translation_widget_climatePanel_seatFR)
    val seatRL = stringResource(R.string.translation_widget_climatePanel_seatRL)
    val seatRC = stringResource(R.string.translation_widget_climatePanel_seatRC)
    val seatRR = stringResource(R.string.translation_widget_climatePanel_seatRR)
    val noSeatHeat = stringResource(R.string.translation_widget_climatePanel_noSeatHeat)
    val defrost = stringResource(R.string.translation_widget_climatePanel_defrost)
    val batHeater = stringResource(R.string.translation_widget_climatePanel_batHeater)
    val refreshLabel = stringResource(R.string.translation_common_refresh)
    val refreshingLabel = stringResource(R.string.translation_common_loading)
    val offlineLabel = stringResource(R.string.translation_common_offline)
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    val formatRelative = rememberRelativeAgeFormatter()
    return remember(
        title,
        noData,
        hvacOn,
        hvacOff,
        cabin,
        outside,
        fanSpeed,
        steeringHeat,
        off,
        seatFL,
        seatFR,
        seatRL,
        seatRC,
        seatRR,
        noSeatHeat,
        defrost,
        batHeater,
        refreshLabel,
        refreshingLabel,
        offlineLabel,
        loadingLabel,
        formatRelative,
    ) {
        ClimateControlPanelStrings(
            title = title,
            noData = noData,
            hvacOn = hvacOn,
            hvacOff = hvacOff,
            cabin = cabin,
            outside = outside,
            fanSpeed = fanSpeed,
            steeringHeat = steeringHeat,
            off = off,
            seatFL = seatFL,
            seatFR = seatFR,
            seatRL = seatRL,
            seatRC = seatRC,
            seatRR = seatRR,
            noSeatHeat = noSeatHeat,
            defrost = defrost,
            batHeater = batHeater,
            refreshLabel = refreshLabel,
            refreshingLabel = refreshingLabel,
            offlineLabel = offlineLabel,
            loadingLabel = loadingLabel,
            formatRelative = formatRelative,
        )
    }
}

/**
 * Builds the localized relative-age formatter the header freshness chip folds [FreshnessAge] buckets
 * through (P1/S10 `translation_freshness_*`), so the pure freshness logic carries no English microcopy.
 */
@Composable
private fun rememberRelativeAgeFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(age.value)
                is FreshnessAge.Minutes -> minutes.format(age.value)
                is FreshnessAge.Hours -> hours.format(age.value)
                is FreshnessAge.Days -> days.format(age.value)
                is FreshnessAge.Weeks -> weeks.format(age.value)
            }
        }
    }
}

// ── Local glyphs — the web lucide icons (Thermometer, Fan, Armchair, CircleDot, Power), authored as
// 24×24 stroked vectors. The data-display layer ships only some of these glyphs and this surface's allowed
// files cannot extend that catalog, so the climate icons are hand-authored here, mirroring the approach in
// components/datadisplay/DataDisplayGlyphs and the sibling ClimateStatusWidget. ─────────────────────────

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
private const val CHIP_WASH_ALPHA = 0.12f
private const val LOADING_BAR_COUNT = 4
private val LOADING_BAR_HEIGHT = 16.dp
private val METRIC_ICON_TOP_PADDING = 2.dp

private fun climateStroked(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

private val ClimateThermometerGlyph: ImageVector =
    climateStroked("ClimateThermometer") {
        // Mercury column (stem) running down into the bulb.
        moveTo(12f, 13f)
        lineTo(12f, 5.5f)
        // Bulb — a circle at the base, approximated with two semicircular arcs.
        moveTo(9f, 16.5f)
        arcTo(3f, 3f, 0f, false, true, 15f, 16.5f)
        arcTo(3f, 3f, 0f, false, true, 9f, 16.5f)
        close()
        // Two scale ticks on the right of the stem.
        moveTo(14f, 8f)
        lineTo(15.5f, 8f)
        moveTo(14f, 11f)
        lineTo(15.5f, 11f)
    }

private val ClimateFanGlyph: ImageVector =
    climateStroked("ClimateFan") {
        // Housing — a circle approximated with two semicircular arcs centered at (12,12).
        moveTo(4f, 12f)
        arcTo(8f, 8f, 0f, false, true, 20f, 12f)
        arcTo(8f, 8f, 0f, false, true, 4f, 12f)
        close()
        // Three blades radiating from the hub.
        moveTo(12f, 12f)
        lineTo(12f, 5.5f)
        moveTo(12f, 12f)
        lineTo(17.5f, 15f)
        moveTo(12f, 12f)
        lineTo(6.5f, 15f)
    }

private val ClimateSeatGlyph: ImageVector =
    climateStroked("ClimateSeat") {
        // Backrest + arms across the top.
        moveTo(5f, 12f)
        lineTo(7f, 12f)
        lineTo(7f, 8f)
        lineTo(17f, 8f)
        lineTo(17f, 12f)
        lineTo(19f, 12f)
        // Left armrest down.
        moveTo(5f, 12f)
        lineTo(5f, 16f)
        // Right armrest down.
        moveTo(19f, 12f)
        lineTo(19f, 16f)
        // Seat cushion.
        moveTo(7.5f, 14f)
        lineTo(16.5f, 14f)
    }

private val ClimateWheelGlyph: ImageVector =
    climateStroked("ClimateWheel") {
        // Outer circle approximated with two semicircular arcs centered at (12,12).
        moveTo(4f, 12f)
        arcTo(8f, 8f, 0f, false, true, 20f, 12f)
        arcTo(8f, 8f, 0f, false, true, 4f, 12f)
        close()
        // Filled-looking center dot, approximated with two tiny arcs.
        moveTo(10.5f, 12f)
        arcTo(1.5f, 1.5f, 0f, false, true, 13.5f, 12f)
        arcTo(1.5f, 1.5f, 0f, false, true, 10.5f, 12f)
        close()
    }

private val ClimatePowerGlyph: ImageVector =
    climateStroked("ClimatePower") {
        // Vertical power line.
        moveTo(12f, 3.5f)
        lineTo(12f, 11.5f)
        // Open arc around the bottom (the power-symbol ring, broken at the top).
        moveTo(8f, 6.5f)
        arcTo(7f, 7f, 0f, true, false, 16f, 6.5f)
    }

// ── Previews — one per rendered state (content / compact / empty / loading / error / offline). ──────────

private fun previewClimate(): JsonElement =
    buildJsonObject {
        put("inside_temp", 21.0)
        put("outside_temp", 14.0)
        put("hvac_power", 2.4)
        put("hvac_ac_enabled", true)
        put("hvac_fan_speed", 4)
        put("hvac_steering_wheel_heat_level", 2)
        put("seat_heater_left", 3)
        put("seat_heater_right", 1)
        put("defrost_mode", "Front")
        put("battery_heater_on", true)
    }

@Preview(name = "ClimatePanel · content", showBackground = true)
@Composable
private fun ClimatePanelContentPreview() {
    TeslaSyncTheme {
        ClimateControlPanelWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewClimate(), fetchedAt = System.currentTimeMillis()),
            formatter = UnitFormatter.default(),
        )
    }
}

@Preview(name = "ClimatePanel · compact", showBackground = true)
@Composable
private fun ClimatePanelCompactPreview() {
    TeslaSyncTheme {
        ClimateControlPanelWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewClimate(), fetchedAt = System.currentTimeMillis()),
            formatter = UnitFormatter.default(),
            size = ClimateControlPanelSize(cols = 1, rows = 1),
        )
    }
}

@Preview(name = "ClimatePanel · empty", showBackground = true)
@Composable
private fun ClimatePanelEmptyPreview() {
    TeslaSyncTheme {
        ClimateControlPanelWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = JsonNull, fetchedAt = System.currentTimeMillis()),
            formatter = UnitFormatter.default(),
        )
    }
}

@Preview(name = "ClimatePanel · loading", showBackground = true)
@Composable
private fun ClimatePanelLoadingPreview() {
    TeslaSyncTheme {
        ClimateControlPanelWidgetContent(state = UiState.loading(), formatter = UnitFormatter.default())
    }
}

@Preview(name = "ClimatePanel · error", showBackground = true)
@Composable
private fun ClimatePanelErrorPreview() {
    TeslaSyncTheme {
        ClimateControlPanelWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            formatter = UnitFormatter.default(),
        )
    }
}

@Preview(name = "ClimatePanel · offline (cached)", showBackground = true)
@Composable
private fun ClimatePanelOfflinePreview() {
    TeslaSyncTheme {
        ClimateControlPanelWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewClimate(),
                    fetchedAt = System.currentTimeMillis(),
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            formatter = UnitFormatter.default(),
        )
    }
}
