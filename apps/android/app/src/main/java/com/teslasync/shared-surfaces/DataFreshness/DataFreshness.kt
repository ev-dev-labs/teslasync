// The native Jetpack Compose + Material 3 DataFreshness shared surface — a parity port of
// web/src/components/data-display/DataFreshness.tsx (and its `DataFreshnessAuto` wrapper). The web component
// is a tiny query-result-driven freshness chip: a status dot + icon + relative-time label ("3m ago",
// "updating…", "error") that surfaces the health of a data fetch, designed to live in a widget/page header.
//
// This surface is the native equivalent. All data flows through the shared [DataFreshnessViewModel] over the
// [DataFreshnessSource] seam (P1/S8) — the view performs NO HTTP and reads no store directly. Every
// derivation flows through the pure [DataFreshnessProjection]; the composable is a thin render layer. The
// faithful mapping of the web behaviour:
//   • `useChargingHistory(...)` (the web doc-comment's worked example query) → the injected [source], folded
//     by the ViewModel into the [DataFreshnessViewModel.snapshot] freshness flow (never HTTP from the view).
//   • the web `status` (error > fetching > stale > fresh) → [FreshnessStatus], with the error tier split into
//     a hard [FreshnessStatus.Error] and a last-known-cache [FreshnessStatus.Offline] (the honest P3 offline
//     surface), each driving the dot/icon color + glyph.
//   • the web `relativeTime` ("3m ago" / "updating…" / "error" / "") → the resolved chip text.
//   • the web `title` tooltip → the TalkBack `stateDescription` ("Last updated: {time}" / "Never updated" /
//     "Updating…").
//   • the web `aria-label` ("Refresh" when refetchable, else "Data freshness: {state}") + `aria-live=polite`
//     + `aria-atomic` → a single merged semantics node with a polite live region.
//   • the web `animate-ping` dot ring, `animate-pulse` background-refetch pulse, and `animate-spin` icon →
//     the native infinite transitions, all suppressed under reduced motion (TalkBack "remove animations").
//   • the web `onClick → onRefresh` (only when not fetching) → the chip's tap calling
//     [DataFreshnessViewModel.refresh].
//
// States reproduced (every one renders a non-blank chip): loading (initial fetch → "updating…" + spinning
// icon), the fresh chip ("3m ago"), stale (amber), error (red wifi-off + "error"), offline (amber wifi-off
// over last-known time), and the never-updated / empty surface (dot + icon, no text, "Never updated"
// announced — the web empty relative-time + "Never updated" title). The one-shot `view.opened` diagnostic
// (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/DataFreshness) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datafreshness

import android.text.format.DateFormat
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay
import java.util.Date

/** Test tag identifying the chip container — used by the instrumented per-state + a11y UI tests. */
const val DATA_FRESHNESS_TEST_TAG: String = "data-freshness"

/** The status dot diameter — the native mirror of the web `h-1.5 w-1.5` (6px) dot. */
private val DOT_SIZE = 6.dp

/** Reserved label width so the text changing never reflows neighbouring header items (web `min-w-[4.5rem]`). */
private val TEXT_MIN_WIDTH = 72.dp

/** Re-render cadence keeping the relative-time label accurate (web 30s `setInterval`). */
private const val RELATIVE_TICK_MS = 30_000L

private const val SPIN_PERIOD_MS = 1_000
private const val PULSE_PERIOD_MS = 1_200
private const val PING_PERIOD_MS = 1_000
private const val PULSE_MIN_ALPHA = 0.5f
private const val PING_START_ALPHA = 0.4f
private const val PING_END_ALPHA = 0f
private const val PING_MAX_SCALE = 2.2f
private const val FULL_ROTATION_DEG = 360f

/**
 * Stateful entry point bound to the shared Charging freshness feed — the faithful port of the web
 * `DataFreshnessAuto` deriving every prop from a `useQuery()` result. Binds the [DataFreshnessViewModel] for
 * [vehicleId], records the one-shot `view.opened` diagnostic (P1/S11), collects the live freshness snapshot,
 * re-renders on a 30s cadence to keep the relative label accurate, and projects it into the render the
 * stateless chip paints.
 *
 * @param vehicleId the vehicle whose charging history freshness is surfaced (web `useChargingHistory(id)`).
 * @param source the shared Charging seam (a `ChargingStore`/`ChargingRepository` adapter the host wires).
 * @param modifier optional layout modifier for the chip container.
 * @param compact icon-only mode for small widgets (web `compact` → no relative-time text).
 * @param refetchable whether tapping refetches (web `DataFreshnessAuto.refetchable`).
 * @param forceStaleAfterMs forces the stale tier once the value ages past this window (web `forceStaleAfterMs`).
 * @param logger the sanctioned redacting logger; defaults to the app's [io.teslasync.android.data.DataContainer].
 */
@Composable
fun DataFreshness(
    vehicleId: Long,
    source: DataFreshnessSource,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    refetchable: Boolean = true,
    forceStaleAfterMs: Long? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: DataFreshnessViewModel =
        viewModel(
            key = DataFreshnessRegistration.ID + ":" + vehicleId,
            factory = DataFreshnessViewModel.factory(source, logger, vehicleId),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val snapshot by viewModel.snapshot.collectAsStateWithLifecycle()
    val reduceMotion = rememberReducedMotion()

    // Re-render periodically so the relative label ("just now" → "5m ago") stays accurate; the label only
    // changes on minute boundaries, so a 30s cadence is plenty (web's 30s interval).
    val nowMs by produceState(initialValue = System.currentTimeMillis(), snapshot.updatedAtMs) {
        while (true) {
            value = System.currentTimeMillis()
            delay(RELATIVE_TICK_MS)
        }
    }

    val render = DataFreshnessProjection.render(snapshot, nowMs, reduceMotion, refetchable, forceStaleAfterMs)
    val onRefresh: (() -> Unit)? = if (render.refreshable) viewModel::refresh else null
    DataFreshnessChip(render = render, modifier = modifier, compact = compact, onRefresh = onRefresh)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Paints the freshness chip from a fully
 * resolved [render]: a status dot (with the fetching ring / background-refetch pulse), the status icon (web
 * Wifi / WifiOff / spinning Refresh), and the relative-time label. The whole chip is a single accessibility
 * node with a polite live region (web `aria-live`/`aria-atomic`); [onRefresh] makes it a tappable button
 * (web `onRefresh && !isFetching`). Never blank — the dot + icon always render, even when there is no text.
 */
@Composable
fun DataFreshnessChip(
    render: FreshnessRender,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
    onRefresh: (() -> Unit)? = null,
) {
    val color = statusColor(render.status)
    val icon = statusIcon(render.status)
    val label = relativeText(render.label)
    val tooltip = tooltipText(render.tooltip)
    val description =
        if (render.refreshable) {
            stringResource(R.string.translation_freshness_refresh)
        } else {
            stringResource(R.string.translation_a11y_dataFreshness, render.status.slug)
        }
    val refresh = onRefresh

    Row(
        modifier =
            modifier
                .testTag(DATA_FRESHNESS_TEST_TAG)
                .then(if (refresh != null) Modifier.clickable { refresh() } else Modifier)
                .semantics(mergeDescendants = true) {
                    contentDescription = description
                    stateDescription = tooltip
                    liveRegion = LiveRegionMode.Polite
                    if (render.refreshable) role = Role.Button
                }.padding(vertical = Spacing.xs, horizontal = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StatusDot(color = color, showPing = render.showPing, showPulse = render.showPulse)
        StatusIcon(icon = icon, color = color, spin = render.spin)
        if (!compact) {
            Text(
                text = label,
                modifier = Modifier.widthIn(min = TEXT_MIN_WIDTH),
                style = MaterialTheme.typography.labelSmall.copy(fontFeatureSettings = "tnum"),
                color = color,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** The status dot with its fetching ring (web `animate-ping`) and background-refetch pulse (`animate-pulse`). */
@Composable
private fun StatusDot(
    color: Color,
    showPing: Boolean,
    showPulse: Boolean,
) {
    Box(contentAlignment = Alignment.Center, modifier = Modifier.size(DOT_SIZE)) {
        if (showPing) {
            val transition = rememberInfiniteTransition(label = "dataFreshnessPing")
            val ringScale by transition.animateFloat(
                initialValue = 1f,
                targetValue = PING_MAX_SCALE,
                animationSpec = infiniteRepeatable(tween(PING_PERIOD_MS, easing = LinearEasing), RepeatMode.Restart),
                label = "pingScale",
            )
            val ringAlpha by transition.animateFloat(
                initialValue = PING_START_ALPHA,
                targetValue = PING_END_ALPHA,
                animationSpec = infiniteRepeatable(tween(PING_PERIOD_MS, easing = LinearEasing), RepeatMode.Restart),
                label = "pingAlpha",
            )
            Box(
                modifier =
                    Modifier
                        .size(DOT_SIZE)
                        .scale(ringScale)
                        .alpha(ringAlpha)
                        .clip(CircleShape)
                        .background(color),
            )
        }
        val dotAlpha =
            if (showPulse) {
                val transition = rememberInfiniteTransition(label = "dataFreshnessPulse")
                val pulse by transition.animateFloat(
                    initialValue = 1f,
                    targetValue = PULSE_MIN_ALPHA,
                    animationSpec = infiniteRepeatable(tween(PULSE_PERIOD_MS, easing = LinearEasing), RepeatMode.Reverse),
                    label = "pulseAlpha",
                )
                pulse
            } else {
                1f
            }
        Box(
            modifier =
                Modifier
                    .size(DOT_SIZE)
                    .alpha(dotAlpha)
                    .clip(CircleShape)
                    .background(color),
        )
    }
}

/** The status icon, spinning while a fetch is in flight (web fetching `animate-spin`). */
@Composable
private fun StatusIcon(
    icon: ImageVector,
    color: Color,
    spin: Boolean,
) {
    val rotation =
        if (spin) {
            val transition = rememberInfiniteTransition(label = "dataFreshnessSpin")
            val degrees by transition.animateFloat(
                initialValue = 0f,
                targetValue = FULL_ROTATION_DEG,
                animationSpec = infiniteRepeatable(tween(SPIN_PERIOD_MS, easing = LinearEasing), RepeatMode.Restart),
                label = "spinDegrees",
            )
            degrees
        } else {
            0f
        }
    Icon(
        imageVector = icon,
        contentDescription = null,
        modifier = Modifier.rotate(rotation),
        size = IconSize.Xs,
        tint = color,
    )
}

/** The semantic color for a freshness tier — the native mirror of the web `FRESHNESS_COLORS` map. */
@Composable
private fun statusColor(status: FreshnessStatus): Color =
    when (status) {
        FreshnessStatus.Fresh -> TeslaTokens.status.success
        FreshnessStatus.Fetching -> TeslaTokens.status.info
        FreshnessStatus.Stale -> TeslaTokens.status.warning
        FreshnessStatus.Error -> TeslaTokens.status.danger
        FreshnessStatus.Offline -> TeslaTokens.status.warning
    }

/** The icon for a freshness tier — Wifi when connected/stale, WifiOff on failure, Refresh while fetching. */
private fun statusIcon(status: FreshnessStatus): ImageVector =
    when (status) {
        FreshnessStatus.Fresh -> WifiOnGlyph
        FreshnessStatus.Stale -> WifiOnGlyph
        FreshnessStatus.Fetching -> FeedbackGlyphs.Refresh
        FreshnessStatus.Error -> FeedbackGlyphs.WifiOff
        FreshnessStatus.Offline -> FeedbackGlyphs.WifiOff
    }

/** Resolves the relative-time label to its localized string (web `relativeTime`); empty for never-updated. */
@Composable
private fun relativeText(label: RelativeLabel): String =
    when (label.unit) {
        RelativeUnit.JustNow -> stringResource(R.string.translation_freshness_justNow)
        RelativeUnit.Minutes -> stringResource(R.string.translation_freshness_minutes, label.value)
        RelativeUnit.Hours -> stringResource(R.string.translation_freshness_hours, label.value)
        RelativeUnit.Days -> stringResource(R.string.translation_freshness_days, label.value)
        RelativeUnit.Weeks -> stringResource(R.string.translation_freshness_weeks, label.value)
        RelativeUnit.Updating -> stringResource(R.string.translation_freshness_updating)
        RelativeUnit.Error -> stringResource(R.string.translation_freshness_error)
        RelativeUnit.None -> ""
    }

/** Resolves the tooltip / state-description to its localized string (web `title`). */
@Composable
private fun tooltipText(tooltip: FreshnessTooltip): String =
    when (tooltip.kind) {
        TooltipKind.Updating -> stringResource(R.string.translation_freshness_updatingTooltip)
        TooltipKind.NeverUpdated -> stringResource(R.string.translation_freshness_neverUpdated)
        TooltipKind.LastUpdated -> {
            val context = LocalContext.current
            val atMs = tooltip.atMs ?: 0L
            val time = remember(atMs) { DateFormat.getTimeFormat(context).format(Date(atMs)) }
            stringResource(R.string.translation_freshness_lastUpdated, time)
        }
    }

/**
 * The "connected" wifi glyph (the web `Wifi` icon) — authored here as a 24×24 stroked vector because neither
 * `TeslaGlyphs` nor `FeedbackGlyphs` ships an upward-fanning wifi-on glyph (only the wifi-off variant). Drawn
 * monochrome and recolored at render time by the [Icon] tint, exactly like the sibling glyph sets.
 */
private val WifiOnGlyph: ImageVector =
    ImageVector
        .Builder(
            name = "WifiOn",
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
            ) {
                moveTo(5f, 12f)
                curveTo(9f, 8.5f, 15f, 8.5f, 19f, 12f)
                moveTo(8f, 15f)
                curveTo(10.3f, 13f, 13.7f, 13f, 16f, 15f)
                moveTo(12f, 18.4f)
                lineTo(12.1f, 18.4f)
            }
        }.build()

// ── Previews (tooling-only; sample timestamps are never shipped UI) ────────────────────────────────────

private const val PREVIEW_MINUTES_AGO_MS = 3 * 60 * 1_000L

private fun previewRender(
    snapshot: FreshnessSnapshot,
    refetchable: Boolean = true,
): FreshnessRender =
    DataFreshnessProjection.render(
        snapshot = snapshot,
        nowMs = PREVIEW_MINUTES_AGO_MS,
        reduceMotion = true,
        refetchable = refetchable,
        forceStaleAfterMs = null,
    )

private val previewFreshSnapshot =
    FreshnessSnapshot(0L, fetching = false, stale = false, hardError = false, offline = false, hasData = true, empty = false)
private val previewFetchingSnapshot =
    FreshnessSnapshot(null, fetching = true, stale = false, hardError = false, offline = false, hasData = false, empty = false)
private val previewStaleSnapshot =
    FreshnessSnapshot(0L, fetching = false, stale = true, hardError = false, offline = false, hasData = true, empty = false)
private val previewErrorSnapshot =
    FreshnessSnapshot(null, fetching = false, stale = false, hardError = true, offline = false, hasData = false, empty = false)
private val previewOfflineSnapshot =
    FreshnessSnapshot(0L, fetching = false, stale = true, hardError = false, offline = true, hasData = true, empty = false)
private val previewNeverSnapshot =
    FreshnessSnapshot(null, fetching = false, stale = false, hardError = false, offline = false, hasData = false, empty = false)

@Preview(name = "Fresh — 3m ago", showBackground = true)
@Composable
private fun DataFreshnessFreshPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            DataFreshnessChip(render = previewRender(previewFreshSnapshot), onRefresh = {})
        }
    }
}

@Preview(name = "Fetching — updating…", showBackground = true)
@Composable
private fun DataFreshnessFetchingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            DataFreshnessChip(render = previewRender(previewFetchingSnapshot))
        }
    }
}

@Preview(name = "Stale — amber", showBackground = true)
@Composable
private fun DataFreshnessStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            DataFreshnessChip(render = previewRender(previewStaleSnapshot), onRefresh = {})
        }
    }
}

@Preview(name = "Error — red", showBackground = true)
@Composable
private fun DataFreshnessErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            DataFreshnessChip(
                render = previewRender(previewErrorSnapshot),
                onRefresh = {},
            )
        }
    }
}

@Preview(name = "Offline — last known", showBackground = true)
@Composable
private fun DataFreshnessOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            DataFreshnessChip(render = previewRender(previewOfflineSnapshot), onRefresh = {})
        }
    }
}

@Preview(name = "Never updated", showBackground = true)
@Composable
private fun DataFreshnessNeverUpdatedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            DataFreshnessChip(
                render = previewRender(previewNeverSnapshot),
                onRefresh = {},
            )
        }
    }
}

@Preview(name = "Compact — icon only", showBackground = true)
@Composable
private fun DataFreshnessCompactPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            DataFreshnessChip(render = previewRender(previewFreshSnapshot), compact = true, onRefresh = {})
        }
    }
}
