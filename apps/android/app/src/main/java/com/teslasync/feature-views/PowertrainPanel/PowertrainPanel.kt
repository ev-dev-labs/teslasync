// The native Jetpack Compose + Material 3 PowertrainPanel feature view — a parity port of
// web/src/features/vehicles/components/telemetry-panels/PowertrainPanel.tsx. The web component takes a
// `MotorSnapshot` prop and renders a `GlassPanel` titled "Powertrain" (cog icon) containing, when the
// snapshot is present, a shift-state badge, a centered ±300 kW power meter, Front/Rear RPM and Front/Rear
// Torque `MetricCard`s, the peak Motor temperature (red when > 80 °C), the Inverter temperature, and the
// Regen power; when the snapshot is null it renders a friendly "No motor data available" empty state. This
// native port keeps that exact composition and additionally surfaces the cache-then-network states the P3
// contract mandates (loading / empty / error / stale / offline) by binding the shared latest-motor feed
// (P1/S8) through a [PowertrainPanelViewModel]: the title always renders, a skeleton covers the first load, a
// `QueryError` covers a hard failure with no cache, a freshness chip + auto-refresh covers stale/offline, and
// an absent snapshot still renders the titled panel with the empty state (never a blank box). The view
// performs no HTTP. Temperatures are SI→display converted at this render boundary via the shared
// [UnitFormatter] (web `useUnits()`); the power/torque/rpm/regen plain numbers use the live locale + precision
// (web `fmtNumber` / `fmtInt`); every visible string resolves through the i18n catalog (P1/S10); and every
// reading/badge carries a merged TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/PowertrainPanel) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.powertrainpanel

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.ui.draw.clip
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
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
import java.util.Locale

/** The web `<FadeIn delay={0.14}>` entry stagger (50 ms), matching the sibling telemetry panels. */
private const val FADE_DELAY_MS: Int = 50

/** The centered power meter's height — the web `h-3` track (12 dp). */
private val POWER_METER_HEIGHT: Dp = 12.dp
private val POWER_METER_DIVIDER_WIDTH: Dp = 1.dp
private const val POWER_TRACK_ALPHA: Float = 0.05f
private const val POWER_DIVIDER_ALPHA: Float = 0.4f
private const val POWER_FILL_ALPHA: Float = 0.6f

/** Shift-badge wash + border alpha — the web `bg-{tone}/10 border-{tone}/30` translucency. */
private const val CHIP_WASH_ALPHA: Float = 0.12f
private const val CHIP_BORDER_ALPHA: Float = 0.3f

/** The ±300 kW meter's scale-tick labels — the web `<span>-300</span><span>0</span><span>+300</span>`. */
private const val POWER_SCALE_MIN_LABEL: String = "-300"
private const val POWER_SCALE_MID_LABEL: String = "0"
private const val POWER_SCALE_MAX_LABEL: String = "+300"

private val SKELETON_BADGE_HEIGHT: Dp = 28.dp
private val SKELETON_CARD_HEIGHT: Dp = 64.dp
private val SKELETON_BAR_HEIGHT: Dp = 16.dp
private const val SKELETON_BAR_COUNT: Int = 4

private const val HTTP_NOT_FOUND: Int = 404
private const val HTTP_UNAUTHORIZED: Int = 401
private const val HTTP_FORBIDDEN: Int = 403
private const val HTTP_SERVER_ERROR_MIN: Int = 500
private const val HTTP_SERVER_ERROR_MAX: Int = 599

/**
 * Stateful entry point — the faithful 1:1 port of the web `PowertrainPanel({ motorData })`. Binds the shared
 * latest-motor feed via [source] into a [PowertrainPanelViewModel], records the one-shot `view.opened`
 * diagnostic (P1/S11), resolves the live display-[UnitFormatter] (web `useUnits()`, P1/S8), the display locale
 * + precision (web `fmtNumber` globals), and the localized [PowertrainPanelStrings] (P1/S10), and renders. A
 * host supplies the selected [vehicleId] (the web prop's source); a `null`/non-positive id falls back to the
 * first enrolled vehicle and, when none resolves, renders the empty state.
 */
@Composable
fun PowertrainPanel(
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    source: PowertrainPanelSource = LocalDataContainer.current.vehiclesStore.asPowertrainPanelSource(),
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = POWERTRAIN_PANEL_SLUG,
) {
    val viewModel: PowertrainPanelViewModel =
        viewModel(key = instanceKey, factory = PowertrainPanelViewModel.factory(source, logger, vehicleId))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    val locale = resolveDisplayLocale(formatter.prefs.locale)
    val precision = formatter.prefs.precision ?: DEFAULT_NUMBER_DECIMALS
    val strings = rememberPowertrainPanelStrings()

    PowertrainPanelContent(
        state = state,
        formatter = formatter,
        strings = strings,
        locale = locale,
        precision = precision,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Resolves the surface's localized labels from the generated catalog (P1/S10) — the `common.*` / `telemetry.*`
 * keys the web component reads via `t(...)`.
 */
@Composable
fun rememberPowertrainPanelStrings(): PowertrainPanelStrings =
    PowertrainPanelStrings(
        title = stringResource(R.string.translation_common_powertrain),
        shiftState = stringResource(R.string.translation_telemetry_shiftState),
        unknown = stringResource(R.string.translation_common_unknown),
        power = stringResource(R.string.translation_telemetry_power),
        rpmFront = stringResource(R.string.translation_telemetry_rpmFront),
        rpmRear = stringResource(R.string.translation_telemetry_rpmRear),
        torqueFront = stringResource(R.string.translation_telemetry_torqueFront),
        torqueRear = stringResource(R.string.translation_telemetry_torqueRear),
        motorTemp = stringResource(R.string.translation_telemetry_motorTemp),
        inverterTemp = stringResource(R.string.translation_telemetry_inverterTemp),
        regen = stringResource(R.string.translation_telemetry_regen),
        noData = stringResource(R.string.translation_telemetry_noMotorData),
    )

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. The `GlassPanel`
 * + cog "Powertrain" title always render; then the skeleton body while the first load is in flight, a
 * `QueryError` with retry on a hard failure with no cache, the full motor body when a snapshot is present
 * (web `motorData` truthy), or the friendly empty state otherwise. A stale/offline cached snapshot keeps its
 * body visible with a freshness chip flagged and auto-refreshes. No surface is ever blank.
 */
@Composable
fun PowertrainPanelContent(
    state: UiState<JsonElement>,
    formatter: UnitFormatter,
    strings: PowertrainPanelStrings,
    locale: Locale,
    precision: Int,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.isError) {
        if (state.stale && !state.refreshing && !state.isError) onRefresh()
    }
    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            PowertrainHeader(title = strings.title, state = state)
            Spacer(modifier = Modifier.height(Spacing.lg))
            when {
                state.isLoading -> PowertrainLoadingBody()
                state.isError && !state.hasData ->
                    QueryError(
                        kind = queryErrorKindOf(state),
                        resourceName = strings.snapshotLabel,
                        onRetry = onRefresh,
                        modifier = Modifier.fillMaxWidth(),
                    )

                else ->
                    PowertrainPanelLoaded(
                        snapshot = state.data,
                        formatter = formatter,
                        strings = strings,
                        locale = locale,
                        precision = precision,
                    )
            }
        }
    }
}

/** The web header `<h3 className="section-title">` — cog glyph + title, with a freshness chip once a fetch has run. */
@Composable
private fun PowertrainHeader(
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
            imageVector = PowertrainCogGlyph,
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

/** The loaded branch: the full motor body (web `motorData` truthy) or the friendly empty state. */
@Composable
private fun PowertrainPanelLoaded(
    snapshot: JsonElement?,
    formatter: UnitFormatter,
    strings: PowertrainPanelStrings,
    locale: Locale,
    precision: Int,
    modifier: Modifier = Modifier,
) {
    val display =
        remember(snapshot, formatter, strings, locale, precision) {
            PowertrainPanelProjection.project(snapshot, formatter, strings, locale, precision)
        }
    if (!display.hasData) {
        EmptyState(message = strings.noData, icon = PowertrainCogGlyph, modifier = modifier.fillMaxWidth())
        return
    }
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        ShiftStateRow(display = display, strings = strings)
        PowerMeterSection(display = display, strings = strings)
        MotorSpeedCards(display = display, strings = strings)
        TorqueCards(display = display, strings = strings)
        ValueRow(label = strings.motorTemp, value = display.motorTempText, valueColor = motorTempColor(display))
        ValueRow(label = strings.inverterTemp, value = display.inverterTempText)
        ValueRow(label = strings.regen, value = display.regenText, valueColor = TeslaTokens.status.success)
    }
}

/** Web "Shift state badge" — a label and a tone-washed pill carrying a dot glyph + the shift letter. */
@Composable
private fun ShiftStateRow(
    display: PowertrainPanelDisplay,
    strings: PowertrainPanelStrings,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) {
                    contentDescription = "${strings.shiftState}, ${display.shiftStateText}"
                },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Caption(strings.shiftState)
        ShiftBadge(text = display.shiftStateText, tone = shiftAccent(display.shiftTone))
    }
}

/** A single shift-state pill — washed in its accent tone with a leading dot glyph. */
@Composable
private fun ShiftBadge(
    text: String,
    tone: Color,
    modifier: Modifier = Modifier,
) {
    Surface(
        shape = RoundedCornerShape(Radius.pill),
        color = tone.copy(alpha = CHIP_WASH_ALPHA),
        contentColor = tone,
        border = BorderStroke(POWER_METER_DIVIDER_WIDTH, tone.copy(alpha = CHIP_BORDER_ALPHA)),
        modifier = modifier,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(imageVector = PowertrainCircleDotGlyph, contentDescription = null, size = IconSize.Xs, tint = tone)
            Text(text = text, style = MaterialTheme.typography.labelSmall)
        }
    }
}

/** Web "Power" — a label/value line, the centered ±300 kW meter, and the three scale ticks. */
@Composable
private fun PowerMeterSection(
    display: PowertrainPanelDisplay,
    strings: PowertrainPanelStrings,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) {
                    contentDescription = "${strings.power}, ${display.powerText}"
                },
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Caption(strings.power)
            CodeText(display.powerText)
        }
        PowerMeter(display = display)
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Caption(POWER_SCALE_MIN_LABEL)
            Caption(POWER_SCALE_MID_LABEL)
            Caption(POWER_SCALE_MAX_LABEL)
        }
    }
}

/**
 * The centered power meter — a rounded track split into two half-cells by a center divider, with the fill
 * anchored at the center and growing toward an edge: green to the right for drive power (web `power_kw >= 0`),
 * red to the left for regenerative/negative power. The fill width is [PowertrainPanelDisplay.powerFraction] of
 * its half (web `min(|power| / 300, 1)`); no fill is drawn when the reading is absent.
 */
@Composable
private fun PowerMeter(
    display: PowertrainPanelDisplay,
    modifier: Modifier = Modifier,
) {
    val trackColor = MaterialTheme.colorScheme.onSurface.copy(alpha = POWER_TRACK_ALPHA)
    val dividerColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = POWER_DIVIDER_ALPHA)
    val fillShape = RoundedCornerShape(Radius.pill)
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .height(POWER_METER_HEIGHT)
                .clip(RoundedCornerShape(Radius.pill))
                .background(trackColor),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(modifier = Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.CenterEnd) {
            if (display.powerHasValue && !display.powerPositive) {
                Box(
                    modifier =
                        Modifier
                            .fillMaxHeight()
                            .fillMaxWidth(display.powerFraction)
                            .background(TeslaTokens.status.danger.copy(alpha = POWER_FILL_ALPHA), fillShape),
                )
            }
        }
        Box(modifier = Modifier.width(POWER_METER_DIVIDER_WIDTH).fillMaxHeight().background(dividerColor))
        Box(modifier = Modifier.weight(1f).fillMaxHeight(), contentAlignment = Alignment.CenterStart) {
            if (display.powerHasValue && display.powerPositive) {
                Box(
                    modifier =
                        Modifier
                            .fillMaxHeight()
                            .fillMaxWidth(display.powerFraction)
                            .background(TeslaTokens.status.success.copy(alpha = POWER_FILL_ALPHA), fillShape),
                )
            }
        }
    }
}

/** Web "Motor RPM" — a two-up row of [MetricCard]s (Front / Rear), each with the hard-coded `RPM` subtitle. */
@Composable
private fun MotorSpeedCards(
    display: PowertrainPanelDisplay,
    strings: PowertrainPanelStrings,
    modifier: Modifier = Modifier,
) {
    Row(modifier = modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        MetricCard(
            label = strings.rpmFront,
            value = display.rpmFrontText,
            subtitle = RPM_UNIT,
            modifier =
                Modifier
                    .weight(1f)
                    .semantics(mergeDescendants = true) {
                        contentDescription = "${strings.rpmFront}, ${display.rpmFrontText} $RPM_UNIT"
                    },
        )
        MetricCard(
            label = strings.rpmRear,
            value = display.rpmRearText,
            subtitle = RPM_UNIT,
            modifier =
                Modifier
                    .weight(1f)
                    .semantics(mergeDescendants = true) {
                        contentDescription = "${strings.rpmRear}, ${display.rpmRearText} $RPM_UNIT"
                    },
        )
    }
}

/** Web "Torque split" — a two-up row of [MetricCard]s (Front / Rear), each with the hard-coded `Nm` subtitle. */
@Composable
private fun TorqueCards(
    display: PowertrainPanelDisplay,
    strings: PowertrainPanelStrings,
    modifier: Modifier = Modifier,
) {
    Row(modifier = modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        MetricCard(
            label = strings.torqueFront,
            value = display.torqueFrontText,
            subtitle = TORQUE_UNIT,
            modifier =
                Modifier
                    .weight(1f)
                    .semantics(mergeDescendants = true) {
                        contentDescription = "${strings.torqueFront}, ${display.torqueFrontText} $TORQUE_UNIT"
                    },
        )
        MetricCard(
            label = strings.torqueRear,
            value = display.torqueRearText,
            subtitle = TORQUE_UNIT,
            modifier =
                Modifier
                    .weight(1f)
                    .semantics(mergeDescendants = true) {
                        contentDescription = "${strings.torqueRear}, ${display.torqueRearText} $TORQUE_UNIT"
                    },
        )
    }
}

/** A single label/value reading row — the web `flex items-center justify-between` line (mono value). */
@Composable
private fun ValueRow(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    valueColor: Color = MaterialTheme.colorScheme.onSurface,
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
        MonoValue(text = value, color = valueColor, modifier = Modifier.padding(start = Spacing.sm))
    }
}

/**
 * A monospace reading value tinted with a semantic [color] — the web `font-mono` value spans whose color
 * varies (the regen `text-green-400`, the over-temperature `text-red-400`). Mirrors the shared `CodeText`
 * role style but takes a color, since the role component is fixed to the primary text color.
 */
@Composable
private fun MonoValue(
    text: String,
    color: Color,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        modifier = modifier,
        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
        color = color,
    )
}

/** The first-load skeleton body — a badge block, two metric-card blocks, and a few reading-row bars. */
@Composable
private fun PowertrainLoadingBody(modifier: Modifier = Modifier) {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(height = SKELETON_BADGE_HEIGHT, rounded = true)
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Skeleton(modifier = Modifier.weight(1f), height = SKELETON_CARD_HEIGHT, rounded = true)
            Skeleton(modifier = Modifier.weight(1f), height = SKELETON_CARD_HEIGHT, rounded = true)
        }
        repeat(SKELETON_BAR_COUNT) {
            Skeleton(height = SKELETON_BAR_HEIGHT, rounded = true)
        }
    }
}

/** The accent tone the shift badge carries — the web green / red / amber / muted ladder. */
@Composable
private fun shiftAccent(tone: ShiftTone): Color =
    when (tone) {
        ShiftTone.Drive -> TeslaTokens.status.success
        ShiftTone.Reverse -> TeslaTokens.status.danger
        ShiftTone.Neutral -> TeslaTokens.status.warning
        ShiftTone.Other -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/** The motor-temperature value color — red over the hot threshold (web `> 80 ? text-red-400 : primary`). */
@Composable
private fun motorTempColor(display: PowertrainPanelDisplay): Color =
    if (display.motorTempHot) TeslaTokens.status.danger else MaterialTheme.colorScheme.onSurface

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

// ── Local glyphs — the web `Cog` + `CircleDot` (lucide). The data-display / ui layers ship neither and this
// surface's allowed files cannot extend those catalogs, so both are hand-authored here as 24×24 stroked
// vectors, mirroring the approach in ClimatePanel (Thermometer / Fan) and components/datadisplay glyphs. ──

private fun powertrainStroked(
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

private val PowertrainCogGlyph: ImageVector =
    powertrainStroked("PowertrainCog") {
        // Hub — a small ring at the gear's center.
        glyphCircle(12f, 12f, 3f)
        // Body — the toothed ring around the hub.
        glyphCircle(12f, 12f, 7.5f)
        // Eight teeth — short radial spokes at the cardinal + diagonal points.
        glyphTooth(12f, 4.5f, 12f, 2f)
        glyphTooth(12f, 19.5f, 12f, 22f)
        glyphTooth(4.5f, 12f, 2f, 12f)
        glyphTooth(19.5f, 12f, 22f, 12f)
        glyphTooth(6.7f, 6.7f, 5f, 5f)
        glyphTooth(17.3f, 6.7f, 19f, 5f)
        glyphTooth(6.7f, 17.3f, 5f, 19f)
        glyphTooth(17.3f, 17.3f, 19f, 19f)
    }

private val PowertrainCircleDotGlyph: ImageVector =
    powertrainStroked("PowertrainCircleDot") {
        glyphCircle(12f, 12f, 8f)
        glyphDot(12f, 12f)
    }

/** A near-zero-length round-capped segment renders as a filled dot at ([x], [y]). */
private fun PathBuilder.glyphDot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + 0.1f, y)
}

/** A single gear tooth — a short spoke from ([fromX], [fromY]) out to ([toX], [toY]). */
private fun PathBuilder.glyphTooth(
    fromX: Float,
    fromY: Float,
    toX: Float,
    toY: Float,
) {
    moveTo(fromX, fromY)
    lineTo(toX, toY)
}

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs. */
private fun PathBuilder.glyphCircle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f

// ── Previews — one per rendered state (content / empty / loading / error / offline). ───────────────────

private val PREVIEW_STRINGS =
    PowertrainPanelStrings(
        title = "Powertrain",
        shiftState = "Shift State",
        unknown = "Unknown",
        power = "Power",
        rpmFront = "Front RPM",
        rpmRear = "Rear RPM",
        torqueFront = "Front Torque",
        torqueRear = "Rear Torque",
        motorTemp = "Motor Temp (peak)",
        inverterTemp = "Inverter Temp",
        regen = "Regen",
        noData = "No motor data available",
    )

private fun previewMotor(): JsonElement =
    buildJsonObject {
        put("shift_state", "D")
        put("power_kw", 150.5)
        put("motor_rpm_front", 4200.0)
        put("motor_rpm_rear", 4180.0)
        put("torque_nm_front", 220.0)
        put("torque_nm_rear", 235.5)
        put("motor_temp_c_front", 64.0)
        put("motor_temp_c_rear", 58.0)
        put("inverter_temp_c", 45.0)
        put("regen_kw", 18.0)
    }

@Preview(name = "Powertrain · content", showBackground = true, widthDp = 420)
@Composable
private fun PowertrainPanelContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PowertrainPanelContent(
            state = UiState(phase = UiPhase.Content, data = previewMotor(), fetchedAt = 1L),
            formatter = UnitFormatter.default(),
            strings = PREVIEW_STRINGS,
            locale = Locale.US,
            precision = DEFAULT_NUMBER_DECIMALS,
        )
    }
}

@Preview(name = "Powertrain · empty", showBackground = true, widthDp = 420)
@Composable
private fun PowertrainPanelEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PowertrainPanelContent(
            state = UiState(phase = UiPhase.Empty, data = JsonNull, fetchedAt = 1L),
            formatter = UnitFormatter.default(),
            strings = PREVIEW_STRINGS,
            locale = Locale.US,
            precision = DEFAULT_NUMBER_DECIMALS,
        )
    }
}

@Preview(name = "Powertrain · loading", showBackground = true, widthDp = 420)
@Composable
private fun PowertrainPanelLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PowertrainPanelContent(
            state = UiState.loading(),
            formatter = UnitFormatter.default(),
            strings = PREVIEW_STRINGS,
            locale = Locale.US,
            precision = DEFAULT_NUMBER_DECIMALS,
        )
    }
}

@Preview(name = "Powertrain · error", showBackground = true, widthDp = 420)
@Composable
private fun PowertrainPanelErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PowertrainPanelContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            formatter = UnitFormatter.default(),
            strings = PREVIEW_STRINGS,
            locale = Locale.US,
            precision = DEFAULT_NUMBER_DECIMALS,
        )
    }
}

@Preview(name = "Powertrain · offline (cached)", showBackground = true, widthDp = 420)
@Composable
private fun PowertrainPanelOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PowertrainPanelContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewMotor(),
                    fetchedAt = 1L,
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            formatter = UnitFormatter.default(),
            strings = PREVIEW_STRINGS,
            locale = Locale.US,
            precision = DEFAULT_NUMBER_DECIMALS,
        )
    }
}
