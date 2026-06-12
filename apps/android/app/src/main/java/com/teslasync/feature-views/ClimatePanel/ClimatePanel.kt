// The native Jetpack Compose + Material 3 ClimatePanel feature view — a parity port of
// web/src/features/vehicles/components/telemetry-panels/ClimatePanel.tsx. The web component takes a
// `ClimateSnapshot` prop and renders a `GlassPanel` titled "Climate" (thermometer icon) containing, when
// the snapshot is present, Cabin/Outside temperature `MetricCard`s, Driver/Passenger setpoint rows, an
// HVAC-state row, a six-segment fan-speed meter, and three status chips (Defrost / Climate / Precondition);
// when the snapshot is null it renders a friendly "No climate data available" empty state. This native
// port keeps that exact composition and additionally surfaces the cache-then-network states the P3 contract
// mandates (loading / empty / error / stale / offline) by binding the shared latest-climate feed (P1/S8)
// through a [ClimatePanelViewModel]: the title always renders, a skeleton covers the first load, a
// `QueryError` covers a hard failure with no cache, a freshness chip + auto-refresh covers stale/offline,
// and an absent snapshot still renders the titled panel with the empty state (never a blank box). The view
// performs no HTTP. Temperatures are SI→display converted at this render boundary via the shared
// [UnitFormatter] (web `useUnits()`); every visible string resolves through the i18n catalog (P1/S10); and
// every reading/chip carries a merged TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ClimatePanel) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.climatepanel

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
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

/** The web `<…>` entry stagger (50 ms), matching the sibling telemetry panels. */
private const val FADE_DELAY_MS: Int = 50

/** Graduated fan-meter segment widths — the web `w-1.5 … w-4` ladder (6 → 16 dp). */
private val FAN_BAR_WIDTHS: List<Dp> = listOf(6.dp, 8.dp, 10.dp, 12.dp, 14.dp, 16.dp)
private val FAN_BAR_HEIGHT: Dp = 12.dp
private const val FAN_BAR_FILLED_ALPHA: Float = 0.7f
private const val FAN_BAR_EMPTY_ALPHA: Float = 0.12f

/** Status-chip wash + border alpha — the web `bg-{tone}/10 border-{tone}/30` translucency. */
private const val CHIP_WASH_ALPHA: Float = 0.12f
private const val CHIP_BORDER_ALPHA: Float = 0.28f

private val SKELETON_CARD_HEIGHT: Dp = 64.dp
private val SKELETON_BAR_HEIGHT: Dp = 16.dp
private const val SKELETON_BAR_COUNT: Int = 4

private const val HTTP_NOT_FOUND: Int = 404
private const val HTTP_UNAUTHORIZED: Int = 401
private const val HTTP_FORBIDDEN: Int = 403
private const val HTTP_SERVER_ERROR_MIN: Int = 500
private const val HTTP_SERVER_ERROR_MAX: Int = 599

/**
 * Stateful entry point — the faithful 1:1 port of the web `ClimatePanel({ climateData })`. Binds the
 * shared latest-climate feed via [source] into a [ClimatePanelViewModel], records the one-shot
 * `view.opened` diagnostic (P1/S11), resolves the live display-[UnitFormatter] (web `useUnits()`, P1/S8)
 * and the localized [ClimatePanelStrings] (P1/S10), and renders. A host supplies the selected [vehicleId]
 * (the web prop's source); a `null`/non-positive id falls back to the first enrolled vehicle and, when
 * none resolves, renders the empty state.
 */
@Composable
fun ClimatePanel(
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    source: ClimatePanelSource = LocalDataContainer.current.vehiclesStore.asClimatePanelSource(),
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = CLIMATE_PANEL_SLUG,
) {
    val viewModel: ClimatePanelViewModel =
        viewModel(key = instanceKey, factory = ClimatePanelViewModel.factory(source, logger, vehicleId))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    val strings = rememberClimatePanelStrings()

    ClimatePanelContent(
        state = state,
        formatter = formatter,
        strings = strings,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Resolves the surface's localized labels from the generated catalog (P1/S10) — the `common.*` /
 * `telemetry.*` keys the web component reads via `t(...)`.
 */
@Composable
fun rememberClimatePanelStrings(): ClimatePanelStrings =
    ClimatePanelStrings(
        title = stringResource(R.string.translation_common_climate),
        cabin = stringResource(R.string.translation_common_insideTemp),
        outside = stringResource(R.string.translation_common_outsideTemp),
        driverSetpoint = stringResource(R.string.translation_telemetry_driverSetpoint),
        passengerSetpoint = stringResource(R.string.translation_telemetry_passengerSetpoint),
        hvacState = stringResource(R.string.translation_telemetry_hvacState),
        fanSpeed = stringResource(R.string.translation_telemetry_fanSpeed),
        defrost = stringResource(R.string.translation_telemetry_defrost),
        climate = stringResource(R.string.translation_telemetry_climate),
        precondition = stringResource(R.string.translation_telemetry_precondition),
        on = stringResource(R.string.translation_common_on),
        off = stringResource(R.string.translation_common_off),
        noData = stringResource(R.string.translation_telemetry_noClimateData),
    )

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. The `GlassPanel`
 * + thermometer "Climate" title always render; then the skeleton body while the first load is in flight, a
 * `QueryError` with retry on a hard failure with no cache, the full climate body when a snapshot is present
 * (web `climateData` truthy), or the friendly empty state otherwise. A stale/offline cached snapshot keeps
 * its body visible with a freshness chip flagged and auto-refreshes. No surface is ever blank.
 */
@Composable
fun ClimatePanelContent(
    state: UiState<JsonElement>,
    formatter: UnitFormatter,
    strings: ClimatePanelStrings,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.isError) {
        if (state.stale && !state.refreshing && !state.isError) onRefresh()
    }
    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            ClimateHeader(title = strings.title, state = state)
            Spacer(modifier = Modifier.height(Spacing.lg))
            when {
                state.isLoading -> ClimateLoadingBody()
                state.isError && !state.hasData ->
                    QueryError(
                        kind = queryErrorKindOf(state),
                        resourceName = strings.snapshotLabel,
                        onRetry = onRefresh,
                        modifier = Modifier.fillMaxWidth(),
                    )

                else -> ClimatePanelLoaded(snapshot = state.data, formatter = formatter, strings = strings)
            }
        }
    }
}

/** The web header `<h3 className="section-title">` — thermometer glyph + title, with a freshness chip once a fetch has run. */
@Composable
private fun ClimateHeader(
    title: String,
    state: UiState<*>,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = ClimateThermometerGlyph,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.info,
        )
        SectionTitle(title, modifier = Modifier.semantics { heading() })
        Spacer(modifier = Modifier.weight(1f))
        if ((state.fetchedAt ?: 0L) > 0L || state.refreshing || state.hasError) {
            DataFreshness(
                updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                compact = true,
                fetchingLabel = stringResource(R.string.translation_common_loading),
                errorLabel = stringResource(R.string.translation_common_offline),
                formatAge = rememberRelativeAgeFormatter(),
            )
        }
    }
}

/** The loaded branch: the full climate body (web `climateData` truthy) or the friendly empty state. */
@Composable
private fun ClimatePanelLoaded(
    snapshot: JsonElement?,
    formatter: UnitFormatter,
    strings: ClimatePanelStrings,
    modifier: Modifier = Modifier,
) {
    val display =
        remember(snapshot, formatter, strings) {
            ClimatePanelProjection.project(snapshot, formatter, strings)
        }
    if (!display.hasData) {
        EmptyState(message = strings.noData, icon = ClimateThermometerGlyph, modifier = modifier.fillMaxWidth())
        return
    }
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        TemperatureCards(display = display, strings = strings)
        SetpointRows(display = display, strings = strings)
        ReadingRow(label = strings.hvacState, value = display.hvacStateText)
        FanSpeedRow(display = display, strings = strings)
        ChipRow(chips = display.chips)
    }
}

/** Web "Cabin + Outside temps" — a two-up row of [MetricCard]s. */
@Composable
private fun TemperatureCards(
    display: ClimatePanelDisplay,
    strings: ClimatePanelStrings,
    modifier: Modifier = Modifier,
) {
    Row(modifier = modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        MetricCard(
            label = strings.cabin,
            value = display.cabinTempText,
            modifier =
                Modifier
                    .weight(1f)
                    .semantics(mergeDescendants = true) {
                        contentDescription = "${strings.cabin}, ${display.cabinTempText}"
                    },
        )
        MetricCard(
            label = strings.outside,
            value = display.outsideTempText,
            modifier =
                Modifier
                    .weight(1f)
                    .semantics(mergeDescendants = true) {
                        contentDescription = "${strings.outside}, ${display.outsideTempText}"
                    },
        )
    }
}

/** Web "Target temps" — a two-up row of label/value setpoint cells. */
@Composable
private fun SetpointRows(
    display: ClimatePanelDisplay,
    strings: ClimatePanelStrings,
    modifier: Modifier = Modifier,
) {
    Row(modifier = modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
        ReadingRow(
            label = strings.driverSetpoint,
            value = display.driverSetpointText,
            modifier = Modifier.weight(1f),
        )
        ReadingRow(
            label = strings.passengerSetpoint,
            value = display.passengerSetpointText,
            modifier = Modifier.weight(1f),
        )
    }
}

/** A single label/value reading row — the web `flex items-center justify-between` line. */
@Composable
private fun ReadingRow(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) { contentDescription = "$label, $value" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Caption(label)
        CodeText(value, modifier = Modifier.padding(start = Spacing.sm))
    }
}

/** Web "Fan Speed" — a fan-iconed label and a six-segment graduated meter + the numeric level. */
@Composable
private fun FanSpeedRow(
    display: ClimatePanelDisplay,
    strings: ClimatePanelStrings,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) {
                    contentDescription = "${strings.fanSpeed}, ${display.fanStatusText}"
                },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Icon(
                imageVector = ClimateFanGlyph,
                contentDescription = null,
                size = IconSize.Xs,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Caption(strings.fanSpeed)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            val filledColor = TeslaTokens.status.info.copy(alpha = FAN_BAR_FILLED_ALPHA)
            val emptyColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = FAN_BAR_EMPTY_ALPHA)
            for (level in 1..FAN_SPEED_BARS) {
                Spacer(
                    modifier =
                        Modifier
                            .width(FAN_BAR_WIDTHS[level - 1])
                            .height(FAN_BAR_HEIGHT)
                            .background(
                                color = if (display.fanBarFilled(level)) filledColor else emptyColor,
                                shape = RoundedCornerShape(Radius.sm),
                            ),
                )
            }
            CodeText(display.fanStatusText, modifier = Modifier.padding(start = Spacing.xs))
        }
    }
}

/** Web "System badges" — the three status chips in source order (Defrost, Climate, Precondition). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChipRow(
    chips: List<ClimateChipState>,
    modifier: Modifier = Modifier,
) {
    FlowRow(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        chips.forEach { chip -> ClimateChipView(chip) }
    }
}

/** A single status chip — a pill that is washed in its accent tone when active, muted otherwise. */
@Composable
private fun ClimateChipView(chip: ClimateChipState) {
    val tone = if (chip.active) chipAccent(chip.chip) else MaterialTheme.colorScheme.onSurfaceVariant
    val icon = chipIcon(chip.chip)
    Surface(
        shape = RoundedCornerShape(Radius.pill),
        color = tone.copy(alpha = CHIP_WASH_ALPHA),
        contentColor = tone,
        border = BorderStroke(1.dp, tone.copy(alpha = CHIP_BORDER_ALPHA)),
        modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = chip.label },
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            if (icon != null) Icon(imageVector = icon, contentDescription = null, size = IconSize.Xs, tint = tone)
            Text(text = chip.label, style = MaterialTheme.typography.labelSmall)
        }
    }
}

/** The first-load skeleton body — two temperature-card blocks plus a few reading-row bars. */
@Composable
private fun ClimateLoadingBody(modifier: Modifier = Modifier) {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Skeleton(modifier = Modifier.weight(1f), height = SKELETON_CARD_HEIGHT, rounded = true)
            Skeleton(modifier = Modifier.weight(1f), height = SKELETON_CARD_HEIGHT, rounded = true)
        }
        repeat(SKELETON_BAR_COUNT) {
            Skeleton(height = SKELETON_BAR_HEIGHT, rounded = true)
        }
    }
}

/** The accent tone each chip carries when active — the web blue / green / amber chip colors. */
@Composable
private fun chipAccent(chip: ClimateChip): Color =
    when (chip) {
        ClimateChip.Defrost -> TeslaTokens.status.info
        ClimateChip.Climate -> TeslaTokens.status.success
        ClimateChip.Precondition -> TeslaTokens.status.warning
    }

/** The leading glyph each chip carries — the web `Snowflake` / `Zap` icons; Precondition has none. */
private fun chipIcon(chip: ClimateChip): ImageVector? =
    when (chip) {
        ClimateChip.Defrost -> DataDisplayGlyphs.Snowflake
        ClimateChip.Climate -> DataDisplayGlyphs.Bolt
        ClimateChip.Precondition -> null
    }

/** Classify a [UiState] failure into the recovery copy the `QueryError` branch shows. */
private fun queryErrorKindOf(state: UiState<*>): QueryErrorKind =
    when (state.errorKind) {
        ErrorKind.Http ->
            when (state.httpStatus) {
                HTTP_NOT_FOUND -> QueryErrorKind.NotFound
                HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                in HTTP_SERVER_ERROR_MIN..HTTP_SERVER_ERROR_MAX -> QueryErrorKind.ServerError
                else -> QueryErrorKind.Network
            }
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Decode -> QueryErrorKind.ServerError
        else -> QueryErrorKind.Network
    }

/**
 * Builds the localized relative-age formatter the freshness chip folds [FreshnessAge] buckets through
 * (P1/S10 `translation_freshness_*`), so the pure freshness logic carries no English microcopy.
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

// ── Local glyphs — the web `Thermometer` + `Fan` (lucide). The data-display layer ships neither and this
// surface's allowed files cannot extend that catalog, so both are hand-authored here as 24×24 stroked
// vectors, mirroring the approach in ClimateStatusWidget / components/datadisplay/DataDisplayGlyphs. ──

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
        // Central hub.
        moveTo(12.1f, 12f)
        lineTo(12f, 12f)
        // Four curved blades radiating from the hub (top-left, top-right, bottom-right, bottom-left).
        moveTo(12f, 12f)
        curveTo(12f, 8f, 9f, 5f, 6f, 6f)
        curveTo(8f, 9f, 12f, 8f, 12f, 12f)
        moveTo(12f, 12f)
        curveTo(16f, 12f, 19f, 9f, 18f, 6f)
        curveTo(15f, 8f, 16f, 12f, 12f, 12f)
        moveTo(12f, 12f)
        curveTo(12f, 16f, 15f, 19f, 18f, 18f)
        curveTo(16f, 15f, 12f, 16f, 12f, 12f)
        moveTo(12f, 12f)
        curveTo(8f, 12f, 5f, 15f, 6f, 18f)
        curveTo(9f, 16f, 8f, 12f, 12f, 12f)
    }

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f

// ── Previews — one per rendered state (content / empty / loading / error / offline). ───────────────────

private val PREVIEW_STRINGS =
    ClimatePanelStrings(
        title = "Climate",
        cabin = "Cabin",
        outside = "Outside",
        driverSetpoint = "Driver Setpoint",
        passengerSetpoint = "Passenger Setpoint",
        hvacState = "HVAC State",
        fanSpeed = "Fan Speed",
        defrost = "Defrost",
        climate = "Climate",
        precondition = "Precondition",
        on = "On",
        off = "Off",
        noData = "No climate data available",
    )

private fun previewClimate(): JsonElement =
    buildJsonObject {
        put("inside_temp_c", 21.5)
        put("outside_temp_c", 12.0)
        put("driver_setpoint_c", 21.0)
        put("passenger_setpoint_c", 22.0)
        put("hvac_state", "On")
        put("defrost_mode", "Front")
        put("is_climate_on", true)
        put("is_preconditioning", false)
        put("fan_status", 4)
    }

@Preview(name = "Climate · content", showBackground = true, widthDp = 420)
@Composable
private fun ClimatePanelContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ClimatePanelContent(
            state = UiState(phase = UiPhase.Content, data = previewClimate(), fetchedAt = 1L),
            formatter = UnitFormatter.default(),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Climate · empty", showBackground = true, widthDp = 420)
@Composable
private fun ClimatePanelEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ClimatePanelContent(
            state = UiState(phase = UiPhase.Empty, data = JsonNull, fetchedAt = 1L),
            formatter = UnitFormatter.default(),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Climate · loading", showBackground = true, widthDp = 420)
@Composable
private fun ClimatePanelLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ClimatePanelContent(
            state = UiState.loading(),
            formatter = UnitFormatter.default(),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Climate · error", showBackground = true, widthDp = 420)
@Composable
private fun ClimatePanelErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ClimatePanelContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            formatter = UnitFormatter.default(),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Climate · offline (cached)", showBackground = true, widthDp = 420)
@Composable
private fun ClimatePanelOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ClimatePanelContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewClimate(),
                    fetchedAt = 1L,
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            formatter = UnitFormatter.default(),
            strings = PREVIEW_STRINGS,
        )
    }
}
