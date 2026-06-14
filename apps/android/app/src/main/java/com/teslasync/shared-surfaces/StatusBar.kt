// Native Compose render layer for the StatusBar shared surface — the parity port of the web footer
// (web/src/components/layout/StatusBar.tsx). It is a thin, stateless view over the pure [StatusBarProjection]
// and the [StatusBarViewModel]'s [StatusBarPreferences] feed: it owns no business logic, performs no HTTP
// or persistence, and renders every phase the prompt's state matrix mandates — loading (skeleton chrome),
// content (the enabled bar hosting its segment slots), empty/disabled (a friendly restore affordance instead
// of the web's blank `return null`), a hard error (a compact QueryError-equivalent with retry), and the
// stale/offline freshness envelope (a chip + the `aria-live` announcement). Narrow widths collapse the bar
// to icon-only and shorten it, mirroring the web `useNarrowViewport` + `h-6 lg:h-7` rules.
//
// The five status segments (API health · live telemetry · active vehicle · background jobs · version, plus
// the help cluster) are each their OWN P3 shared surface (A-0178…) and are composed here through
// [StatusBarSegments] slots — the native analogue of the web `<ConnectionSegment/>`… children — never
// re-encoded. A host wires the real segment surfaces into the slots; previews use representative samples.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/StatusBar) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.statusbar

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.navigation.WindowWidth
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing

/** Test tag on the surface root so on-device UI tests can locate the rendered bar in any state. */
const val STATUS_BAR_TEST_TAG: String = "status-bar"

private val BAR_ELEVATION: Dp = 2.dp
private val DIVIDER_HEIGHT: Dp = 12.dp
private val DIVIDER_WIDTH: Dp = 1.dp
private val SKELETON_HEIGHT: Dp = 10.dp
private const val DIVIDER_ALPHA: Float = 0.5f
private const val SKELETON_FRACTION: Float = 0.16f
private const val PREVIEW_STAMP: Long = 1_700_000_000_000L

/**
 * The six segment slots the bar composes — the native analogue of the web `<ConnectionSegment/>`,
 * `<LiveTelemetrySegment/>`, `<BackgroundWorkSegment/>`, `<ActiveVehicleSegment/>`, `<HelpSegment/>`, and
 * `<VersionSegment/>` children. Each is its own P3 shared surface; the host supplies the real composables,
 * and [None] leaves them empty (the bar still renders its chrome, freshness, and landmark). Each slot
 * receives the resolved `iconOnly` flag so segments collapse in lockstep with the container.
 */
class StatusBarSegments(
    val connection: @Composable (iconOnly: Boolean) -> Unit,
    val liveTelemetry: @Composable (iconOnly: Boolean) -> Unit,
    val backgroundWork: @Composable (iconOnly: Boolean) -> Unit,
    val activeVehicle: @Composable (iconOnly: Boolean) -> Unit,
    val help: @Composable (iconOnly: Boolean) -> Unit,
    val version: @Composable (iconOnly: Boolean) -> Unit,
) {
    companion object {
        /** Empty slots — the host wires the real per-segment surfaces (each its own P3 prompt). */
        val None: StatusBarSegments =
            StatusBarSegments(
                connection = {},
                liveTelemetry = {},
                backgroundWork = {},
                activeVehicle = {},
                help = {},
                version = {},
            )

        /** Representative slot content for previews/tests — a labeled status chip per segment. */
        fun sample(): StatusBarSegments =
            StatusBarSegments(
                connection = { iconOnly -> SampleSegment("API", StatusTone.Success, iconOnly) },
                liveTelemetry = { iconOnly -> SampleSegment("Live", StatusTone.Success, iconOnly) },
                backgroundWork = {},
                activeVehicle = { iconOnly -> SampleSegment("Garage", StatusTone.Neutral, iconOnly) },
                help = { iconOnly -> SampleSegment("Help", StatusTone.Neutral, iconOnly) },
                version = { iconOnly -> SampleSegment("v0.1.0", StatusTone.Neutral, iconOnly) },
            )
    }
}

/**
 * Stateful entry point — the parity port of the web `<StatusBar/>`. Records the one-shot `view.opened`
 * diagnostic (P1/S11) on first composition, collects the preference [UiState], and renders the responsive
 * footer chrome. [width] is the host-computed window-size bucket (drives the icon-only collapse + the
 * height/placement), [compact] forces icon-only at any width (web `compact` prop), and [segments] supplies
 * the per-segment child surfaces.
 *
 * @param viewModel the state holder bound to the shared preference store.
 * @param width the current window width bucket (web `useNarrowViewport`).
 * @param compact force every segment into its icon-only variant (web `compact` prop).
 * @param segments the six composed segment surfaces (each its own P3 prompt).
 */
@Composable
fun StatusBar(
    viewModel: StatusBarViewModel,
    modifier: Modifier = Modifier,
    width: WindowWidth = WindowWidth.Expanded,
    compact: Boolean = false,
    segments: StatusBarSegments = StatusBarSegments.None,
) {
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val strings = rememberStatusBarStrings()
    val state by viewModel.state.collectAsStateWithLifecycle()

    StatusBarChrome(
        state = state,
        strings = strings,
        width = width,
        segments = segments,
        modifier = modifier,
        compact = compact,
        onRetry = viewModel::retry,
        onShow = { viewModel.setEnabled(true) },
    )
}

/**
 * Stateless footer chrome — renders the bar in every phase the bound preference feed reports. Hoisted out
 * of the ViewModel so it is preview- and screenshot-testable for each state. The root carries the
 * `role="status" aria-live="polite"` landmark (web parity) so screen readers announce notable transitions
 * (offline ↔ online) without interrupting other reading flow.
 */
@Composable
fun StatusBarChrome(
    state: UiState<StatusBarPreferences>,
    strings: StatusBarStrings,
    width: WindowWidth,
    segments: StatusBarSegments,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    onRetry: () -> Unit = {},
    onShow: () -> Unit = {},
) {
    val prefs = state.data ?: StatusBarRegistration.DEFAULTS
    val iconOnly = StatusBarProjection.iconOnly(prefs, compact, width)
    val metrics = StatusBarProjection.metrics(width)
    val freshness = StatusBarProjection.freshness(state)

    Surface(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(STATUS_BAR_TEST_TAG)
                .semantics {
                    liveRegion = LiveRegionMode.Polite
                    contentDescription = strings.applicationStatus
                },
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        tonalElevation = BAR_ELEVATION,
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(DIVIDER_WIDTH)
                    .background(MaterialTheme.colorScheme.outlineVariant),
            )
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .height(metrics.heightDp.dp)
                        .padding(horizontal = Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                when (state.phase) {
                    UiPhase.Loading -> StatusBarLoadingRow(strings)
                    UiPhase.Error -> StatusBarErrorRow(strings, onRetry)
                    UiPhase.Empty -> StatusBarHiddenRow(strings, iconOnly, onShow)
                    UiPhase.Content -> StatusBarContentRow(iconOnly, freshness, strings, segments)
                }
            }
        }
    }
}

/** Loading chrome — two shimmering chips standing in for the resolving segments. */
@Composable
private fun RowScope.StatusBarLoadingRow(strings: StatusBarStrings) {
    Row(
        modifier =
            Modifier
                .weight(1f)
                .semantics { contentDescription = strings.loading },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(widthFraction = SKELETON_FRACTION, height = SKELETON_HEIGHT, rounded = true)
        Skeleton(widthFraction = SKELETON_FRACTION, height = SKELETON_HEIGHT, rounded = true)
    }
}

/** Hard-error chrome — a compact `QueryError` equivalent: a warning glyph + a retry affordance. */
@Composable
private fun RowScope.StatusBarErrorRow(
    strings: StatusBarStrings,
    onRetry: () -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = TeslaGlyphs.Warning,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.error,
        )
        Caption(strings.barLabel)
    }
    Button(
        label = strings.retry,
        onClick = onRetry,
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
    )
}

/**
 * Disabled-bar chrome — the structurally-empty branch. The web container renders `null` when disabled; the
 * prompt's states contract mandates a friendly, accessible affordance instead of a blank box, so the bar
 * offers a one-tap restore (web `theme.statusBar.show`) backed by the same preference store.
 */
@Composable
private fun RowScope.StatusBarHiddenRow(
    strings: StatusBarStrings,
    iconOnly: Boolean,
    onShow: () -> Unit,
) {
    if (iconOnly) {
        Spacer(Modifier.weight(1f))
    } else {
        Caption(strings.hiddenNotice)
    }
    Button(
        label = strings.showBar,
        onClick = onShow,
        variant = ButtonVariant.Ghost,
        size = ButtonSize.Sm,
        leadingIcon = TeslaGlyphs.Eye,
    )
}

/** Content chrome — the two segment groups the web `justify-between` footer renders, split by dividers. */
@Composable
private fun RowScope.StatusBarContentRow(
    iconOnly: Boolean,
    freshness: StatusBarFreshness,
    strings: StatusBarStrings,
    segments: StatusBarSegments,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        if (freshness != StatusBarFreshness.Live) {
            StatusBarFreshnessChip(freshness, strings)
            StatusBarDivider()
        }
        segments.connection(iconOnly)
        StatusBarDivider()
        segments.liveTelemetry(iconOnly)
    }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        segments.backgroundWork(iconOnly)
        segments.activeVehicle(iconOnly)
        StatusBarDivider()
        segments.help(iconOnly)
        StatusBarDivider()
        segments.version(iconOnly)
    }
}

/** The leading freshness chip the bar shows when its preferences are stale or served offline/last-known. */
@Composable
private fun StatusBarFreshnessChip(
    freshness: StatusBarFreshness,
    strings: StatusBarStrings,
) {
    val label: String
    val tone: StatusTone
    when (freshness) {
        StatusBarFreshness.Offline -> {
            label = strings.offline
            tone = StatusTone.Danger
        }
        StatusBarFreshness.Stale -> {
            label = strings.stale
            tone = StatusTone.Warning
        }
        StatusBarFreshness.Live -> {
            label = strings.barLabel
            tone = StatusTone.Success
        }
    }
    StatusPill(text = label, tone = tone, pulse = freshness == StatusBarFreshness.Stale)
}

/** A thin vertical rule between segments — the web `h-3 w-px bg-white/[0.08]` divider. */
@Composable
private fun StatusBarDivider() {
    Box(
        Modifier
            .padding(horizontal = Spacing.xs)
            .width(DIVIDER_WIDTH)
            .height(DIVIDER_HEIGHT)
            .background(MaterialTheme.colorScheme.outlineVariant.copy(alpha = DIVIDER_ALPHA)),
    )
}

/** Representative segment chip for previews/tests — never shipped into a real bar (the host wires segments). */
@Composable
private fun SampleSegment(
    label: String,
    tone: StatusTone,
    iconOnly: Boolean,
) {
    StatusPill(text = if (iconOnly) label.take(1) else label, tone = tone)
}

/** Builds the localized chrome labels from the P1/S10 catalog; tests pass a deterministic instance. */
@Composable
private fun rememberStatusBarStrings(): StatusBarStrings =
    StatusBarStrings(
        applicationStatus = stringResource(R.string.translation_statusBar_aria),
        barLabel = stringResource(R.string.translation_theme_statusBar_label),
        showBar = stringResource(R.string.translation_theme_statusBar_show),
        showBarHelp = stringResource(R.string.translation_theme_statusBar_showHelp),
        hiddenNotice = stringResource(R.string.translation_theme_statusBar_hiddenToast),
        iconOnlyLabel = stringResource(R.string.translation_theme_statusBar_iconOnly),
        loading = stringResource(R.string.translation_common_loading),
        stale = stringResource(R.string.translation_mqtt_stale),
        offline = stringResource(R.string.translation_common_offline),
        retry = stringResource(R.string.translation_common_retry),
    )

// ── Previews — one per rendered state (loading / content / empty / error / stale / offline + variants). ──

private fun previewStrings(): StatusBarStrings =
    StatusBarStrings(
        applicationStatus = "Application status",
        barLabel = "Status bar",
        showBar = "Show status bar",
        showBarHelp = "Always-on footer with API health, live telemetry, vehicle, and version.",
        hiddenNotice = "Status bar hidden",
        iconOnlyLabel = "Always icon-only",
        loading = "Loading",
        stale = "Stale",
        offline = "Offline",
        retry = "Retry",
    )

private fun enabledPrefs(): StatusBarPreferences = StatusBarPreferences(enabled = true, iconOnly = false)

private fun disabledPrefs(): StatusBarPreferences = StatusBarPreferences(enabled = false, iconOnly = false)

@Composable
private fun PreviewBar(
    state: UiState<StatusBarPreferences>,
    width: WindowWidth = WindowWidth.Expanded,
    compact: Boolean = false,
) {
    TeslaSyncTheme(dynamicColor = false) {
        StatusBarChrome(
            state = state,
            strings = previewStrings(),
            width = width,
            segments = StatusBarSegments.sample(),
            compact = compact,
        )
    }
}

@Preview(name = "StatusBar · loading", showBackground = true, widthDp = 760, heightDp = 60)
@Composable
private fun StatusBarLoadingPreview() = PreviewBar(state = UiState.loading())

@Preview(name = "StatusBar · content", showBackground = true, widthDp = 760, heightDp = 60)
@Composable
private fun StatusBarContentPreview() = PreviewBar(state = UiState(UiPhase.Content, data = enabledPrefs(), fetchedAt = PREVIEW_STAMP))

@Preview(name = "StatusBar · empty", showBackground = true, widthDp = 760, heightDp = 60)
@Composable
private fun StatusBarEmptyPreview() = PreviewBar(state = UiState(UiPhase.Empty, data = disabledPrefs(), fetchedAt = PREVIEW_STAMP))

@Preview(name = "StatusBar · error", showBackground = true, widthDp = 760, heightDp = 60)
@Composable
private fun StatusBarErrorPreview() = PreviewBar(state = UiState(UiPhase.Error, errorKind = ErrorKind.Unknown))

@Preview(name = "StatusBar · stale", showBackground = true, widthDp = 760, heightDp = 60)
@Composable
private fun StatusBarStalePreview() =
    PreviewBar(
        state =
            UiState(
                UiPhase.Content,
                data = enabledPrefs(),
                fetchedAt = PREVIEW_STAMP,
                stale = true,
                refreshing = true,
            ),
    )

@Preview(name = "StatusBar · offline", showBackground = true, widthDp = 760, heightDp = 60)
@Composable
private fun StatusBarOfflinePreview() =
    PreviewBar(
        state =
            UiState(
                UiPhase.Content,
                data = enabledPrefs(),
                fetchedAt = PREVIEW_STAMP,
                stale = true,
                errorKind = ErrorKind.Network,
            ),
    )

@Preview(name = "StatusBar · icon-only", showBackground = true, widthDp = 420, heightDp = 60)
@Composable
private fun StatusBarIconOnlyPreview() =
    PreviewBar(
        state = UiState(UiPhase.Content, data = enabledPrefs(), fetchedAt = PREVIEW_STAMP),
        compact = true,
    )

@Preview(name = "StatusBar · narrow", showBackground = true, widthDp = 420, heightDp = 60)
@Composable
private fun StatusBarNarrowPreview() =
    PreviewBar(
        state = UiState(UiPhase.Content, data = enabledPrefs(), fetchedAt = PREVIEW_STAMP),
        width = WindowWidth.Compact,
    )
