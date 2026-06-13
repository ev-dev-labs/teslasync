// The native Jetpack Compose + Material 3 SuspenseProgressBoundary shared surface — a parity port of
// web/src/components/feedback/SuspenseProgressBoundary.tsx and the web/src/lib/globalProgress.ts channel it
// drives. The web surface is a STRUCTURAL Suspense→progress bridge: while a code-split child is resolving its
// caller-supplied `fallback` is shown and a process-wide progress channel is activated; when the child
// resolves the channel is released. A single top-of-viewport bar (web `<TopProgress>`) reflects the channel.
//
// This file reproduces that composition faithfully and idiomatically:
//   • [SuspenseProgressBoundary] is the bridge — it shows the `fallback` while `loading` and the real
//     `content` once resolved, activating the channel for exactly the lifetime the fallback is on screen.
//   • [ProgressTrackingFallback] is the 1:1 of the web internal fallback wrapper: a DisposableEffect whose
//     start fires on enter and whose paired (idempotent) stop fires on leave — the web `useEffect(() =>
//     globalProgress.start(), [])` cleanup contract, which is StrictMode/double-dispose safe by construction.
//   • [GlobalProgressBar] is the channel's view — the native analogue of the web `<TopProgress>` that any host
//     mounts ONCE at the app root. It subscribes to the channel, advances the asymptotic trickle on the
//     [TRICKLE_INTERVAL_MS] cadence (the web `setInterval`), and renders the shared [TopProgress] atom. Because
//     that bar is always mounted at the root, its ticker IS the trickle cadence — exactly the web
//     globalProgress↔TopProgress relationship.
//
// All channel arithmetic flows through the pure reducers in SuspenseProgressBoundaryModel.kt; this composable
// owns only the per-tick coroutine and the one-shot `view.opened` diagnostic (P1/S11), and performs NO HTTP.
// The bar honours the platform reduced-motion preference (P1/S9 motion layer): when motion is reduced it shows
// a static determinate affordance instead of an advancing trickle. Its TalkBack announcement resolves through
// the i18n catalog (P1/S10). The surface paints no literal English.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/SuspenseProgressBoundary) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.suspenseprogressboundary

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.feedback.TopProgress
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

/**
 * The faithful port of the web `SuspenseProgressBoundary`. While [loading] (the lazy child is resolving) the
 * caller's [fallback] is shown and the shared progress [channel] is held active; once resolved the [content]
 * is shown and the channel is released. Records the one-shot `view.opened` diagnostic (P1/S11). Renders no bar
 * of its own — mount one [GlobalProgressBar] at the app root to visualise the channel, exactly as the web app
 * mounts a single `<TopProgress>`. Performs no HTTP; [logger] defaults to the process logger.
 *
 * @param loading whether the lazy region is still resolving (web: the Suspense fallback is mounted).
 * @param fallback the caller-supplied loading affordance shown while [loading] (web `fallback` prop).
 * @param channel the progress channel to drive; defaults to the process-wide [GlobalProgress] (web singleton).
 * @param logger the redacting diagnostics logger; defaults to the container's logger.
 * @param content the resolved region shown once [loading] is false (web `children`).
 */
@Composable
fun SuspenseProgressBoundary(
    loading: Boolean,
    fallback: @Composable () -> Unit,
    channel: GlobalProgressController = GlobalProgress,
    logger: Logger = LocalDataContainer.current.logger,
    content: @Composable () -> Unit,
) {
    LaunchedEffect(Unit) { SuspenseProgressBoundaryDiagnostics.recordViewOpened(logger) }

    when (boundaryPhase(loading)) {
        BoundaryPhase.Loading -> ProgressTrackingFallback(channel, fallback)
        BoundaryPhase.Loaded -> content()
    }
}

/**
 * The internal fallback wrapper — the only point at which the channel `start` / `stop` fire. Entering this
 * composable (because the boundary is loading) activates the channel; leaving it (because the lazy region
 * resolved, or the boundary left the tree) releases it. The 1:1 of the web `ProgressTrackingFallback`'s
 * `useEffect(() => globalProgress.start(), [])`: the returned stop is idempotent, so a double dispose can
 * never push the active count below zero.
 */
@Composable
private fun ProgressTrackingFallback(
    channel: GlobalProgressController,
    content: @Composable () -> Unit,
) {
    DisposableEffect(channel) {
        val stop = channel.start()
        onDispose { stop() }
    }
    content()
}

/**
 * The channel's view — the native analogue of the web `<TopProgress>`. Mount ONE at the app root. It subscribes
 * to [channel], advances the asymptotic trickle on the [TRICKLE_INTERVAL_MS] cadence while active, and renders
 * the shared [TopProgress] atom as a determinate 0..1 bar. Renders nothing while the channel is idle (web: the
 * bar is hidden at `progress = 0`, `active = false`).
 *
 * Reduced motion (P1/S9): when the platform requests reduced motion the trickle ticker is suspended and the
 * bar shows a static determinate affordance at its seeded position rather than an advancing animation. The bar
 * is an assertive-free polite live region announced via the i18n `a11y.loading` string (P1/S10).
 */
@Composable
fun GlobalProgressBar(
    modifier: Modifier = Modifier,
    channel: GlobalProgressController = GlobalProgress,
) {
    var active by remember(channel) { mutableStateOf(channel.snapshot().active) }
    var progress by remember(channel) { mutableFloatStateOf(channel.snapshot().progress) }

    DisposableEffect(channel) {
        val unsubscribe =
            channel.subscribe { isActiveNow, value ->
                active = isActiveNow
                progress = value
            }
        onDispose { unsubscribe() }
    }

    val reduceMotion = rememberReducedMotion()
    LaunchedEffect(active, reduceMotion, channel) {
        if (!active || reduceMotion) return@LaunchedEffect
        while (isActive) {
            delay(TRICKLE_INTERVAL_MS)
            channel.tick()
        }
    }

    if (!active) return

    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    TopProgress(
        progress = progressFraction(progress),
        modifier =
            modifier
                .fillMaxWidth()
                .semantics {
                    contentDescription = loadingLabel
                    liveRegion = LiveRegionMode.Polite
                },
    )
}

// ── Previews (tooling-only) ─────────────────────────────────────────────────────────────────────────────
// Each renders one faithful state of the surface: the trickling channel bar, the loading phase (bar + the
// caller's fallback), and the resolved phase (the real content, no bar). Reduced motion is forced so the
// snapshots are deterministic.

@Preview(name = "Channel bar — trickling", showBackground = true)
@Composable
private fun GlobalProgressBarPreview() {
    val channel = rememberSampleChannel()
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            GlobalProgressBar(channel = channel)
        }
    }
}

@Preview(name = "Loading phase — fallback shown", showBackground = true)
@Composable
private fun SuspenseProgressBoundaryLoadingPreview() {
    val channel = rememberSampleChannel()
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                GlobalProgressBar(channel = channel)
                SampleFallback()
            }
        }
    }
}

@Preview(name = "Resolved phase — content shown", showBackground = true)
@Composable
private fun SuspenseProgressBoundaryResolvedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SampleContent()
    }
}

/** A representative caller fallback — what the user sees while the lazy region resolves. */
@Composable
private fun SampleFallback() {
    Box(
        modifier = Modifier.fillMaxWidth().padding(Spacing.lg),
        contentAlignment = Alignment.Center,
    ) {
        Caption(stringResource(R.string.translation_common_loading))
    }
}

/** A representative resolved region — what replaces the fallback once the child has loaded. */
@Composable
private fun SampleContent() {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        BodyText(stringResource(R.string.translation_onboarding_ready))
    }
}

/** Ticks applied in previews so the bar shows a representative mid-trickle position rather than its seed. */
private const val SAMPLE_TICKS: Int = 8

/** A channel seeded to a representative mid-trickle position, for the deterministic previews above. */
@Composable
private fun rememberSampleChannel(): GlobalProgressController =
    remember {
        GlobalProgressController().apply {
            start()
            repeat(SAMPLE_TICKS) { tick() }
        }
    }
