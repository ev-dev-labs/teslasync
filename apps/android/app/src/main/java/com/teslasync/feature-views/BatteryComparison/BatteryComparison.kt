// The native Jetpack Compose + Material 3 BatteryComparison feature view — a parity port of
// web/src/features/vehicles/components/BatteryComparison.tsx. The web component runs one polled `useQuery`
// over the enrolled fleet (each vehicle's `fetchVehicleState`, per-vehicle errors swallowed), keeps the
// vehicles whose state resolved, and renders a `GlassPanel` titled `Activity` + `Fleet Battery Status` with
// one row per vehicle: the name (`display_name || vin`), a gradient meter filled to `${level}%` and tinted by
// `batteryColor(level)`, the `{level}%` label, and `formatDistance(rated_range)`. The web component returns
// `null` when no vehicle reports a state; this native port instead ALWAYS renders the titled panel and shows a
// friendly empty state inside (the P3 surface contract + frontend guideline: never hide a section), and adds
// the cache-then-network states the contract mandates (loading skeleton / hard fetch-error / stale / offline)
// by binding the shared vehicles + per-vehicle state feeds (P1/S8) through a [BatteryComparisonViewModel].
//
// Every derivation flows through the pure [BatteryComparisonProjection]; this file is a thin render layer that
// resolves the i18n labels (P1/S10 `translation_fleet_batteryStatus` + the shared lifecycle keys), the live
// display units (P1/S8 — the shared `UnitFormatter`, the web `useUnits` boundary), the design-token band
// colours (P1/S9), and the reduced-motion preference, then draws them. There is no English literal and no HTTP
// here. Each bar is a single merged accessibility node that announces the name, level, and range together (the
// meter is decorative). The one-shot `view.opened` diagnostic (P1/S11) fires on first composition.
//
// Web → native token mapping (no ported Tailwind, ADR-005): the web `GlassPanel p-5` → [GlassPanel] +
// [PanelPadding.Lg]; the `gap-2` title row → [Spacing.sm]; `mb-4` → [Spacing.lg]; `space-y-3` bars → the
// inter-row [Spacing.md]; the per-bar `gap-3` → [Spacing.md]; the `h-3` meter → 12.dp; the `text-cyan-400`
// title icon → the theme `primary` accent; the `batteryColor` good/warn/critical hexes → `TeslaTokens.status`
// success/warning/danger; the meter's `linear-gradient(90deg, ${color}80, ${color})` → a horizontal [Brush]
// from the band colour at half alpha to full; the fill's `transition-all duration-slow` → an
// `animateFloatAsState` suppressed to an instant snap under reduced motion (P1/S9).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/BatteryComparison) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.batterycomparison

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.MotionDurations
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

// ── Geometry (web `w-24` name, `h-3` meter, `w-10` value, `w-16` range, `space-y-3` / `gap-3`) ──────────
private val NAME_WIDTH: Dp = 96.dp
private val VALUE_WIDTH: Dp = 44.dp
private val RANGE_WIDTH: Dp = 64.dp
private val METER_HEIGHT: Dp = 12.dp
private const val SKELETON_BAR_COUNT: Int = 3
private const val GRADIENT_START_ALPHA: Float = 0.5f
private const val INSTANT_SNAP_MS: Int = 0
private const val EM_DASH: String = "\u2014"

/**
 * The localized microcopy this surface reads from the i18n catalog (P1/S10) — the web `t('fleet.batteryStatus',
 * …)` title plus the friendly empty-state message (the web returns `null` for "no bars"; this port shows a
 * never-hidden empty surface instead). The lifecycle-chrome strings (loading / error / retry / offline /
 * freshness) are resolved inline at the Compose boundary, so this holder stays a thin content carrier.
 *
 * @property title the panel title (web `Fleet Battery Status`).
 * @property empty the empty-state message shown when no vehicle reports a battery reading.
 */
data class BatteryComparisonStrings(
    val title: String,
    val empty: String,
)

/**
 * Stateful entry point. Binds the shared vehicles + per-vehicle state feeds via [source] into a
 * [BatteryComparisonViewModel], resolves the live display units (P1/S8 — the web `useUnits` boundary) and the
 * localized [BatteryComparisonStrings] from the catalog (P1/S10), records the one-shot `view.opened`
 * diagnostic, and renders the surface. A host supplies [source] (an adapter over the shared S8 vehicles data
 * layer) and a unique [instanceKey] per placement.
 */
@Composable
fun BatteryComparison(
    source: BatteryComparisonSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = BATTERY_COMPARISON_SLUG,
) {
    val viewModel: BatteryComparisonViewModel =
        viewModel(key = instanceKey, factory = BatteryComparisonViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    val strings = rememberBatteryComparisonStrings()

    BatteryComparisonContent(
        state = state,
        strings = strings,
        formatter = formatter,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Always draws the titled
 * [GlassPanel] (never hidden, even with no data) and inside it reproduces the web bars, extended with the
 * mandated states: a first load shows a skeleton bar grid; a hard fetch-error with no cached fleet shows an
 * [ErrorDisplay] with retry; a stale/offline cached fleet keeps the bars visible with a freshness chip flagged
 * and auto-refreshes (the web 30s poll); and no resolved bar shows a friendly empty state (the web `null`).
 */
@Composable
fun BatteryComparisonContent(
    state: UiState<List<BatteryComparisonRow>>,
    strings: BatteryComparisonStrings,
    formatter: UnitFormatter,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.isError) {
        if (state.stale && !state.refreshing && !state.isError) onRefresh()
    }
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        BatteryComparisonHeader(title = strings.title)
        Column(
            modifier = Modifier.padding(top = Spacing.lg).fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            when {
                state.isLoading -> BatteryComparisonLoading()
                state.isError && !state.hasData -> BatteryComparisonError(onRetry = onRefresh)
                else -> BatteryComparisonBars(state = state, strings = strings, formatter = formatter)
            }
        }
    }
}

/** The panel title row — web `Activity` icon (theme accent) + `Fleet Battery Status` (web `gap-2`). */
@Composable
private fun BatteryComparisonHeader(title: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = BatteryComparisonGlyphs.Activity,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.primary,
        )
        PanelTitle(title)
    }
}

/**
 * The resolved (non-loading, non-hard-error) body: an optional freshness chip over either the friendly empty
 * state (no resolved bars — the web `bars.length === 0`) or the battery bars.
 */
@Composable
private fun BatteryComparisonBars(
    state: UiState<List<BatteryComparisonRow>>,
    strings: BatteryComparisonStrings,
    formatter: UnitFormatter,
) {
    if (state.fetchedAt != null || state.refreshing || state.hasError) {
        BatteryComparisonFreshness(state)
    }
    val rows = state.data ?: emptyList()
    if (rows.isEmpty()) {
        EmptyState(message = strings.empty, modifier = Modifier.fillMaxWidth())
    } else {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            rows.forEach { row -> BatteryComparisonRowView(row = row, formatter = formatter) }
        }
    }
}

/** One battery bar — web row: name (truncated) ▸ gradient meter ▸ `{level}%` ▸ formatted range. */
@Composable
private fun BatteryComparisonRowView(
    row: BatteryComparisonRow,
    formatter: UnitFormatter,
) {
    val color = bandColor(row.band)
    val percent = BatteryComparisonProjection.percentLabel(row.level)
    val rangeText = formatter.distance(row.rangeMeters)
    val description = "${row.name}, $percent, $rangeText"
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clearAndSetSemantics { contentDescription = description },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Text(
            text = row.name,
            modifier = Modifier.width(NAME_WIDTH),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        BatteryMeter(fraction = row.barFraction, color = color, modifier = Modifier.weight(1f))
        Text(
            text = percent,
            modifier = Modifier.width(VALUE_WIDTH),
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Medium),
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.End,
            maxLines = 1,
        )
        Text(
            text = rangeText,
            modifier = Modifier.width(RANGE_WIDTH),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.End,
            maxLines = 1,
        )
    }
}

/**
 * The charge meter — the web `h-3 rounded-full bg-white/[0.04]` track with an inner fill at `min(level, 100)%`
 * width painted with the band gradient (`linear-gradient(90deg, ${color}80, ${color})`). The fill width
 * animates on change (web `transition-all duration-slow`) and snaps instantly under reduced motion.
 */
@Composable
private fun BatteryMeter(
    fraction: Float,
    color: Color,
    modifier: Modifier = Modifier,
) {
    val reduceMotion = rememberReducedMotion()
    val animated by animateFloatAsState(
        targetValue = fraction,
        animationSpec = tween(durationMillis = if (reduceMotion) INSTANT_SNAP_MS else MotionDurations.slow),
        label = "battery-comparison-fill",
    )
    Box(
        modifier =
            modifier
                .height(METER_HEIGHT)
                .clip(RoundedCornerShape(Radius.pill))
                .background(MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Box(
            modifier =
                Modifier
                    .fillMaxWidth(animated)
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(Radius.pill))
                    .background(Brush.horizontalGradient(listOf(color.copy(alpha = GRADIENT_START_ALPHA), color))),
        )
    }
}

/** The right-aligned freshness chip — surfaces the fleet feed's refreshing / stale / offline health. */
@Composable
private fun BatteryComparisonFreshness(state: UiState<List<BatteryComparisonRow>>) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberRelativeAgeFormatter(),
        )
    }
}

/** The first-load skeleton — a small grid of shimmer bars mirroring the row layout (web has no bars yet). */
@Composable
private fun BatteryComparisonLoading() {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .clearAndSetSemantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(SKELETON_BAR_COUNT) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            ) {
                Skeleton(modifier = Modifier.width(NAME_WIDTH), height = METER_HEIGHT, rounded = true)
                Skeleton(modifier = Modifier.weight(1f), height = METER_HEIGHT, rounded = true)
                Skeleton(modifier = Modifier.width(VALUE_WIDTH), height = METER_HEIGHT, rounded = true)
                Skeleton(modifier = Modifier.width(RANGE_WIDTH), height = METER_HEIGHT, rounded = true)
            }
        }
    }
}

/** The hard-error body — shown only when the fleet list itself failed with no cache (nothing known). */
@Composable
private fun BatteryComparisonError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        modifier = Modifier.fillMaxWidth(),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/** Maps a [BatteryBand] onto a P1/S9 design token — the web `batteryColor` good/warn/critical hexes. */
@Composable
private fun bandColor(band: BatteryBand): Color =
    when (band) {
        BatteryBand.Good -> TeslaTokens.status.success
        BatteryBand.Warning -> TeslaTokens.status.warning
        BatteryBand.Critical -> TeslaTokens.status.danger
    }

/**
 * Resolves the localized [BatteryComparisonStrings] from the i18n catalog (P1/S10) — the web
 * `t('fleet.batteryStatus', …)` title plus the shared `common.noData` empty message. Remembered against the
 * resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberBatteryComparisonStrings(): BatteryComparisonStrings {
    val title = stringResource(R.string.translation_fleet_batteryStatus)
    val empty = stringResource(R.string.translation_common_noData)
    return remember(title, empty) { BatteryComparisonStrings(title = title, empty = empty) }
}

/**
 * Builds the localized relative-age formatter the freshness chip folds [FreshnessAge] buckets through (P1/S10
 * `translation_freshness_*`), so the pure freshness logic carries no English microcopy.
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

/**
 * The one glyph this surface needs that the shared sets do not carry. The web title icon is lucide `Activity`;
 * Android ships no equivalent without the frozen `material-icons-extended` artifact, so — exactly as the
 * sibling `HelpersGlyphs` does for its lucide port — it is authored here as a 24×24 stroked vector (the
 * heart-monitor pulse polyline `M22 12h-4l-3 9L9 3l-3 9H2`).
 */
private object BatteryComparisonGlyphs {
    private const val VIEWPORT = 24f
    private const val STROKE_WIDTH = 2f

    val Activity: ImageVector =
        stroked("Activity") {
            moveTo(22f, 12f)
            lineTo(18f, 12f)
            lineTo(15f, 21f)
            lineTo(9f, 3f)
            lineTo(6f, 12f)
            lineTo(2f, 12f)
        }

    private fun stroked(
        name: String,
        build: PathBuilder.() -> Unit,
    ): ImageVector =
        ImageVector
            .Builder(
                name = name,
                defaultWidth = 24.dp,
                defaultHeight = 24.dp,
                viewportWidth = VIEWPORT,
                viewportHeight = VIEWPORT,
            ).apply {
                path(
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = STROKE_WIDTH,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

private val PREVIEW_STRINGS =
    BatteryComparisonStrings(title = "Fleet Battery Status", empty = "No data available")

private fun previewRows(): List<BatteryComparisonRow> =
    listOf(
        BatteryComparisonRow(1L, "Model 3", 82, BatteryBand.Good, 0.82f, 410_000.0),
        BatteryComparisonRow(2L, "Model Y", 47, BatteryBand.Warning, 0.47f, 230_000.0),
        BatteryComparisonRow(3L, "Cybertruck", 18, BatteryBand.Critical, 0.18f, 95_000.0),
    )

@Preview(name = "Content", showBackground = true, widthDp = 420)
@Composable
private fun BatteryComparisonContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryComparisonContent(
            state = UiState(phase = UiPhase.Content, data = previewRows(), fetchedAt = 1L),
            strings = PREVIEW_STRINGS,
            formatter = UnitFormatter.default(),
        )
    }
}

@Preview(name = "Loading", showBackground = true, widthDp = 420)
@Composable
private fun BatteryComparisonLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryComparisonContent(
            state = UiState.loading(),
            strings = PREVIEW_STRINGS,
            formatter = UnitFormatter.default(),
        )
    }
}

@Preview(name = "Empty", showBackground = true, widthDp = 420)
@Composable
private fun BatteryComparisonEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryComparisonContent(
            state = UiState(phase = UiPhase.Empty, data = emptyList(), fetchedAt = 1L),
            strings = PREVIEW_STRINGS,
            formatter = UnitFormatter.default(),
        )
    }
}

@Preview(name = "Error", showBackground = true, widthDp = 420)
@Composable
private fun BatteryComparisonErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryComparisonContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            strings = PREVIEW_STRINGS,
            formatter = UnitFormatter.default(),
        )
    }
}

@Preview(name = "Offline (cached)", showBackground = true, widthDp = 420)
@Composable
private fun BatteryComparisonOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        BatteryComparisonContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewRows(),
                    fetchedAt = 1L,
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            strings = PREVIEW_STRINGS,
            formatter = UnitFormatter.default(),
        )
    }
}
