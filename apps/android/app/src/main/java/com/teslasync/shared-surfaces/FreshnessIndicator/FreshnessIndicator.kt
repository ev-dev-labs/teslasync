// The native Jetpack Compose + Material 3 FreshnessIndicator shared surface — a parity port of the web
// per-datum freshness read-out web/src/components/data-display/FreshnessIndicator.tsx. The web surface places
// a small colored status dot (green + pulsing when fresh, amber when stale, red when offline, muted when the
// timestamp is missing) next to a relative-age label ("just now", "42s ago", "3m ago", "11h ago", "—") to
// show how recently a SPECIFIC data point was sampled, and re-renders every 10 seconds so the label never
// goes stale. It is NOT the live-pipe health indicator (that is `LiveIndicator`); a page can show a healthy
// live pipe and a stale FreshnessIndicator at once when the wire is up but the vehicle stopped emitting.
//
// Every derivation flows through the pure model in FreshnessIndicatorModel.kt (computeAge → status → age
// bucket, plus the `useIsStale` reduction); this file is the thin render layer that drives the 10s clock,
// maps the projected status onto the per-theme TeslaTokens status palette, resolves the localized label and
// accessible description from the shared P1/S10 catalog, animates the fresh-dot pulse (suppressed under
// reduced motion), and fires the one-shot PII-safe `view.opened` diagnostic (P1/S11). It performs NO HTTP.
// The whole read-out collapses into a single accessibility node carrying the spoken description, with the
// dot marked decorative — improving on the web source, which exposes only a `title` tooltip + a colour-only
// dot to assistive tech.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/FreshnessIndicator) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located hook, stateless renderer, helpers, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.freshnessindicator

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay

/** The dot's resting alpha at the bottom of the fresh pulse — the native analogue of the web `animate-pulse`. */
private const val PULSE_MIN_ALPHA: Float = 0.4f

/** Fresh-pulse half-cycle duration (ms); the alpha eases 0.4 ↔ 1.0 and back, a calm "this is live" heartbeat. */
private const val PULSE_DURATION_MS: Int = 1_200

/** Web `size="sm"` dot diameter (web `h-1.5 w-1.5`). */
private val DOT_SIZE_SM: Dp = 6.dp

/** Web `size="md"` dot diameter (web `h-2 w-2`). */
private val DOT_SIZE_MD: Dp = 8.dp

/**
 * Stateful entry point — the faithful port of the web `FreshnessIndicator`. Records the one-shot
 * `view.opened` diagnostic, drives the 10-second re-render clock (web `setInterval(…, 10_000)`), and renders
 * the dot + relative-age label for [timestampMillis]. Always renders (the web component never returns
 * `null`): a `null` / not-yet-resolved timestamp falls through to the muted "unknown" branch. Performs no
 * HTTP; [logger] defaults to the process logger.
 *
 * @param timestampMillis epoch millis the underlying datum was sampled (web `timestamp`); `null` → unknown.
 * @param staleThresholdSeconds seconds before the datum is "stale" (web `staleThreshold`, default 120).
 * @param offlineThresholdSeconds seconds before the datum is "offline" (web `offlineThreshold`, default 600).
 * @param showLabel whether to render the relative-age label beside the dot (web `showLabel`, default true).
 * @param size dot + label size variant (web `size`, default [FreshnessIndicatorSize.Sm]).
 */
@Composable
fun FreshnessIndicator(
    timestampMillis: Long?,
    modifier: Modifier = Modifier,
    staleThresholdSeconds: Long = FreshnessIndicatorDefaults.STALE_THRESHOLD_SECONDS,
    offlineThresholdSeconds: Long = FreshnessIndicatorDefaults.OFFLINE_THRESHOLD_SECONDS,
    showLabel: Boolean = true,
    size: FreshnessIndicatorSize = FreshnessIndicatorSize.Sm,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { FreshnessIndicatorDiagnostics.recordViewOpened(logger) }
    val now = rememberFreshnessClock(timestampMillis)
    FreshnessIndicatorContent(
        timestampMillis = timestampMillis,
        nowMillis = now,
        modifier = modifier,
        staleThresholdSeconds = staleThresholdSeconds,
        offlineThresholdSeconds = offlineThresholdSeconds,
        showLabel = showLabel,
        size = size,
    )
}

/**
 * The native port of the web `useIsStale(timestamp, staleThreshold)` hook — drives the same 10-second clock
 * and returns the live [FreshnessStaleness] (`isStale` / `isOffline` / `ageLabel`). Callers (e.g. a warning
 * banner) read it to decide whether to surface a "data may be stale" affordance, exactly as the web hook is
 * used; the returned `ageLabel` is an i18n-friendly descriptor the caller resolves through the catalog.
 */
@Composable
fun rememberFreshnessStaleness(
    timestampMillis: Long?,
    staleThresholdSeconds: Long = FreshnessIndicatorDefaults.STALE_THRESHOLD_SECONDS,
): FreshnessStaleness {
    val now = rememberFreshnessClock(timestampMillis)
    return remember(timestampMillis, now, staleThresholdSeconds) {
        freshnessStaleness(timestampMillis, now, staleThresholdSeconds)
    }
}

/**
 * The shared 10-second wall-clock both the indicator and [rememberFreshnessStaleness] re-render against —
 * the native analogue of the web `setInterval(() => setTick(...), 10_000)`. Seeds with the current time on
 * first composition and re-ticks every [FreshnessIndicatorDefaults.TICK_INTERVAL_MS]; the loop restarts when
 * [timestampMillis] changes and is cancelled on dispose.
 */
@Composable
private fun rememberFreshnessClock(timestampMillis: Long?): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(timestampMillis) {
        while (true) {
            delay(FreshnessIndicatorDefaults.TICK_INTERVAL_MS)
            now = System.currentTimeMillis()
        }
    }
    return now
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reduces
 * [timestampMillis] (relative to the supplied [nowMillis]) into a [FreshnessIndicatorProjection] and draws
 * the status dot + the muted relative-age label, collapsing the row into one accessibility node that speaks
 * the localized description (the dot is decorative). Carries no diagnostics and no clock, so a parent
 * rendering many indicators in a list never emits per-item events and previews stay deterministic.
 */
@Composable
fun FreshnessIndicatorContent(
    timestampMillis: Long?,
    nowMillis: Long,
    modifier: Modifier = Modifier,
    staleThresholdSeconds: Long = FreshnessIndicatorDefaults.STALE_THRESHOLD_SECONDS,
    offlineThresholdSeconds: Long = FreshnessIndicatorDefaults.OFFLINE_THRESHOLD_SECONDS,
    showLabel: Boolean = true,
    size: FreshnessIndicatorSize = FreshnessIndicatorSize.Sm,
) {
    val projection =
        remember(timestampMillis, nowMillis, staleThresholdSeconds, offlineThresholdSeconds) {
            projectFreshnessIndicator(timestampMillis, nowMillis, staleThresholdSeconds, offlineThresholdSeconds)
        }
    val description = freshnessA11yText(projection.a11y)
    val dotColor = freshnessDotColor(projection.status)
    val pulseAlpha = freshnessPulseAlpha(projection.status)

    Row(
        modifier = modifier.clearAndSetSemantics { contentDescription = description },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Box(
            modifier =
                Modifier
                    .size(freshnessDotSize(size))
                    .alpha(pulseAlpha)
                    .clip(CircleShape)
                    .background(dotColor),
        )
        if (showLabel) {
            Text(
                text = freshnessAgeLabelText(projection.ageLabel),
                style = freshnessLabelStyle(size),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** The dot diameter for the chosen [size] — web `h-1.5 w-1.5` (sm) / `h-2 w-2` (md). */
private fun freshnessDotSize(size: FreshnessIndicatorSize): Dp =
    when (size) {
        FreshnessIndicatorSize.Sm -> DOT_SIZE_SM
        FreshnessIndicatorSize.Md -> DOT_SIZE_MD
    }

/** The muted relative-age label's type ramp for the chosen [size] — web `text-[10px]` (sm) / `text-xs` (md). */
@Composable
private fun freshnessLabelStyle(size: FreshnessIndicatorSize): TextStyle =
    when (size) {
        FreshnessIndicatorSize.Sm -> MaterialTheme.typography.labelSmall
        FreshnessIndicatorSize.Md -> MaterialTheme.typography.labelMedium
    }

/**
 * Map the projected [FreshnessStatus] onto a per-theme dot colour — the native mirror of the web colour
 * rules (fresh → green, stale → amber, offline → red, unknown → muted), drawn from the TeslaTokens status
 * palette and the Material scheme so light / dark / high-contrast all stay correct.
 */
@Composable
@ReadOnlyComposable
private fun freshnessDotColor(status: FreshnessStatus): Color =
    when (status) {
        FreshnessStatus.Fresh -> TeslaTokens.status.success
        FreshnessStatus.Stale -> TeslaTokens.status.warning
        FreshnessStatus.Offline -> TeslaTokens.status.danger
        FreshnessStatus.Unknown -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/**
 * The dot's alpha — a calm pulse (0.4 ↔ 1.0) only while the datum is [FreshnessStatus.Fresh] and the user
 * has not requested reduced motion (web `status === 'fresh' && animate-pulse`); every other state, and every
 * user who opted out of motion, renders the dot fully opaque and still.
 */
@Composable
private fun freshnessPulseAlpha(status: FreshnessStatus): Float {
    val reduce = rememberReducedMotion()
    return if (status == FreshnessStatus.Fresh && !reduce) {
        val transition = rememberInfiniteTransition(label = "freshness-pulse")
        transition
            .animateFloat(
                initialValue = PULSE_MIN_ALPHA,
                targetValue = 1f,
                animationSpec = infiniteRepeatable(tween(PULSE_DURATION_MS), RepeatMode.Reverse),
                label = "freshness-pulse-alpha",
            ).value
    } else {
        1f
    }
}

/**
 * Resolve the visible relative-age label for the [label] bucket — the native mirror of the web `formatAge`
 * output. The em-dash is a typographic symbol (no localized word); every other bucket resolves through the
 * shared P1/S10 relative-time keys (`freshness.justNow` / `.seconds` / `.minutes` / `.hours`).
 */
@Composable
private fun freshnessAgeLabelText(label: FreshnessAgeLabel): String =
    when (label) {
        FreshnessAgeLabel.Unknown -> FRESHNESS_INDICATOR_DASH
        FreshnessAgeLabel.JustNow -> stringResource(R.string.translation_freshness_justNow)
        is FreshnessAgeLabel.Seconds -> stringResource(R.string.translation_freshness_seconds, label.value)
        is FreshnessAgeLabel.Minutes -> stringResource(R.string.translation_freshness_minutes, label.value)
        is FreshnessAgeLabel.Hours -> stringResource(R.string.translation_freshness_hours, label.value)
    }

/**
 * Resolve the spoken accessible description for the [a11y] descriptor — the unknown / empty branch speaks the
 * friendly `freshness.neverUpdated` ("Never updated") instead of the meaningless em-dash, and a present datum
 * speaks `a11y.dataFreshness` ("Data freshness: {age}") so a screen-reader user gets the recency the colour
 * dot conveys visually. Both keys resolve through the shared P1/S10 catalog.
 */
@Composable
private fun freshnessA11yText(a11y: FreshnessA11y): String =
    when (a11y) {
        FreshnessA11y.NeverUpdated -> stringResource(R.string.translation_freshness_neverUpdated)
        is FreshnessA11y.Freshness ->
            stringResource(R.string.translation_a11y_dataFreshness, freshnessAgeLabelText(a11y.ageLabel))
    }

// ── Previews (tooling-only; render a settled frame against a fixed clock, never shipped UI) ─────────────────

/** A fixed "now" so the previews render deterministic ages without reading the wall clock. */
private const val PREVIEW_NOW_MS: Long = 1_700_000_000_000

@Preview(name = "States — fresh / stale / offline / unknown", showBackground = true)
@Composable
private fun FreshnessIndicatorStatesPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            FreshnessIndicatorContent(timestampMillis = PREVIEW_NOW_MS - 5_000L, nowMillis = PREVIEW_NOW_MS)
            FreshnessIndicatorContent(timestampMillis = PREVIEW_NOW_MS - 42_000L, nowMillis = PREVIEW_NOW_MS)
            FreshnessIndicatorContent(timestampMillis = PREVIEW_NOW_MS - 200_000L, nowMillis = PREVIEW_NOW_MS)
            FreshnessIndicatorContent(timestampMillis = PREVIEW_NOW_MS - 700_000L, nowMillis = PREVIEW_NOW_MS)
            FreshnessIndicatorContent(timestampMillis = null, nowMillis = PREVIEW_NOW_MS)
        }
    }
}

@Preview(name = "Size md + dot-only (no label)", showBackground = true)
@Composable
private fun FreshnessIndicatorSizePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            FreshnessIndicatorContent(
                timestampMillis = PREVIEW_NOW_MS - 200_000L,
                nowMillis = PREVIEW_NOW_MS,
                size = FreshnessIndicatorSize.Md,
            )
            FreshnessIndicatorContent(
                timestampMillis = PREVIEW_NOW_MS - 700_000L,
                nowMillis = PREVIEW_NOW_MS,
                showLabel = false,
                size = FreshnessIndicatorSize.Md,
            )
        }
    }
}

@Preview(name = "Offline (dark)", showBackground = true)
@Composable
private fun FreshnessIndicatorDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        FreshnessIndicatorContent(timestampMillis = PREVIEW_NOW_MS - 3_700_000L, nowMillis = PREVIEW_NOW_MS)
    }
}
