// The native Jetpack Compose + Material 3 Tire Pressure Visual dashboard surface — a parity port of
// web/src/features/dashboard/widgets/TirePressureVisualWidget.tsx. It mirrors the web `WidgetShell`
// (a skeleton while the first load is in flight, a `QueryError` on a hard failure — the web passes the
// shell its `error` prop — otherwise a CircleDot-iconed title + freshness header) wrapping either the
// four-corner car diagram with per-tire pressure values + a status badge, or a friendly empty state when
// no snapshot is present. All data flows through the shared [TirePressureVisualWidgetViewModel] (P1/S8);
// the view never performs HTTP. Pressures are SI→display converted at this render boundary via the shared
// [UnitFormatter] (web `useUnits()`), every string resolves through the i18n catalog (P1/S10), and every
// interactive element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/TirePressureVisualWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.tirepressurevisual

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Stateful entry point. Binds the shared vehicles + latest-tire-pressure feeds via [source] into a
 * [TirePressureVisualWidgetViewModel], resolves the live display-[UnitFormatter] from the app container
 * ([LocalDataContainer]; web `useUnits()`), records the one-shot `view.opened` diagnostic, and renders the
 * surface. A dashboard host supplies [source] (an adapter over the shared S8 vehicles data layer), a unique
 * [instanceKey] per placement, and the placement [size]; an explicit [vehicleId] pins the surface to one
 * vehicle (web `WidgetProps.vehicleId`), otherwise the first enrolled vehicle is used.
 */
@Composable
fun TirePressureVisualWidget(
    source: TirePressureVisualSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: TirePressureSize = TirePressureVisualRegistration.DEFAULT_SIZE,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = TirePressureVisualRegistration.ID,
) {
    val viewModel: TirePressureVisualWidgetViewModel =
        viewModel(key = instanceKey, factory = TirePressureVisualWidgetViewModel.factory(source, logger, vehicleId))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()

    TirePressureVisualWidgetContent(
        state = state,
        formatter = formatter,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits: a first load → full skeleton; a hard failure → a [QueryError] with a retry
 * (the web tire widget passes the shell its `error` prop, so a hard error replaces the body); otherwise the
 * CircleDot title + freshness header over the car diagram + per-tire values + status badge, or the empty
 * state. A stale/offline cached snapshot keeps its diagram visible with the freshness chip flagged.
 */
@Composable
fun TirePressureVisualWidgetContent(
    state: UiState<JsonElement>,
    formatter: UnitFormatter,
    modifier: Modifier = Modifier,
    size: TirePressureSize = TirePressureVisualRegistration.DEFAULT_SIZE,
    onRefresh: () -> Unit = {},
) {
    when {
        state.isLoading -> TpvLoading(modifier)
        state.isError -> TpvError(state = state, onRefresh = onRefresh, modifier = modifier)
        else -> TpvLoaded(state = state, formatter = formatter, size = size, onRefresh = onRefresh, modifier = modifier)
    }
}

@Composable
private fun TpvLoaded(
    state: UiState<JsonElement>,
    formatter: UnitFormatter,
    size: TirePressureSize,
    onRefresh: () -> Unit,
    modifier: Modifier,
) {
    val display =
        remember(state.data, formatter) {
            TirePressureVisualProjection.project(state.data, formatter, System.currentTimeMillis())
        }
    val compact = TirePressureVisualRegistration.isCompact(size)
    Column(modifier = modifier.fillMaxSize()) {
        TpvHeader(state = state, compact = compact, onRefresh = onRefresh)
        Box(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        ) {
            if (display.hasData) TpvContent(display) else TpvEmpty()
        }
    }
}

@Composable
private fun TpvHeader(
    state: UiState<*>,
    compact: Boolean,
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
            imageVector = TireCircleDotGlyph,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.info,
        )
        if (compact) {
            Box(modifier = Modifier.weight(1f))
        } else {
            PanelTitle(
                stringResource(R.string.translation_widget_tirePressure),
                modifier = Modifier.weight(1f).semantics { heading() },
            )
        }
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
private fun TpvContent(display: TirePressureVisualDisplay) {
    Column(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(
            modifier = Modifier.fillMaxWidth().weight(1f),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            TpvCornerColumn(
                top = display.tire(TireCorner.FrontLeft),
                bottom = display.tire(TireCorner.RearLeft),
                alignEnd = true,
            )
            Box(
                modifier = Modifier.weight(1f).fillMaxHeight().heightIn(max = DIAGRAM_MAX_HEIGHT),
                contentAlignment = Alignment.Center,
            ) {
                CarDiagram(display.tires)
            }
            TpvCornerColumn(
                top = display.tire(TireCorner.FrontRight),
                bottom = display.tire(TireCorner.RearRight),
                alignEnd = false,
            )
        }
        TpvFooter(display)
    }
}

@Composable
private fun TpvCornerColumn(
    top: TireReading?,
    bottom: TireReading?,
    alignEnd: Boolean,
) {
    Column(
        modifier = Modifier.fillMaxHeight().widthIn(min = CORNER_COLUMN_MIN_WIDTH),
        verticalArrangement = Arrangement.SpaceBetween,
        horizontalAlignment = if (alignEnd) Alignment.End else Alignment.Start,
    ) {
        TpvCornerCell(top, alignEnd)
        TpvCornerCell(bottom, alignEnd)
    }
}

@Composable
private fun TpvCornerCell(
    reading: TireReading?,
    alignEnd: Boolean,
) {
    if (reading == null) return
    val label = cornerLabel(reading.corner)
    val value = reading.valueText
    val align = if (alignEnd) TextAlign.End else TextAlign.Start
    Column(
        horizontalAlignment = if (alignEnd) Alignment.End else Alignment.Start,
        modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = "$label, $value" },
    ) {
        Caption(label)
        Text(
            text = value,
            style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
            color = tireStatusColor(reading.status),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = align,
        )
    }
}

@Composable
private fun TpvFooter(display: TirePressureVisualDisplay) {
    val ageText = rememberReadingAgeFormatter()(display.readingAge)
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Badge(
            text =
                if (display.allNormal) {
                    stringResource(R.string.translation_widget_tireAllNormal)
                } else {
                    stringResource(R.string.translation_widget_tireWarning)
                },
            variant = tireBadgeVariant(display.allNormal, display.hasWarning),
        )
        Caption("${display.unitLabel} \u00B7 $ageText")
    }
}

@Composable
private fun TpvEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_widget_noTireData),
        icon = TireCircleDotGlyph,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun TpvLoading(modifier: Modifier) {
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

@Composable
private fun TpvError(
    state: UiState<JsonElement>,
    onRefresh: () -> Unit,
    modifier: Modifier,
) {
    Box(
        modifier = modifier.fillMaxSize().padding(Spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        QueryError(kind = queryErrorKindOf(state), onRetry = onRefresh)
    }
}

/**
 * Top-down car silhouette with four tire indicators — the native port of the web `CarDiagram` SVG
 * (viewBox 0 0 120 180). The body outline + window hints + four rounded tire rects are drawn on a [Canvas]
 * scaled to fit with the SVG `xMidYMid meet` contract (uniform scale, centered). Each tire is filled by its
 * status color; the diagram is decorative (web `aria-hidden`) — the per-corner value cells carry the
 * accessible reading.
 */
@Composable
private fun CarDiagram(tires: List<TireReading>) {
    val green = TeslaTokens.status.success
    val amber = TeslaTokens.status.warning
    val red = TeslaTokens.status.danger
    val outline = MaterialTheme.colorScheme.onSurface

    fun colorFor(status: TireStatus): Color =
        when (status) {
            TireStatus.Green -> green
            TireStatus.Amber -> amber
            TireStatus.Red -> red
        }

    Canvas(
        modifier =
            Modifier
                .fillMaxWidth()
                .fillMaxHeight()
                .heightIn(max = DIAGRAM_MAX_HEIGHT)
                .clearAndSetSemantics { },
    ) {
        val scale = minOf(size.width / VIEWBOX_W, size.height / VIEWBOX_H)
        val originX = (size.width - VIEWBOX_W * scale) / 2f
        val originY = (size.height - VIEWBOX_H * scale) / 2f

        fun pt(
            x: Float,
            y: Float,
        ) = Offset(originX + x * scale, originY + y * scale)

        // Car body outline (rect x30 y16 w60 h148 rx16).
        drawRoundRect(
            color = outline.copy(alpha = BODY_STROKE_ALPHA),
            topLeft = pt(BODY_X, BODY_Y),
            size = Size(BODY_W * scale, BODY_H * scale),
            cornerRadius = CornerRadius(BODY_RADIUS * scale, BODY_RADIUS * scale),
            style = Stroke(width = BODY_STROKE_WIDTH * scale),
        )
        // Windshield + rear-window hints.
        drawWindowHint(pt(WINDOW_X1, WINDSHIELD_Y), pt(WINDOW_X2, WINDSHIELD_Y), outline, scale)
        drawWindowHint(pt(WINDOW_X1, REAR_WINDOW_Y), pt(WINDOW_X2, REAR_WINDOW_Y), outline, scale)

        // Four tires, each a rounded rect (w16 h26 rx4) filled by status color.
        tires.forEach { tire ->
            val origin = tireOrigin(tire.corner)
            drawRoundRect(
                color = colorFor(tire.status).copy(alpha = TIRE_FILL_ALPHA),
                topLeft = pt(origin.first, origin.second),
                size = Size(TIRE_W * scale, TIRE_H * scale),
                cornerRadius = CornerRadius(TIRE_RADIUS * scale, TIRE_RADIUS * scale),
            )
        }
    }
}

private fun DrawScope.drawWindowHint(
    start: Offset,
    end: Offset,
    color: Color,
    scale: Float,
) {
    drawLine(
        color = color.copy(alpha = WINDOW_STROKE_ALPHA),
        start = start,
        end = end,
        strokeWidth = WINDOW_STROKE_WIDTH * scale,
    )
}

/** Top-left viewBox coordinate of a corner's tire rect (web `tirePositions`). */
private fun tireOrigin(corner: TireCorner): Pair<Float, Float> =
    when (corner) {
        TireCorner.FrontLeft -> TIRE_LEFT_X to TIRE_FRONT_Y
        TireCorner.FrontRight -> TIRE_RIGHT_X to TIRE_FRONT_Y
        TireCorner.RearLeft -> TIRE_LEFT_X to TIRE_REAR_Y
        TireCorner.RearRight -> TIRE_RIGHT_X to TIRE_REAR_Y
    }

@Composable
private fun cornerLabel(corner: TireCorner): String =
    stringResource(
        when (corner) {
            TireCorner.FrontLeft -> R.string.translation_widget_tireFL
            TireCorner.FrontRight -> R.string.translation_widget_tireFR
            TireCorner.RearLeft -> R.string.translation_widget_tireRL
            TireCorner.RearRight -> R.string.translation_widget_tireRR
        },
    )

@Composable
private fun tireStatusColor(status: TireStatus): Color =
    when (status) {
        TireStatus.Green -> TeslaTokens.status.success
        TireStatus.Amber -> TeslaTokens.status.warning
        TireStatus.Red -> TeslaTokens.status.danger
    }

/**
 * The footer badge variant — the verbatim web ternary `allNormal ? 'success' : hasWarning ? 'warning' :
 * 'danger'`. (The danger arm is unreachable in practice — a non-all-green snapshot always has a warning —
 * but it is preserved for parity with the web source.)
 */
private fun tireBadgeVariant(
    allNormal: Boolean,
    hasWarning: Boolean,
): BadgeVariant =
    when {
        allNormal -> BadgeVariant.Success
        hasWarning -> BadgeVariant.Warning
        else -> BadgeVariant.Danger
    }

/**
 * Folds a [UiState] hard failure onto a [QueryErrorKind] for the [QueryError] surface (web's WidgetShell
 * `error` branch): a network/timeout failure is treated as offline, a circuit-open failure as transient
 * back-pressure, and the HTTP status selects not-found / unauthorized / server-error copy.
 */
private fun queryErrorKindOf(state: UiState<JsonElement>): QueryErrorKind =
    classifyQueryError(
        status = state.httpStatus,
        online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
        transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
    )

/**
 * Builds the localized relative-age formatter the footer reading-time folds [TireReadingAge] buckets
 * through (web `formatTimestamp` → P1/S10 keys), so the pure projection carries no English microcopy. The
 * `m`/`h`/`d` unit letters are the web source's verbatim abbreviations (identical to the `translation_freshness_*`
 * pattern) and are not separately translatable.
 */
@Composable
private fun rememberReadingAgeFormatter(): (TireReadingAge) -> String {
    val noReading = stringResource(R.string.translation_widget_tireNoReading)
    val justNow = stringResource(R.string.translation_widget_tireJustNow)
    val ago = stringResource(R.string.translation_widget_ago)
    return remember(noReading, justNow, ago) {
        { age ->
            when (age) {
                TireReadingAge.NoReading -> noReading
                TireReadingAge.Invalid -> EM_DASH
                TireReadingAge.JustNow -> justNow
                is TireReadingAge.Minutes -> "${age.value}m $ago"
                is TireReadingAge.Hours -> "${age.value}h $ago"
                is TireReadingAge.Days -> "${age.value}d $ago"
            }
        }
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

// ── Local glyph — the web `CircleDot` (lucide), authored as a 24×24 stroked vector (an outer ring + a
// center dot). The feedback/data-display catalogs ship no CircleDot and this surface's allowed files
// cannot extend them, so the icon is hand-authored here, mirroring the sibling ClimateStatusWidget. ──

private fun tireStroked(
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

private val TireCircleDotGlyph: ImageVector =
    tireStroked("TireCircleDot") {
        // Outer ring (r = 10, centered at 12,12), approximated with two semicircular arcs.
        moveTo(2f, 12f)
        arcTo(10f, 10f, 0f, false, true, 22f, 12f)
        arcTo(10f, 10f, 0f, false, true, 2f, 12f)
        close()
        // Center dot (r = 1).
        moveTo(11f, 12f)
        arcTo(1f, 1f, 0f, false, true, 13f, 12f)
        arcTo(1f, 1f, 0f, false, true, 11f, 12f)
        close()
    }

// ── Geometry constants (web SVG viewBox 0 0 120 180) ──────────────────────────────────────────────────
private const val VIEWBOX_W = 120f
private const val VIEWBOX_H = 180f
private const val BODY_X = 30f
private const val BODY_Y = 16f
private const val BODY_W = 60f
private const val BODY_H = 148f
private const val BODY_RADIUS = 16f
private const val BODY_STROKE_WIDTH = 1.5f
private const val BODY_STROKE_ALPHA = 0.12f
private const val WINDOW_X1 = 36f
private const val WINDOW_X2 = 84f
private const val WINDSHIELD_Y = 52f
private const val REAR_WINDOW_Y = 132f
private const val WINDOW_STROKE_WIDTH = 1f
private const val WINDOW_STROKE_ALPHA = 0.08f
private const val TIRE_W = 16f
private const val TIRE_H = 26f
private const val TIRE_RADIUS = 4f
private const val TIRE_FILL_ALPHA = 0.85f
private const val TIRE_LEFT_X = 14f
private const val TIRE_RIGHT_X = 90f
private const val TIRE_FRONT_Y = 28f
private const val TIRE_REAR_Y = 126f

private val DIAGRAM_MAX_HEIGHT = 140.dp
private val CORNER_COLUMN_MIN_WIDTH = 50.dp
private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
private const val LOADING_BAR_COUNT = 4
private val LOADING_BAR_HEIGHT = 16.dp

// ── Previews — one per rendered state (content / warning / empty / loading / error / offline / compact). ──

private fun previewTires(
    fl: Double,
    fr: Double,
    rl: Double,
    rr: Double,
): JsonElement =
    buildJsonObject {
        put("front_left", fl)
        put("front_right", fr)
        put("rear_left", rl)
        put("rear_right", rr)
    }

@Preview(name = "Tire pressure · content", showBackground = true)
@Composable
private fun TpvContentPreview() {
    TeslaSyncTheme {
        TirePressureVisualWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewTires(2.4, 2.5, 2.6, 2.7),
                    fetchedAt = System.currentTimeMillis(),
                ),
            formatter = UnitFormatter.default(),
        )
    }
}

@Preview(name = "Tire pressure · warning", showBackground = true)
@Composable
private fun TpvWarningPreview() {
    TeslaSyncTheme {
        TirePressureVisualWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewTires(2.4, 2.1, 3.2, 2.6),
                    fetchedAt = System.currentTimeMillis(),
                ),
            formatter = UnitFormatter.default(),
        )
    }
}

@Preview(name = "Tire pressure · empty", showBackground = true)
@Composable
private fun TpvEmptyPreview() {
    TeslaSyncTheme {
        TirePressureVisualWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = JsonNull, fetchedAt = System.currentTimeMillis()),
            formatter = UnitFormatter.default(),
        )
    }
}

@Preview(name = "Tire pressure · loading", showBackground = true)
@Composable
private fun TpvLoadingPreview() {
    TeslaSyncTheme {
        TirePressureVisualWidgetContent(state = UiState.loading(), formatter = UnitFormatter.default())
    }
}

@Preview(name = "Tire pressure · error", showBackground = true)
@Composable
private fun TpvErrorPreview() {
    TeslaSyncTheme {
        TirePressureVisualWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            formatter = UnitFormatter.default(),
        )
    }
}

@Preview(name = "Tire pressure · offline (cached)", showBackground = true)
@Composable
private fun TpvOfflinePreview() {
    TeslaSyncTheme {
        TirePressureVisualWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewTires(2.4, 2.5, 2.6, 2.7),
                    fetchedAt = System.currentTimeMillis(),
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            formatter = UnitFormatter.default(),
        )
    }
}

@Preview(name = "Tire pressure · compact", showBackground = true)
@Composable
private fun TpvCompactPreview() {
    TeslaSyncTheme {
        TirePressureVisualWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewTires(2.4, 2.5, 2.6, 2.7),
                    fetchedAt = System.currentTimeMillis(),
                ),
            formatter = UnitFormatter.default(),
            size = TirePressureSize(cols = 1, rows = 2),
        )
    }
}
