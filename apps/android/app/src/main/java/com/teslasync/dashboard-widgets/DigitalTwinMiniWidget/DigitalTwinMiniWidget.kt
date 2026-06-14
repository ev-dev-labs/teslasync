// The native Jetpack Compose + Material 3 Digital Twin Mini dashboard surface — a parity port of
// web/src/features/dashboard/widgets/DigitalTwinMiniWidget.tsx. It mirrors the web `WidgetShell`
// (a full skeleton while the first load is in flight, otherwise a monitor-iconed title + freshness
// header with an "Open" link to the full digital twin) wrapping the web body: the shared `VehicleTwin`
// illustration drawn at the small footprint over the merged physical state, plus the lock + sentry status
// badges (shown unless the footprint is very cramped), or a friendly empty state when no vehicle is
// enrolled. All data flows through the shared [DigitalTwinMiniWidgetViewModel] (P1/S8); the view never
// performs HTTP. The twin canvas is the shared `components/vehicles` surface (DRY — the same illustration
// the full Digital Twin page draws). Every string resolves through the i18n catalog (P1/S10), and the
// illustration + badge row each carry a merged TalkBack description.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DigitalTwinMiniWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.digitaltwinmini

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.vehicletwin.VehicleTwinCanvas
import io.teslasync.android.sharedsurfaces.vehicletwin.VehicleTwinLabels
import io.teslasync.android.sharedsurfaces.vehicletwin.VehicleTwinSize
import io.teslasync.android.sharedsurfaces.vehicletwin.VehicleTwinStrings
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import kotlin.time.Instant

/** The 24×24 stroked-vector authoring constants for the local lucide glyphs (web `Monitor` / `ArrowUpRight` / `Unlock`). */
private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f

/** Loading skeleton + twin sizing. */
private val LOADING_BAR_HEIGHT = 14.dp
private val LOADING_TWIN_HEIGHT = 96.dp
private const val LOADING_TITLE_FRACTION = 0.45f
private val BADGE_MIN_HEIGHT = 24.dp
private const val BADGE_WASH_ALPHA = 0.16f
private const val BADGE_BORDER_ALPHA = 0.30f
private val BADGE_BORDER_WIDTH = 1.dp

/**
 * Stateful entry point — the parity port of the web `<DigitalTwinMiniWidget />`. Binds the shared
 * vehicles + state / security / charging feeds via [source] into a [DigitalTwinMiniWidgetViewModel],
 * resolves the localized strings (P1/S10), records the one-shot `view.opened` diagnostic, and renders the
 * surface at the configured [size]. A dashboard host supplies [source] (an adapter over the shared S7/S8
 * Vehicles data layer), an optional [vehicleId] (web `WidgetProps.vehicleId`), the grid [size] (web
 * `WidgetProps.size`), the [onOpen] navigation callback (web `<Link to="/digital-twin">`, hoisted to the
 * host so the view performs no navigation itself), and a unique [instanceKey] per placement.
 */
@Composable
fun DigitalTwinMiniWidget(
    source: DigitalTwinMiniSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: DigitalTwinMiniSize = DigitalTwinMiniRegistration.DEFAULT_SIZE,
    onOpen: () -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = DigitalTwinMiniRegistration.ID,
) {
    val viewModel: DigitalTwinMiniWidgetViewModel =
        viewModel(key = instanceKey, factory = DigitalTwinMiniWidgetViewModel.factory(source, logger, vehicleId))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    DigitalTwinMiniWidgetContent(
        state = state,
        strings = rememberDigitalTwinMiniStrings(),
        twinStrings = rememberTwinCanvasStrings(),
        size = size,
        onRefresh = viewModel::refresh,
        onOpen = onOpen,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. Reproduces the
 * web `WidgetShell` short-circuit (a first load → full skeleton) and otherwise the monitor title +
 * freshness + "Open" header over the twin illustration + status badges, the empty state, or — when no
 * vehicle is resolvable because the fleet feed hard-failed — a retry surface (the prompt's required error
 * state, mirroring the sibling hero card). A failed state refresh while a vehicle is enrolled keeps the
 * twin visible with the freshness chip flagged (web never passes `WidgetShell`'s blocking `error` prop),
 * and stale (non-error) data auto-refreshes once.
 */
@Composable
fun DigitalTwinMiniWidgetContent(
    state: UiState<DigitalTwinMiniData>,
    strings: DigitalTwinMiniStrings,
    twinStrings: VehicleTwinStrings,
    modifier: Modifier = Modifier,
    size: DigitalTwinMiniSize = DigitalTwinMiniRegistration.DEFAULT_SIZE,
    onRefresh: () -> Unit = {},
    onOpen: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    when {
        state.isLoading -> DigitalTwinMiniLoading(modifier)
        state.isError -> DigitalTwinMiniError(strings.digitalTwin, onRefresh, modifier)
        else -> DigitalTwinMiniLoaded(state, strings, twinStrings, size, onRefresh, onOpen, modifier)
    }
}

@Composable
private fun DigitalTwinMiniLoaded(
    state: UiState<DigitalTwinMiniData>,
    strings: DigitalTwinMiniStrings,
    twinStrings: VehicleTwinStrings,
    size: DigitalTwinMiniSize,
    onRefresh: () -> Unit,
    onOpen: () -> Unit,
    modifier: Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        DigitalTwinMiniHeader(
            state = state,
            title = strings.digitalTwin,
            openLabel = strings.open,
            onRefresh = onRefresh,
            onOpen = onOpen,
        )
        Box(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            contentAlignment = Alignment.Center,
        ) {
            if (state.data?.vehicle != null) {
                DigitalTwinMiniIllustration(data = state.data, strings = strings, twinStrings = twinStrings, size = size)
            } else {
                DigitalTwinMiniEmpty(strings.noVehicle)
            }
        }
    }
}

@Composable
private fun DigitalTwinMiniHeader(
    state: UiState<*>,
    title: String,
    openLabel: String,
    onRefresh: () -> Unit,
    onOpen: () -> Unit,
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
            imageVector = DigitalTwinMonitorGlyph,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.info,
        )
        PanelTitle(title, modifier = Modifier.weight(1f).semantics { heading() })
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
        DigitalTwinOpenLink(label = openLabel, onClick = onOpen)
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

/** The "Open" affordance (web `<Link to="/digital-twin">Open <ArrowUpRight/></Link>`); navigation is hoisted to the host. */
@Composable
private fun DigitalTwinOpenLink(
    label: String,
    onClick: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .clip(MaterialTheme.shapes.small)
                .clickable(onClick = onClick)
                .heightIn(min = BADGE_MIN_HEIGHT)
                .padding(horizontal = Spacing.xs)
                .semantics(mergeDescendants = true) { role = Role.Button },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Caption(label)
        Icon(
            imageVector = DigitalTwinArrowUpRightGlyph,
            contentDescription = null,
            size = IconSize.Xs,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** The twin illustration + status badges — the web body when a vehicle is present. */
@Composable
private fun DigitalTwinMiniIllustration(
    data: DigitalTwinMiniData,
    strings: DigitalTwinMiniStrings,
    twinStrings: VehicleTwinStrings,
    size: DigitalTwinMiniSize,
) {
    val display = remember(data, strings) { DigitalTwinMiniProjection.project(data, strings) }
    FadeIn(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            VehicleTwinCanvas(
                paint = display.paint,
                twinState = display.twinState,
                strings = twinStrings,
                size = VehicleTwinSize.Sm,
            )
            if (size.showsBadges) {
                DigitalTwinMiniBadges(display)
            }
        }
    }
}

/** The lock + (optional) sentry status chips — the web `<Badge variant><Icon/>text</Badge>` pair. */
@Composable
private fun DigitalTwinMiniBadges(display: DigitalTwinMiniDisplay) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        TwinStatusChip(
            icon = if (display.lockBadge.unlocked) DigitalTwinUnlockGlyph else DataDisplayGlyphs.Lock,
            text = display.lockBadge.text,
            tone = display.lockBadge.tone,
        )
        display.sentryBadge?.let { sentry ->
            TwinStatusChip(icon = DataDisplayGlyphs.Shield, text = sentry.text, tone = sentry.tone)
        }
    }
}

/**
 * A leading-icon status chip — the shared `Badge` only supports a leading dot, but the web badges carry a
 * meaningful Lock / Unlock / Shield glyph, so this mirrors the shared `Badge` styling (a pill with a
 * low-alpha wash + bordered tone behind tinted icon + label) while keeping the icon.
 */
@Composable
private fun TwinStatusChip(
    icon: ImageVector,
    text: String,
    tone: BadgeTone,
) {
    val color = badgeToneColor(tone)
    Surface(
        shape = RoundedCornerShape(Radius.pill),
        color = color.copy(alpha = BADGE_WASH_ALPHA),
        contentColor = color,
        border = BorderStroke(BADGE_BORDER_WIDTH, color.copy(alpha = BADGE_BORDER_ALPHA)),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(imageVector = icon, contentDescription = null, size = IconSize.Xs, tint = color)
            Caption(text)
        }
    }
}

@Composable
private fun DigitalTwinMiniEmpty(message: String) {
    EmptyState(
        message = message,
        icon = DigitalTwinMonitorGlyph,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun DigitalTwinMiniError(
    title: String,
    onRetry: () -> Unit,
    modifier: Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        DigitalTwinMiniTitleOnlyHeader(title)
        ErrorDisplay(
            message = stringResource(R.string.translation_error_serverError_message),
            title = stringResource(R.string.translation_error_serverError_title),
            onRetry = onRetry,
            retryLabel = stringResource(R.string.translation_common_retry),
            modifier = Modifier.fillMaxWidth().padding(Spacing.sm),
        )
    }
}

@Composable
private fun DigitalTwinMiniTitleOnlyHeader(title: String) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(DigitalTwinMonitorGlyph, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.info)
        PanelTitle(title, modifier = Modifier.semantics { heading() })
    }
}

@Composable
private fun DigitalTwinMiniLoading(modifier: Modifier) {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_BAR_HEIGHT)
        Skeleton(height = LOADING_TWIN_HEIGHT, rounded = true)
        Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_BAR_HEIGHT)
    }
}

/** Per-tone chip foreground — the native mirror of the web `Badge` `variant` → status colour map. */
@Composable
private fun badgeToneColor(tone: BadgeTone): Color =
    when (tone) {
        BadgeTone.Success -> TeslaTokens.status.success
        BadgeTone.Danger -> TeslaTokens.status.danger
        BadgeTone.Info -> TeslaTokens.status.info
        BadgeTone.Neutral -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/**
 * Resolves the localized [DigitalTwinMiniStrings] from the i18n catalog (P1/S10) — the seven `widget.*`
 * keys the web component reads via `t('widget.…')`. Remembered against the resolved strings so a locale
 * change re-projects the surface.
 */
@Composable
private fun rememberDigitalTwinMiniStrings(): DigitalTwinMiniStrings {
    val digitalTwin = stringResource(R.string.translation_widget_digitalTwinMini)
    val open = stringResource(R.string.translation_widget_open)
    val locked = stringResource(R.string.translation_widget_locked)
    val unlocked = stringResource(R.string.translation_widget_unlocked)
    val sentry = stringResource(R.string.translation_widget_sentryOn)
    val off = stringResource(R.string.translation_widget_sentryOff)
    val noVehicle = stringResource(R.string.translation_widget_noVehicle)
    return remember(digitalTwin, open, locked, unlocked, sentry, off, noVehicle) {
        DigitalTwinMiniStrings(
            digitalTwin = digitalTwin,
            open = open,
            locked = locked,
            unlocked = unlocked,
            sentry = sentry,
            off = off,
            noVehicle = noVehicle,
        )
    }
}

/**
 * Builds the localized [VehicleTwinStrings] the shared canvas folds into its accessible summary — the same
 * P1/S10 keys the shared `VehicleTwin` surface resolves, supplied here because its own remember helper is
 * private to that file.
 */
@Composable
private fun rememberTwinCanvasStrings(): VehicleTwinStrings =
    VehicleTwinStrings(
        loadingLabel = stringResource(R.string.translation_common_loading),
        emptyTitle = stringResource(R.string.translation_digitalTwin_title),
        emptyDesc = stringResource(R.string.translation_digitalTwin_noVehicles),
        staleLabel = stringResource(R.string.translation_mqtt_stale),
        offlineLabel = stringResource(R.string.translation_common_offline),
        updatingLabel = stringResource(R.string.translation_freshness_updating),
        errorResource = stringResource(R.string.translation_common_vehicle),
        labels =
            VehicleTwinLabels(
                twinTitle = stringResource(R.string.translation_digitalTwin_subtitle),
                open = stringResource(R.string.translation_common_open),
                closed = stringResource(R.string.translation_common_closed),
                partial = stringResource(R.string.translation_widget_doorWindow_partial),
                unknown = stringResource(R.string.translation_common_unknown),
                locked = stringResource(R.string.translation_digitalTwin_locked),
                unlocked = stringResource(R.string.translation_common_unlocked),
                charging = stringResource(R.string.translation_digitalTwin_charging),
                driving = stringResource(R.string.translation_digitalTwin_driving),
                sentry = stringResource(R.string.translation_digitalTwin_sentryMode),
                headlights = stringResource(R.string.translation_digitalTwin_headlights),
                doors = stringResource(R.string.translation_digitalTwin_doorsTitle),
                windows = stringResource(R.string.translation_digitalTwin_windowsTitle),
            ),
    )

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
                FreshnessAge.Unknown -> "\u2014"
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

// ── Local glyphs — the web lucide icons (Monitor / ArrowUpRight / Unlock), authored as 24×24 stroked
// vectors. The data-display layer ships Lock + Shield (reused above) but not these three, and this
// surface's allowed files cannot extend that catalog, so they are hand-authored here, mirroring the
// sibling SecurityStatusWidget's hand-authored glyphs. ────────────────────────────────────────────────

private fun twinStroked(
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

private val DigitalTwinMonitorGlyph: ImageVector =
    twinStroked("DigitalTwinMonitor") {
        // Screen.
        moveTo(3f, 4f)
        lineTo(21f, 4f)
        lineTo(21f, 16f)
        lineTo(3f, 16f)
        close()
        // Stand neck.
        moveTo(12f, 16f)
        lineTo(12f, 20f)
        // Stand base.
        moveTo(8f, 20f)
        lineTo(16f, 20f)
    }

private val DigitalTwinArrowUpRightGlyph: ImageVector =
    twinStroked("DigitalTwinArrowUpRight") {
        // Diagonal shaft.
        moveTo(7f, 17f)
        lineTo(17f, 7f)
        // Arrow head.
        moveTo(8f, 7f)
        lineTo(17f, 7f)
        lineTo(17f, 16f)
    }

private val DigitalTwinUnlockGlyph: ImageVector =
    twinStroked("DigitalTwinUnlock") {
        // Body of the padlock.
        moveTo(5f, 11f)
        lineTo(19f, 11f)
        lineTo(19f, 20f)
        lineTo(5f, 20f)
        close()
        // Shackle, left post + top arc, open on the right (the unlocked state).
        moveTo(8f, 11f)
        lineTo(8f, 8f)
        curveTo(8f, 5.8f, 9.8f, 4f, 12f, 4f)
        curveTo(14.2f, 4f, 16f, 5.8f, 16f, 8f)
    }

// ── Previews — one per rendered state. ─────────────────────────────────────────────────────────────────

@Preview(name = "Digital Twin Mini — content", showBackground = true)
@Composable
private fun DigitalTwinMiniContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DigitalTwinMiniWidgetContent(
            state = UiState(UiPhase.Content, data = previewData(), fetchedAt = PREVIEW_NOW),
            strings = previewStrings(),
            twinStrings = rememberTwinCanvasStrings(),
        )
    }
}

@Preview(name = "Digital Twin Mini — empty", showBackground = true)
@Composable
private fun DigitalTwinMiniEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DigitalTwinMiniWidgetContent(
            state = UiState(UiPhase.Empty, data = DigitalTwinMiniData(null, null, null, null), fetchedAt = PREVIEW_NOW),
            strings = previewStrings(),
            twinStrings = rememberTwinCanvasStrings(),
        )
    }
}

private const val PREVIEW_NOW = 1_780_000_000_000L

private fun previewStrings(): DigitalTwinMiniStrings =
    DigitalTwinMiniStrings(
        digitalTwin = "Digital Twin",
        open = "Open",
        locked = "Locked",
        unlocked = "Unlocked",
        sentry = "Sentry",
        off = "Off",
        noVehicle = "No vehicle data",
    )

private fun previewData(): DigitalTwinMiniData =
    DigitalTwinMiniData(
        vehicle = previewVehicle(),
        vehicleState = null,
        security = null,
        charging = null,
    )

private fun previewVehicle(): Vehicle =
    Vehicle(
        createdAt = Instant.fromEpochSeconds(0),
        displayName = "Garage Car",
        enrolledAt = Instant.fromEpochSeconds(0),
        id = 1,
        teslaId = 1,
        timezone = "UTC",
        updatedAt = Instant.fromEpochSeconds(0),
        vin = "VIN1",
        color = "DeepBlue",
        model = "Model 3",
    )
