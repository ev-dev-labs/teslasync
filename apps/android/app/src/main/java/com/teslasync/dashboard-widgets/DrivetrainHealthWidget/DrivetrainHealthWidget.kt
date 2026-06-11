// The native Jetpack Compose + Material 3 Drivetrain Health dashboard surface — a parity port of
// web/src/features/dashboard/widgets/DrivetrainHealthWidget.tsx. It mirrors the web `WidgetShell`
// (skeleton while loading, a retry surface on hard error, otherwise — on the standard footprint — a
// cog-iconed title + freshness header) wrapping the web `WidgetGaugeHero`: a color-banded radial gauge of
// the overall powertrain score plus, on the standard footprint, the Motor Temp / Stator Temp / Inverter /
// Drive State stat grid — or a friendly empty state when no drivetrain or motor document is decoded. All
// data flows through the shared [DrivetrainHealthWidgetViewModel] (P1/S8); the view never performs HTTP.
// SI temperatures are converted to the user's unit at this render boundary via the live [UnitFormatter]
// (web `useUnits()`), every string resolves through the i18n catalog (P1/S10), and the refresh control
// carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DrivetrainHealthWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.drivetrainhealth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.charts.RadialGauge
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Stateful entry point. Binds the shared vehicles + drivetrain-health + latest-motor feeds via [source]
 * into a [DrivetrainHealthWidgetViewModel], resolves the live display-[UnitFormatter] from the app
 * container ([LocalDataContainer]; web `useUnits()`), records the one-shot `view.opened` diagnostic, and
 * renders the surface. A dashboard host supplies [source] (an adapter over the shared S8 data layer), the
 * grid [size] (web `WidgetProps.size`), an optional [vehicleId] (web `WidgetProps.vehicleId`), and a
 * unique [instanceKey] per placement.
 */
@Composable
fun DrivetrainHealthWidget(
    source: DrivetrainHealthSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: DrivetrainHealthSize = DrivetrainHealthRegistration.DEFAULT_SIZE,
    logger: Logger = LocalDataContainer.current.logger,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    instanceKey: String = DrivetrainHealthRegistration.ID,
) {
    val viewModel: DrivetrainHealthWidgetViewModel =
        viewModel(key = instanceKey, factory = DrivetrainHealthWidgetViewModel.factory(source, logger, vehicleId))
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by units.collectAsStateWithLifecycle()

    DrivetrainHealthWidgetContent(
        state = state,
        prefs = formatter.prefs,
        size = size,
        modifier = modifier,
        onRefresh = viewModel::refresh,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the gauge hero over
 * the freshness header. [prefs] supplies the SI→display temperature conversion at the render boundary;
 * [size] selects the compact (gauge-only) vs standard (gauge + stat grid) layout (web `size.cols`).
 */
@Composable
fun DrivetrainHealthWidgetContent(
    state: UiState<DrivetrainHealthSnapshot>,
    prefs: UnitPref,
    size: DrivetrainHealthSize,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
) {
    val strings = rememberDrivetrainHealthStrings()
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        when {
            state.isLoading -> DrivetrainHealthLoading()
            state.isError -> DrivetrainHealthErrorState(state = state, onRetry = onRefresh)
            else -> DrivetrainHealthLoaded(state = state, prefs = prefs, size = size, strings = strings, onRefresh = onRefresh)
        }
    }
}

@Composable
private fun DrivetrainHealthLoaded(
    state: UiState<DrivetrainHealthSnapshot>,
    prefs: UnitPref,
    size: DrivetrainHealthSize,
    strings: DrivetrainHealthStrings,
    onRefresh: () -> Unit,
) {
    val compact = DrivetrainHealthRegistration.isCompact(size)
    val display =
        remember(state.data, prefs, strings) {
            DrivetrainHealthProjection.project(state.data ?: DrivetrainHealthSnapshot(null, null), prefs, strings)
        }
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        DrivetrainHealthHeader(
            title = if (compact) null else strings.title,
            state = state,
            onRefresh = onRefresh,
        )
        DrivetrainHealthBody(display = display, compact = compact, emptyMessage = strings.noData)
    }
}

@Composable
private fun DrivetrainHealthHeader(
    title: String?,
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (title != null) {
            Icon(
                imageVector = DrivetrainCogGlyph,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.success,
            )
            Caption(text = title, modifier = Modifier.weight(1f).semantics { heading() })
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = title == null,
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
private fun DrivetrainHealthBody(
    display: DrivetrainHealthDisplay,
    compact: Boolean,
    emptyMessage: String,
) {
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = BODY_MIN_HEIGHT)
                .padding(vertical = Spacing.sm),
        contentAlignment = Alignment.Center,
    ) {
        if (display.hasData) {
            DrivetrainGaugeHero(display = display, compact = compact)
        } else {
            EmptyState(message = emptyMessage, icon = DrivetrainCogGlyph)
        }
    }
}

@Composable
private fun DrivetrainGaugeHero(
    display: DrivetrainHealthDisplay,
    compact: Boolean,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        RadialGauge(
            value = display.score,
            max = GAUGE_MAX,
            label = display.scoreText,
            unit = display.scoreUnit,
            color = bandColor(display.band),
            size = if (compact) COMPACT_GAUGE_SIZE else STANDARD_GAUGE_SIZE,
            decimals = SCORE_GAUGE_DECIMALS,
        )
        if (!compact) {
            DrivetrainStatGrid(stats = display.stats)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun DrivetrainStatGrid(stats: List<DrivetrainStat>) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md, Alignment.CenterHorizontally),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        stats.forEach { stat -> DrivetrainStatItem(stat = stat) }
    }
}

@Composable
private fun DrivetrainStatItem(stat: DrivetrainStat) {
    val description = if (stat.unit != null) "${stat.label}, ${stat.value} ${stat.unit}" else "${stat.label}, ${stat.value}"
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = description },
    ) {
        Caption(text = stat.label)
        Row(
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            BodyText(text = stat.value, maxLines = 1)
            if (stat.unit != null) {
                Caption(text = stat.unit)
            }
        }
    }
}

@Composable
private fun DrivetrainHealthLoading() {
    val label = stringResource(R.string.translation_a11y_loading)
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = BODY_MIN_HEIGHT)
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Skeleton(height = LOADING_GAUGE_SIZE, widthFraction = LOADING_WIDTH_FRACTION, rounded = true)
    }
}

@Composable
private fun DrivetrainHealthErrorState(
    state: UiState<DrivetrainHealthSnapshot>,
    onRetry: () -> Unit,
) {
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = BODY_MIN_HEIGHT)
                .padding(Spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        QueryError(
            kind = queryErrorKindFor(state),
            resourceName = stringResource(R.string.translation_widget_drivetrainHealth_title),
            onRetry = onRetry,
        )
    }
}

/**
 * Folds a [UiState] hard failure onto a [QueryErrorKind]: an [ErrorKind.Network]/[ErrorKind.Timeout] is
 * treated as offline, [ErrorKind.CircuitOpen] as transient back-pressure, and an HTTP status selects the
 * not-found / unauthorized / server bucket.
 */
private fun queryErrorKindFor(state: UiState<*>): QueryErrorKind =
    classifyQueryError(
        status = state.httpStatus,
        online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
        transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
    )

@Composable
private fun bandColor(band: HealthBand): Color =
    when (band) {
        HealthBand.Good -> TeslaTokens.status.success
        HealthBand.Warning -> TeslaTokens.status.warning
        HealthBand.Critical -> TeslaTokens.status.danger
    }

/**
 * Builds the localized [DrivetrainHealthStrings] from the i18n catalog (P1/S10) — the seven
 * `widget.drivetrainHealth.*` keys the web component reads via `t('widget.drivetrainHealth.…')`. Remembered
 * against the resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberDrivetrainHealthStrings(): DrivetrainHealthStrings {
    val title = stringResource(R.string.translation_widget_drivetrainHealth_title)
    val score = stringResource(R.string.translation_widget_drivetrainHealth_score)
    val motorTemp = stringResource(R.string.translation_widget_drivetrainHealth_motorTemp)
    val statorTemp = stringResource(R.string.translation_widget_drivetrainHealth_statorTemp)
    val inverterHealth = stringResource(R.string.translation_widget_drivetrainHealth_inverterHealth)
    val driveState = stringResource(R.string.translation_widget_drivetrainHealth_driveState)
    val noData = stringResource(R.string.translation_widget_drivetrainHealth_noData)
    return remember(title, score, motorTemp, statorTemp, inverterHealth, driveState, noData) {
        DrivetrainHealthStrings(
            title = title,
            score = score,
            motorTemp = motorTemp,
            statorTemp = statorTemp,
            inverterHealth = inverterHealth,
            driveState = driveState,
            noData = noData,
        )
    }
}

// ── Local glyph — the web `Cog` (lucide), authored as a 24×24 stroked gear vector. The data-display layer
// ships no cog/gear glyph and this surface's allowed files cannot extend that catalog, so the icon is
// hand-authored here, mirroring the approach the sibling ClimateStatusWidget uses for its thermometer. ──

private fun drivetrainStroked(
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

private val DrivetrainCogGlyph: ImageVector =
    drivetrainStroked("DrivetrainCog") {
        // Central hub — a circle approximated with two semicircular arcs.
        moveTo(9.5f, 12f)
        arcTo(2.5f, 2.5f, 0f, false, true, 14.5f, 12f)
        arcTo(2.5f, 2.5f, 0f, false, true, 9.5f, 12f)
        close()
        // Gear ring connecting the tooth bases.
        moveTo(5f, 12f)
        arcTo(7f, 7f, 0f, false, true, 19f, 12f)
        arcTo(7f, 7f, 0f, false, true, 5f, 12f)
        close()
        // Eight radial teeth (4 cardinal + 4 diagonal) extending beyond the ring.
        moveTo(12f, 2.5f)
        lineTo(12f, 5f)
        moveTo(12f, 19f)
        lineTo(12f, 21.5f)
        moveTo(2.5f, 12f)
        lineTo(5f, 12f)
        moveTo(19f, 12f)
        lineTo(21.5f, 12f)
        moveTo(5.3f, 5.3f)
        lineTo(7f, 7f)
        moveTo(17f, 17f)
        lineTo(18.7f, 18.7f)
        moveTo(18.7f, 5.3f)
        lineTo(17f, 7f)
        moveTo(7f, 17f)
        lineTo(5.3f, 18.7f)
    }

private val COMPACT_GAUGE_SIZE: Dp = 70.dp
private val STANDARD_GAUGE_SIZE: Dp = 100.dp
private val BODY_MIN_HEIGHT: Dp = 120.dp
private val LOADING_GAUGE_SIZE: Dp = 96.dp
private val GLYPH_SIZE: Dp = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
private const val GAUGE_MAX = 100.0
private const val SCORE_GAUGE_DECIMALS = 0
private const val LOADING_WIDTH_FRACTION = 0.6f

// ── Previews — one per rendered state (content / compact / empty / loading / error / offline). ─────────

private fun previewHealth(): JsonElement =
    buildJsonObject {
        put("front_motor_temp_c", 45.0)
        put("rear_motor_temp_c", 48.0)
        put("inverter_temp_c", 52.0)
        put("motor_status", "Normal")
        put("overall_health", "good")
    }

private fun previewMotor(): JsonElement =
    buildJsonObject {
        put("motor_temp_c_front", 46.0)
        put("di_stator_temp", 61.0)
        put("inverter_temp_c", 53.0)
        put("state_front", "Drive")
    }

private fun previewSnapshot(): DrivetrainHealthSnapshot = DrivetrainHealthSnapshot(previewHealth(), previewMotor())

@Preview(name = "DrivetrainHealth · content", showBackground = true)
@Composable
private fun DrivetrainHealthContentPreview() {
    TeslaSyncTheme {
        DrivetrainHealthWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewSnapshot(), fetchedAt = System.currentTimeMillis()),
            prefs = UnitFormatter.default().prefs,
            size = DrivetrainHealthRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "DrivetrainHealth · compact", showBackground = true)
@Composable
private fun DrivetrainHealthCompactPreview() {
    TeslaSyncTheme {
        DrivetrainHealthWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewSnapshot(), fetchedAt = System.currentTimeMillis()),
            prefs = UnitFormatter.default().prefs,
            size = DrivetrainHealthSize(cols = 1, rows = 2),
        )
    }
}

@Preview(name = "DrivetrainHealth · empty", showBackground = true)
@Composable
private fun DrivetrainHealthEmptyPreview() {
    TeslaSyncTheme {
        DrivetrainHealthWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Empty,
                    data = DrivetrainHealthSnapshot(null, null),
                    fetchedAt = System.currentTimeMillis(),
                ),
            prefs = UnitFormatter.default().prefs,
            size = DrivetrainHealthRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "DrivetrainHealth · loading", showBackground = true)
@Composable
private fun DrivetrainHealthLoadingPreview() {
    TeslaSyncTheme {
        DrivetrainHealthWidgetContent(
            state = UiState.loading(),
            prefs = UnitFormatter.default().prefs,
            size = DrivetrainHealthRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "DrivetrainHealth · error", showBackground = true)
@Composable
private fun DrivetrainHealthErrorPreview() {
    TeslaSyncTheme {
        DrivetrainHealthWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            prefs = UnitFormatter.default().prefs,
            size = DrivetrainHealthRegistration.DEFAULT_SIZE,
        )
    }
}

@Preview(name = "DrivetrainHealth · offline (cached)", showBackground = true)
@Composable
private fun DrivetrainHealthOfflinePreview() {
    TeslaSyncTheme {
        DrivetrainHealthWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewSnapshot(),
                    fetchedAt = System.currentTimeMillis(),
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            prefs = UnitFormatter.default().prefs,
            size = DrivetrainHealthRegistration.DEFAULT_SIZE,
        )
    }
}
