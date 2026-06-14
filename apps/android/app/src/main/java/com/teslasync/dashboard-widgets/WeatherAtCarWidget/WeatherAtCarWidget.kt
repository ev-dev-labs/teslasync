// The native Jetpack Compose + Material 3 Weather at Car dashboard surface — a parity port of
// web/src/features/dashboard/widgets/WeatherAtCarWidget.tsx. It mirrors the web `WidgetShell` (a skeleton
// while the first load is in flight, otherwise a CloudSun-iconed title + freshness header) wrapping one of
// the web ternary's bodies: the weather glyph + outside-temperature reading (a compact icon-over-value
// layout at the 1×1 footprint, otherwise the icon beside the value + "Outside Temperature" label + the
// vehicle coordinates), or a friendly "No weather data" empty state. All data flows through the shared
// [WeatherAtCarWidgetViewModel] (P1/S8); the view never performs HTTP. The SI outside temperature is
// SI→display converted at this render boundary via the shared [io.teslasync.android.data.UnitFormatter]'s
// prefs (web `useUnits()`), every string resolves through the i18n catalog (P1/S10), and every interactive
// element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/WeatherAtCarWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.weatheratcar

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.DurationUnitPref
import io.teslasync.shared.core.units.EnergyUnitPref
import io.teslasync.shared.core.units.PowerUnitPref
import io.teslasync.shared.core.units.PressureUnitPref
import io.teslasync.shared.core.units.SpeedUnitPref
import io.teslasync.shared.core.units.TemperatureUnitPref
import io.teslasync.shared.core.units.UnitPref
import kotlinx.coroutines.flow.StateFlow

/**
 * Stateful entry point. Binds the shared Vehicles feeds via [source] into a [WeatherAtCarWidgetViewModel],
 * records the one-shot `view.opened` diagnostic, collects the live display [units] formatter, and renders
 * the surface. A dashboard host supplies [source] (an adapter over the shared S7/S8 Vehicles data layer),
 * an optional [vehicleId] (web `WidgetProps.vehicleId`), the placement [size] (web `WidgetProps.size`, which
 * drives the compact/full layout), and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network Vehicles seam (`VehiclesRepository`/`VehiclesStore` adapter).
 * @param vehicleId the configured vehicle, or `null`/non-positive to use the first enrolled vehicle.
 * @param size the grid footprint; a 1×1 cell renders the compact layout (web `isCompact`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param units the live SI→display unit formatter; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun WeatherAtCarWidget(
    source: WeatherAtCarSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: WeatherAtCarSize = WeatherAtCarRegistration.DEFAULT_SIZE,
    logger: Logger = LocalDataContainer.current.logger,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    instanceKey: String = WeatherAtCarRegistration.ID,
) {
    val viewModel: WeatherAtCarWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { WeatherAtCarWidgetViewModel(source, logger, vehicleId) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by units.collectAsStateWithLifecycle()

    WeatherAtCarWidgetContent(
        state = state,
        prefs = formatter.prefs,
        compact = size.isCompact,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuit (a first load → full skeleton) and otherwise the CloudSun title + freshness
 * header over the reading / empty body. The web widget does not pass `WidgetShell`'s `error` prop, so a hard
 * failure is surfaced honestly through the header freshness chip (offline) + the refresh control (the retry
 * affordance) above the empty body — never a blanked panel — and a stale/offline cached reading keeps its
 * value visible with the freshness chip flagged. Stale (non-error) data auto-refreshes, mirroring the web
 * `refetchInterval` liveness contract. [prefs] supplies the SI→display temperature conversion.
 */
@Composable
fun WeatherAtCarWidgetContent(
    state: UiState<VehicleStateEnvelope>,
    prefs: UnitPref,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    onRefresh: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    when {
        state.isLoading -> WeatherLoading(modifier)
        else -> WeatherLoaded(state = state, prefs = prefs, compact = compact, onRefresh = onRefresh, modifier = modifier)
    }
}

@Composable
private fun WeatherLoaded(
    state: UiState<VehicleStateEnvelope>,
    prefs: UnitPref,
    compact: Boolean,
    onRefresh: () -> Unit,
    modifier: Modifier,
) {
    val strings = rememberWeatherAtCarStrings()
    val display = remember(state.data, prefs, strings) { WeatherAtCarProjection.project(state.data?.state, prefs, strings) }
    Column(modifier = modifier.fillMaxSize()) {
        WeatherHeader(state = state, compact = compact, title = strings.weatherAtCar, onRefresh = onRefresh)
        Box(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
            contentAlignment = if (compact || !display.hasData) Alignment.Center else Alignment.CenterStart,
        ) {
            when {
                !display.hasData -> WeatherEmpty(strings.noWeather)
                compact -> WeatherCompactBody(display)
                else -> WeatherFullBody(display = display, label = strings.outsideTemperature)
            }
        }
    }
}

@Composable
private fun WeatherHeader(
    state: UiState<*>,
    compact: Boolean,
    title: String,
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
        if (compact) {
            Spacer(modifier = Modifier.weight(1f))
        } else {
            Icon(
                imageVector = WeatherCloudSunGlyph,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.info,
            )
            PanelTitle(title, modifier = Modifier.weight(1f).semantics { heading() })
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun WeatherFullBody(
    display: WeatherAtCarDisplay,
    label: String,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) { contentDescription = display.contentDescription },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Icon(
            imageVector = conditionGlyph(display.condition),
            contentDescription = null,
            size = IconSize.Xl,
            tint = TeslaTokens.status.info,
        )
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            MetricValue(display.temperatureText)
            MetricLabel(label)
            display.coordinatesText?.let { Caption(it) }
        }
    }
}

@Composable
private fun WeatherCompactBody(display: WeatherAtCarDisplay) {
    Column(
        modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = display.contentDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = conditionGlyph(display.condition),
            contentDescription = null,
            size = IconSize.Lg,
            tint = TeslaTokens.status.info,
        )
        MetricValue(display.temperatureText)
    }
}

@Composable
private fun WeatherEmpty(message: String) {
    EmptyState(
        message = message,
        icon = WeatherThermometerGlyph,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun WeatherLoading(modifier: Modifier) {
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

private fun conditionGlyph(condition: WeatherCondition): ImageVector =
    when (condition) {
        WeatherCondition.Freezing -> WeatherCloudSnowGlyph
        WeatherCondition.Hot -> WeatherSunGlyph
        WeatherCondition.Mild -> WeatherCloudSunGlyph
    }

/**
 * Builds the localized [WeatherAtCarStrings] from the i18n catalog (P1/S10) — the three `widget.*` keys the
 * web component reads via `t('widget.…')`. Remembered against the resolved strings so a locale change
 * re-projects the surface.
 */
@Composable
private fun rememberWeatherAtCarStrings(): WeatherAtCarStrings {
    val weatherAtCar = stringResource(R.string.translation_widget_weatherAtCar)
    val outsideTemperature = stringResource(R.string.translation_widget_outsideTemp)
    val noWeather = stringResource(R.string.translation_widget_noWeather)
    return remember(weatherAtCar, outsideTemperature, noWeather) {
        WeatherAtCarStrings(
            weatherAtCar = weatherAtCar,
            outsideTemperature = outsideTemperature,
            noWeather = noWeather,
        )
    }
}

// ── Local glyphs — the web `Sun` / `CloudSun` / `CloudSnow` / `Thermometer` (lucide), authored as 24×24
// stroked vectors. The data-display layer ships no weather glyphs and this surface's allowed files cannot
// extend that catalog, so the weather icons are hand-authored here, mirroring the approach the sibling
// ClimateStatusWidget uses for its thermometer glyph. ───────────────────────────────────────────────────

private fun weatherStroked(
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

/** A rounded cloud outline shared by the partly-cloudy and snow glyphs. */
private fun PathBuilder.cloudOutline() {
    moveTo(8f, 18f)
    lineTo(16f, 18f)
    arcTo(3f, 3f, 0f, false, false, 16.5f, 12.2f)
    arcTo(4f, 4f, 0f, false, false, 8.8f, 11.4f)
    arcTo(3f, 3f, 0f, false, false, 8f, 18f)
    close()
}

private val WeatherSunGlyph: ImageVector =
    weatherStroked("WeatherSun") {
        // Solar disc.
        moveTo(8f, 12f)
        arcTo(4f, 4f, 0f, false, true, 16f, 12f)
        arcTo(4f, 4f, 0f, false, true, 8f, 12f)
        close()
        // Eight rays around the disc.
        moveTo(12f, 2.5f)
        lineTo(12f, 4.5f)
        moveTo(12f, 19.5f)
        lineTo(12f, 21.5f)
        moveTo(2.5f, 12f)
        lineTo(4.5f, 12f)
        moveTo(19.5f, 12f)
        lineTo(21.5f, 12f)
        moveTo(5.2f, 5.2f)
        lineTo(6.6f, 6.6f)
        moveTo(17.4f, 17.4f)
        lineTo(18.8f, 18.8f)
        moveTo(18.8f, 5.2f)
        lineTo(17.4f, 6.6f)
        moveTo(6.6f, 17.4f)
        lineTo(5.2f, 18.8f)
    }

private val WeatherCloudSunGlyph: ImageVector =
    weatherStroked("WeatherCloudSun") {
        // A small sun peeking from the top-left, with three short rays.
        moveTo(6f, 9f)
        arcTo(2.4f, 2.4f, 0f, false, true, 10.8f, 9f)
        arcTo(2.4f, 2.4f, 0f, false, true, 6f, 9f)
        close()
        moveTo(8.4f, 3.4f)
        lineTo(8.4f, 4.8f)
        moveTo(3.2f, 9f)
        lineTo(4.6f, 9f)
        moveTo(4.7f, 5.3f)
        lineTo(5.7f, 6.3f)
        // Cloud in the foreground.
        cloudOutline()
    }

private val WeatherCloudSnowGlyph: ImageVector =
    weatherStroked("WeatherCloudSnow") {
        cloudOutline()
        // Three snow ticks falling beneath the cloud.
        moveTo(9.5f, 20.4f)
        lineTo(9.5f, 21.6f)
        moveTo(12f, 20.8f)
        lineTo(12f, 22f)
        moveTo(14.5f, 20.4f)
        lineTo(14.5f, 21.6f)
    }

private val WeatherThermometerGlyph: ImageVector =
    weatherStroked("WeatherThermometer") {
        // Mercury column running down into the bulb.
        moveTo(12f, 13f)
        lineTo(12f, 5.5f)
        // Bulb at the base.
        moveTo(9f, 16.5f)
        arcTo(3f, 3f, 0f, false, true, 15f, 16.5f)
        arcTo(3f, 3f, 0f, false, true, 9f, 16.5f)
        close()
        // Two scale ticks on the stem.
        moveTo(14f, 8f)
        lineTo(15.5f, 8f)
        moveTo(14f, 11f)
        lineTo(15.5f, 11f)
    }

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
private const val LOADING_BAR_COUNT = 3
private val LOADING_BAR_HEIGHT = 16.dp

// ── Previews — one per rendered state (full content / compact content / empty / loading / error / offline).

private fun previewPrefs(): UnitPref =
    UnitPref(
        distance = DistanceUnitPref.KM,
        speed = SpeedUnitPref.KMH,
        temperature = TemperatureUnitPref.CELSIUS,
        pressure = PressureUnitPref.KPA,
        energy = EnergyUnitPref.KWH,
        duration = DurationUnitPref.HOURS,
        power = PowerUnitPref.KW,
    )

private fun previewState(outsideTempC: Double): VehicleState =
    VehicleState(
        batteryLevel = 68,
        chargeRate = 0.0,
        chargerPower = 0.0,
        idealRange = 0.0,
        insideTemp = 21.0,
        isCharging = false,
        isClimateOn = false,
        isLocked = true,
        latitude = 37.42,
        longitude = -122.08,
        odometer = 0.0,
        outsideTemp = outsideTempC,
        power = 0.0,
        ratedRange = 0.0,
        sentryMode = false,
        softwareVersion = "2025.1.0",
        speed = 0.0,
        state = "online",
        timeToFullCharge = 0.0,
        vehicleId = 5,
    )

private fun previewEnvelope(state: VehicleState?): VehicleStateEnvelope = VehicleStateEnvelope(state = state, live = false)

@Preview(name = "Weather · content", showBackground = true)
@Composable
private fun WeatherContentPreview() {
    TeslaSyncTheme {
        WeatherAtCarWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewEnvelope(previewState(14.0)), fetchedAt = PREVIEW_NOW),
            prefs = previewPrefs(),
        )
    }
}

@Preview(name = "Weather · compact", showBackground = true)
@Composable
private fun WeatherCompactPreview() {
    TeslaSyncTheme {
        WeatherAtCarWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewEnvelope(previewState(-3.0)), fetchedAt = PREVIEW_NOW),
            prefs = previewPrefs(),
            compact = true,
        )
    }
}

@Preview(name = "Weather · empty", showBackground = true)
@Composable
private fun WeatherEmptyPreview() {
    TeslaSyncTheme {
        WeatherAtCarWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = previewEnvelope(null), fetchedAt = PREVIEW_NOW),
            prefs = previewPrefs(),
        )
    }
}

@Preview(name = "Weather · loading", showBackground = true)
@Composable
private fun WeatherLoadingPreview() {
    TeslaSyncTheme {
        WeatherAtCarWidgetContent(state = UiState.loading(), prefs = previewPrefs())
    }
}

@Preview(name = "Weather · error", showBackground = true)
@Composable
private fun WeatherErrorPreview() {
    TeslaSyncTheme {
        WeatherAtCarWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = previewEnvelope(null), errorKind = ErrorKind.Network),
            prefs = previewPrefs(),
        )
    }
}

@Preview(name = "Weather · offline (cached)", showBackground = true)
@Composable
private fun WeatherOfflinePreview() {
    TeslaSyncTheme {
        WeatherAtCarWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewEnvelope(previewState(28.0)),
                    fetchedAt = PREVIEW_NOW,
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            prefs = previewPrefs(),
        )
    }
}

private const val PREVIEW_NOW = 1_780_000_000_000L
