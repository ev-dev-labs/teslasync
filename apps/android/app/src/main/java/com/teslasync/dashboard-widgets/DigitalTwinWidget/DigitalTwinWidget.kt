// The native Jetpack Compose + Material 3 Digital Twin dashboard surface — a parity port of
// web/src/features/dashboard/widgets/DigitalTwinWidget.tsx. It mirrors the web `WidgetShell` (a skeleton
// while the first load is in flight, otherwise a Monitor-iconed title + freshness header) wrapping the twin
// body: a native top-down vehicle schematic (the platform-idiomatic counterpart of the web SVG
// `VehicleTwin` — doors, windows, frunk / trunk, headlights, charge port and a sentry ring all coloured by
// live state) above the wrapping status-badge row (lock + windows always, plus driving / charging / sentry
// / lights / hazards / open-doors / frunk / trunk when engaged) and the vehicle label, or a friendly empty
// state when the fleet has no vehicle. All data flows through the shared [DigitalTwinWidgetViewModel]
// (P1/S8); the view never performs HTTP. Every string resolves through the i18n catalog (P1/S10), the twin
// carries a folded TalkBack summary, and the refresh control is labelled.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DigitalTwinWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.digitaltwin

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
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
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

private val TWIN_HEIGHT_COMPACT: Dp = 168.dp
private val TWIN_HEIGHT_EXPANDED: Dp = 210.dp
private val LOADING_TITLE_HEIGHT: Dp = 14.dp
private val LOADING_BADGE_HEIGHT: Dp = 20.dp
private const val LOADING_TITLE_FRACTION: Float = 0.4f
private const val LOADING_BADGE_FRACTION: Float = 0.7f

private val DEFAULT_BODY_PAINT: Color = Color(0xFF3A4250)

/**
 * Stateful entry point. Binds the shared vehicles + state + security + charging feeds via [source] into a
 * [DigitalTwinWidgetViewModel], resolves the localized [DigitalTwinStrings] from the catalog (P1/S10),
 * records the one-shot `view.opened` diagnostic, and renders the surface for the given [size]. A dashboard
 * host supplies [source] (an adapter over the shared S8 data layer) and a unique [instanceKey] per
 * placement; an explicit [vehicleId] pins the surface to one vehicle (web `WidgetProps.vehicleId`),
 * otherwise the first enrolled vehicle is used.
 */
@Composable
fun DigitalTwinWidget(
    source: DigitalTwinSource,
    modifier: Modifier = Modifier,
    size: DigitalTwinSize = DigitalTwinRegistration.DEFAULT_SIZE,
    vehicleId: Long? = null,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = DigitalTwinRegistration.ID,
) {
    val viewModel: DigitalTwinWidgetViewModel =
        viewModel(key = instanceKey, factory = DigitalTwinWidgetViewModel.factory(source, logger, vehicleId))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    DigitalTwinWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuit (a first load → full skeleton) and otherwise the Monitor title + freshness
 * header over the twin + badges, or the "No vehicle data" empty state. The web widget does not pass
 * `WidgetShell`'s `error` prop, so a hard failure is surfaced honestly through the header freshness chip
 * (offline) + the refresh control — never a blanked panel — and a stale (non-error) snapshot auto-refreshes,
 * mirroring the web freshness contract. [size] selects the compact vs larger twin render (web `size`).
 */
@Composable
fun DigitalTwinWidgetContent(
    state: UiState<DigitalTwinData>,
    size: DigitalTwinSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberDigitalTwinStrings()

    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Md) {
        when {
            state.isLoading -> DigitalTwinLoading(label = stringResource(R.string.translation_common_loading))
            else -> DigitalTwinLoaded(state = state, size = size, strings = strings, onRefresh = onRefresh)
        }
    }
}

@Composable
private fun DigitalTwinLoaded(
    state: UiState<DigitalTwinData>,
    size: DigitalTwinSize,
    strings: DigitalTwinStrings,
    onRefresh: () -> Unit,
) {
    val display =
        remember(state.data, strings) {
            DigitalTwinProjection.project(state.data ?: DigitalTwinData.EMPTY, strings)
        }
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        DigitalTwinHeader(title = strings.title, state = state, onRefresh = onRefresh)
        when {
            !display.hasVehicle -> DigitalTwinEmpty(message = strings.noVehicle)
            else -> DigitalTwinBody(display = display, size = size)
        }
    }
}

@Composable
private fun DigitalTwinHeader(
    title: String,
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = MonitorGlyph,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.primary,
        )
        PanelTitle(title, modifier = Modifier.weight(1f).semantics { heading() })
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = false,
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
private fun DigitalTwinBody(
    display: DigitalTwinDisplay,
    size: DigitalTwinSize,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        TwinVisual(
            twin = display.twin,
            exteriorColor = display.exteriorColor,
            height = if (size.isExpanded) TWIN_HEIGHT_EXPANDED else TWIN_HEIGHT_COMPACT,
            contentDescription = display.twinContentDescription,
        )
        TwinBadgeRow(badges = display.badges)
        if (display.vehicleLabel.isNotEmpty()) {
            BodyText(display.vehicleLabel, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
    }
}

@Composable
private fun TwinVisual(
    twin: VehicleTwinState,
    exteriorColor: String?,
    height: Dp,
    contentDescription: String,
) {
    val palette = rememberTwinPalette(exteriorColor)
    Canvas(
        modifier =
            Modifier
                .fillMaxWidth()
                .height(height)
                .clearAndSetSemantics { this.contentDescription = contentDescription },
    ) {
        drawTwin(twin, palette)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TwinBadgeRow(badges: List<TwinBadge>) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterHorizontally),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        badges.forEach { badge ->
            Badge(text = badge.text, variant = badgeVariant(badge.tone), dot = badge.dot)
        }
    }
}

@Composable
private fun DigitalTwinEmpty(message: String) {
    EmptyState(
        message = message,
        icon = MonitorGlyph,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun DigitalTwinLoading(label: String) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT)
        Skeleton(height = TWIN_HEIGHT_COMPACT, rounded = true)
        Skeleton(widthFraction = LOADING_BADGE_FRACTION, height = LOADING_BADGE_HEIGHT, rounded = true)
    }
}

/** Maps a pure [TwinBadgeTone] onto the shared [BadgeVariant] (web `info`/`success`/`warning`/`danger`/`neutral`). */
private fun badgeVariant(tone: TwinBadgeTone): BadgeVariant =
    when (tone) {
        TwinBadgeTone.Info -> BadgeVariant.Info
        TwinBadgeTone.Success -> BadgeVariant.Success
        TwinBadgeTone.Warning -> BadgeVariant.Warning
        TwinBadgeTone.Danger -> BadgeVariant.Danger
        TwinBadgeTone.Neutral -> BadgeVariant.Neutral
    }

// ── twin canvas (native top-down counterpart of the web SVG `VehicleTwin`) ──────────────────────────────

/** Resolved (theme- + paint-derived) colours the [drawTwin] schematic uses; built at the render boundary. */
private data class TwinPalette(
    val body: Color,
    val bodyStroke: Color,
    val cabin: Color,
    val glassClosed: Color,
    val glassOpen: Color,
    val glassPartial: Color,
    val glassUnknown: Color,
    val doorClosed: Color,
    val doorOpen: Color,
    val doorUnknown: Color,
    val headlightOn: Color,
    val headlightOff: Color,
    val charge: Color,
    val sentry: Color,
    val wheel: Color,
)

@Composable
private fun rememberTwinPalette(exteriorColor: String?): TwinPalette {
    val scheme = MaterialTheme.colorScheme
    val warning = TeslaTokens.status.warning
    val success = TeslaTokens.status.success
    val danger = TeslaTokens.status.danger
    val body = resolvePaint(exteriorColor)
    return remember(exteriorColor, scheme.surfaceVariant, scheme.onSurface, warning, success, danger) {
        TwinPalette(
            body = body,
            bodyStroke = body.copy(alpha = 0.65f),
            cabin = scheme.surfaceVariant.copy(alpha = 0.55f),
            glassClosed = Color(0xFF2A3A52),
            glassOpen = Color(0xFF0B1018),
            glassPartial = warning.copy(alpha = 0.55f),
            glassUnknown = scheme.onSurface.copy(alpha = 0.18f),
            doorClosed = scheme.onSurface.copy(alpha = 0.22f),
            doorOpen = warning,
            doorUnknown = scheme.onSurface.copy(alpha = 0.28f),
            headlightOn = Color(0xFFFFF6C2),
            headlightOff = scheme.onSurface.copy(alpha = 0.20f),
            charge = success,
            sentry = danger,
            wheel = scheme.onSurface.copy(alpha = 0.55f),
        )
    }
}

private fun resolvePaint(code: String?): Color {
    val c = code?.lowercase()?.trim().orEmpty()
    return when {
        c.isEmpty() -> DEFAULT_BODY_PAINT
        containsAny(c, "white", "pearl") -> Color(0xFFE6E8EC)
        containsAny(c, "black", "solid") -> Color(0xFF202329)
        containsAny(c, "blue", "deep") -> Color(0xFF2C5C9C)
        c.contains("red") -> Color(0xFFB23A3A)
        containsAny(c, "silver", "quicksilver") -> Color(0xFFB6BCC4)
        containsAny(c, "grey", "gray", "midnight", "stealth") -> Color(0xFF464B54)
        c.contains("green") -> Color(0xFF3C6E57)
        else -> DEFAULT_BODY_PAINT
    }
}

private fun containsAny(
    source: String,
    vararg tokens: String,
): Boolean = tokens.any { source.contains(it) }

private fun DrawScope.drawTwin(
    twin: VehicleTwinState,
    palette: TwinPalette,
) {
    if (twin.sentryMode == true) drawSentryRing(palette.sentry)
    drawWheels(palette.wheel)
    drawBody(palette)
    drawOpenings(twin, palette)
    drawDoors(twin.doors, palette)
    drawWindows(twin, palette)
    drawHeadlights(on = twin.headlights == true, palette = palette)
    drawChargePort(open = twin.chargePortOpen == true || twin.isCharging, palette = palette)
}

private fun DrawScope.drawSentryRing(color: Color) {
    val w = size.width
    val h = size.height
    drawRoundRect(
        color = color.copy(alpha = 0.5f),
        topLeft = Offset(w * 0.255f, h * 0.02f),
        size = Size(w * 0.49f, h * 0.96f),
        cornerRadius = CornerRadius(w * 0.14f, w * 0.14f),
        style = Stroke(width = w * 0.018f),
    )
}

private fun DrawScope.drawWheels(color: Color) {
    val w = size.width
    val h = size.height
    val wheelW = w * 0.06f
    val wheelH = h * 0.11f
    val corner = CornerRadius(wheelW * 0.5f, wheelW * 0.5f)
    val xs = listOf(w * 0.255f, w * 0.685f)
    val ys = listOf(h * 0.20f, h * 0.69f)
    for (x in xs) {
        for (y in ys) {
            drawRoundRect(
                color = color,
                topLeft = Offset(x, y),
                size = Size(wheelW, wheelH),
                cornerRadius = corner,
            )
        }
    }
}

private fun DrawScope.drawBody(palette: TwinPalette) {
    val w = size.width
    val h = size.height
    drawRoundRect(
        color = palette.body,
        topLeft = Offset(w * 0.30f, h * 0.06f),
        size = Size(w * 0.40f, h * 0.88f),
        cornerRadius = CornerRadius(w * 0.12f, h * 0.07f),
    )
    drawRoundRect(
        color = palette.bodyStroke,
        topLeft = Offset(w * 0.30f, h * 0.06f),
        size = Size(w * 0.40f, h * 0.88f),
        cornerRadius = CornerRadius(w * 0.12f, h * 0.07f),
        style = Stroke(width = w * 0.008f),
    )
    drawRoundRect(
        color = palette.cabin,
        topLeft = Offset(w * 0.345f, h * 0.30f),
        size = Size(w * 0.31f, h * 0.42f),
        cornerRadius = CornerRadius(w * 0.06f, h * 0.05f),
    )
}

private fun DrawScope.drawOpenings(
    twin: VehicleTwinState,
    palette: TwinPalette,
) {
    val w = size.width
    val h = size.height
    drawOpening(
        rect = Rect(Offset(w * 0.37f, h * 0.085f), Size(w * 0.26f, h * 0.07f)),
        open = twin.frunkOpen == true,
        palette = palette,
    )
    drawOpening(
        rect = Rect(Offset(w * 0.37f, h * 0.845f), Size(w * 0.26f, h * 0.07f)),
        open = twin.trunkOpen == true,
        palette = palette,
    )
}

private fun DrawScope.drawOpening(
    rect: Rect,
    open: Boolean,
    palette: TwinPalette,
) {
    val corner = CornerRadius(rect.width * 0.10f, rect.width * 0.10f)
    if (open) {
        drawRoundRect(color = palette.doorOpen.copy(alpha = 0.22f), topLeft = rect.topLeft, size = rect.size, cornerRadius = corner)
    }
    drawRoundRect(
        color = if (open) palette.doorOpen else palette.doorClosed,
        topLeft = rect.topLeft,
        size = rect.size,
        cornerRadius = corner,
        style = Stroke(width = size.width * (if (open) 0.01f else 0.006f)),
    )
}

private fun DrawScope.drawDoors(
    doors: TwinDoors,
    palette: TwinPalette,
) {
    val w = size.width
    val h = size.height
    val panelW = w * 0.05f
    val leftX = w * 0.305f
    val rightX = w * 0.645f
    drawDoorPanel(doors.driverFront, Rect(Offset(leftX, h * 0.345f), Size(panelW, h * 0.145f)), palette)
    drawDoorPanel(doors.driverRear, Rect(Offset(leftX, h * 0.515f), Size(panelW, h * 0.145f)), palette)
    drawDoorPanel(doors.passengerFront, Rect(Offset(rightX, h * 0.345f), Size(panelW, h * 0.145f)), palette)
    drawDoorPanel(doors.passengerRear, Rect(Offset(rightX, h * 0.515f), Size(panelW, h * 0.145f)), palette)
}

private fun DrawScope.drawDoorPanel(
    open: Boolean?,
    rect: Rect,
    palette: TwinPalette,
) {
    val corner = CornerRadius(rect.width * 0.4f, rect.width * 0.4f)
    when (open) {
        true -> drawRoundRect(color = palette.doorOpen, topLeft = rect.topLeft, size = rect.size, cornerRadius = corner)
        false -> drawRoundRect(color = palette.doorClosed, topLeft = rect.topLeft, size = rect.size, cornerRadius = corner)
        null ->
            drawRoundRect(
                color = palette.doorUnknown,
                topLeft = rect.topLeft,
                size = rect.size,
                cornerRadius = corner,
                style = Stroke(width = size.width * 0.006f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 6f))),
            )
    }
}

private fun DrawScope.drawWindows(
    twin: VehicleTwinState,
    palette: TwinPalette,
) {
    val w = size.width
    val h = size.height
    val cellW = w * 0.085f
    val cellH = h * 0.12f
    val leftX = w * 0.365f
    val rightX = w * 0.55f
    drawWindowCell(twin.windowFD, Rect(Offset(leftX, h * 0.32f), Size(cellW, cellH)), palette)
    drawWindowCell(twin.windowRD, Rect(Offset(leftX, h * 0.58f), Size(cellW, cellH)), palette)
    drawWindowCell(twin.windowFP, Rect(Offset(rightX, h * 0.32f), Size(cellW, cellH)), palette)
    drawWindowCell(twin.windowRP, Rect(Offset(rightX, h * 0.58f), Size(cellW, cellH)), palette)
}

private fun DrawScope.drawWindowCell(
    state: WindowOpenState,
    rect: Rect,
    palette: TwinPalette,
) {
    drawRoundRect(
        color = windowFill(state, palette),
        topLeft = rect.topLeft,
        size = rect.size,
        cornerRadius = CornerRadius(rect.width * 0.2f, rect.width * 0.2f),
    )
}

private fun windowFill(
    state: WindowOpenState,
    palette: TwinPalette,
): Color =
    when (state) {
        WindowOpenState.Closed -> palette.glassClosed
        WindowOpenState.Open -> palette.glassOpen
        WindowOpenState.Partial -> palette.glassPartial
        WindowOpenState.Unknown -> palette.glassUnknown
    }

private fun DrawScope.drawHeadlights(
    on: Boolean,
    palette: TwinPalette,
) {
    val w = size.width
    val h = size.height
    val color = if (on) palette.headlightOn else palette.headlightOff
    val lampW = w * 0.07f
    val lampH = h * 0.035f
    val corner = CornerRadius(lampH * 0.5f, lampH * 0.5f)
    listOf(w * 0.335f, w * 0.595f).forEach { x ->
        drawRoundRect(color = color, topLeft = Offset(x, h * 0.10f), size = Size(lampW, lampH), cornerRadius = corner)
    }
}

private fun DrawScope.drawChargePort(
    open: Boolean,
    palette: TwinPalette,
) {
    val w = size.width
    val h = size.height
    val color = if (open) palette.charge else palette.doorClosed
    drawCircle(color = color, radius = w * 0.022f, center = Offset(w * 0.305f, h * 0.71f))
}

// ── strings + glyph ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Resolves the localized [DigitalTwinStrings] from the i18n catalog (P1/S10) — the sixteen `widget.*` keys
 * the web component reads via `t('widget.…')`. Remembered against the resolved strings so a locale change
 * re-projects the surface.
 */
@Composable
private fun rememberDigitalTwinStrings(): DigitalTwinStrings {
    val title = stringResource(R.string.translation_widget_digitalTwin)
    val lockUnknown = stringResource(R.string.translation_widget_lockUnknown)
    val locked = stringResource(R.string.translation_widget_locked)
    val unlocked = stringResource(R.string.translation_widget_unlocked)
    val windowsUnknown = stringResource(R.string.translation_widget_windowsUnknown)
    val windowsClosed = stringResource(R.string.translation_widget_windowsClosed)
    val windowsOpen = stringResource(R.string.translation_widget_windowsOpen)
    val driving = stringResource(R.string.translation_widget_driving)
    val charging = stringResource(R.string.translation_widget_charging)
    val sentryOn = stringResource(R.string.translation_widget_sentryOn)
    val headlightsOn = stringResource(R.string.translation_widget_headlightsOn)
    val hazardsOn = stringResource(R.string.translation_widget_hazardsOn)
    val doorsOpen = stringResource(R.string.translation_widget_doorsOpen)
    val frunkOpen = stringResource(R.string.translation_widget_frunkOpen)
    val trunkOpen = stringResource(R.string.translation_widget_trunkOpen)
    val noVehicle = stringResource(R.string.translation_widget_noVehicle)
    return remember(
        title,
        lockUnknown,
        locked,
        unlocked,
        windowsUnknown,
        windowsClosed,
        windowsOpen,
        driving,
        charging,
        sentryOn,
        headlightsOn,
        hazardsOn,
        doorsOpen,
        frunkOpen,
        trunkOpen,
        noVehicle,
    ) {
        DigitalTwinStrings(
            title = title,
            lockUnknown = lockUnknown,
            locked = locked,
            unlocked = unlocked,
            windowsUnknown = windowsUnknown,
            windowsClosed = windowsClosed,
            windowsOpen = windowsOpen,
            driving = driving,
            charging = charging,
            sentryOn = sentryOn,
            headlightsOn = headlightsOn,
            hazardsOn = hazardsOn,
            doorsOpen = doorsOpen,
            frunkOpen = frunkOpen,
            trunkOpen = trunkOpen,
            noVehicle = noVehicle,
        )
    }
}

/** Local Monitor (screen) glyph — the native stand-in for the web `lucide-react` `Monitor` title icon. */
private val MonitorGlyph: ImageVector =
    ImageVector
        .Builder(
            name = "Monitor",
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
                pathBuilder = monitorPath(),
            )
        }.build()

private fun monitorPath(): PathBuilder.() -> Unit =
    {
        moveTo(3f, 4f)
        lineTo(21f, 4f)
        lineTo(21f, 15f)
        lineTo(3f, 15f)
        close()
        moveTo(8f, 20f)
        lineTo(16f, 20f)
        moveTo(12f, 15f)
        lineTo(12f, 20f)
    }

// ── previews ────────────────────────────────────────────────────────────────────────────────────────────

@Preview(name = "DigitalTwin — content", showBackground = true)
@Composable
private fun DigitalTwinContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DigitalTwinWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewData(), fetchedAt = PREVIEW_NOW),
            size = DigitalTwinRegistration.DEFAULT_SIZE,
            onRefresh = {},
        )
    }
}

@Preview(name = "DigitalTwin — empty", showBackground = true)
@Composable
private fun DigitalTwinEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DigitalTwinWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = DigitalTwinData.EMPTY, fetchedAt = PREVIEW_NOW),
            size = DigitalTwinRegistration.DEFAULT_SIZE,
            onRefresh = {},
        )
    }
}

private const val PREVIEW_NOW = 1_780_000_000_000L

private fun previewData(): DigitalTwinData =
    DigitalTwinData(
        vehicle = TwinVehicle(id = 1, label = "Sparky", exteriorColor = "Deep Blue"),
        twin =
            VehicleTwinState.EMPTY.copy(
                doors =
                    TwinDoors(
                        driverFront = true,
                        passengerFront = false,
                        driverRear = false,
                        passengerRear = false,
                        trunkFront = false,
                        trunkRear = true,
                    ),
                windowFD = WindowOpenState.Open,
                windowFP = WindowOpenState.Closed,
                windowRD = WindowOpenState.Closed,
                windowRP = WindowOpenState.Closed,
                trunkOpen = true,
                isCharging = true,
                chargePortOpen = true,
                locked = true,
                sentryMode = true,
                headlights = true,
            ),
    )
