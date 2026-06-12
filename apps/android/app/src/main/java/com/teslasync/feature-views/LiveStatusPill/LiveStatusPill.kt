// The native Jetpack Compose + Material 3 LiveStatusPill feature view — a parity port of
// web/src/features/system/components/status/LiveStatusPill.tsx. The web component renders a compact rounded
// pill that reflects the /system-status SSE pump: a colored status dot (pulsing while reconnecting), a
// connection glyph, the state label, and a "· {updated X ago}" tail so an operator can verify the stream
// hasn't silently stopped. Three states drive the whole surface (web `TONE`): live → green + Activity glyph,
// reconnecting → amber + Wifi glyph + pulsing dot, offline → grey + WifiOff glyph.
//
// Every derivation flows through the pure [LiveStatusPillProjection]; the composable is a thin render layer.
// The surface binds no data hook — the owning /system-status page supplies the connection [state], the
// [lastUpdateAtMillis] stamp, and the [nowMillis] tick (web parity). The three state labels resolve through
// the generated i18n catalog (P1/S10) `live.connected` / `live.reconnecting` / `live.disconnected` keys and
// the relative tail through the `freshness.*` keys, so there is no English literal in this file. The web
// source hardcodes those strings; routing them through the catalog is the native upgrade (and the app-wide
// reconnecting label is "Reconnecting…", which this surface adopts). The one-shot `view.opened` diagnostic
// (P1/S11) is emitted on first composition.
//
// Color mapping (P1/S9 tokens, no ported Tailwind): the web green/amber tones map to `TeslaTokens.status`
// success/warning; the web `zinc` offline tone maps to the muted `colorScheme.onSurfaceVariant` (grey, not
// the danger red the shared LiveIndicator uses) to match the web exactly. Each tone paints the foreground at
// full strength, the pill wash at the web `/10` alpha, and the `ring-1` border at the web `/30` alpha. The
// web `animate-pulse` dot maps to an `infiniteRepeatable` alpha fade that snaps to a static dot when reduced
// motion is requested (P1/S9 `rememberReducedMotion`). The whole pill is a single polite live region (web
// `role="status"` + `aria-live="polite"`) announcing the state + freshness as one phrase.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/LiveStatusPill) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livestatuspill

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

// ── Geometry + the web alpha washes (reproduced exactly) ────────────────────────────────────────────────
private val DOT_SIZE: Dp = 8.dp // web `h-2 w-2`
private val BORDER_WIDTH: Dp = 1.dp // web `ring-1`
private const val PILL_BG_ALPHA = 0.10f // web `bg-*-500/10`
private const val PILL_RING_ALPHA = 0.30f // web `ring-*-400/30`

// ── Pulse (web `animate-pulse`: opacity 1 ↔ .5, ~1s each way) ────────────────────────────────────────────
private const val PULSE_MIN_ALPHA = 0.50f
private const val PULSE_DURATION_MS = 1000

private const val TABULAR_NUMS = "tnum" // web `tabular-nums`
private const val SEPARATOR = "\u00b7" // web `·`
private const val EM_DASH = "\u2014" // web `—`

/**
 * Stateful entry point — the faithful 1:1 port of the web `LiveStatusPill({ state, lastUpdateAt, now })`
 * props. Records the one-shot `view.opened` diagnostic on first composition (P1/S11), projects the props onto
 * a [LiveStatusPillDisplay] via the pure [LiveStatusPillProjection], and renders the pill. The surface binds
 * no data of its own; the owning page supplies the [state], the [lastUpdateAtMillis] stamp, and the
 * [nowMillis] tick (so the relative tail re-renders on a timer, web parity).
 *
 * @param state the live SSE connection state (web `state`).
 * @param lastUpdateAtMillis the epoch-millis stamp of the last update, or `null` (web `lastUpdateAt`).
 * @param nowMillis the current epoch-millis tick used to compute the relative tail (web `now`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun LiveStatusPill(
    state: LiveStatusState,
    lastUpdateAtMillis: Long?,
    nowMillis: Long,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { LiveStatusPillDiagnostics.recordViewOpened(logger) }
    val display =
        remember(state, lastUpdateAtMillis, nowMillis) {
            LiveStatusPillProjection.project(state, nowMillis, lastUpdateAtMillis)
        }
    LiveStatusPillContent(display = display, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point. Reproduces the web layout exactly: a rounded
 * pill (web `rounded-full px-2.5 py-1 ring-1`) holding a centered row of the tone-colored status dot, the
 * connection glyph, the state label, a muted separator, and the muted relative tail. The dot pulses while
 * the stream is reconnecting (unless reduced motion is requested); the whole pill is one polite live region
 * that announces the state + freshness as a single phrase.
 */
@Composable
fun LiveStatusPillContent(
    display: LiveStatusPillDisplay,
    modifier: Modifier = Modifier,
) {
    val tone = liveStatusTone(display.state)
    val label = liveStatusLabel(display.state)
    val formatAge = rememberLiveRelativeFormatter()
    val relativeText = formatAge(display.age)
    val freshnessPhrase = liveFreshnessPhrase(display.age, relativeText)
    val description = LiveStatusPillProjection.contentDescription(label, freshnessPhrase)
    val mutedColor = MaterialTheme.colorScheme.onSurfaceVariant

    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(Radius.pill),
        color = tone.background,
        contentColor = tone.foreground,
        border = BorderStroke(BORDER_WIDTH, tone.ring),
    ) {
        Row(
            modifier =
                Modifier
                    .padding(horizontal = Spacing.sm, vertical = Spacing.xs)
                    .clearAndSetSemantics {
                        contentDescription = description
                        liveRegion = LiveRegionMode.Polite
                    },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            StatusDot(color = tone.dot, pulse = display.pulse)
            Icon(
                imageVector = liveStatusIcon(display.state),
                contentDescription = null,
                size = IconSize.Sm,
                tint = tone.foreground,
            )
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Medium),
                color = tone.foreground,
            )
            Text(text = SEPARATOR, style = MaterialTheme.typography.labelMedium, color = mutedColor)
            Text(
                text = relativeText,
                style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = TABULAR_NUMS),
                color = mutedColor,
            )
        }
    }
}

/**
 * The leading status dot (web `h-2 w-2 rounded-full`). When [pulse] is set (the reconnecting state) the dot's
 * alpha loops between full and [PULSE_MIN_ALPHA] (web `animate-pulse`); reduced motion holds it static.
 */
@Composable
private fun StatusDot(
    color: Color,
    pulse: Boolean,
) {
    val reduceMotion = rememberReducedMotion()
    val alpha =
        if (pulse && !reduceMotion) {
            val transition = rememberInfiniteTransition(label = "live-status-pulse")
            transition
                .animateFloat(
                    initialValue = 1f,
                    targetValue = PULSE_MIN_ALPHA,
                    animationSpec = infiniteRepeatable(tween(PULSE_DURATION_MS), RepeatMode.Reverse),
                    label = "live-status-pulse-alpha",
                ).value
        } else {
            1f
        }
    Box(
        modifier =
            Modifier
                .size(DOT_SIZE)
                .clip(CircleShape)
                .background(color.copy(alpha = alpha)),
    )
}

/** Foreground / wash / border / dot tints for one [LiveStatusState] — the web per-tone color set. */
private data class LiveStatusTone(
    val foreground: Color,
    val background: Color,
    val ring: Color,
    val dot: Color,
)

/**
 * Maps a [LiveStatusState] onto its P1/S9 tone: live → success green, reconnecting → warning amber, offline →
 * the muted grey (web `zinc`). The wash and ring reuse the foreground at the web `/10` and `/30` alphas.
 */
@Composable
private fun liveStatusTone(state: LiveStatusState): LiveStatusTone {
    val base =
        when (state) {
            LiveStatusState.Live -> TeslaTokens.status.success
            LiveStatusState.Reconnecting -> TeslaTokens.status.warning
            LiveStatusState.Offline -> MaterialTheme.colorScheme.onSurfaceVariant
        }
    return LiveStatusTone(
        foreground = base,
        background = base.copy(alpha = PILL_BG_ALPHA),
        ring = base.copy(alpha = PILL_RING_ALPHA),
        dot = base,
    )
}

/** The connection glyph for a [LiveStatusState] — web lucide `Activity` (live) / `Wifi` / `WifiOff`. */
private fun liveStatusIcon(state: LiveStatusState): ImageVector =
    when (state) {
        LiveStatusState.Live -> LiveStatusPillGlyphs.Activity
        LiveStatusState.Reconnecting -> DataDisplayGlyphs.Wifi
        LiveStatusState.Offline -> DataDisplayGlyphs.WifiOff
    }

/** The localized state label, resolved through the P1/S10 catalog `live.*` keys (no English literal here). */
@Composable
private fun liveStatusLabel(state: LiveStatusState): String =
    stringResource(
        when (state) {
            LiveStatusState.Live -> R.string.translation_live_connected
            LiveStatusState.Reconnecting -> R.string.translation_live_reconnecting
            LiveStatusState.Offline -> R.string.translation_live_disconnected
        },
    )

/**
 * Localized relative-age formatter for the "updated X ago" tail (`freshness.*` keys) — the render-only
 * concern the sibling surfaces resolve, kept out of the pure projection so the model carries no English
 * microcopy. An unknown age renders the web em dash. The day/week branches are unreachable (the projection
 * caps at hours) but resolved for a correct, complete mapping.
 */
@Composable
private fun rememberLiveRelativeFormatter(): (FreshnessAge) -> String {
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

/**
 * The localized freshness phrase used in the accessibility label — "Never updated" (`freshness.neverUpdated`)
 * when the stamp is absent, otherwise "Last updated: {rel}" (`freshness.lastUpdated`). Reuses existing catalog
 * keys so the a11y string needs no new entry while still reading naturally for TalkBack.
 */
@Composable
private fun liveFreshnessPhrase(
    age: FreshnessAge,
    relativeText: String,
): String =
    if (age == FreshnessAge.Unknown) {
        stringResource(R.string.translation_freshness_neverUpdated)
    } else {
        stringResource(R.string.translation_freshness_lastUpdated, relativeText)
    }

/**
 * The one glyph this surface needs that the shared sets do not carry. The web uses lucide `Activity` for the
 * live state; Android ships no equivalent without the frozen `material-icons-extended` artifact, so — exactly
 * as the sibling `StatusHeader` does for its `Inbox` glyph — it is authored here as a 24×24 stroked vector
 * (the lucide `Activity` heartbeat polyline `M22 12h-4l-3 9L9 3l-3 9H2`). `Wifi` and `WifiOff` are reused from
 * `DataDisplayGlyphs`.
 */
private object LiveStatusPillGlyphs {
    val Activity: ImageVector =
        ImageVector
            .Builder(
                name = "Activity",
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
                    moveTo(22f, 12f)
                    lineTo(18f, 12f)
                    lineTo(15f, 21f)
                    lineTo(9f, 3f)
                    lineTo(6f, 12f)
                    lineTo(2f, 12f)
                }
            }.build()
}

// ── Previews (tooling-only; @Preview entry points exercise each state + relative-age branch) ─────────────

private const val PREVIEW_NOW = 1_700_000_000_000L
private const val PREVIEW_THREE_SECONDS = 3_000L
private const val PREVIEW_FORTY_TWO_SECONDS = 42_000L
private const val PREVIEW_NINETY_MINUTES = 5_400_000L

@Preview(name = "Live — just now", showBackground = true)
@Composable
private fun LiveStatusPillLivePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveStatusPillContent(
            LiveStatusPillProjection.project(LiveStatusState.Live, PREVIEW_NOW, PREVIEW_NOW - PREVIEW_THREE_SECONDS),
        )
    }
}

@Preview(name = "Reconnecting — 42s ago", showBackground = true)
@Composable
private fun LiveStatusPillReconnectingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveStatusPillContent(
            LiveStatusPillProjection.project(
                LiveStatusState.Reconnecting,
                PREVIEW_NOW,
                PREVIEW_NOW - PREVIEW_FORTY_TWO_SECONDS,
            ),
        )
    }
}

@Preview(name = "Offline — 1h ago", showBackground = true)
@Composable
private fun LiveStatusPillOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveStatusPillContent(
            LiveStatusPillProjection.project(LiveStatusState.Offline, PREVIEW_NOW, PREVIEW_NOW - PREVIEW_NINETY_MINUTES),
        )
    }
}

@Preview(name = "Live — never updated", showBackground = true)
@Composable
private fun LiveStatusPillNoStampPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        LiveStatusPillContent(LiveStatusPillProjection.project(LiveStatusState.Live, PREVIEW_NOW, null))
    }
}
