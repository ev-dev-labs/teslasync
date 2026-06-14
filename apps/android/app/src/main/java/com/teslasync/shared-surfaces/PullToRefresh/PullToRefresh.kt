// The native Jetpack Compose + Material 3 PullToRefresh shared surface — a parity port of
// web/src/components/mobile/PullToRefresh.tsx. The web component is a native-feel pull-to-refresh wrapper for
// mobile lists: the user drags down from the top of a scroll container, a small arc grows with the pull, past
// the threshold the bar locks into "release to refresh", and releasing past it fires `onRefresh()` and shows
// "Refreshing…" until the returned promise settles. It is touch-only by default (`enabled` defaults to
// `useIsCoarsePointer()`), rubber-bands the pull past the threshold, ceilings it at MAX_PULL, and collapses the
// snap-back animation under reduced motion. Its only inputs are props (`onRefresh`, `threshold`, `enabled`,
// `children`) and its only hooks are `useIsCoarsePointer`, `useTranslation` (i18n), and `useMotionPreference`
// (reduced motion) — it fetches nothing. All pure derivations live in PullToRefreshModel.kt and are unit-tested
// off-device; this file is the thin render layer that wires the pull gesture, draws the indicator strip, offsets
// the content, resolves the localized labels, honors reduced motion, and fires the one-shot diagnostic.
//
// Because the web source owns no async feed (the host page owns the data and passes `onRefresh` down), it has NO
// loading / empty-fetch / error / stale / offline network lifecycle — exactly like the accepted presentational
// ports (TimelineScrubber, Spinner). Modelling one would invent a fetch the spec does not have (honesty covenant:
// no scope narrowing, no silent drift). The surface's REAL, fully-reproduced states are the inactive passthrough
// (a fine pointer renders the children straight through), the idle rest (no indicator, content unshifted — a
// usable surface, never a blank box, because the wrapped content shows), the active pull (the growing arc +
// "Pull to refresh"), the armed release point (the threshold reached → "Release to refresh"), and the running
// refresh (the spinner + "Refreshing…", held until `onRefresh` settles, then retracted on success OR failure so
// the indicator is never left stuck — the web `try/finally`). Each is exercised by the previews below, the
// off-device model test, and the on-device UI/a11y test.
//
// Parity choices:
//   • Gesture: web top-of-scroll touch drag with `{ passive: false }` `preventDefault` → a native
//     `NestedScrollConnection` over a scroll container. Overscroll past the top (the child consumed nothing) is
//     accumulated as the raw pull, projected through [resistedPull] (the same rubber-band + MAX_PULL ceiling as
//     the web), and consumed so the platform overscroll never fights the gesture (the web `preventDefault`). On
//     release [shouldFireRefresh] decides whether to run `onRefresh`; below the threshold the pull animates back
//     to rest (snapped instantly under reduced motion, the web 0 ms branch). The whole gesture is driven by the
//     pure model reducers, so the offline gate fully covers its logic.
//   • Touch-only default: web `enabled ?? useIsCoarsePointer()` → [rememberIsCoarsePointer], which reads the
//     platform `Configuration.touchscreen` (a `TOUCHSCREEN_NOTOUCH` device is a fine pointer and renders the
//     children straight through with no gesture), overridable through [LocalCoarsePointer] for previews/tests.
//   • Colors: web `bg-white/[0.06]` + `border-[var(--border-subtle)]` + `text-[var(--text-secondary)]` →
//     generated brand tokens, never a raw hex: the chip is an `onSurface` wash + hairline over the per-theme
//     surface, the arc + label use `onSurfaceVariant` (theme-correct on both light and dark, where the web
//     hard-codes white).
//   • i18n: every string resolves through the P1/S10 catalog — `mobile.refresh.pull` / `mobile.refresh.release`
//     / `mobile.refresh.refreshing`.
//   • Accessibility: the indicator chip carries the localized state as its contentDescription and becomes a
//     polite live region while refreshing (web `role="status"` + `aria-live="polite"`), so TalkBack announces the
//     refresh start; the decorative arc and the duplicate visible label are cleared from the a11y tree. Reduced
//     motion is honored (the arc stops spinning, the snap-back is instant).
//   • Diagnostics: records the one-shot PII-safe `view.opened` event (P1/S11) on first composition.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/PullToRefresh — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer, helpers, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pulltorefresh

import android.content.res.Configuration
import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.MotionDurations
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.launch
import kotlin.math.min
import kotlin.math.roundToInt

/** Test tag identifying the pull-to-refresh wrapper — used by the instrumented per-state + a11y UI tests. */
const val PULL_TO_REFRESH_TEST_TAG: String = "pull-to-refresh"

/** The default pull threshold expressed in dp — the native equivalent of the web `DEFAULT_THRESHOLD` (80 px). */
val DEFAULT_THRESHOLD: Dp = DEFAULT_THRESHOLD_PX.dp

/** The indicator arc diameter — web `Loader2` `h-3.5 w-3.5` (14 px). */
private val INDICATOR_ARC_SIZE: Dp = 14.dp

/** The indicator arc stroke width — a hairline that reads at the 14 dp size. */
private val INDICATOR_ARC_STROKE: Dp = 2.dp

/** Chip fill alpha over `onSurface` — web `bg-white/[0.06]`. */
private const val CHIP_BG_ALPHA: Float = 0.06f

/** Chip hairline-border alpha over `onSurface` — web `border-[var(--border-subtle)]`. */
private const val CHIP_BORDER_ALPHA: Float = 0.16f

/** Chip border width — the web subtle hairline. */
private val CHIP_BORDER_WIDTH: Dp = 1.dp

/**
 * Forces the touch-vs-fine pointer answer for everything below it — the deterministic override behind
 * [rememberIsCoarsePointer]. `null` (the default) means "ask the platform"; previews/tests provide `true`/`false`
 * so the gesture-enabled branch is exercised without depending on the host device's input configuration.
 */
val LocalCoarsePointer = staticCompositionLocalOf<Boolean?> { null }

/**
 * The active coarse-pointer (touch) preference — the Android port of the web `useIsCoarsePointer()`. Returns the
 * [LocalCoarsePointer] override when set, otherwise `true` when the platform reports a touchscreen (anything but
 * `Configuration.TOUCHSCREEN_NOTOUCH`), so a touch device opts into the gesture and a fine-pointer device does
 * not — exactly as the web `(pointer: coarse)` media query gates it.
 */
@Composable
fun rememberIsCoarsePointer(): Boolean {
    LocalCoarsePointer.current?.let { return it }
    val touchscreen = LocalConfiguration.current.touchscreen
    return remember(touchscreen) { touchscreen != Configuration.TOUCHSCREEN_NOTOUCH }
}

/**
 * Stateful entry point — the faithful port of the web `PullToRefresh`. Records the one-shot PII-safe
 * `view.opened` diagnostic (P1/S11) on first composition, resolves the touch-only default, and — when active —
 * wires the pull gesture over a scroll container and hands a fully-resolved render to the stateless
 * [PullToRefreshScaffold]. A fine pointer renders [content] straight through, exactly as the web returns the
 * children unwrapped. Binds no data of its own; the host supplies [onRefresh], exactly as the web page does.
 *
 * @param onRefresh the action run when the user releases past the pull threshold (web `onRefresh`). The
 *   "Refreshing…" indicator stays until it settles — it is awaited in a `try/finally` so a failure never leaves
 *   the indicator stuck. The view performs NO HTTP itself; it only invokes this host-supplied action.
 * @param modifier the web `className` analogue.
 * @param threshold the pull distance before a release fires [onRefresh] (web `threshold`, default 80 px → dp).
 * @param enabled overrides the touch-only default; `null` opts in automatically on a coarse (touch) pointer.
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 * @param content the wrapped, refreshable content (web `children`).
 */
@Composable
fun PullToRefresh(
    onRefresh: suspend () -> Unit,
    modifier: Modifier = Modifier,
    threshold: Dp = DEFAULT_THRESHOLD,
    enabled: Boolean? = null,
    logger: Logger = LocalDataContainer.current.logger,
    content: @Composable () -> Unit,
) {
    LaunchedEffect(Unit) { PullToRefreshDiagnostics.recordViewOpened(logger) }

    val active = enabled ?: rememberIsCoarsePointer()
    if (!active) {
        // Web parity: a fine pointer never wraps the children — no indicator strip, no gesture listeners.
        content()
        return
    }

    val thresholdPx = with(LocalDensity.current) { threshold.toPx() }
    val reduce = rememberReducedMotion()
    val scope = rememberCoroutineScope()
    val currentOnRefresh by rememberUpdatedState(onRefresh)
    val currentReduce by rememberUpdatedState(reduce)

    var pull by remember { mutableFloatStateOf(0f) }
    var rawPull by remember { mutableFloatStateOf(0f) }
    var refreshing by remember { mutableStateOf(false) }

    val connection =
        remember(thresholdPx) {
            object : NestedScrollConnection {
                override fun onPreScroll(
                    available: Offset,
                    source: NestedScrollSource,
                ): Offset {
                    // Releasing an active pull as the finger travels back up: shrink the pull before the list scrolls.
                    // A non-upward drag or a spent pull collapses `used` to <= 0, so a single guard covers both.
                    val canRelease = !refreshing && source == NestedScrollSource.UserInput
                    val used = if (canRelease) min(-available.y, rawPull) else 0f
                    if (used <= 0f) return Offset.Zero
                    rawPull -= used
                    pull = resistedPull(rawPull, thresholdPx)
                    return Offset(0f, -used)
                }

                override fun onPostScroll(
                    consumed: Offset,
                    available: Offset,
                    source: NestedScrollSource,
                ): Offset {
                    // Overscroll past the top (the child consumed nothing) is the pull — accumulate + consume it.
                    if (refreshing || source != NestedScrollSource.UserInput || available.y <= 0f) {
                        return Offset.Zero
                    }
                    rawPull += available.y
                    pull = resistedPull(rawPull, thresholdPx)
                    return Offset(0f, available.y)
                }

                override suspend fun onPreFling(available: Velocity): Velocity {
                    val armed = rawPull > 0f
                    val released = pull
                    rawPull = 0f
                    if (!refreshing && shouldFireRefresh(armed, released, thresholdPx)) {
                        pull = 0f
                        refreshing = true
                        scope.launch {
                            try {
                                currentOnRefresh()
                            } finally {
                                refreshing = false
                            }
                        }
                    } else if (released > 0f) {
                        val spec: AnimationSpec<Float> = if (currentReduce) snap() else tween(MotionDurations.fast)
                        animate(initialValue = released, targetValue = 0f, animationSpec = spec) { value, _ -> pull = value }
                    }
                    return Velocity.Zero
                }
            }
        }

    PullToRefreshScaffold(
        pullPx = pull,
        refreshing = refreshing,
        thresholdPx = thresholdPx,
        reduceMotion = reduce,
        pullLabel = stringResource(R.string.translation_mobile_refresh_pull),
        releaseLabel = stringResource(R.string.translation_mobile_refresh_release),
        refreshingLabel = stringResource(R.string.translation_mobile_refresh_refreshing),
        modifier = modifier.nestedScroll(connection),
        content = content,
    )
}

/**
 * Stateless renderer — the preview / UI-test entry point. Draws the indicator strip (the resolved arc + label
 * chip) over the [content], which is offset down by exactly the strip height so the two always meet. Takes the
 * already-resolved labels + pull state so it renders without a [LocalDataContainer], a gesture, or diagnostics,
 * which makes every state — idle, pulling, ready, refreshing — independently previewable and testable.
 *
 * @param pullPx the current resisted pull in px (0 at rest).
 * @param refreshing whether the refresh action is running (the "Refreshing…" state).
 * @param thresholdPx the release threshold in px.
 * @param reduceMotion whether reduced motion is requested (stops the arc spin).
 * @param pullLabel the localized "Pull to refresh" string.
 * @param releaseLabel the localized "Release to refresh" string.
 * @param refreshingLabel the localized "Refreshing…" string.
 * @param content the wrapped, refreshable content.
 */
@Composable
fun PullToRefreshScaffold(
    pullPx: Float,
    refreshing: Boolean,
    thresholdPx: Float,
    reduceMotion: Boolean,
    pullLabel: String,
    releaseLabel: String,
    refreshingLabel: String,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val ready = isReady(pullPx, thresholdPx)
    val progress = pullProgress(pullPx, thresholdPx, refreshing)
    val offsetPx = contentOffsetPx(pullPx, thresholdPx, refreshing)
    val label =
        when (refreshLabel(refreshing, ready)) {
            RefreshLabel.Refreshing -> refreshingLabel
            RefreshLabel.Release -> releaseLabel
            RefreshLabel.Pull -> pullLabel
        }

    Box(modifier = modifier.fillMaxWidth().testTag(PULL_TO_REFRESH_TEST_TAG)) {
        if (indicatorVisible(pullPx, refreshing)) {
            val stripHeight = with(LocalDensity.current) { indicatorHeightPx(pullPx, thresholdPx, refreshing).toDp() }
            Box(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .height(stripHeight)
                        .align(Alignment.TopCenter)
                        .clipToBounds(),
                contentAlignment = Alignment.BottomCenter,
            ) {
                RefreshIndicatorChip(
                    label = label,
                    progress = progress,
                    refreshing = refreshing,
                    reduceMotion = reduceMotion,
                )
            }
        }
        Box(modifier = Modifier.offset { IntOffset(0, offsetPx.roundToInt()) }) {
            content()
        }
    }
}

/**
 * The floating indicator chip — the localized arc + label the web draws in its rounded-full bar. Its opacity and
 * scale grow with [progress] (web `Math.max(0.4, progress)` + `scale(0.8 + progress * 0.2)`). It exposes the
 * localized state to TalkBack and becomes a polite live region while [refreshing] (web `role="status"` +
 * `aria-live="polite"`); the visible label and the decorative arc are cleared from the a11y tree so the chip
 * speaks its state exactly once.
 */
@Composable
private fun RefreshIndicatorChip(
    label: String,
    progress: Float,
    refreshing: Boolean,
    reduceMotion: Boolean,
    modifier: Modifier = Modifier,
) {
    val outline = MaterialTheme.colorScheme.onSurface
    val accent = MaterialTheme.colorScheme.onSurfaceVariant

    Surface(
        shape = RoundedCornerShape(Radius.pill),
        color = outline.copy(alpha = CHIP_BG_ALPHA),
        border = BorderStroke(CHIP_BORDER_WIDTH, outline.copy(alpha = CHIP_BORDER_ALPHA)),
        modifier =
            modifier
                .padding(bottom = Spacing.xs)
                .graphicsLayer {
                    alpha = indicatorOpacity(progress)
                    scaleX = indicatorScale(progress)
                    scaleY = indicatorScale(progress)
                }.semantics(mergeDescendants = true) {
                    contentDescription = label
                    if (refreshing) liveRegion = LiveRegionMode.Polite
                },
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RefreshArc(progress = progress, refreshing = refreshing, reduceMotion = reduceMotion, color = accent)
            Caption(text = label, modifier = Modifier.clearAndSetSemantics {})
        }
    }
}

/**
 * The small progress arc — a spinning indeterminate ring while [refreshing] (web `Loader2` `animate-spin`,
 * suppressed under reduced motion), and a determinate arc rotated by [spinnerRotationDeg] that grows with the
 * pull otherwise (web `rotate(progress * 270deg)`). Decorative: its semantics are cleared so the chip owns the
 * single spoken description.
 */
@Composable
private fun RefreshArc(
    progress: Float,
    refreshing: Boolean,
    reduceMotion: Boolean,
    color: Color,
    modifier: Modifier = Modifier,
) {
    val base = modifier.size(INDICATOR_ARC_SIZE)
    if (shouldSpin(refreshing, reduceMotion)) {
        CircularProgressIndicator(
            modifier = base.clearAndSetSemantics {},
            color = color,
            strokeWidth = INDICATOR_ARC_STROKE,
        )
    } else {
        val ringProgress = if (refreshing) 1f else progress
        val rotation = if (refreshing) 0f else spinnerRotationDeg(progress)
        CircularProgressIndicator(
            progress = { ringProgress },
            modifier = base.rotate(rotation).clearAndSetSemantics {},
            color = color,
            strokeWidth = INDICATOR_ARC_STROKE,
            trackColor = Color.Transparent,
        )
    }
}

// ── Previews (tooling-only; the sample copy is never shipped UI) ──────────────────────────────────────────

private const val PREVIEW_THRESHOLD_PX = 80f
private const val PREVIEW_PULL_LABEL = "Pull to refresh"
private const val PREVIEW_RELEASE_LABEL = "Release to refresh"
private const val PREVIEW_REFRESHING_LABEL = "Refreshing\u2026"

@Composable
private fun PullToRefreshPreviewContent() {
    Column(
        modifier = Modifier.fillMaxWidth().padding(Spacing.md),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        PanelTitle("Recent drives")
        BodyText("Morning commute · 18.4 km")
        BodyText("Supercharger top-up · 42 min")
        BodyText("Evening errands · 7.1 km")
    }
}

@Composable
private fun PullToRefreshPreview(
    pullPx: Float,
    refreshing: Boolean,
) {
    TeslaSyncTheme(dynamicColor = false) {
        PullToRefreshScaffold(
            pullPx = pullPx,
            refreshing = refreshing,
            thresholdPx = PREVIEW_THRESHOLD_PX,
            reduceMotion = false,
            pullLabel = PREVIEW_PULL_LABEL,
            releaseLabel = PREVIEW_RELEASE_LABEL,
            refreshingLabel = PREVIEW_REFRESHING_LABEL,
        ) {
            PullToRefreshPreviewContent()
        }
    }
}

@Preview(name = "PullToRefresh · idle", showBackground = true)
@Composable
private fun PullToRefreshIdlePreview() {
    PullToRefreshPreview(pullPx = 0f, refreshing = false)
}

@Preview(name = "PullToRefresh · pulling", showBackground = true)
@Composable
private fun PullToRefreshPullingPreview() {
    PullToRefreshPreview(pullPx = 44f, refreshing = false)
}

@Preview(name = "PullToRefresh · release", showBackground = true)
@Composable
private fun PullToRefreshReadyPreview() {
    PullToRefreshPreview(pullPx = 88f, refreshing = false)
}

@Preview(name = "PullToRefresh · refreshing", showBackground = true)
@Composable
private fun PullToRefreshRefreshingPreview() {
    PullToRefreshPreview(pullPx = 0f, refreshing = true)
}

@Preview(name = "PullToRefresh · refreshing (reduced motion)", showBackground = true)
@Composable
private fun PullToRefreshRefreshingReducedMotionPreview() {
    CompositionLocalProvider(LocalReducedMotion provides true) {
        TeslaSyncTheme(dynamicColor = false) {
            PullToRefreshScaffold(
                pullPx = 0f,
                refreshing = true,
                thresholdPx = PREVIEW_THRESHOLD_PX,
                reduceMotion = true,
                pullLabel = PREVIEW_PULL_LABEL,
                releaseLabel = PREVIEW_RELEASE_LABEL,
                refreshingLabel = PREVIEW_REFRESHING_LABEL,
            ) {
                PullToRefreshPreviewContent()
            }
        }
    }
}
