// The native Jetpack Compose + Material 3 Vehicle Gauges feature view — a parity port of
// web/src/features/vehicles/components/VehicleGauges.tsx. The web component is purely presentational: its
// parent (the vehicle detail page) loads the vehicle + its live state and passes them down with SI->display
// converters, and VehicleGauges renders a stylized car visualization beside four radial gauges
// (battery / range / speed / power), two-to-three metric bars (battery level, estimated range, and — while
// charging — charge rate), and four quick-info chips (lock, sentry, climate, firmware).
//
// This port keeps that contract end to end and adds the lifecycle chrome every native surface must render. It
// performs NO HTTP: its only web hooks are `useTranslation` (mapped to the i18n catalog) and `useUnits`
// (mapped to the live [UnitFormatter] from the shared P1/S8 data layer). The host supplies the payload as a
// [UiState] (the cache-then-network projection of the vehicle + state feeds), so this view renders every
// lifecycle state that layer can carry — loading, hard error with retry, empty (no vehicle/state), content,
// and stale/offline (cached "last known" + freshness chip + auto-refresh) — without ever fetching. A
// web-parity overload that takes the vehicle + state + the host freshness flags is also provided.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/VehicleGauges — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclegauges

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.CarVizSize
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.MetricBar
import io.teslasync.android.components.datadisplay.TeslaCarViz
import io.teslasync.android.components.datadisplay.TeslaVehicleViz
import io.teslasync.android.components.datadisplay.parseModelKey
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import java.util.Locale

/** At or above this width the car visualization sits beside the metrics (web `lg:grid-cols-[auto,1fr]`). */
private val WIDE_LAYOUT_BREAK: Dp = 560.dp

/** At or above this width the four gauges lay out in one row (web `sm:grid-cols-4`); below it, two per row. */
private val GAUGE_FOUR_COL_BREAK: Dp = 480.dp
private const val GAUGE_COLS_NARROW = 2
private const val GAUGE_COLS_WIDE = 4

/** Radial-gauge diameter; sized to fit four abreast at [GAUGE_FOUR_COL_BREAK] (web `size={110}`). */
private val GAUGE_SIZE: Dp = 96.dp

/** Loading-skeleton sizing (the surface renders skeleton chrome while the first load is in flight). */
private val LOADING_CAR_HEIGHT: Dp = 96.dp
private val LOADING_GAUGE_HEIGHT: Dp = 72.dp
private val LOADING_BAR_HEIGHT: Dp = 12.dp

/** Chip fill opacity over the panel surface (web `bg-white/[0.02]`). */
private const val CHIP_FILL_ALPHA = 0.5f

/** Em dash shown wherever a relative age is unknown (web `'\u2014'`). */
private const val GAUGES_EM_DASH = "\u2014"

/**
 * Stateful entry point. Binds `useUnits` (the live [UnitFormatter] from the shared P1/S8 data layer), records
 * the one-shot PII-safe `view.opened` diagnostic (P1/S11), and renders every lifecycle [state] the host's
 * vehicle + state feeds can carry. The host owns the feed and supplies [onRetry] (its `refetch`); this view
 * never performs HTTP.
 *
 * @param state the cache-then-network projection of the resolved vehicle + its live state.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun VehicleGauges(
    state: UiState<VehicleGaugesData>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { recordVehicleGaugesOpened(logger) }
    VehicleGaugesContent(state = state, modifier = modifier, onRetry = onRetry, formatter = formatter)
}

/**
 * Web-parity overload mirroring the web `<VehicleGauges vehicle state/>` composition: the loaded [vehicle] +
 * its (nullable) [vehicleState], plus the host freshness flags (`loading`, `isStale`, `isError`, `updatedAt`).
 * A `null` [vehicleState] is the empty (no live data) surface. Builds the [UiState] and delegates, so a host
 * that already holds the resolved vehicle can render the gauges directly.
 */
@Composable
fun VehicleGauges(
    vehicle: Vehicle,
    vehicleState: VehicleState?,
    modifier: Modifier = Modifier,
    lastFetchedAt: Long? = null,
    isFetching: Boolean = false,
    isStale: Boolean = false,
    isError: Boolean = false,
    onRetry: () -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(vehicle, vehicleState, lastFetchedAt, isFetching, isStale, isError) {
            vehicleGaugesStateOf(
                data = VehicleGaugesData(vehicle, vehicleState),
                loading = isFetching,
                isStale = isStale,
                isError = isError,
                fetchedAt = lastFetchedAt,
            )
        }
    VehicleGauges(state = state, onRetry = onRetry, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the preview/UI-test entry point. Maps the host feed's [state]
 * onto the loading / error+retry / empty / content surfaces; the content surface renders the freshness chip
 * then the car visualization beside the gauges + bars + chips, reproducing the web composition. Stale
 * (non-error) cached data auto-refreshes and shows a freshness chip, mirroring the web freshness contract.
 * [formatter] is the `useUnits` boundary; [locale] formats the numeric values; [strings] resolves the i18n.
 */
@Composable
fun VehicleGaugesContent(
    state: UiState<VehicleGaugesData>,
    modifier: Modifier = Modifier,
    onRetry: () -> Unit = {},
    formatter: UnitFormatter = UnitFormatter.default(),
    locale: Locale = Locale.getDefault(),
    strings: VehicleGaugesStrings = rememberVehicleGaugesStrings(),
    freshnessFormatter: (FreshnessAge) -> String = rememberVehicleGaugesFreshnessFormatter(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    FadeIn(modifier = modifier) {
        GlassPanel(padding = PanelPadding.Lg) {
            when (vehicleGaugesSurface(state)) {
                VehicleGaugesSurface.Loading -> VehicleGaugesLoading()
                VehicleGaugesSurface.Error -> VehicleGaugesError(state = state, onRetry = onRetry)
                VehicleGaugesSurface.Empty -> VehicleGaugesEmpty()
                VehicleGaugesSurface.Content ->
                    VehicleGaugesLoaded(
                        state = state,
                        formatter = formatter,
                        strings = strings,
                        locale = locale,
                        freshnessFormatter = freshnessFormatter,
                    )
            }
        }
    }
}

@Composable
private fun VehicleGaugesLoaded(
    state: UiState<VehicleGaugesData>,
    formatter: UnitFormatter,
    strings: VehicleGaugesStrings,
    locale: Locale,
    freshnessFormatter: (FreshnessAge) -> String,
) {
    val data = state.data
    val vehicle = data?.vehicle
    val vehicleState = data?.state
    if (vehicle == null || vehicleState == null) return
    val display =
        remember(data, formatter, strings, locale) {
            VehicleGaugesProjection.project(vehicle, vehicleState, formatter, strings, locale)
        }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        VehicleGaugesFreshness(state = state, formatAge = freshnessFormatter)
        VehicleGaugesBody(display = display)
    }
}

/** The responsive car-viz + metrics layout (web single column, switching to two columns at the `lg` width). */
@Composable
private fun VehicleGaugesBody(display: VehicleGaugesDisplay) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        if (maxWidth >= WIDE_LAYOUT_BREAK) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
                verticalAlignment = Alignment.Top,
            ) {
                VehicleGaugesCarViz(spec = display.carViz)
                VehicleGaugesMetrics(display = display, modifier = Modifier.weight(1f))
            }
        } else {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(Spacing.lg),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                VehicleGaugesCarViz(spec = display.carViz)
                VehicleGaugesMetrics(display = display, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

/** The gauges + bars + chips column, with a single spoken summary so the panel is announced as one unit. */
@Composable
private fun VehicleGaugesMetrics(
    display: VehicleGaugesDisplay,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.clearAndSetSemantics { contentDescription = display.accessibleSummary },
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        VehicleGaugesRow(gauges = display.gauges)
        VehicleGaugesBars(bars = display.bars)
        VehicleGaugesChips(chips = display.chips)
    }
}

/** The radial gauges, wrapped into responsive rows (web `grid-cols-2 sm:grid-cols-4`). */
@Composable
private fun VehicleGaugesRow(gauges: List<GaugeSpec>) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val cols = if (maxWidth < GAUGE_FOUR_COL_BREAK) GAUGE_COLS_NARROW else GAUGE_COLS_WIDE
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            gauges.chunked(cols).forEach { rowGauges ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    rowGauges.forEach { gauge ->
                        Box(modifier = Modifier.weight(1f), contentAlignment = Alignment.Center) {
                            RadialGauge(
                                value = gauge.value,
                                max = gauge.max,
                                label = gauge.label,
                                unit = gauge.unit,
                                color = gaugeAccentColor(gauge.accent),
                                size = GAUGE_SIZE,
                            )
                        }
                    }
                    repeat(cols - rowGauges.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** The metric bars (web `space-y-3`): battery level, estimated range, and the charge rate while charging. */
@Composable
private fun VehicleGaugesBars(bars: List<MetricBarSpec>) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        bars.forEach { bar ->
            MetricBar(
                value = bar.value,
                max = bar.max,
                label = bar.label,
                valueText = bar.valueText,
                color = gaugeAccentColor(bar.accent),
            )
        }
    }
}

/** The quick-info chips, wrapping as needed (web `flex flex-wrap gap-2`). */
@Composable
private fun VehicleGaugesChips(chips: List<StatusChipSpec>) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        chips.forEach { chip -> VehicleGaugeChip(chip = chip) }
    }
}

/** One quick-info chip — a rounded pill with a status-colored glyph and a muted label (web chip span). */
@Composable
private fun VehicleGaugeChip(chip: StatusChipSpec) {
    Surface(
        shape = RoundedCornerShape(Radius.pill),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = CHIP_FILL_ALPHA),
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(chipGlyph(chip.glyph), contentDescription = null, size = IconSize.Xs, tint = gaugeAccentColor(chip.accent))
            Caption(chip.label)
        }
    }
}

/** The stylized car visualization (web `<TeslaCarViz size="lg" …>`). */
@Composable
private fun VehicleGaugesCarViz(
    spec: CarVizSpec,
    modifier: Modifier = Modifier,
) {
    TeslaCarViz(
        state =
            TeslaVehicleViz(
                batteryLevelPct = spec.batteryLevelPct,
                isCharging = spec.isCharging,
                isLocked = spec.isLocked,
                isClimateOn = spec.isClimateOn,
                sentryMode = spec.sentryMode,
                speedText = spec.speedText,
            ),
        modifier = modifier,
        model = parseModelKey(spec.model),
        size = CarVizSize.Lg,
    )
}

/** The freshness chip — shown whenever the host has a stamp / is refreshing / stale / errored (last-known). */
@Composable
private fun VehicleGaugesFreshness(
    state: UiState<VehicleGaugesData>,
    formatAge: (FreshnessAge) -> String,
) {
    val show = state.fetchedAt != null || state.refreshing || state.stale || state.hasError
    if (!show) return
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = formatAge,
        )
    }
}

/** Loading chrome — a car block over a gauge-skeleton row and two bar lines (never a blank panel). */
@Composable
private fun VehicleGaugesLoading() {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(height = LOADING_CAR_HEIGHT, rounded = true)
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            repeat(GAUGE_COLS_WIDE) {
                Column(modifier = Modifier.weight(1f)) {
                    Skeleton(height = LOADING_GAUGE_HEIGHT, rounded = true)
                }
            }
        }
        Skeleton(height = LOADING_BAR_HEIGHT)
        Skeleton(height = LOADING_BAR_HEIGHT)
    }
}

/** Hard-error surface with a retry affordance (web `QueryError`), personalised with the vehicle resource name. */
@Composable
private fun VehicleGaugesError(
    state: UiState<*>,
    onRetry: () -> Unit,
) {
    QueryError(
        kind =
            classifyQueryError(
                status = state.httpStatus,
                online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
                transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
            ),
        resourceName = stringResource(R.string.translation_Vehicle),
        onRetry = onRetry,
    )
}

/** The friendly empty state when no live vehicle data is available (web parent renders nothing without it). */
@Composable
private fun VehicleGaugesEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_widget_noVehicle),
        icon = DataDisplayGlyphs.Gauge,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The arc / fill / chip color for an accent — design-token roles, never raw hex or neon (web hex palette). */
@Composable
private fun gaugeAccentColor(accent: GaugeAccent): Color =
    when (accent) {
        GaugeAccent.Info -> TeslaTokens.status.info
        GaugeAccent.Power -> TeslaTokens.chart.power
        GaugeAccent.Success -> TeslaTokens.status.success
        GaugeAccent.Danger -> TeslaTokens.status.danger
        GaugeAccent.Warning -> TeslaTokens.status.warning
        GaugeAccent.Neutral -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/** Maps a [GaugeChipGlyph] to its vector — shared data-display icons plus the locally-authored ones. */
private fun chipGlyph(glyph: GaugeChipGlyph): ImageVector =
    when (glyph) {
        GaugeChipGlyph.Lock -> DataDisplayGlyphs.Lock
        GaugeChipGlyph.Unlock -> VehicleGaugesGlyphs.Unlock
        GaugeChipGlyph.Shield -> DataDisplayGlyphs.Shield
        GaugeChipGlyph.Wind -> VehicleGaugesGlyphs.Wind
        GaugeChipGlyph.Cpu -> VehicleGaugesGlyphs.Cpu
    }

/**
 * Builds the localized [VehicleGaugesStrings] from the i18n catalog (P1/S10) — every `t('common.*')` key the
 * web component resolves, plus the firmware `unknown` fallback. Remembered against the resolved strings so a
 * locale change re-projects the surface.
 */
@Composable
private fun rememberVehicleGaugesStrings(): VehicleGaugesStrings {
    val battery = stringResource(R.string.translation_common_battery)
    val range = stringResource(R.string.translation_common_range)
    val speed = stringResource(R.string.translation_common_speed)
    val power = stringResource(R.string.translation_common_power)
    val batteryLevel = stringResource(R.string.translation_common_batteryLevel)
    val estimatedRange = stringResource(R.string.translation_common_estimatedRange)
    val chargeRate = stringResource(R.string.translation_common_chargeRate)
    val locked = stringResource(R.string.translation_common_locked)
    val unlocked = stringResource(R.string.translation_common_unlocked)
    val sentryOn = stringResource(R.string.translation_common_sentryOn)
    val sentryOff = stringResource(R.string.translation_common_sentryOff)
    val climateOn = stringResource(R.string.translation_common_climateOn)
    val climateOff = stringResource(R.string.translation_common_climateOff)
    val unknown = stringResource(R.string.translation_common_unknown)
    return remember(battery, range, speed, power, batteryLevel, estimatedRange, chargeRate, locked, unlocked) {
        VehicleGaugesStrings(
            battery = battery,
            range = range,
            speed = speed,
            power = power,
            batteryLevel = batteryLevel,
            estimatedRange = estimatedRange,
            chargeRate = chargeRate,
            locked = locked,
            unlocked = unlocked,
            sentryOn = sentryOn,
            sentryOff = sentryOff,
            climateOn = climateOn,
            climateOff = climateOff,
            unknown = unknown,
        )
    }
}

/** Localized relative-age formatter for the freshness chip (`translation_freshness_*`). */
@Composable
private fun rememberVehicleGaugesFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> GAUGES_EM_DASH
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

// ── Previews (tooling-only; one @Preview entry per rendered state) ───────────────────────────────────

private val PREVIEW_VEHICLE: Vehicle =
    Json.decodeFromString(
        Vehicle.serializer(),
        """
        {"id":1,"tesla_id":42,"vin":"5YJ3E1EA7KF000001","display_name":"My Model 3","model":"Model 3",
         "trim_level":"Long Range","timezone":"UTC","created_at":"2026-01-01T00:00:00Z",
         "enrolled_at":"2026-01-01T00:00:00Z","updated_at":"2026-06-01T00:00:00Z"}
        """.trimIndent(),
    )

@Suppress("LongParameterList")
private fun previewState(
    batteryLevel: Long = 72,
    speed: Double = 0.0,
    isCharging: Boolean = false,
    chargerPower: Double = 0.0,
    chargeRate: Double = 0.0,
    isLocked: Boolean = true,
    sentryMode: Boolean = false,
    isClimateOn: Boolean = false,
): VehicleState =
    VehicleState(
        batteryLevel = batteryLevel,
        chargeRate = chargeRate,
        chargerPower = chargerPower,
        idealRange = 380_000.0,
        insideTemp = 21.5,
        isCharging = isCharging,
        isClimateOn = isClimateOn,
        isLocked = isLocked,
        latitude = 0.0,
        longitude = 0.0,
        odometer = 42_000_000.0,
        outsideTemp = 12.0,
        power = 0.0,
        ratedRange = 350_000.0,
        sentryMode = sentryMode,
        softwareVersion = "2026.20.1",
        speed = speed,
        state = "online",
        timeToFullCharge = 0.0,
        vehicleId = 1L,
    )

private fun previewUiState(
    vehicleState: VehicleState?,
    phase: UiPhase = UiPhase.Content,
    stale: Boolean = false,
    errorKind: ErrorKind? = null,
): UiState<VehicleGaugesData> =
    UiState(
        phase = phase,
        data = VehicleGaugesData(PREVIEW_VEHICLE, vehicleState),
        fetchedAt = 1_700_000_000_000L,
        stale = stale,
        errorKind = errorKind,
    )

@Preview(name = "VehicleGauges · idle", showBackground = true)
@Composable
private fun VehicleGaugesIdlePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleGaugesContent(state = previewUiState(previewState()))
    }
}

@Preview(name = "VehicleGauges · driving", showBackground = true)
@Composable
private fun VehicleGaugesDrivingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleGaugesContent(state = previewUiState(previewState(speed = 27.0, isLocked = true, isClimateOn = true)))
    }
}

@Preview(name = "VehicleGauges · charging", showBackground = true)
@Composable
private fun VehicleGaugesChargingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleGaugesContent(
            state = previewUiState(previewState(isCharging = true, chargerPower = 48.4, chargeRate = 48_000.0)),
        )
    }
}

@Preview(name = "VehicleGauges · loading", showBackground = true)
@Composable
private fun VehicleGaugesLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleGaugesContent(state = UiState.loading())
    }
}

@Preview(name = "VehicleGauges · empty", showBackground = true)
@Composable
private fun VehicleGaugesEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleGaugesContent(state = UiState(UiPhase.Empty, data = VehicleGaugesData(PREVIEW_VEHICLE, null)))
    }
}

@Preview(name = "VehicleGauges · error", showBackground = true)
@Composable
private fun VehicleGaugesErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleGaugesContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network))
    }
}

@Preview(name = "VehicleGauges · offline (cached)", showBackground = true)
@Composable
private fun VehicleGaugesOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        VehicleGaugesContent(state = previewUiState(previewState(), stale = true, errorKind = ErrorKind.Network))
    }
}
