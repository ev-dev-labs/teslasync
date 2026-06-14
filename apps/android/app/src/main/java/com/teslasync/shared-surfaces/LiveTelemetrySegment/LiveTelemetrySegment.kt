// The native Jetpack Compose + Material 3 LiveTelemetrySegment shared surface — a parity port of
// web/src/components/layout/status-bar/LiveTelemetrySegment.tsx. The web component is a DENSE single-line
// footer status-bar segment that mirrors the sibling `LiveIndicator` in a compact form, reflecting the live
// SSE pipeline freshness derived from `useLiveConnection` (status + lastMessageAt): a colored status dot, a
// connection glyph (spinning while reconnecting), a short label, and an inline "· {Xs}" age stamp while
// connected. The whole segment is a tap target that navigates to the live signal explorer (web `<Link
// to="/signal-diff">`) and carries a tooltip ("Live telemetry stream · Last message {age} ago").
//
// This surface is the native equivalent. All data flows through the shared [LiveTelemetrySegmentViewModel]
// over the [LiveTelemetrySegmentSource] seam (P1/S8) — the view performs NO HTTP and opens no stream
// directly. Every derivation flows through the pure [LiveTelemetrySegmentProjection]; the composable is a thin
// render layer. The faithful mapping of the web behaviour:
//   • `useLiveConnection()` (status + lastMessageAt) → the injected [source], re-shared by the ViewModel into
//     the [LiveTelemetrySegmentViewModel.snapshot] flow (never HTTP from the view).
//   • the web `cfg[status]` color + icon + label → [liveConnectionColor] + [statusIcon] + [statusShortLabel],
//     one per [LiveConnectionStatus] (connected / reconnecting / disconnected / unknown).
//   • the web seconds-first `ageSecondsLabel` → [LiveTelemetrySegmentProjection.ageLabel] rendered as the
//     compact "12s" / "3m" / "2h" / "—" stamp, shown inline only while connected with a known last-message
//     time and the label visible (web `!iconOnly && status === 'connected' && lastMessageAt`).
//   • the web `iconOnly` prop → the [iconOnly] parameter that drops the label + age stamp to a bare dot +
//     icon (still never blank).
//   • the web reconnecting `animate-spin` Loader2 → the native infinite icon spin, suppressed under reduced
//     motion (TalkBack "remove animations").
//   • the web `<Tooltip content={tooltipBody}>` → the shared Material 3 [Tooltip]; the connected branch reads
//     "{tooltip} · Last message {age} ago", the others "{tooltip} · {short}".
//   • the web `<Link to="/signal-diff" aria-label=…>` → a single labelled `Role.Button` semantics node that
//     fires the caller-supplied [onActivate] navigation (the host wires it to the `signalDiff` destination),
//     mirroring the GuardedLink "caller supplies navigate" seam.
//
// States reproduced (every one renders a non-blank segment): the connected segment with a live age stamp
// ("Live · 12s"), the connected-but-stale segment (web parity — connected with an aged stamp), reconnecting
// (amber, spinning, "Reconnecting"), disconnected ("Offline"), and the cold-start unknown ("Idle" — the
// loading / empty surface), plus the dense `iconOnly` form. The one-shot `view.opened` diagnostic (P1/S11) is
// emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/LiveTelemetrySegment) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.livetelemetrysegment

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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
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
import io.teslasync.android.components.ui.Tooltip
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay

/** Test tag identifying the segment tap target — used by the instrumented per-state + a11y UI tests. */
const val LIVE_TELEMETRY_SEGMENT_TEST_TAG: String = "live-telemetry-segment"

/** The status-dot diameter — the native mirror of the web `h-1.5 w-1.5` (6px) dot. */
private val DOT_SIZE: Dp = 6.dp

/** Re-render cadence keeping the seconds-granularity age stamp ("12s" → "13s") accurate while the wire is up. */
private const val AGE_TICK_MS = 1_000L

private const val SPIN_PERIOD_MS = 1_000
private const val FULL_ROTATION_DEG = 360f

/** The "· " bullet the web prepends to the inline age stamp (a middle dot, not translatable text). */
private const val INLINE_AGE_BULLET = "\u00b7 "

/** The " · " separator joining the tooltip's two clauses (web `{tooltip} · {…}`) — locale-neutral punctuation. */
private const val TOOLTIP_SEPARATOR = " \u00b7 "

/** The ": " join between the aria role and the status label (web `{aria}: {short}`) — locale-neutral. */
private const val ARIA_SEPARATOR = ": "

/** The em dash the compact stamp shows for a missing / future age (web `ageSecondsLabel` "—"). */
private const val AGE_DASH = "\u2014"

// Locale-neutral SI-style time-unit abbreviations the web `ageSecondsLabel` appends verbatim ("12s"/"3m"/"2h").
private const val UNIT_SECONDS = "s"
private const val UNIT_MINUTES = "m"
private const val UNIT_HOURS = "h"

/**
 * Stateful entry point bound to the app-scoped live pipeline — the faithful port of the web
 * `LiveTelemetrySegment` reading `useLiveConnection`. Binds the [LiveTelemetrySegmentViewModel], records the
 * one-shot `view.opened` diagnostic (P1/S11), collects the live wire-health snapshot, re-renders on a 1s
 * cadence to keep the seconds-granularity age stamp accurate, and projects it into the render the stateless
 * segment paints.
 *
 * @param modifier optional layout modifier for the segment tap target.
 * @param iconOnly the web `iconOnly` prop — drops the label + age stamp to a bare dot + icon for ultra-dense
 *   chrome (the dot + icon always render, so the surface is never blank).
 * @param onActivate the navigation action fired on tap — the host wires it to the `signalDiff` destination
 *   (web `<Link to="/signal-diff">`); defaults to a no-op so the segment is safe to preview / embed standalone.
 * @param source the live wire-health seam; defaults to the app-scoped live session store
 *   ([asLiveTelemetrySegmentSource]).
 * @param logger the sanctioned redacting logger; defaults to the app's [io.teslasync.android.data.DataContainer].
 */
@Composable
fun LiveTelemetrySegment(
    modifier: Modifier = Modifier,
    iconOnly: Boolean = false,
    onActivate: () -> Unit = {},
    source: LiveTelemetrySegmentSource = LocalDataContainer.current.liveSessionStore.asLiveTelemetrySegmentSource(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: LiveTelemetrySegmentViewModel =
        viewModel(
            key = LiveTelemetrySegmentRegistration.ID,
            factory = LiveTelemetrySegmentViewModel.factory(source, logger),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val snapshot by viewModel.snapshot.collectAsStateWithLifecycle()
    val reduceMotion = rememberReducedMotion()

    // Re-render every second so the seconds-granularity age stamp stays accurate while the wire is live; the
    // timer restarts whenever a new message resets the last-message clock (web re-renders on each heartbeat).
    val nowMs by produceState(initialValue = System.currentTimeMillis(), snapshot.lastMessageAtMillis) {
        while (true) {
            value = System.currentTimeMillis()
            delay(AGE_TICK_MS)
        }
    }

    val render = LiveTelemetrySegmentProjection.render(snapshot, iconOnly, nowMs, reduceMotion)
    LiveTelemetrySegmentContent(render = render, onActivate = onActivate, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Paints the dense live-wire segment from a
 * fully resolved [render]: the status dot, the status icon (web Wifi / spinning Loader2 / WifiOff), the short
 * label (web `!iconOnly`), and the inline "· {age}" stamp (web connected pill). The whole segment is a single
 * labelled `Role.Button` accessibility node carrying the status aria label and firing [onActivate] (web `<Link
 * aria-label>` to `/signal-diff`); a Material 3 [Tooltip] surfaces the longer status sentence on hover /
 * long-press. Even in `iconOnly` the dot + icon always render, so the segment is never blank.
 */
@Composable
fun LiveTelemetrySegmentContent(
    render: LiveTelemetryRender,
    onActivate: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val color = liveConnectionColor(render.status)
    val label = statusShortLabel(render.status)
    val ageText = ageString(render.age)
    val tooltipText = tooltipBody(render, label, ageText)
    val aria = stringResource(R.string.translation_statusBar_live_aria) + ARIA_SEPARATOR + label

    Tooltip(text = tooltipText) {
        Row(
            modifier =
                modifier
                    .testTag(LIVE_TELEMETRY_SEGMENT_TEST_TAG)
                    .clip(RoundedCornerShape(Radius.sm))
                    .clickable(role = Role.Button, onClick = onActivate)
                    .padding(horizontal = Spacing.sm, vertical = Spacing.xs)
                    .semantics(mergeDescendants = true) { contentDescription = aria },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Box(
                modifier =
                    Modifier
                        .size(DOT_SIZE)
                        .clip(CircleShape)
                        .background(color),
            )
            StatusIcon(icon = statusIcon(render.status), color = color, spin = render.spin)
            if (render.showLabel) {
                Text(
                    text = label,
                    style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Medium),
                    color = color,
                )
                if (render.showInlineAge) {
                    Text(
                        text = INLINE_AGE_BULLET + ageText,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
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
            val transition = rememberInfiniteTransition(label = "liveTelemetrySegmentSpin")
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

/** The localized short label for a wire-health tier (web `cfg[status].short`). */
@Composable
private fun statusShortLabel(status: LiveConnectionStatus): String =
    stringResource(
        when (status) {
            LiveConnectionStatus.Connected -> R.string.translation_statusBar_live_short
            LiveConnectionStatus.Reconnecting -> R.string.translation_statusBar_live_reconnecting
            LiveConnectionStatus.Disconnected -> R.string.translation_statusBar_live_offline
            LiveConnectionStatus.Unknown -> R.string.translation_statusBar_live_unknown
        },
    )

/** The icon for a wire-health tier — Wifi when connected, a spinner while reconnecting, WifiOff when down. */
private fun statusIcon(status: LiveConnectionStatus): ImageVector =
    when (status) {
        LiveConnectionStatus.Connected -> DataDisplayGlyphs.Wifi
        LiveConnectionStatus.Reconnecting -> FeedbackGlyphs.Refresh
        LiveConnectionStatus.Disconnected -> DataDisplayGlyphs.WifiOff
        LiveConnectionStatus.Unknown -> DataDisplayGlyphs.WifiOff
    }

/**
 * The compact age stamp string — the native mirror of the web `ageSecondsLabel`: "—" for a missing / future
 * age, otherwise the whole-unit count plus the locale-neutral SI-style symbol ("12s" / "3m" / "2h").
 */
private fun ageString(age: AgeLabel): String =
    when (age.unit) {
        AgeUnit.None -> AGE_DASH
        AgeUnit.Seconds -> "${age.value}$UNIT_SECONDS"
        AgeUnit.Minutes -> "${age.value}$UNIT_MINUTES"
        AgeUnit.Hours -> "${age.value}$UNIT_HOURS"
    }

/**
 * The tooltip sentence — the native mirror of the web `tooltipBody`: while connected it reads
 * "{tooltip} · Last message {age} ago", otherwise "{tooltip} · {short}". Every clause resolves through the
 * P1/S10 catalog; only the middle-dot separator is a locale-neutral literal.
 */
@Composable
private fun tooltipBody(
    render: LiveTelemetryRender,
    label: String,
    ageText: String,
): String {
    val base = stringResource(R.string.translation_statusBar_live_tooltip)
    val tail =
        if (render.connected) {
            stringResource(R.string.translation_statusBar_live_lastMessage, ageText)
        } else {
            label
        }
    return base + TOOLTIP_SEPARATOR + tail
}

// ── Previews (tooling-only; sample timestamps are never shipped UI) ────────────────────────────────────

private const val PREVIEW_NOW_MS = 3 * 60 * 1_000L

private fun previewRender(
    status: LiveConnectionStatus,
    iconOnly: Boolean = false,
    lastMessageAtMillis: Long? = PREVIEW_NOW_MS - 12_000L,
    stale: Boolean = false,
): LiveTelemetryRender =
    LiveTelemetrySegmentProjection.render(
        snapshot = LiveTelemetrySnapshot(status = status, lastMessageAtMillis = lastMessageAtMillis, stale = stale),
        iconOnly = iconOnly,
        nowMs = PREVIEW_NOW_MS,
        reduceMotion = true,
    )

@Preview(name = "Connected — Live · 12s", showBackground = true)
@Composable
private fun LiveTelemetrySegmentConnectedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            LiveTelemetrySegmentContent(render = previewRender(LiveConnectionStatus.Connected), onActivate = {})
        }
    }
}

@Preview(name = "Connected — stale (aged stamp)", showBackground = true)
@Composable
private fun LiveTelemetrySegmentStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            LiveTelemetrySegmentContent(
                render = previewRender(LiveConnectionStatus.Connected, lastMessageAtMillis = 0L, stale = true),
                onActivate = {},
            )
        }
    }
}

@Preview(name = "Reconnecting — amber", showBackground = true)
@Composable
private fun LiveTelemetrySegmentReconnectingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            LiveTelemetrySegmentContent(
                render = previewRender(LiveConnectionStatus.Reconnecting, lastMessageAtMillis = null),
                onActivate = {},
            )
        }
    }
}

@Preview(name = "Disconnected — Offline", showBackground = true)
@Composable
private fun LiveTelemetrySegmentDisconnectedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            LiveTelemetrySegmentContent(
                render = previewRender(LiveConnectionStatus.Disconnected, lastMessageAtMillis = null),
                onActivate = {},
            )
        }
    }
}

@Preview(name = "Unknown — cold start (Idle)", showBackground = true)
@Composable
private fun LiveTelemetrySegmentUnknownPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            LiveTelemetrySegmentContent(
                render = previewRender(LiveConnectionStatus.Unknown, lastMessageAtMillis = null),
                onActivate = {},
            )
        }
    }
}

@Preview(name = "Icon only — connected", showBackground = true)
@Composable
private fun LiveTelemetrySegmentIconOnlyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            LiveTelemetrySegmentContent(
                render = previewRender(LiveConnectionStatus.Connected, iconOnly = true),
                onActivate = {},
            )
        }
    }
}
