// The native Jetpack Compose + Material 3 Vehicle Hero Card dashboard surface — a parity port of
// web/src/features/dashboard/widgets/VehicleHeroCardWidget.tsx. It mirrors the web `WidgetShell`
// (skeleton while the state first loads, otherwise a title + freshness header) wrapping the web body
// ternary: a vehicle hero (the footprint-aware `CompactView` battery hero or the `FullView` metric
// grid) or, when no vehicle is enrolled, a friendly empty state. The hero card never blanks to a hard
// error: like the web component (which passes `isError` to the freshness header but never the blocking
// `error` chrome) a failed state refresh keeps the card visible with last-known/fallback values plus
// a freshness error chip. All data flows through the shared [VehicleHeroCardWidgetViewModel]; SI values
// are converted to the user's unit at this render boundary via the live [UnitFormatter]. The view never
// performs HTTP. Every string resolves through the i18n catalog and the refresh control carries a
// TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/VehicleHeroCardWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.vehicleherocard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.ChipSize
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.StatusBadge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import kotlinx.coroutines.flow.StateFlow

private const val EM_DASH = "\u2014"

/** Tint opacity of the charging banner's success-colored fill (web `bg-neon-green/5`). */
private const val CHARGING_BANNER_ALPHA = 0.1f

/** Loading-skeleton sizing (the web `WidgetShell` renders a full-bleed skeleton while loading). */
private const val LOADING_TITLE_FRACTION = 0.4f
private val LOADING_TITLE_HEIGHT = 12.dp
private val LOADING_BAR_HEIGHT = 16.dp
private val LOADING_COMPACT_HEIGHT = 28.dp

/**
 * Stateful entry point. Binds the shared Vehicles feeds via [source] into a [VehicleHeroCardWidgetViewModel],
 * records the one-shot `view.opened` diagnostic, collects the live [units] formatter, and renders the
 * surface at the configured [size]. A dashboard host supplies [source] (an adapter over the shared
 * S7/S8 Vehicles data layer), an optional [vehicleId] (web `WidgetProps.vehicleId`), the grid [size]
 * (web `WidgetProps.size`), and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network Vehicles seam (`VehiclesRepository`/`VehiclesStore` adapter).
 * @param vehicleId the configured vehicle, or `null`/non-positive to use the first enrolled vehicle.
 * @param size the grid footprint that selects the compact / full / wide / tall layout.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param units the live SI→display unit formatter; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun VehicleHeroCardWidget(
    source: VehicleHeroCardSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: VehicleHeroCardSize = VehicleHeroCardRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    instanceKey: String = VehicleHeroCardRegistration.ID,
) {
    val viewModel: VehicleHeroCardWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { VehicleHeroCardWidgetViewModel(source, logger, vehicleId) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by units.collectAsStateWithLifecycle()

    VehicleHeroCardContent(
        state = state,
        prefs = formatter.prefs,
        onRefresh = viewModel::refresh,
        modifier = modifier,
        size = size,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuit (loading → skeleton) and otherwise renders the title/freshness header over
 * the hero card or the empty state. A hard error with no cache (no vehicle resolvable) shows a retry
 * surface, satisfying the prompt's required error state; a failed state refresh while a vehicle is
 * enrolled stays a stale/offline card (never a blocking error), mirroring the web. Stale (non-error)
 * data auto-refreshes, mirroring the web freshness contract. [prefs] supplies the SI→display unit
 * conversion at the render boundary; [size] selects the layout.
 */
@Composable
fun VehicleHeroCardContent(
    state: UiState<VehicleHeroCardData>,
    prefs: UnitPref,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    size: VehicleHeroCardSize = VehicleHeroCardRegistration.defaultSize,
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberVehicleHeroCardStrings()
    val compact = size.isCompact

    GlassPanel(modifier = modifier, padding = if (compact) PanelPadding.Sm else PanelPadding.Md) {
        when {
            state.isLoading -> VehicleHeroCardLoading(label = stringResource(R.string.translation_common_loading), compact = compact)
            state.isError -> VehicleHeroCardError(onRetry = onRefresh)
            else -> VehicleHeroCardLoaded(state = state, prefs = prefs, strings = strings, onRefresh = onRefresh, size = size)
        }
    }
}

@Composable
private fun VehicleHeroCardLoaded(
    state: UiState<VehicleHeroCardData>,
    prefs: UnitPref,
    strings: VehicleHeroCardStrings,
    onRefresh: () -> Unit,
    size: VehicleHeroCardSize,
) {
    val data = state.data
    val vehicle = data?.vehicle
    if (size.isCompact) {
        VehicleHeroCardCompact(vehicle = vehicle, state = data?.state, prefs = prefs, strings = strings, uiState = state)
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        VehicleHeroCardHeader(uiState = state, onRefresh = onRefresh)
        if (vehicle == null) {
            VehicleHeroCardEmpty()
        } else {
            val display = remember(data, prefs, strings) { VehicleHeroCardProjection.project(vehicle, data.state, prefs, strings) }
            FadeIn { VehicleHeroCardFull(display = display, strings = strings, size = size) }
        }
    }
}

/** Compact 1×1 hero (web `CompactView`): a dot-only freshness chip, the status badge, the count-up battery %, and the name. */
@Composable
private fun VehicleHeroCardCompact(
    vehicle: Vehicle?,
    state: VehicleState?,
    prefs: UnitPref,
    strings: VehicleHeroCardStrings,
    uiState: UiState<VehicleHeroCardData>,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            DataFreshness(
                updatedAtMillis = uiState.fetchedAt?.takeIf { it > 0 },
                isFetching = uiState.refreshing,
                isStale = uiState.stale,
                isError = uiState.hasError,
                compact = true,
            )
        }
        if (vehicle == null) {
            VehicleHeroCardEmpty()
        } else {
            val display = remember(vehicle, state, prefs, strings) { VehicleHeroCardProjection.project(vehicle, state, prefs, strings) }
            VehicleHeroCardCompactBody(display)
        }
    }
}

@Composable
private fun VehicleHeroCardCompactBody(display: VehicleHeroCardDisplay) {
    Column(
        modifier = Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = display.compactDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        StatusBadge(status = display.status, size = ChipSize.Sm)
        val level = display.batteryLevel
        if (level != null) {
            AnimatedNumber(value = level * 1.0, suffix = "%")
        } else {
            MetricValue(EM_DASH)
        }
        Caption(display.name)
    }
}

@Composable
private fun VehicleHeroCardHeader(
    uiState: UiState<*>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            CarGlyph,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Caption(stringResource(R.string.translation_widget_vehicleHeroCard))
        Spacer(modifier = Modifier.weight(1f))
        DataFreshness(
            updatedAtMillis = uiState.fetchedAt?.takeIf { it > 0 },
            isFetching = uiState.refreshing,
            isStale = uiState.stale,
            isError = uiState.hasError,
            compact = false,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !uiState.refreshing,
            size = IconSize.Sm,
        )
    }
}

/** Full 2×1+ hero (web `FullView`): name + status, model/trim subtitle, metric grid, charge banner, tall extra row. */
@Composable
private fun VehicleHeroCardFull(
    display: VehicleHeroCardDisplay,
    strings: VehicleHeroCardStrings,
    size: VehicleHeroCardSize,
) {
    Column(
        modifier = Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = display.fullDescription },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Heading(display.name, modifier = Modifier.weight(1f), level = HeadingLevel.Sub, maxLines = 1)
            StatusBadge(status = display.status, size = ChipSize.Sm)
        }
        if (display.subtitle.isNotEmpty()) {
            Caption(display.subtitle)
        }
        VehicleHeroCardMetrics(display = display, strings = strings, wide = size.isWide)
        if (display.isCharging) {
            VehicleHeroCardChargingBanner(powerText = display.chargerPowerText, chargingLabel = strings.charging)
        }
        if (size.isTall && !size.isWide) {
            VehicleHeroCardTallRow(display = display, strings = strings)
        }
    }
}

@Composable
private fun VehicleHeroCardMetrics(
    display: VehicleHeroCardDisplay,
    strings: VehicleHeroCardStrings,
    wide: Boolean,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
        MetricCell(DataDisplayGlyphs.Battery, strings.battery, display.batteryText, batteryColor(display.batteryTier))
        MetricCell(DataDisplayGlyphs.Gauge, strings.range, display.rangeText, MaterialTheme.colorScheme.onSurface)
        MetricCell(ThermometerGlyph, strings.cabin, display.cabinText, MaterialTheme.colorScheme.onSurface)
        if (wide) {
            MetricCell(ThermometerGlyph, strings.outside, display.outsideText, MaterialTheme.colorScheme.onSurface)
        }
    }
}

@Composable
private fun VehicleHeroCardTallRow(
    display: VehicleHeroCardDisplay,
    strings: VehicleHeroCardStrings,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        HorizontalDivider()
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            MetricCell(ThermometerGlyph, strings.outside, display.outsideText, MaterialTheme.colorScheme.onSurface)
            MetricCell(DataDisplayGlyphs.Gauge, strings.idealRange, display.rangeText, MaterialTheme.colorScheme.onSurface)
        }
    }
}

@Composable
private fun RowScope.MetricCell(
    icon: ImageVector,
    label: String,
    value: String,
    valueColor: Color,
) {
    Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Icon(icon, contentDescription = null, size = IconSize.Xs, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            MetricLabel(label)
        }
        Heading(value, level = HeadingLevel.Sub, color = valueColor, maxLines = 1)
    }
}

@Composable
private fun VehicleHeroCardChargingBanner(
    powerText: String?,
    chargingLabel: String,
) {
    Surface(shape = MaterialTheme.shapes.small, color = TeslaTokens.status.success.copy(alpha = CHARGING_BANNER_ALPHA)) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(DataDisplayGlyphs.Bolt, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.success)
            Heading(chargingLabel, level = HeadingLevel.Sub, color = TeslaTokens.status.success)
            if (powerText != null) {
                Spacer(modifier = Modifier.weight(1f))
                Caption(powerText)
            }
        }
    }
}

@Composable
private fun VehicleHeroCardEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_widget_noVehicle),
        icon = CarGlyph,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun VehicleHeroCardError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun VehicleHeroCardLoading(
    label: String,
    compact: Boolean,
) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (!compact) {
            Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT)
        }
        Skeleton(height = if (compact) LOADING_COMPACT_HEIGHT else LOADING_BAR_HEIGHT, rounded = true)
        if (!compact) {
            Skeleton(height = LOADING_COMPACT_HEIGHT, rounded = true)
        }
    }
}

/** The battery value's color band (web `batteryColor`): emerald / amber / red, or muted when unknown. */
@Composable
private fun batteryColor(tier: BatteryTier): Color =
    when (tier) {
        BatteryTier.High -> TeslaTokens.status.success
        BatteryTier.Mid -> TeslaTokens.status.warning
        BatteryTier.Low -> TeslaTokens.status.danger
        BatteryTier.Unknown -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/**
 * Builds the localized [VehicleHeroCardStrings] from the i18n catalog (P1/S10) — the `widget.*` metric
 * labels the web component reads via `t('widget.…')`. Remembered against the resolved strings so a
 * locale change re-projects the surface.
 */
@Composable
private fun rememberVehicleHeroCardStrings(): VehicleHeroCardStrings {
    val battery = stringResource(R.string.translation_widget_battery)
    val range = stringResource(R.string.translation_widget_range)
    val cabin = stringResource(R.string.translation_widget_cabin)
    val outside = stringResource(R.string.translation_widget_outside)
    val charging = stringResource(R.string.translation_widget_charging)
    val idealRange = stringResource(R.string.translation_widget_idealRange)
    return remember(battery, range, cabin, outside, charging, idealRange) {
        VehicleHeroCardStrings(
            battery = battery,
            range = range,
            cabin = cabin,
            outside = outside,
            charging = charging,
            idealRange = idealRange,
        )
    }
}

// ── Locally-authored glyphs ──
// The web component uses lucide-react's `Car` + `Thermometer`. Android has no bundled equivalent
// without the frozen `material-icons-extended` artifact, so — exactly as `components/datadisplay/
// DataDisplayGlyphs` does for its line icons — these two are authored here as 24×24 stroked vectors,
// monochrome and recolored at render time by `Icon`'s `tint`. Both are decorative (contentDescription
// = null); the surface's TalkBack phrase is folded onto the card body, not these icons.

private const val GLYPH_DIMENSION = 24f
private const val GLYPH_STROKE_WIDTH = 2f

private fun vehicleGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_DIMENSION.dp,
            defaultHeight = GLYPH_DIMENSION.dp,
            viewportWidth = GLYPH_DIMENSION,
            viewportHeight = GLYPH_DIMENSION,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE_WIDTH,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

private val CarGlyph: ImageVector =
    vehicleGlyph("Car") {
        moveTo(4f, 13f)
        lineTo(6.5f, 8f)
        lineTo(15f, 8f)
        lineTo(18.5f, 12f)
        moveTo(3f, 13f)
        lineTo(21f, 13f)
        lineTo(21f, 16f)
        lineTo(3f, 16f)
        close()
        moveTo(7.5f, 16f)
        lineTo(7.6f, 16f)
        moveTo(16.5f, 16f)
        lineTo(16.6f, 16f)
    }

private val ThermometerGlyph: ImageVector =
    vehicleGlyph("Thermometer") {
        moveTo(10f, 5f)
        lineTo(14f, 5f)
        moveTo(12f, 5f)
        lineTo(12f, 14f)
        moveTo(12f, 14f)
        curveTo(10.3f, 14f, 9f, 15.3f, 9f, 17f)
        curveTo(9f, 18.7f, 10.3f, 20f, 12f, 20f)
        curveTo(13.7f, 20f, 15f, 18.7f, 15f, 17f)
        curveTo(15f, 15.3f, 13.7f, 14f, 12f, 14f)
        close()
    }
