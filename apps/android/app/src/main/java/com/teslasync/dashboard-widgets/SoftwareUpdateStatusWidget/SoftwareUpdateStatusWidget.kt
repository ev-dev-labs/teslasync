// The native Jetpack Compose + Material 3 Software Update Status dashboard surface — a parity port of
// web/src/features/dashboard/widgets/SoftwareUpdateStatusWidget.tsx. It mirrors the web `WidgetShell`
// (a skeleton while the first load is in flight, otherwise a device-iconed title + freshness header)
// wrapping either the compact tile (icon + version + status chip) or the full layout (current-version row +
// status chip + the update block with download/install progress bars, ready row, estimated-time and
// scheduled-start detail rows, and the "Up to date" footer), or a friendly empty state when no vehicle
// state is decoded. All data flows through the shared [SoftwareUpdateStatusWidgetViewModel] (P1/S8); the
// view never performs HTTP. The web widget does not pass `WidgetShell`'s `error` prop, so a hard failure is
// surfaced honestly through the header freshness chip (offline) + the refresh control (the retry
// affordance) above the empty body, and a stale/offline cached snapshot keeps its rows visible with the
// freshness chip flagged. Every string resolves through the i18n catalog (P1/S10) and every interactive
// element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SoftwareUpdateStatusWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.softwareupdatestatus

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
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
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.MetricBar
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** The progress bar maximum (web `max={100}`). */
private const val PROGRESS_MAX = 100.0

/**
 * Stateful entry point. Binds the shared vehicles + vehicle-state + latest-config feeds via [source] into a
 * [SoftwareUpdateStatusWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders the
 * surface. A dashboard host supplies [source] (an adapter over the shared S8 vehicles data layer) and a
 * unique [instanceKey] per placement; an explicit [vehicleId] pins the surface to one vehicle (web
 * `WidgetProps.vehicleId`), otherwise the first enrolled vehicle is used. [size] is the host-assigned grid
 * footprint (web `WidgetProps.size`).
 */
@Composable
fun SoftwareUpdateStatusWidget(
    source: SoftwareUpdateStatusSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: SoftwareUpdateStatusSize = SoftwareUpdateStatusRegistration.DEFAULT_SIZE,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = SoftwareUpdateStatusRegistration.ID,
) {
    val viewModel: SoftwareUpdateStatusWidgetViewModel =
        viewModel(key = instanceKey, factory = SoftwareUpdateStatusWidgetViewModel.factory(source, logger, vehicleId))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    SoftwareUpdateStatusWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuit (a first load → full skeleton) and otherwise the device-iconed title +
 * freshness header over the compact tile / full update layout, or the empty state.
 */
@Composable
fun SoftwareUpdateStatusWidgetContent(
    state: UiState<SoftwareUpdateSnapshot>,
    modifier: Modifier = Modifier,
    size: SoftwareUpdateStatusSize = SoftwareUpdateStatusRegistration.DEFAULT_SIZE,
    onRefresh: () -> Unit = {},
) {
    when {
        state.isLoading -> SoftwareUpdateLoading(compact = size.isCompact, modifier = modifier)
        else -> SoftwareUpdateLoaded(state = state, size = size, onRefresh = onRefresh, modifier = modifier)
    }
}

@Composable
private fun SoftwareUpdateLoaded(
    state: UiState<SoftwareUpdateSnapshot>,
    size: SoftwareUpdateStatusSize,
    onRefresh: () -> Unit,
    modifier: Modifier,
) {
    val snapshot = state.data ?: SoftwareUpdateSnapshot.EMPTY
    val display = remember(snapshot, size) { SoftwareUpdateProjection.project(snapshot, size) }
    Column(modifier = modifier.fillMaxSize()) {
        SoftwareUpdateHeader(
            title = if (size.isCompact) null else stringResource(R.string.translation_widget_softwareUpdate),
            state = state,
            onRefresh = onRefresh,
        )
        when {
            !display.hasState -> SoftwareUpdateEmpty(Modifier.fillMaxWidth())
            display.isCompact -> FadeIn(modifier = Modifier.fillMaxSize()) { SoftwareUpdateCompactBody(display) }
            else -> FadeIn(modifier = Modifier.fillMaxSize()) { SoftwareUpdateFullBody(display) }
        }
    }
}

@Composable
private fun SoftwareUpdateHeader(
    title: String?,
    state: UiState<*>,
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
        if (title != null) {
            Icon(
                imageVector = SoftwareMonitorGlyph,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.info,
            )
            PanelTitle(title, modifier = Modifier.weight(1f).semantics { heading() })
        } else {
            Spacer(modifier = Modifier.weight(1f))
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = title == null,
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

// ── Compact (1×1) tile ───────────────────────────────────────────────────────────────────────────────

@Composable
private fun SoftwareUpdateCompactBody(display: SoftwareUpdateDisplay) {
    Column(
        modifier = Modifier.fillMaxSize().padding(Spacing.md),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
    ) {
        Icon(
            imageVector = SoftwareMonitorGlyph,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.info,
        )
        BodyText(display.currentVersionText, maxLines = 1)
        SoftwareUpdateStatusChip(display.status)
    }
}

// ── Full (2×1+) layout ─────────────────────────────────────────────────────────────────────────────────

@Composable
private fun SoftwareUpdateFullBody(display: SoftwareUpdateDisplay) {
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Spacing.md, vertical = Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        SoftwareUpdateCurrentVersionRow(display)
        if (display.showUpdateSection) {
            SoftwareUpdateSection(display)
        }
        if (display.showUpToDate) {
            SoftwareUpdateStatusLine(
                label = stringResource(R.string.translation_widget_softwareUpdate_upToDate),
                tint = TeslaTokens.status.success,
            )
        }
    }
}

@Composable
private fun SoftwareUpdateCurrentVersionRow(display: SoftwareUpdateDisplay) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) {
                    contentDescription = display.currentVersionText
                },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            MetricLabel(stringResource(R.string.translation_widget_softwareUpdate_currentVersion))
            BodyText(display.currentVersionText, maxLines = 1)
        }
        SoftwareUpdateStatusChip(display.status)
    }
}

@Composable
private fun SoftwareUpdateSection(display: SoftwareUpdateDisplay) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(
                imageVector = FeedbackGlyphs.Download,
                contentDescription = null,
                size = IconSize.Xs,
                tint = TeslaTokens.status.info,
            )
            Caption(stringResource(R.string.translation_widget_softwareUpdate_update))
            BodyText(display.updateVersion ?: EM_DASH, maxLines = 1, color = TeslaTokens.status.info)
        }
        if (display.showDownloadBar) {
            MetricBar(
                value = display.downloadPct ?: 0.0,
                max = PROGRESS_MAX,
                label = stringResource(R.string.translation_widget_softwareUpdate_downloading),
                valueText = SoftwareUpdateFormat.percent(display.downloadPct ?: 0.0),
                color = TeslaTokens.status.info,
            )
        }
        if (display.showInstallBar) {
            MetricBar(
                value = display.installPct ?: 0.0,
                max = PROGRESS_MAX,
                label = stringResource(R.string.translation_widget_softwareUpdate_installing),
                valueText = SoftwareUpdateFormat.percent(display.installPct ?: 0.0),
                color = MaterialTheme.colorScheme.primary,
            )
        }
        if (display.showReady) {
            SoftwareUpdateStatusLine(
                label = stringResource(R.string.translation_widget_softwareUpdate_readyToInstall),
                tint = TeslaTokens.status.success,
            )
        }
        if (display.showExpectedDuration || display.showScheduled) {
            SoftwareUpdateScheduleDetails(display)
        }
    }
}

@Composable
private fun SoftwareUpdateScheduleDetails(display: SoftwareUpdateDisplay) {
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    if (display.showExpectedDuration) {
        val estTime = stringResource(R.string.translation_widget_softwareUpdate_estTime)
        val minutes = stringResource(R.string.translation_widget_softwareUpdate_min)
        val durationText = SoftwareUpdateFormat.duration(display.expectedDuration ?: 0.0)
        SoftwareUpdateDetailRow("$estTime: ~$durationText $minutes")
    }
    if (display.showScheduled) {
        val scheduled = stringResource(R.string.translation_widget_softwareUpdate_scheduled)
        SoftwareUpdateDetailRow("$scheduled: ${display.scheduledStart.orEmpty()}")
    }
}

@Composable
private fun SoftwareUpdateDetailRow(text: String) {
    Row(
        modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = text },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = DataDisplayGlyphs.Clock,
            contentDescription = null,
            size = IconSize.Xs,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Caption(text)
    }
}

@Composable
private fun SoftwareUpdateStatusLine(
    label: String,
    tint: Color,
) {
    Row(
        modifier = Modifier.fillMaxWidth().semantics(mergeDescendants = true) { contentDescription = label },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = DataDisplayGlyphs.CheckCircle,
            contentDescription = null,
            size = IconSize.Xs,
            tint = tint,
        )
        BodyText(label, color = tint, maxLines = 1)
    }
}

@Composable
private fun SoftwareUpdateStatusChip(status: UpdateStatus) {
    Badge(text = statusLabel(status), variant = statusVariant(status), dot = true)
}

@Composable
private fun SoftwareUpdateEmpty(modifier: Modifier) {
    EmptyState(
        message = stringResource(R.string.translation_widget_softwareUpdate_noData),
        icon = SoftwareMonitorGlyph,
        modifier = modifier,
    )
}

@Composable
private fun SoftwareUpdateLoading(
    compact: Boolean,
    modifier: Modifier,
) {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = SKELETON_TITLE_HEIGHT)
        Skeleton(height = SKELETON_BAR_HEIGHT, rounded = true)
        if (!compact) {
            Skeleton(widthFraction = SKELETON_LABEL_FRACTION, height = SKELETON_BAR_HEIGHT, rounded = true)
            Skeleton(height = SKELETON_BAR_HEIGHT, rounded = true)
        }
    }
}

// ── Status chip mapping (web StatusBadgeSmall config) ────────────────────────────────────────────────

@Composable
private fun statusLabel(status: UpdateStatus): String =
    stringResource(
        when (status) {
            UpdateStatus.UpToDate -> R.string.translation_widget_softwareUpdate_statusUpToDate
            UpdateStatus.Available -> R.string.translation_widget_softwareUpdate_statusAvailable
            UpdateStatus.Downloading -> R.string.translation_widget_softwareUpdate_statusDownloading
            UpdateStatus.Ready -> R.string.translation_widget_softwareUpdate_statusReady
            UpdateStatus.Installing -> R.string.translation_widget_softwareUpdate_statusInstalling
            UpdateStatus.Installed -> R.string.translation_widget_softwareUpdate_statusInstalled
        },
    )

private fun statusVariant(status: UpdateStatus): BadgeVariant =
    when (status) {
        UpdateStatus.UpToDate -> BadgeVariant.Success
        UpdateStatus.Available -> BadgeVariant.Info
        UpdateStatus.Downloading -> BadgeVariant.Warning
        UpdateStatus.Ready -> BadgeVariant.Info
        UpdateStatus.Installing -> BadgeVariant.Warning
        UpdateStatus.Installed -> BadgeVariant.Success
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

// ── Local glyph — the web `MonitorSmartphone` (lucide), authored as a 24×24 stroked vector. The
// data-display layer ships no monitor/device glyph and this surface's allowed files cannot extend that
// catalog, so the device icon is hand-authored here, mirroring the approach in the sibling
// ClimateStatusWidget's thermometer. ──

private fun softwareStroked(
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

private val SoftwareMonitorGlyph: ImageVector =
    softwareStroked("SoftwareMonitor") {
        // Monitor screen — a rounded rectangle outline.
        moveTo(3f, 4f)
        lineTo(21f, 4f)
        lineTo(21f, 16f)
        lineTo(3f, 16f)
        close()
        // Stand — a short column down to a base bar.
        moveTo(12f, 16f)
        lineTo(12f, 20f)
        moveTo(8f, 20f)
        lineTo(16f, 20f)
    }

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
private const val SKELETON_TITLE_FRACTION = 0.5f
private const val SKELETON_LABEL_FRACTION = 0.6f
private val SKELETON_TITLE_HEIGHT = 14.dp
private val SKELETON_BAR_HEIGHT = 16.dp

// ── Previews — one per rendered state (compact / available / downloading / installing / up-to-date /
// empty / loading / offline). ──

private fun previewSnapshot(
    updateVersion: String? = null,
    downloadPct: Double? = null,
    installPct: Double? = null,
    expectedDuration: Double? = null,
    scheduledStart: String? = null,
): SoftwareUpdateSnapshot =
    SoftwareUpdateSnapshot(
        hasState = true,
        currentVersion = "2024.8.9",
        updateVersion = updateVersion,
        downloadPct = downloadPct,
        installPct = installPct,
        expectedDuration = expectedDuration,
        scheduledStart = scheduledStart,
    )

private fun previewState(snapshot: SoftwareUpdateSnapshot): UiState<SoftwareUpdateSnapshot> =
    UiState(phase = UiPhase.Content, data = snapshot, fetchedAt = 1L)

@Preview(name = "SoftwareUpdate · up to date", showBackground = true)
@Composable
private fun SoftwareUpdateUpToDatePreview() {
    TeslaSyncTheme {
        SoftwareUpdateStatusWidgetContent(state = previewState(previewSnapshot()))
    }
}

@Preview(name = "SoftwareUpdate · downloading", showBackground = true)
@Composable
private fun SoftwareUpdateDownloadingPreview() {
    TeslaSyncTheme {
        SoftwareUpdateStatusWidgetContent(
            state =
                previewState(
                    previewSnapshot(
                        updateVersion = "2024.12.1",
                        downloadPct = 47.0,
                        expectedDuration = 18.0,
                    ),
                ),
        )
    }
}

@Preview(name = "SoftwareUpdate · installing", showBackground = true)
@Composable
private fun SoftwareUpdateInstallingPreview() {
    TeslaSyncTheme {
        SoftwareUpdateStatusWidgetContent(
            state =
                previewState(
                    previewSnapshot(
                        updateVersion = "2024.12.1",
                        downloadPct = 100.0,
                        installPct = 62.0,
                        scheduledStart = "Tonight 2:00 AM",
                    ),
                ),
        )
    }
}

@Preview(name = "SoftwareUpdate · compact", showBackground = true)
@Composable
private fun SoftwareUpdateCompactPreview() {
    TeslaSyncTheme {
        SoftwareUpdateStatusWidgetContent(
            state = previewState(previewSnapshot(updateVersion = "2024.12.1", downloadPct = 100.0)),
            size = SoftwareUpdateStatusSize(cols = 1, rows = 1),
        )
    }
}

@Preview(name = "SoftwareUpdate · empty", showBackground = true)
@Composable
private fun SoftwareUpdateEmptyPreview() {
    TeslaSyncTheme {
        SoftwareUpdateStatusWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = SoftwareUpdateSnapshot.EMPTY, fetchedAt = 1L),
        )
    }
}

@Preview(name = "SoftwareUpdate · loading", showBackground = true)
@Composable
private fun SoftwareUpdateLoadingPreview() {
    TeslaSyncTheme {
        SoftwareUpdateStatusWidgetContent(state = UiState.loading())
    }
}

@Preview(name = "SoftwareUpdate · offline (cached)", showBackground = true)
@Composable
private fun SoftwareUpdateOfflinePreview() {
    TeslaSyncTheme {
        SoftwareUpdateStatusWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewSnapshot(updateVersion = "2024.12.1", downloadPct = 100.0),
                    fetchedAt = 1L,
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
        )
    }
}
