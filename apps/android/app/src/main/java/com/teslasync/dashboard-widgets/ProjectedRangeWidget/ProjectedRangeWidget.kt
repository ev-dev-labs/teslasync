// The native Jetpack Compose + Material 3 Projected Range dashboard surface — a parity port of
// web/src/features/dashboard/widgets/ProjectedRangeWidget.tsx. It mirrors the web `WidgetShell` (a skeleton
// while loading, a `QueryError` retry surface on hard failure, otherwise — for the standard/wide footprint
// — a Navigation title + freshness header) wrapping one of the three bodies the web renders: the compact
// hero (1×N — a big projected-distance number + a confidence badge), the standard layout (the range hero +
// a projected-vs-EPA comparison bar), or — when wide — the standard layout plus a range-factors list
// (degradation / avg daily / capacity / cycles). A friendly empty state shows when no payload exists. All
// data flows through the shared [ProjectedRangeWidgetViewModel]; SI kilometres are converted to the user's
// distance unit at this render boundary via the live [UnitFormatter]. The view never performs HTTP. Every
// string resolves through the i18n catalog and every interactive element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/ProjectedRangeWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.projectedrange

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.MotionDurations
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import java.util.Locale

private const val HERO_DECIMALS = 0
private val BAR_HEIGHT = 8.dp
private val FACTOR_ROW_MIN_HEIGHT = 44.dp
private val LOADING_TITLE_HEIGHT = 14.dp
private val LOADING_HERO_HEIGHT = 30.dp
private val LOADING_BAR_HEIGHT = 8.dp
private const val LOADING_TITLE_FRACTION = 0.4f
private const val LOADING_HERO_FRACTION = 0.6f
private const val LOADING_BAR_FRACTION = 1f

/**
 * Stateful entry point. Binds the shared feeds via [source] into a [ProjectedRangeWidgetViewModel], records
 * the one-shot `view.opened` diagnostic, and renders the surface for the given [size]. A dashboard host
 * supplies [source] (an adapter over the shared S7/S8 data layer), an optional [vehicleId] (web
 * `WidgetProps.vehicleId`), and a unique [instanceKey] per placement. [units] defaults to the app's
 * `LocalDataContainer` live formatter (web `useUnits`).
 *
 * @param source the cache-then-network seam (vehicles + projected-range adapter).
 * @param vehicleId the configured vehicle, or `null`/non-positive to use the first enrolled vehicle.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ProjectedRangeWidget(
    source: ProjectedRangeSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: ProjectedRangeSize = ProjectedRangeRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = ProjectedRangeRegistration.ID,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
) {
    val viewModel: ProjectedRangeWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { ProjectedRangeWidgetViewModel(source, logger, vehicleId) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by units.collectAsStateWithLifecycle()

    ProjectedRangeWidgetContent(
        state = state,
        prefs = formatter.prefs,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the compact /
 * standard / wide body, with a freshness chip that reflects refreshing/stale/offline. Stale (non-error)
 * data auto-refreshes, mirroring the web freshness contract. [prefs] supplies the SI-kilometre →
 * display-unit distance conversion; [locale] drives number grouping (tests pin a deterministic locale).
 */
@Composable
fun ProjectedRangeWidgetContent(
    state: UiState<JsonElement>,
    prefs: UnitPref,
    size: ProjectedRangeSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberProjectedRangeStrings()

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading ->
                ProjectedRangeLoading(size = size, label = stringResource(R.string.translation_a11y_loading))

            state.isError ->
                QueryError(kind = state.toQueryErrorKind(), resourceName = strings.title, onRetry = onRefresh)

            else -> {
                val display =
                    remember(state.data, size, prefs, strings, locale) {
                        ProjectedRangeProjection.project(parseProjectedRange(state.data), size, strings, prefs, locale)
                    }
                if (size.isCompact) {
                    ProjectedRangeCompact(state = state, display = display, locale = locale)
                } else {
                    ProjectedRangeStandard(state = state, display = display, onRefresh = onRefresh, locale = locale)
                }
            }
        }
    }
}

@Composable
private fun ProjectedRangeCompact(
    state: UiState<JsonElement>,
    display: ProjectedRangeDisplay,
    locale: Locale,
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
        )
    }
    if (display.hasData) {
        ProjectedRangeHero(
            display = display,
            badgeText = display.badge?.compactText,
            showProjectedLabel = true,
            locale = locale,
            modifier = Modifier.clearAndSetSemantics { contentDescription = display.compactContentDescription },
        )
    } else {
        ProjectedRangeEmpty(message = display.emptyMessage)
    }
}

@Composable
private fun ProjectedRangeStandard(
    state: UiState<JsonElement>,
    display: ProjectedRangeDisplay,
    onRefresh: () -> Unit,
    locale: Locale,
) {
    ProjectedRangeHeader(title = display.title, state = state, onRefresh = onRefresh)
    if (display.hasData) {
        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            ProjectedRangeHero(
                display = display,
                badgeText = display.badge?.standardText,
                showProjectedLabel = false,
                locale = locale,
            )
            ProjectedRangeComparisonBar(display = display)
            if (display.isWide) {
                ProjectedRangeFactors(display = display)
            }
        }
    } else {
        ProjectedRangeEmpty(message = display.emptyMessage)
    }
}

@Composable
private fun ProjectedRangeHero(
    display: ProjectedRangeDisplay,
    badgeText: String?,
    showProjectedLabel: Boolean,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    val reduceMotion = rememberReducedMotion()
    Column(
        modifier = modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Row(
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            val value = display.projectedRangeValue
            if (value != null && !reduceMotion) {
                AnimatedNumber(value = value, decimals = HERO_DECIMALS, locale = locale)
            } else {
                MetricValue(display.projectedRangeText)
            }
            Caption(display.distanceUnitLabel)
        }
        if (showProjectedLabel) {
            MetricLabel(display.projectedLabel)
        }
        val badge = display.badge
        if (badge != null && badgeText != null) {
            Badge(text = badgeText, variant = badge.band.toBadgeVariant())
        }
    }
}

@Composable
private fun ProjectedRangeComparisonBar(display: ProjectedRangeDisplay) {
    val fraction by animateFloatAsState(
        targetValue = display.comparisonFraction.coerceIn(0f, 1f),
        animationSpec = tween(MotionDurations.slow),
        label = "projected-range-comparison",
    )
    val trackColor = MaterialTheme.colorScheme.surfaceVariant
    val barColor = comparisonColor(display.comparisonBand)
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Caption(display.projectedLabel)
            Caption("${display.epaLabel}: ${display.epaText}")
        }
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .height(BAR_HEIGHT)
                    .clip(RoundedCornerShape(Radius.pill))
                    .background(trackColor),
        ) {
            Box(
                modifier =
                    Modifier
                        .fillMaxWidth(fraction)
                        .fillMaxHeight()
                        .clip(RoundedCornerShape(Radius.pill))
                        .background(barColor),
            )
        }
        val ofEpa = display.ofEpaText
        if (ofEpa != null) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                Caption(ofEpa)
            }
        }
    }
}

@Composable
private fun ProjectedRangeFactors(display: ProjectedRangeDisplay) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(display.factorsLabel)
        display.factors.forEach { factor -> ProjectedRangeFactorRow(factor = factor) }
    }
}

@Composable
private fun ProjectedRangeFactorRow(factor: ProjectedRangeFactor) {
    Row(
        modifier = Modifier.fillMaxWidth().heightIn(min = FACTOR_ROW_MIN_HEIGHT),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Row(
            modifier = Modifier.weight(1f),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(
                imageVector = factor.icon.glyph(),
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Caption(factor.label, modifier = Modifier.weight(1f))
        }
        Subhead(factor.value)
    }
}

@Composable
private fun ProjectedRangeHeader(
    title: String,
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = ProjectedRangeGlyphs.Navigation,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.chart.battery,
        )
        PanelTitle(title, modifier = Modifier.weight(1f).semantics { heading() })
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
        )
        IconButton(
            imageVector = ProjectedRangeGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun ProjectedRangeEmpty(message: String) {
    EmptyState(
        message = message,
        icon = ProjectedRangeGlyphs.Navigation,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun ProjectedRangeLoading(
    size: ProjectedRangeSize,
    label: String,
) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (size.isCompact) {
            Skeleton(widthFraction = LOADING_HERO_FRACTION, height = LOADING_HERO_HEIGHT)
        } else {
            Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT)
            Skeleton(widthFraction = LOADING_HERO_FRACTION, height = LOADING_HERO_HEIGHT)
            Skeleton(widthFraction = LOADING_BAR_FRACTION, height = LOADING_BAR_HEIGHT)
        }
    }
}

/**
 * Builds the localized [ProjectedRangeStrings] from the i18n catalog (P1/S10) — the fourteen
 * `widget.projectedRange.*` keys the web component reads via `t('widget.projectedRange.…')`. Remembered
 * against the resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberProjectedRangeStrings(): ProjectedRangeStrings {
    val title = stringResource(R.string.translation_widget_projectedRange_title)
    val projected = stringResource(R.string.translation_widget_projectedRange_projected)
    val epa = stringResource(R.string.translation_widget_projectedRange_epa)
    val ofEpa = stringResource(R.string.translation_widget_projectedRange_ofEpa)
    val factors = stringResource(R.string.translation_widget_projectedRange_factors)
    val degradation = stringResource(R.string.translation_widget_projectedRange_degradation)
    val avgDaily = stringResource(R.string.translation_widget_projectedRange_avgDaily)
    val capacity = stringResource(R.string.translation_widget_projectedRange_capacity)
    val cycles = stringResource(R.string.translation_widget_projectedRange_cycles)
    val excellent = stringResource(R.string.translation_widget_projectedRange_excellent)
    val good = stringResource(R.string.translation_widget_projectedRange_good)
    val fair = stringResource(R.string.translation_widget_projectedRange_fair)
    val poor = stringResource(R.string.translation_widget_projectedRange_poor)
    val noData = stringResource(R.string.translation_widget_projectedRange_noData)
    return remember(
        title,
        projected,
        epa,
        ofEpa,
        factors,
        degradation,
        avgDaily,
        capacity,
        cycles,
        excellent,
        good,
        fair,
        poor,
        noData,
    ) {
        ProjectedRangeStrings(
            title = title,
            projected = projected,
            epa = epa,
            ofEpa = ofEpa,
            factors = factors,
            degradation = degradation,
            avgDaily = avgDaily,
            capacity = capacity,
            cycles = cycles,
            excellent = excellent,
            good = good,
            fair = fair,
            poor = poor,
            noData = noData,
        )
    }
}

/** Maps the [UiState] failure classification onto the shared [QueryErrorKind] recovery copy. */
private fun UiState<*>.toQueryErrorKind(): QueryErrorKind =
    when (errorKind) {
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
        ErrorKind.Http -> classifyQueryError(status = httpStatus, online = true, transientWaiting = false)
        ErrorKind.Decode -> QueryErrorKind.ServerError
        null, ErrorKind.Unknown -> QueryErrorKind.Network
    }

/** Maps a health [HealthBand] onto the shared [BadgeVariant] (web `badge.variant`). */
private fun HealthBand.toBadgeVariant(): BadgeVariant =
    when (this) {
        HealthBand.Excellent, HealthBand.Good -> BadgeVariant.Success
        HealthBand.Fair -> BadgeVariant.Warning
        HealthBand.Poor -> BadgeVariant.Danger
    }

/** Maps a [ComparisonBand] onto its semantic bar color (web `#10b981` / `#f59e0b` / `#ef4444`). */
@Composable
private fun comparisonColor(band: ComparisonBand): Color =
    when (band) {
        ComparisonBand.Good -> TeslaTokens.status.success
        ComparisonBand.Fair -> TeslaTokens.status.warning
        ComparisonBand.Poor -> TeslaTokens.status.danger
    }

/** Resolves the range-factor marker to its self-contained line glyph. */
private fun ProjectedRangeFactorIcon.glyph(): ImageVector =
    when (this) {
        ProjectedRangeFactorIcon.Degradation -> ProjectedRangeGlyphs.Gauge
        ProjectedRangeFactorIcon.AvgDaily -> ProjectedRangeGlyphs.Navigation
        ProjectedRangeFactorIcon.Capacity -> ProjectedRangeGlyphs.Thermometer
        ProjectedRangeFactorIcon.Cycles -> ProjectedRangeGlyphs.Mountain
    }

/**
 * Self-contained line glyphs for the surface, authored as 24×24 stroked vectors (the web library leans on
 * lucide-react, which has no bundled Android equivalent). Each is monochrome and recoloured at render time
 * by the [Icon] tint — the same approach as the sibling MileageStatsWidget.
 */
private object ProjectedRangeGlyphs {
    /** lucide `navigation` — a compass arrow (title icon, empty-state icon, Avg Daily factor). */
    val Navigation: ImageVector =
        projectedVector("ProjectedRangeNavigation") {
            moveTo(3f, 11f)
            lineTo(22f, 2f)
            lineTo(13f, 21f)
            lineTo(11f, 13f)
            close()
        }

    /** lucide `gauge` — a dial arc with a needle (Battery Degradation factor). */
    val Gauge: ImageVector =
        projectedVector("ProjectedRangeGauge") {
            moveTo(12f, 13f)
            lineTo(15.5f, 9.5f)
            moveTo(4.5f, 15f)
            curveTo(4.5f, 9f, 8f, 5.5f, 12f, 5.5f)
            curveTo(16f, 5.5f, 19.5f, 9f, 19.5f, 15f)
        }

    /** lucide `thermometer` — a tube with a bulb (Current Capacity factor). */
    val Thermometer: ImageVector =
        projectedVector("ProjectedRangeThermometer") {
            moveTo(14f, 14.5f)
            lineTo(14f, 5f)
            curveTo(14f, 3.9f, 13.1f, 3f, 12f, 3f)
            curveTo(10.9f, 3f, 10f, 3.9f, 10f, 5f)
            lineTo(10f, 14.5f)
            circle(12f, 17.5f, 3f)
        }

    /** lucide `mountain` — twin peaks (Battery Cycles factor). */
    val Mountain: ImageVector =
        projectedVector("ProjectedRangeMountain") {
            moveTo(3f, 20f)
            lineTo(10f, 7f)
            lineTo(14f, 14f)
            lineTo(16.5f, 9.5f)
            lineTo(21f, 20f)
            close()
        }

    /** Circular double-arrow — the header refresh affordance. */
    val Refresh: ImageVector =
        projectedVector("ProjectedRangeRefresh") {
            moveTo(20f, 9f)
            curveTo(18.5f, 6f, 15.5f, 4f, 12f, 4f)
            curveTo(8f, 4f, 4.7f, 6.8f, 4f, 11f)
            moveTo(4f, 15f)
            curveTo(5.5f, 18f, 8.5f, 20f, 12f, 20f)
            curveTo(16f, 20f, 19.3f, 17.2f, 20f, 13f)
            moveTo(20f, 5f)
            lineTo(20f, 9f)
            lineTo(16f, 9f)
            moveTo(4f, 19f)
            lineTo(4f, 15f)
            lineTo(8f, 15f)
        }
}

/** Appends a closed circle of radius [r] centred at ([cx], [cy]) as four cubic-Bézier quadrants. */
private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    val k = CIRCLE_BEZIER_K * r
    moveTo(cx + r, cy)
    curveTo(cx + r, cy + k, cx + k, cy + r, cx, cy + r)
    curveTo(cx - k, cy + r, cx - r, cy + k, cx - r, cy)
    curveTo(cx - r, cy - k, cx - k, cy - r, cx, cy - r)
    curveTo(cx + k, cy - r, cx + r, cy - k, cx + r, cy)
    close()
}

/** Cubic-Bézier control-point ratio that approximates a circular quadrant (4/3·(√2−1)). */
private const val CIRCLE_BEZIER_K = 0.5522847f

private fun projectedVector(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()
