// The native Jetpack Compose + Material 3 LiveIndicator shared surface — a parity port of
// web/src/components/data-display/LiveIndicator.tsx. The web component is an at-a-glance chip reflecting the
// health of the live-data wire (SSE), derived from `useLiveConnection`: an icon + label (+ a freshness stamp
// when connected) in one of three variants (pill / dot / compact).
//
// This surface is the native equivalent. All data flows through the shared [LiveIndicatorViewModel] over the
// [LiveIndicatorSource] seam (P1/S8) — the view performs NO HTTP and opens no stream directly. Every
// derivation flows through the pure [LiveIndicatorProjection]; the composable is a thin render layer. The
// faithful mapping of the web behaviour:
//   • `useLiveConnection()` (status + lastMessageAt) → the injected [source], re-shared by the ViewModel into
//     the [LiveIndicatorViewModel.snapshot] flow (never HTTP from the view).
//   • the web `cfg[status]` color + icon + label → [liveConnectionColor] + [statusIcon] + [statusLabel], one
//     per [LiveConnectionStatus] (connected / reconnecting / disconnected / unknown).
//   • the web `· {formatRelativeTime(lastMessageAt)}` pill stamp → the resolved "· {relative-time}" text,
//     shown only for the pill variant while connected (web `variant === 'pill' && status === 'connected'`).
//   • the web reconnecting `animate-spin` Loader2 → the native infinite icon spin, suppressed under reduced
//     motion (TalkBack "remove animations").
//   • the web `role="status"` + `aria-label={label}` → a single merged semantics node with a polite live
//     region carrying the status label.
//
// States reproduced (every one renders a non-blank chip / dot): the connected pill ("Live · 3m ago"), the
// connected-but-stale chip (web parity — connected with an aged stamp), reconnecting (amber, spinning),
// disconnected ("Offline"), and the cold-start unknown ("Unknown" — the loading / empty surface). The
// one-shot `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/LiveIndicator) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.liveindicator

import android.text.format.DateFormat
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.android.components.datadisplay.liveConnectionColor
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay
import java.util.Date

/** Test tag identifying the chip / dot container — used by the instrumented per-state + a11y UI tests. */
const val LIVE_INDICATOR_TEST_TAG: String = "live-indicator"

/** The bare-dot diameter — the native mirror of the web `h-2 w-2` (8px) dot. */
private val DOT_SIZE = 8.dp

/** Soft chip background tint over the status color — the native mirror of the web `bg-{color}/10`. */
private const val PILL_BG_ALPHA = 0.12f

/** Re-render cadence keeping the freshness stamp accurate ("just now" → "1m ago") as the wire stays live. */
private const val RELATIVE_TICK_MS = 30_000L

private const val SPIN_PERIOD_MS = 1_000
private const val FULL_ROTATION_DEG = 360f

/** The "· " separator the web pill prepends to the freshness stamp (a middle dot, not translatable text). */
private const val FRESHNESS_BULLET = "\u00b7 "

/**
 * Stateful entry point bound to the app-scoped live pipeline — the faithful port of the web `LiveIndicator`
 * reading `useLiveConnection`. Binds the [LiveIndicatorViewModel], records the one-shot `view.opened`
 * diagnostic (P1/S11), collects the live wire-health snapshot, re-renders on a 30s cadence to keep the
 * freshness stamp accurate, and projects it into the render the stateless chip paints.
 *
 * @param modifier optional layout modifier for the chip / dot container.
 * @param variant the visual variant (web `variant`): [LiveIndicatorVariant.Pill] (default),
 *   [LiveIndicatorVariant.Dot] for dense headers, or [LiveIndicatorVariant.Compact] for no freshness stamp.
 * @param source the live wire-health seam; defaults to the app-scoped live session store ([asLiveIndicatorSource]).
 * @param logger the sanctioned redacting logger; defaults to the app's [io.teslasync.android.data.DataContainer].
 */
@Composable
fun LiveIndicator(
    modifier: Modifier = Modifier,
    variant: LiveIndicatorVariant = LiveIndicatorVariant.Pill,
    source: LiveIndicatorSource = LocalDataContainer.current.liveSessionStore.asLiveIndicatorSource(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: LiveIndicatorViewModel =
        viewModel(
            key = LiveIndicatorRegistration.ID,
            factory = LiveIndicatorViewModel.factory(source, logger),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val snapshot by viewModel.snapshot.collectAsStateWithLifecycle()
    val reduceMotion = rememberReducedMotion()

    // Re-render periodically so the freshness stamp ("just now" → "5m ago") stays accurate; it only changes on
    // minute boundaries, so a 30s cadence is plenty (web re-renders on each heartbeat).
    val nowMs by produceState(initialValue = System.currentTimeMillis(), snapshot.lastMessageAtMillis) {
        while (true) {
            value = System.currentTimeMillis()
            delay(RELATIVE_TICK_MS)
        }
    }

    val render = LiveIndicatorProjection.render(snapshot, variant, nowMs, reduceMotion)
    LiveIndicatorChip(render = render, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Paints the live-wire chip from a fully
 * resolved [render]: the status icon (web Wifi / spinning Loader2 / WifiOff), the status label, and (for the
 * connected pill) the "· {relative-time}" freshness stamp. The whole chip is a single accessibility node with
 * a polite live region carrying the status label (web `role="status"` / `aria-label`). The dot variant is a
 * bare colored dot, also labelled — never blank.
 */
@Composable
fun LiveIndicatorChip(
    render: LiveRender,
    modifier: Modifier = Modifier,
) {
    val color = liveConnectionColor(render.status)
    val label = statusLabel(render.status)

    if (render.variant == LiveIndicatorVariant.Dot) {
        Box(
            modifier =
                modifier
                    .testTag(LIVE_INDICATOR_TEST_TAG)
                    .size(DOT_SIZE)
                    .clip(CircleShape)
                    .background(color)
                    .clearAndSetSemantics {
                        contentDescription = label
                        liveRegion = LiveRegionMode.Polite
                    },
        )
        return
    }

    Surface(
        modifier =
            modifier
                .testTag(LIVE_INDICATOR_TEST_TAG)
                .semantics(mergeDescendants = true) {
                    contentDescription = label
                    liveRegion = LiveRegionMode.Polite
                },
        shape = RoundedCornerShape(Radius.pill),
        color = color.copy(alpha = PILL_BG_ALPHA),
        contentColor = color,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            StatusIcon(icon = statusIcon(render.status), color = color, spin = render.spin)
            Text(text = label, style = MaterialTheme.typography.labelSmall, color = color)
            if (render.showFreshness) {
                Text(
                    text = FRESHNESS_BULLET + relativeText(render.freshness),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/** The status icon, spinning while reconnecting (web reconnecting `animate-spin`). */
@Composable
private fun StatusIcon(
    icon: ImageVector,
    color: Color,
    spin: Boolean,
) {
    val rotation =
        if (spin) {
            val transition = rememberInfiniteTransition(label = "liveIndicatorSpin")
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

/** The localized status label for a wire-health tier (web `cfg[status].label`). */
@Composable
private fun statusLabel(status: LiveConnectionStatus): String =
    when (status) {
        LiveConnectionStatus.Connected -> stringResource(R.string.translation_live_connected)
        LiveConnectionStatus.Reconnecting -> stringResource(R.string.translation_live_reconnecting)
        LiveConnectionStatus.Disconnected -> stringResource(R.string.translation_live_disconnected)
        LiveConnectionStatus.Unknown -> stringResource(R.string.translation_live_unknown)
    }

/** The icon for a wire-health tier — Wifi when connected, a spinner while reconnecting, WifiOff when down. */
private fun statusIcon(status: LiveConnectionStatus): ImageVector =
    when (status) {
        LiveConnectionStatus.Connected -> DataDisplayGlyphs.Wifi
        LiveConnectionStatus.Reconnecting -> FeedbackGlyphs.Refresh
        LiveConnectionStatus.Disconnected -> DataDisplayGlyphs.WifiOff
        LiveConnectionStatus.Unknown -> DataDisplayGlyphs.WifiOff
    }

/** Resolves the freshness stamp to its localized string (web `formatRelativeTime`); empty when never seen. */
@Composable
private fun relativeText(label: RelativeLabel): String =
    when (label.unit) {
        RelativeUnit.JustNow -> stringResource(R.string.translation_freshness_justNow)
        RelativeUnit.Minutes -> stringResource(R.string.translation_freshness_minutes, label.value)
        RelativeUnit.Hours -> stringResource(R.string.translation_freshness_hours, label.value)
        RelativeUnit.Absolute -> {
            val context = LocalContext.current
            val atMs = label.atMillis ?: 0L
            remember(atMs) { DateFormat.getDateFormat(context).format(Date(atMs)) }
        }
        RelativeUnit.None -> ""
    }

// ── Previews (tooling-only; sample timestamps are never shipped UI) ────────────────────────────────────

private const val PREVIEW_NOW_MS = 3 * 60 * 1_000L

private fun previewRender(
    status: LiveConnectionStatus,
    variant: LiveIndicatorVariant = LiveIndicatorVariant.Pill,
    lastMessageAtMillis: Long? = 0L,
    stale: Boolean = false,
): LiveRender =
    LiveIndicatorProjection.render(
        snapshot = LiveConnectionSnapshot(status = status, lastMessageAtMillis = lastMessageAtMillis, stale = stale),
        variant = variant,
        nowMs = PREVIEW_NOW_MS,
        reduceMotion = true,
    )

@Preview(name = "Connected — Live · 3m ago", showBackground = true)
@Composable
private fun LiveIndicatorConnectedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            LiveIndicatorChip(render = previewRender(LiveConnectionStatus.Connected))
        }
    }
}

@Preview(name = "Connected — stale (aged stamp)", showBackground = true)
@Composable
private fun LiveIndicatorStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            LiveIndicatorChip(render = previewRender(LiveConnectionStatus.Connected, stale = true))
        }
    }
}

@Preview(name = "Reconnecting — amber", showBackground = true)
@Composable
private fun LiveIndicatorReconnectingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            LiveIndicatorChip(render = previewRender(LiveConnectionStatus.Reconnecting, lastMessageAtMillis = null))
        }
    }
}

@Preview(name = "Disconnected — Offline", showBackground = true)
@Composable
private fun LiveIndicatorDisconnectedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            LiveIndicatorChip(render = previewRender(LiveConnectionStatus.Disconnected, lastMessageAtMillis = null))
        }
    }
}

@Preview(name = "Unknown — cold start", showBackground = true)
@Composable
private fun LiveIndicatorUnknownPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            LiveIndicatorChip(render = previewRender(LiveConnectionStatus.Unknown, lastMessageAtMillis = null))
        }
    }
}

@Preview(name = "Dot — connected", showBackground = true)
@Composable
private fun LiveIndicatorDotPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            LiveIndicatorChip(render = previewRender(LiveConnectionStatus.Connected, variant = LiveIndicatorVariant.Dot))
        }
    }
}
