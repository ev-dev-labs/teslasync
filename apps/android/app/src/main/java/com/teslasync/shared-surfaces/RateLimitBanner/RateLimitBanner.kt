// The native Jetpack Compose + Material 3 RateLimitBanner shared surface — a parity port of
// web/src/components/feedback/RateLimitBanner.tsx. The web surface is the sticky, amber status banner shown
// when the resilient HTTP client (web `resilientFetch`) has either been rate-limited (HTTP 429) or fast-failed
// against an open Tesla upstream breaker (HTTP 503 `UPSTREAM_BREAKER_OPEN`): an icon chip (a Clock for the
// rate-limit countdown, an AlertCircle for the upstream outage), a single live "…retry in Ns" message, a
// "Retry now" primary action that stays disabled until the countdown elapses, and a dismiss (✕). On retry the
// web clears the banner AND invalidates every TanStack query so pages refetch; the native
// [RateLimitBannerSource.retryAll] is that argument-less refresh.
//
// There is no native AlertBanner content-slot that fits (the shared AlertBanner takes a flat message + two
// fixed action slots and cannot host this banner's icon-chip + inline-countdown + disabled-until-ready button
// emphasis), so the chrome is composed here from the shared atoms (the feedback Tone palette, Button,
// IconButton, BodyText, Icon) — the same approach the sibling AiLimitBanner takes. The two lucide glyphs the
// web uses (Clock / AlertCircle) have no TeslaGlyphs counterpart, so they are authored locally as 24×24
// stroked vectors in the exact idiom of the shared glyph set (monochrome, recolored at render by the icon
// tint). Every visible string resolves through the i18n catalog (P1/S10); the banner carries the live message
// as its merged TalkBack announcement and is marked a polite live region (the web `aria-live="polite"`).
//
// All derivation flows through the pure reducers in RateLimitBannerModel.kt; this composable only owns the
// signal subscription, the per-second countdown ticker (the web `useState` + `setInterval`), and the one-shot
// `view.opened` diagnostic (P1/S11). It performs NO HTTP and never touches the platform event bus directly —
// it observes [RateLimitBannerSource] (ADR-002).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/RateLimitBanner) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ratelimitbanner

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
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
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.toneColors
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** The banner border — a 1 px hairline tinted to the amber tone (web `border-b border-amber-300/30`). */
private val BANNER_BORDER_WIDTH: Dp = 1.dp

/** Soft tint behind the leading icon (web `bg-amber-300/15`). */
private const val ICON_CHIP_ALPHA: Float = 0.15f

/** One countdown tick — the web `setInterval(…, 1000)` cadence. */
private const val TICK_INTERVAL_MS: Long = 1_000L

/**
 * Stateful entry point — the faithful port of the web `RateLimitBanner`. Records the one-shot `view.opened`
 * diagnostic, subscribes to the resilience [RateLimitBannerSource.signals] (the web document-event listeners),
 * folds each signal into the live state, drives the per-second countdown (the web `useState` + `setInterval`,
 * restarted whenever a fresh signal arrives), and renders the banner. Renders nothing until a signal arrives
 * (web `state === null` → `null`). Performs no HTTP; [logger] defaults to the process logger.
 *
 * @param source the resilience seam (P1/S8) — its [RateLimitBannerSource.signals] stream replaces the web
 *   `teslasync:rate-limited` / `teslasync:upstream-down` document events, and [RateLimitBannerSource.retryAll]
 *   replaces the web `qc.invalidateQueries()`.
 */
@Composable
fun RateLimitBanner(
    source: RateLimitBannerSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { RateLimitBannerDiagnostics.recordViewOpened(logger) }

    var state by remember { mutableStateOf<RateLimitState?>(null) }
    var nowMillis by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(source) {
        source.signals.collect { signal ->
            val now = System.currentTimeMillis()
            state = stateFromSignal(signal, now)
            nowMillis = now
        }
    }

    // Tick once per second only while a countdown is in flight — the web `setInterval` is mounted only while
    // the banner is visible. Keyed on `state` so a fresh signal restarts the countdown and a clear stops it.
    LaunchedEffect(state) {
        val active = state ?: return@LaunchedEffect
        nowMillis = System.currentTimeMillis()
        while (remainingSeconds(active.expiresAtMillis, System.currentTimeMillis()) > 0) {
            delay(TICK_INTERVAL_MS)
            nowMillis = System.currentTimeMillis()
        }
        nowMillis = System.currentTimeMillis()
    }

    RateLimitBannerContent(
        surface = classify(state, nowMillis),
        modifier = modifier,
        onRetry = {
            state = null
            scope.launch { source.retryAll() }
        },
        onDismiss = { state = null },
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Renders the banner when
 * [surface] is [RateLimitSurface.Visible], or nothing when it is [RateLimitSurface.Hidden] (web `state === null`
 * → `null`). Deterministic: the live countdown is already reduced into [surface], so no clock is read here.
 */
@Composable
fun RateLimitBannerContent(
    surface: RateLimitSurface,
    modifier: Modifier = Modifier,
    onRetry: () -> Unit = {},
    onDismiss: () -> Unit = {},
) {
    if (surface !is RateLimitSurface.Visible) return
    RateLimitAlert(visible = surface, modifier = modifier, onRetry = onRetry, onDismiss = onDismiss)
}

/** The web banner chrome: an amber-tinted, bordered surface with the icon chip, copy, Retry, and dismiss. */
@Composable
private fun RateLimitAlert(
    visible: RateLimitSurface.Visible,
    modifier: Modifier = Modifier,
    onRetry: () -> Unit = {},
    onDismiss: () -> Unit = {},
) {
    val colors = toneColors(Tone.Warning)
    val message =
        when (visible.kind) {
            RateLimitKind.RateLimited ->
                stringResource(R.string.translation_ratelimit_banner, visible.remainingSeconds)
            RateLimitKind.UpstreamDown ->
                stringResource(R.string.translation_upstream_banner, visible.remainingSeconds)
        }
    val icon =
        when (visible.kind) {
            RateLimitKind.RateLimited -> RateLimitGlyphs.Clock
            RateLimitKind.UpstreamDown -> RateLimitGlyphs.AlertCircle
        }
    val retryLabel = stringResource(R.string.translation_ratelimit_retry)
    val dismissLabel = stringResource(R.string.translation_common_dismiss)

    Surface(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics {
                    liveRegion = LiveRegionMode.Polite
                    contentDescription = message
                },
        shape = RoundedCornerShape(Radius.md),
        color = colors.background,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(BANNER_BORDER_WIDTH, colors.border),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.sm),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier =
                    Modifier
                        .background(colors.foreground.copy(alpha = ICON_CHIP_ALPHA), RoundedCornerShape(Radius.sm))
                        .padding(Spacing.xs),
            ) {
                Icon(icon, contentDescription = null, size = IconSize.Md, tint = colors.foreground)
            }
            BodyText(message, modifier = Modifier.weight(1f))
            Button(
                label = retryLabel,
                onClick = onRetry,
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
                enabled = visible.retryEnabled,
            )
            IconButton(
                imageVector = TeslaGlyphs.Close,
                contentDescription = dismissLabel,
                onClick = onDismiss,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

// ── Local glyphs (tooling-parity for the two lucide icons the web uses) ─────────────────────────────────────
// Authored in the exact idiom of the shared TeslaGlyphs set — 24×24, 2 px round-capped stroke, drawn in opaque
// black and recolored at render time by the Icon `tint` — because the web Clock / AlertCircle have no shared
// counterpart and editing the shared glyph set is out of this surface's scope.

private val GLYPH_SIZE: Dp = 24.dp
private const val GLYPH_VIEWPORT: Float = 24f
private const val GLYPH_STROKE: Float = 2f

private object RateLimitGlyphs {
    /** A clock face with two hands — the rate-limit countdown icon (web lucide `Clock`). */
    val Clock: ImageVector =
        strokedGlyph("RateLimitClock") {
            circlePath(12f, 12f, 8f)
            moveTo(12f, 7.5f)
            lineTo(12f, 12f)
            lineTo(15.5f, 13.5f)
        }

    /** A circle with an exclamation — the upstream-outage icon (web lucide `AlertCircle`). */
    val AlertCircle: ImageVector =
        strokedGlyph("RateLimitAlertCircle") {
            circlePath(12f, 12f, 9f)
            moveTo(12f, 7.5f)
            lineTo(12f, 13f)
            dotPath(12f, 16f)
        }
}

private fun strokedGlyph(
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

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs (mirrors TeslaGlyphs). */
private fun PathBuilder.circlePath(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}

/** A round-capped near-zero-length segment renders as a filled dot at ([x], [y]) (mirrors TeslaGlyphs). */
private fun PathBuilder.dotPath(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + 0.1f, y)
}

// ── Previews (tooling-only) ─────────────────────────────────────────────────────────────────────────────────
// Each renders a representative Visible surface: a rate-limit mid-countdown (Retry disabled), the same once the
// countdown elapses (Retry enabled), and an upstream outage mid-countdown.

@Preview(name = "Rate limited — counting down", showBackground = true)
@Composable
private fun RateLimitBannerCountingDownPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RateLimitBannerContent(
            surface = RateLimitSurface.Visible(RateLimitKind.RateLimited, remainingSeconds = 12, retryEnabled = false),
        )
    }
}

@Preview(name = "Rate limited — retry ready", showBackground = true)
@Composable
private fun RateLimitBannerRetryReadyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RateLimitBannerContent(
            surface = RateLimitSurface.Visible(RateLimitKind.RateLimited, remainingSeconds = 0, retryEnabled = true),
        )
    }
}

@Preview(name = "Upstream down — counting down", showBackground = true)
@Composable
private fun RateLimitBannerUpstreamPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RateLimitBannerContent(
            surface = RateLimitSurface.Visible(RateLimitKind.UpstreamDown, remainingSeconds = 27, retryEnabled = false),
        )
    }
}
