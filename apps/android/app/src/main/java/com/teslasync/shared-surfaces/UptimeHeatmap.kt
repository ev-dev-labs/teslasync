// Native Compose render layer for the UptimeHeatmap shared surface — the parity port of the web rolling
// status grid (web/src/components/status/UptimeHeatmap.tsx). It is a thin, stateless view over the pure
// [UptimeWindow] + [UptimeHeatmapProjection] and the [UptimeHeatmapViewModel]'s feed: it owns no business
// logic, performs no HTTP or persistence, and renders every phase the prompt's state matrix mandates —
// loading (skeleton chrome), content (the squares grid + uptime caption), empty (a friendly empty state
// instead of the web's blank grid), a hard error (a QueryError-equivalent with retry), and the stale/offline
// freshness envelope (a chip + the `aria-live` announcement).
//
// Each day is a colored square (web `h-3 w-3 rounded-sm`); tapping it reveals the day's date, status, and
// optional summary in a [Popover] (the native analogue of the web `Tooltip`), and every square carries the
// web `aria-label={`${date}: ${label}`}` as its accessibility label. The squares wrap with [FlowRow] (web
// `flex flex-wrap gap-1`), oldest first.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/UptimeHeatmap) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.uptimeheatmap

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Popover
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import java.util.Locale

/** Test tag on the surface root so on-device UI tests can locate the rendered panel in any state. */
const val UPTIME_HEATMAP_TEST_TAG: String = "uptime-heatmap"

/** Test tag on the squares grid so UI tests can assert the content phase rendered its days. */
const val UPTIME_HEATMAP_GRID_TEST_TAG: String = "uptime-heatmap-grid"

private val SQUARE_SIZE: Dp = 12.dp
private val SQUARE_GAP: Dp = 4.dp
private val GRID_SKELETON_HEIGHT: Dp = 14.dp
private const val TITLE_SKELETON_FRACTION: Float = 0.45f
private const val GRID_SKELETON_FRACTION: Float = 0.9f
private const val COLORED_SQUARE_ALPHA: Float = 0.85f
private const val UNKNOWN_SQUARE_ALPHA: Float = 0.40f
private const val PREVIEW_STAMP: Long = 1_700_000_000_000L
private const val PREVIEW_WINDOW_DAYS: Int = 30

/**
 * Stateful entry point — the parity port of the web `<UptimeHeatmap/>`. Records the one-shot `view.opened`
 * diagnostic (P1/S11) on first composition, collects the window [UiState], and renders the panel chrome.
 *
 * @param viewModel the state holder bound to the shared window store.
 * @param modifier outer modifier applied to the panel root.
 */
@Composable
fun UptimeHeatmap(
    viewModel: UptimeHeatmapViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val strings = rememberUptimeHeatmapStrings()
    val state by viewModel.state.collectAsStateWithLifecycle()

    UptimeHeatmapChrome(
        state = state,
        strings = strings,
        modifier = modifier,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless panel chrome — renders the heatmap in every phase the bound window feed reports. Hoisted out of
 * the ViewModel so it is preview- and screenshot-testable for each state. The root carries the
 * `role="status" aria-live="polite"` landmark (web parity) so screen readers announce notable transitions
 * (offline ↔ online) without interrupting other reading flow.
 */
@Composable
fun UptimeHeatmapChrome(
    state: UiState<UptimeWindow>,
    strings: UptimeHeatmapStrings,
    modifier: Modifier = Modifier,
    onRetry: () -> Unit = {},
) {
    val window = state.data ?: EMPTY_WINDOW
    val freshness = UptimeHeatmapProjection.freshness(state)

    GlassPanel(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(UPTIME_HEATMAP_TEST_TAG)
                .semantics {
                    liveRegion = LiveRegionMode.Polite
                    contentDescription = strings.surfaceLabel
                },
    ) {
        when (state.phase) {
            UiPhase.Loading -> UptimeHeatmapLoading(strings)
            UiPhase.Error -> UptimeHeatmapError(state, strings, onRetry)
            UiPhase.Empty -> UptimeHeatmapEmpty(window, freshness, strings)
            UiPhase.Content -> UptimeHeatmapContent(window, freshness, strings)
        }
    }
}

/** Loading chrome — a shimmering title bar plus a shimmering grid strip standing in for the resolving days. */
@Composable
private fun UptimeHeatmapLoading(strings: UptimeHeatmapStrings) {
    Column(
        modifier = Modifier.semantics { contentDescription = strings.loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = TITLE_SKELETON_FRACTION, height = GRID_SKELETON_HEIGHT, rounded = true)
        Skeleton(widthFraction = GRID_SKELETON_FRACTION, height = GRID_SKELETON_HEIGHT, rounded = true)
    }
}

/** Hard-error chrome — a stable surface title plus the shared [QueryError] recovery panel with retry. */
@Composable
private fun UptimeHeatmapError(
    state: UiState<UptimeWindow>,
    strings: UptimeHeatmapStrings,
    onRetry: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        PanelTitle(strings.resourceName)
        QueryError(
            kind = UptimeHeatmapProjection.queryErrorKind(state),
            resourceName = strings.resourceName,
            onRetry = onRetry,
        )
    }
}

/** Empty chrome — the heading (web "last 0 days") plus a friendly, non-blank empty state. */
@Composable
private fun UptimeHeatmapEmpty(
    window: UptimeWindow,
    freshness: UptimeHeatmapFreshness,
    strings: UptimeHeatmapStrings,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        UptimeHeatmapHeader(
            heading = window.title ?: strings.heading(window.days.size),
            uptime = null,
            freshness = freshness,
            strings = strings,
        )
        EmptyState(
            message = strings.emptyMessage,
            title = strings.emptyTitle,
            icon = TeslaGlyphs.Info,
        )
    }
}

/** Content chrome — the heading + uptime caption, the wrapping squares grid, and the optional footnote. */
@Composable
private fun UptimeHeatmapContent(
    window: UptimeWindow,
    freshness: UptimeHeatmapFreshness,
    strings: UptimeHeatmapStrings,
) {
    val percent = UptimeHeatmapProjection.uptimePercent(window.days)
    val badge =
        percent?.let {
            UptimeBadge(
                text = strings.uptimeCaption(UptimeHeatmapProjection.formatPercent(it, Locale.getDefault())),
                tone = UptimeHeatmapProjection.pctTone(it),
            )
        }

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        UptimeHeatmapHeader(
            heading = window.title ?: strings.heading(window.days.size),
            uptime = badge,
            freshness = freshness,
            strings = strings,
        )
        UptimeSquares(window.days, strings)
        val footnote = window.footnote
        if (!footnote.isNullOrBlank()) {
            HelperText(footnote)
        }
    }
}

/** The panel header — the title on the left, the freshness chip + uptime caption on the right (web `justify-between`). */
@Composable
private fun UptimeHeatmapHeader(
    heading: String,
    uptime: UptimeBadge?,
    freshness: UptimeHeatmapFreshness,
    strings: UptimeHeatmapStrings,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Heading(
            text = heading,
            level = HeadingLevel.Panel,
            maxLines = 1,
        )
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            UptimeFreshnessChip(freshness, strings)
            if (uptime != null) {
                BodyText(uptime.text, color = uptimePctColor(uptime.tone))
            }
        }
    }
}

/** The wrapping grid of day squares — web `flex flex-wrap gap-1`, oldest first. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun UptimeSquares(
    days: List<UptimeDay>,
    strings: UptimeHeatmapStrings,
) {
    FlowRow(
        modifier =
            Modifier
                .fillMaxWidth()
                .testTag(UPTIME_HEATMAP_GRID_TEST_TAG)
                .semantics { contentDescription = strings.listLabel },
        horizontalArrangement = Arrangement.spacedBy(SQUARE_GAP),
        verticalArrangement = Arrangement.spacedBy(SQUARE_GAP),
    ) {
        days.forEach { day ->
            UptimeSquare(day, strings)
        }
    }
}

/** One day square — colored by status, with a tap-revealed [Popover] and the web per-day accessibility label. */
@Composable
private fun UptimeSquare(
    day: UptimeDay,
    strings: UptimeHeatmapStrings,
) {
    var expanded by remember { mutableStateOf(false) }
    val label = strings.dayLabel(day.date, day.status)

    Box {
        Box(
            modifier =
                Modifier
                    .size(SQUARE_SIZE)
                    .clip(RoundedCornerShape(Radius.sm))
                    .background(uptimeSquareColor(day.status))
                    .clickable(onClickLabel = label, role = Role.Button) { expanded = true }
                    .semantics { contentDescription = label },
        )
        Popover(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            accessibleName = label,
        ) {
            Caption(day.date)
            BodyText(strings.statusLabel(day.status))
            val summary = day.summary
            if (!summary.isNullOrBlank()) {
                HelperText(summary)
            }
        }
    }
}

/** The leading freshness chip shown when the window is stale or served offline/last-known. */
@Composable
private fun UptimeFreshnessChip(
    freshness: UptimeHeatmapFreshness,
    strings: UptimeHeatmapStrings,
) {
    when (freshness) {
        UptimeHeatmapFreshness.Offline -> StatusPill(text = strings.offline, tone = StatusTone.Danger)
        UptimeHeatmapFreshness.Stale -> StatusPill(text = strings.stale, tone = StatusTone.Warning, pulse = true)
        UptimeHeatmapFreshness.Live -> Unit
    }
}

/** A small value object carrying the resolved uptime caption text + its threshold tone. */
private class UptimeBadge(
    val text: String,
    val tone: UptimePctTone,
)

/** Maps a day's [UptimeStatus] to its square color (web `SQUARE_BG`), via the theme status palette. */
@Composable
private fun uptimeSquareColor(status: UptimeStatus): Color =
    when (status) {
        UptimeStatus.Healthy -> TeslaTokens.status.success.copy(alpha = COLORED_SQUARE_ALPHA)
        UptimeStatus.Degraded -> TeslaTokens.status.warning.copy(alpha = COLORED_SQUARE_ALPHA)
        UptimeStatus.Unhealthy -> TeslaTokens.status.danger.copy(alpha = COLORED_SQUARE_ALPHA)
        UptimeStatus.Maintenance -> TeslaTokens.status.info.copy(alpha = COLORED_SQUARE_ALPHA)
        UptimeStatus.Unknown -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = UNKNOWN_SQUARE_ALPHA)
    }

/** Maps the uptime caption's [UptimePctTone] to a theme color (web `>=99` green / `>=95` amber / else red). */
@Composable
private fun uptimePctColor(tone: UptimePctTone): Color =
    when (tone) {
        UptimePctTone.Good -> TeslaTokens.status.success
        UptimePctTone.Warn -> TeslaTokens.status.warning
        UptimePctTone.Bad -> TeslaTokens.status.danger
    }

/** Builds the localized chrome labels from the P1/S10 catalog; tests pass a deterministic instance. */
@Composable
private fun rememberUptimeHeatmapStrings(): UptimeHeatmapStrings =
    UptimeHeatmapStrings(
        titleTemplate = stringResource(R.string.translation_uptimeHeatmap_title),
        uptimeTemplate = stringResource(R.string.translation_uptimeHeatmap_uptimeSuffix),
        listLabel = stringResource(R.string.translation_uptimeHeatmap_listLabel),
        dayLabelTemplate = stringResource(R.string.translation_uptimeHeatmap_dayLabel),
        surfaceLabel = stringResource(R.string.translation_uptimeHeatmap_aria),
        statusLabels =
            mapOf(
                UptimeStatus.Healthy to stringResource(R.string.translation_uptimeHeatmap_status_healthy),
                UptimeStatus.Degraded to stringResource(R.string.translation_uptimeHeatmap_status_degraded),
                UptimeStatus.Unhealthy to stringResource(R.string.translation_uptimeHeatmap_status_unhealthy),
                UptimeStatus.Unknown to stringResource(R.string.translation_uptimeHeatmap_status_unknown),
                UptimeStatus.Maintenance to stringResource(R.string.translation_uptimeHeatmap_status_maintenance),
            ),
        emptyTitle = stringResource(R.string.translation_uptimeHeatmap_emptyTitle),
        emptyMessage = stringResource(R.string.translation_uptimeHeatmap_empty),
        resourceName = stringResource(R.string.translation_uptimeHeatmap_resourceName),
        stale = stringResource(R.string.translation_mqtt_stale),
        offline = stringResource(R.string.translation_common_offline),
        loadingLabel = stringResource(R.string.translation_common_loading),
    )

private val EMPTY_WINDOW = UptimeWindow(days = emptyList())

// ── Previews — one per rendered state (loading / content / empty / error / stale / offline + tones). ──

private fun previewStrings(): UptimeHeatmapStrings =
    UptimeHeatmapStrings(
        titleTemplate = "Uptime — last %1\$s days",
        uptimeTemplate = "%1\$s uptime",
        listLabel = "Daily status history",
        dayLabelTemplate = "%1\$s: %2\$s",
        surfaceLabel = "Uptime — daily status heatmap",
        statusLabels =
            mapOf(
                UptimeStatus.Healthy to "Operational",
                UptimeStatus.Degraded to "Degraded",
                UptimeStatus.Unhealthy to "Outage",
                UptimeStatus.Unknown to "Unknown",
                UptimeStatus.Maintenance to "Maintenance",
            ),
        emptyTitle = "No uptime data",
        emptyMessage = "No status history to show yet.",
        resourceName = "Uptime history",
        stale = "Stale",
        offline = "Offline",
        loadingLabel = "Loading",
    )

private fun previewWindow(
    days: Int = PREVIEW_WINDOW_DAYS,
    degradedEvery: Int = 9,
    outageOn: Int = 17,
): UptimeWindow {
    val list =
        (0 until days).map { i ->
            val status =
                when {
                    i == outageOn -> UptimeStatus.Unhealthy
                    i % degradedEvery == 0 && i != 0 -> UptimeStatus.Degraded
                    i == days - 2 -> UptimeStatus.Maintenance
                    else -> UptimeStatus.Healthy
                }
            UptimeDay(
                date = "2026-05-%02d".format(i + 1),
                status = status,
                summary = if (i == outageOn) "API outage 14:00–14:45" else null,
            )
        }
    return UptimeWindow(days = list)
}

@Composable
private fun PreviewPanel(state: UiState<UptimeWindow>) {
    TeslaSyncTheme(dynamicColor = false) {
        UptimeHeatmapChrome(state = state, strings = previewStrings())
    }
}

@Preview(name = "UptimeHeatmap · loading", showBackground = true, widthDp = 380)
@Composable
private fun UptimeHeatmapLoadingPreview() = PreviewPanel(state = UiState.loading())

@Preview(name = "UptimeHeatmap · content", showBackground = true, widthDp = 380)
@Composable
private fun UptimeHeatmapContentPreview() =
    PreviewPanel(state = UiState(UiPhase.Content, data = previewWindow(), fetchedAt = PREVIEW_STAMP))

@Preview(name = "UptimeHeatmap · low uptime", showBackground = true, widthDp = 380)
@Composable
private fun UptimeHeatmapLowPreview() =
    PreviewPanel(
        state = UiState(UiPhase.Content, data = previewWindow(degradedEvery = 3, outageOn = 4), fetchedAt = PREVIEW_STAMP),
    )

@Preview(name = "UptimeHeatmap · empty", showBackground = true, widthDp = 380)
@Composable
private fun UptimeHeatmapEmptyPreview() = PreviewPanel(state = UiState(UiPhase.Empty, data = EMPTY_WINDOW, fetchedAt = PREVIEW_STAMP))

@Preview(name = "UptimeHeatmap · error", showBackground = true, widthDp = 380)
@Composable
private fun UptimeHeatmapErrorPreview() = PreviewPanel(state = UiState(UiPhase.Error, errorKind = ErrorKind.Unknown))

@Preview(name = "UptimeHeatmap · stale", showBackground = true, widthDp = 380)
@Composable
private fun UptimeHeatmapStalePreview() =
    PreviewPanel(
        state = UiState(UiPhase.Content, data = previewWindow(), fetchedAt = PREVIEW_STAMP, stale = true, refreshing = true),
    )

@Preview(name = "UptimeHeatmap · offline", showBackground = true, widthDp = 380)
@Composable
private fun UptimeHeatmapOfflinePreview() =
    PreviewPanel(
        state = UiState(UiPhase.Content, data = previewWindow(), fetchedAt = PREVIEW_STAMP, stale = true, errorKind = ErrorKind.Network),
    )
