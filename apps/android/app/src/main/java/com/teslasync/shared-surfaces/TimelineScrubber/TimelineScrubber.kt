// The native Jetpack Compose + Material 3 TimelineScrubber shared surface — a parity port of
// web/src/components/data-display/TimelineScrubber.tsx. The web component is a rich, purely-presentational
// trip-replay scrubber: a controlled progress track with hover/drag preview, keyframe marker ticks, an optional
// decorative background, and a touch-friendly hit area. Its only inputs are props (`progress`, `buffered`,
// `duration`, `markers`, `getPreviewAt`, `onSeek`, `background`) and its only hooks are `useTranslation` (i18n)
// and `useMotionPreference` (reduced motion) — it fetches nothing. All pure derivations live in
// TimelineScrubberModel.kt and are unit-tested off-device; this file is the thin render layer that draws the
// track + fill + markers + thumb, wires tap/drag/hover gestures, resolves the localized labels + brand colors,
// and fires the one-shot diagnostic.
//
// Because the web source owns no async feed (the replay page owns `progress`/`markers` and passes `onSeek`
// down), it has NO loading / empty-fetch / error / stale / offline lifecycle — exactly like the accepted
// presentational ports (TimeMarker, PlaybackSpeedMenu). Modelling one would invent a fetch the spec does not
// have (honesty covenant: no scope narrowing, no silent drift). The surface's REAL, fully-reproduced states are
// the empty timeline (no markers + unknown duration → a usable bare track, never a blank box), the populated
// timeline, the hover ghost + preview bubble, the active drag (enlarged thumb + neon ring + live preview), the
// buffered fill, the cluster-count badge, and the reduced-motion path (the playhead snaps instead of animating).
// Each is exercised by the previews below, the off-device model test, and the on-device UI/a11y test.
//
// Parity choices:
//   • Bespoke track, not the shared `Slider`: the web is a hand-built track (custom markers, preview bubble,
//     decorative background, throttled drag emits) far beyond a single-thumb Material slider, so — like the web
//     and the sibling TripReplayCharts scrubber — it is drawn with Compose foundation primitives (a `Box` track
//     + `pointerInput` tap/drag/hover), never a chart/slider library. Fractional positioning uses `BiasAlignment`
//     (the native `translate-x-50%` analogue) so a child centers exactly on its 0..1 fraction at any width.
//   • Gestures: web click → tap (`detectTapGestures`); web pointer-drag with 50 ms throttled `onSeek` emits +
//     a final emit on release → `detectHorizontalDragGestures` (the same two-`pointerInput` idiom as
//     TripReplayCharts); web mouse hover → a hover loop that reacts only to un-pressed pointers, so touch drags
//     never double-drive the preview. The final drag position is always emitted on release (web `handlePointerUp`).
//   • Colors: web Tailwind marker classes + CSS vars → generated brand tokens, never a raw hex. The fill is the
//     neon `primary`; the rail/buffered use `onSurface` at the web's 0.08 / 0.12 alpha (theme-correct on both
//     light and dark, where the web hard-codes white); each marker maps to a brand token via [markerStyle] with
//     the `-300` shades lightened toward white. The preview bubble's speed/power/SoC/elevation reuse the
//     cyan/amber/emerald/secondary semantics as the regen/energy/battery/onSurfaceVariant tokens.
//   • i18n: every string resolves through the P1/S10 catalog — `replay.controls.progress` (the slider's
//     accessible name), `replay.markers.atPercent` (the marker position phrase), and the per-kind
//     `replay.markers.*` labels (with `automations.builder.event` as the localized fallback for the generic
//     `event` kind, since the web uses the raw kind token there and the catalog carries no replay `event` key).
//   • Accessibility: the track is an adjustable progress node (contentDescription = the localized name,
//     stateDescription = the m:ss playback clock, `ProgressBarRangeInfo` + a `setProgress` action so TalkBack can
//     scrub); each marker is a focusable button with its own localized "<name> at <pct>%" label; the thumb,
//     ghost, background, and bubble are decorative (cleared from the a11y tree). Reduced motion is honored.
//   • Diagnostics: records the one-shot PII-safe `view.opened` event (P1/S11) on first composition.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/TimelineScrubber — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path, exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderers, helpers, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.timelinescrubber

import android.os.SystemClock
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.BiasAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.components.motion.MotionDefaults
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Tooltip
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Elevation
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

// ── Web prop / visual constants (px → dp; Tailwind utility → token) ──────────────────────────────────────

/** Touch-friendly track height — web `h-8` (32px) coarse-pointer hit area. */
private val TRACK_HEIGHT: Dp = 32.dp

/** The rounded rail height — web `h-1.5` (6px). */
private val RAIL_HEIGHT: Dp = 6.dp

/** Rail base alpha — web `bg-white/[0.08]` (resolved on `onSurface` so both themes read correctly). */
private const val RAIL_ALPHA: Float = 0.08f

/** Buffered-fill alpha — web `bg-white/[0.12]`. */
private const val BUFFERED_ALPHA: Float = 0.12f

/** Idle playhead thumb diameter — web `h-3 w-3` (12px). */
private val THUMB_SIZE: Dp = 12.dp

/** Active (dragging) thumb diameter — web `h-4 w-4` (16px). */
private val THUMB_DRAG_SIZE: Dp = 16.dp

/** Thumb drop-shadow — web `shadow-lg`. */
private val THUMB_ELEVATION: Dp = 3.dp

/** Active-thumb ring width — web `ring-2`. */
private val THUMB_RING_WIDTH: Dp = 2.dp

/** Active-thumb ring alpha — web `ring-[var(--neon)]/40`. */
private const val THUMB_RING_ALPHA: Float = 0.4f

/** Marker tick height — web `h-3` (12px). */
private val MARKER_TICK_HEIGHT: Dp = 12.dp

/** Marker tick visible width — web `w-1` (4px). */
private val MARKER_WIDTH: Dp = 4.dp

/** Marker invisible touch target — web `touch-target-overlay` expands the 4px tick to a usable hit area. */
private val MARKER_TOUCH_WIDTH: Dp = 24.dp

/** Marker tick corner radius — web `rounded-sm`. */
private val MARKER_CORNER: Dp = 1.dp

/** How far the `-300` marker shades are lightened toward white (preserves the web lighter-within-family look). */
private const val MARKER_LIGHTEN: Float = 0.30f

/** Hover ghost playhead width — web `w-px`. */
private val GHOST_WIDTH: Dp = 1.dp

/** Hover ghost playhead height — web `h-3` (12px). */
private val GHOST_HEIGHT: Dp = 12.dp

/** Decorative background band height — web `top-1 h-6` (24px). */
private val BACKGROUND_HEIGHT: Dp = 24.dp

/** Decorative background opacity — web `opacity-20`. */
private const val BACKGROUND_ALPHA: Float = 0.20f

/** How far above the track the preview bubble floats — the web `-top-2 -translate-y-full` lift. */
private val PREVIEW_LIFT: Dp = 30.dp

/** Preview bubble drop-shadow — web `shadow-lg`. */
private val BUBBLE_SHADOW: Dp = 8.dp

/** Vertical gap between preview bubble lines — web `gap-1` (4px). */
private val BUBBLE_LINE_GAP: Dp = 4.dp

/** Gap between the speed glyph and the speed value — web `gap-1`. */
private val BUBBLE_GLYPH_GAP: Dp = 4.dp

/** Muted-glyph alpha for the preview speed line's `⛰` (web `text-[var(--text-muted)]`). */
private const val GLYPH_ALPHA: Float = 0.6f

/** Cluster-count badge lift above the tick — web `-top-3`. */
private val COUNT_BADGE_LIFT: Dp = 12.dp

/** Min epsilon width for a non-zero fill so `fillMaxWidth(fraction)` never receives 0. */
private const val FILL_EPSILON: Float = 0.0001f

/** The accessibility progress range — web `aria-valuemin=0 … aria-valuemax=100` expressed as a 0..1 fraction. */
private val PROGRESS_RANGE: ClosedFloatingPointRange<Float> = 0f..1f

/** Maps a 0..1 fraction to a [BiasAlignment] horizontal bias (-1 = start … +1 = end) — the `translate-x-50%`. */
private fun fractionToBias(fraction: Float): Float = (clampFraction(fraction) * 2f) - 1f

/**
 * Stateful entry point — the faithful 1:1 port of the web `TimelineScrubber` props. Records the one-shot
 * PII-safe `view.opened` diagnostic (P1/S11), resolves the localized slider name, and renders the interactive
 * scrubber. Binds no data of its own; the replay host supplies [progress], [markers], [getPreviewAt], and the
 * [onSeek] callback, exactly as the web page does.
 *
 * @param progress the current playhead position (web `progress`, 0..1, clamped).
 * @param durationSeconds the drive duration in seconds (web `duration`); used only for the accessibility clock.
 * @param onSeek the final commit handler — fired on tap, on drag (throttled) + release, and on marker click.
 * @param modifier the web `className` analogue.
 * @param buffered the buffered position (web `buffered`, 0..1) reserved for future streaming use, or null.
 * @param markers the notable moments along the timeline (web `markers`).
 * @param getPreviewAt sampler returning pre-formatted preview values for a normalized position (web `getPreviewAt`).
 * @param background optional decorative content drawn behind the track at low opacity (web `background`).
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun TimelineScrubber(
    progress: Float,
    durationSeconds: Double,
    onSeek: (Float) -> Unit,
    modifier: Modifier = Modifier,
    buffered: Float? = null,
    markers: List<TimelineMarker> = emptyList(),
    getPreviewAt: ((Float) -> TimelinePreviewPoint?)? = null,
    background: (@Composable () -> Unit)? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { TimelineScrubberDiagnostics.recordViewOpened(logger) }
    TimelineScrubberContent(
        progress = progress,
        durationSeconds = durationSeconds,
        onSeek = onSeek,
        progressLabel = stringResource(R.string.translation_replay_controls_progress),
        modifier = modifier,
        buffered = buffered,
        markers = markers,
        getPreviewAt = getPreviewAt,
        background = background,
    )
}

/**
 * Stateless renderer — the preview / UI-test entry point. Draws the full track (decorative background, rounded
 * rail, buffered fill, neon progress fill, marker ticks, hover ghost, playhead thumb) and the floating preview
 * bubble, wiring tap / drag / hover gestures and the adjustable accessibility node. Takes the already-resolved
 * [progressLabel] so it renders without a [LocalDataContainer] or diagnostics. Honors reduced motion: the fill
 * and thumb snap to position instead of animating.
 */
@Composable
fun TimelineScrubberContent(
    progress: Float,
    durationSeconds: Double,
    onSeek: (Float) -> Unit,
    progressLabel: String,
    modifier: Modifier = Modifier,
    buffered: Float? = null,
    markers: List<TimelineMarker> = emptyList(),
    getPreviewAt: ((Float) -> TimelinePreviewPoint?)? = null,
    background: (@Composable () -> Unit)? = null,
) {
    val reduce = rememberReducedMotion()
    val clampedProgress = clampFraction(progress)
    val clampedBuffered = buffered?.let { clampFraction(it) }

    var isDragging by remember { mutableStateOf(false) }
    var hoverAt by remember { mutableStateOf<Float?>(null) }
    var hoverPreview by remember { mutableStateOf<TimelinePreviewPoint?>(null) }
    val lastEmitMs = remember { longArrayOf(0L) }
    val lastFraction = remember { floatArrayOf(0f) }

    val animatedFraction by animateFloatAsState(
        targetValue = clampedProgress,
        animationSpec = if (reduce) snap() else tween(durationMillis = MotionDefaults.TRANSITION_MS),
        label = "timeline-scrubber-fill",
    )

    val ariaText = ariaValueText(durationSeconds, clampedProgress)
    val previewFraction = hoverAt ?: clampedProgress
    val previewClockStr = previewClock(durationSeconds, previewFraction)
    val showPreview = (hoverAt != null || isDragging) && (hoverPreview != null || previewClockStr != null)

    val railColor = MaterialTheme.colorScheme.onSurface.copy(alpha = RAIL_ALPHA)
    val bufferedColor = MaterialTheme.colorScheme.onSurface.copy(alpha = BUFFERED_ALPHA)
    val fillColor = MaterialTheme.colorScheme.primary
    val thumbColor = MaterialTheme.colorScheme.onSurface
    val ringColor = MaterialTheme.colorScheme.primary.copy(alpha = THUMB_RING_ALPHA)
    val ghostColor = MaterialTheme.colorScheme.onSurfaceVariant

    Box(modifier = modifier.fillMaxWidth()) {
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .height(TRACK_HEIGHT)
                    .align(Alignment.BottomCenter)
                    .semantics {
                        contentDescription = progressLabel
                        ariaText?.let { stateDescription = it }
                        progressBarRangeInfo = ProgressBarRangeInfo(clampedProgress, PROGRESS_RANGE)
                        setProgress { target ->
                            onSeek(clampFraction(target))
                            true
                        }
                    }.pointerInput(getPreviewAt) {
                        detectTapGestures { offset -> onSeek(fractionAt(offset.x, size.width)) }
                    }.pointerInput(getPreviewAt) {
                        detectHorizontalDragGestures(
                            onDragStart = { offset ->
                                isDragging = true
                                val f = fractionAt(offset.x, size.width)
                                lastFraction[0] = f
                                hoverAt = f
                                hoverPreview = getPreviewAt?.invoke(f)
                                lastEmitMs[0] = SystemClock.uptimeMillis()
                                onSeek(f)
                            },
                            onDragEnd = {
                                onSeek(lastFraction[0])
                                isDragging = false
                                hoverAt = null
                                hoverPreview = null
                            },
                            onDragCancel = {
                                isDragging = false
                                hoverAt = null
                                hoverPreview = null
                            },
                        ) { change, _ ->
                            val f = fractionAt(change.position.x, size.width)
                            lastFraction[0] = f
                            hoverAt = f
                            hoverPreview = getPreviewAt?.invoke(f)
                            val now = SystemClock.uptimeMillis()
                            if (now - lastEmitMs[0] >= SCRUB_INTERVAL_MS) {
                                lastEmitMs[0] = now
                                onSeek(f)
                            }
                        }
                    }.pointerInput(getPreviewAt) {
                        awaitPointerEventScope {
                            while (true) {
                                val event = awaitPointerEvent()
                                val change = event.changes.firstOrNull() ?: continue
                                when (event.type) {
                                    PointerEventType.Exit -> {
                                        if (!isDragging) {
                                            hoverAt = null
                                            hoverPreview = null
                                        }
                                    }
                                    PointerEventType.Enter, PointerEventType.Move -> {
                                        if (!change.pressed && !isDragging) {
                                            val f = fractionAt(change.position.x, size.width)
                                            hoverAt = f
                                            hoverPreview = getPreviewAt?.invoke(f)
                                        }
                                    }
                                    else -> Unit
                                }
                            }
                        }
                    },
        ) {
            if (background != null) {
                Box(
                    modifier =
                        Modifier
                            .align(Alignment.Center)
                            .fillMaxWidth()
                            .height(BACKGROUND_HEIGHT)
                            .graphicsLayer { alpha = BACKGROUND_ALPHA }
                            .clearAndSetSemantics {},
                ) {
                    background()
                }
            }

            Box(
                modifier =
                    Modifier
                        .align(Alignment.Center)
                        .fillMaxWidth()
                        .height(RAIL_HEIGHT)
                        .clip(RoundedCornerShape(percent = 50))
                        .background(railColor),
            ) {
                if (clampedBuffered != null && clampedBuffered > 0f) {
                    Box(
                        modifier =
                            Modifier
                                .align(Alignment.CenterStart)
                                .fillMaxWidth(clampedBuffered.coerceIn(FILL_EPSILON, 1f))
                                .fillMaxHeight()
                                .background(bufferedColor),
                    )
                }
                if (animatedFraction > 0f) {
                    Box(
                        modifier =
                            Modifier
                                .align(Alignment.CenterStart)
                                .fillMaxWidth(animatedFraction.coerceIn(FILL_EPSILON, 1f))
                                .fillMaxHeight()
                                .clip(RoundedCornerShape(percent = 50))
                                .background(fillColor),
                    )
                }
            }

            markers.forEach { marker ->
                val kindLabel = markerKindLabel(marker.kind)
                TimelineMarkerTick(
                    marker = marker,
                    color = markerColor(marker.kind),
                    name = marker.label ?: kindLabel,
                    tooltipText = marker.label ?: kindLabel,
                    atPercentPhrase =
                        stringResource(R.string.translation_replay_markers_atPercent, percentOf(marker.at).toString()),
                    onSeek = onSeek,
                    modifier = Modifier.align(BiasAlignment(fractionToBias(marker.at.toFloat()), 0f)),
                )
            }

            hoverAt?.let { ghost ->
                if (!isDragging) {
                    Box(
                        modifier =
                            Modifier
                                .align(BiasAlignment(fractionToBias(ghost), 0f))
                                .width(GHOST_WIDTH)
                                .height(GHOST_HEIGHT)
                                .background(ghostColor)
                                .clearAndSetSemantics {},
                    )
                }
            }

            Box(
                modifier =
                    Modifier
                        .align(BiasAlignment(fractionToBias(animatedFraction), 0f))
                        .size(if (isDragging) THUMB_DRAG_SIZE else THUMB_SIZE)
                        .shadow(THUMB_ELEVATION, CircleShape)
                        .clip(CircleShape)
                        .background(thumbColor)
                        .then(if (isDragging) Modifier.border(THUMB_RING_WIDTH, ringColor, CircleShape) else Modifier)
                        .clearAndSetSemantics {},
            )
        }

        if (showPreview) {
            TimelinePreviewBubble(
                clock = previewClockStr,
                preview = hoverPreview,
                modifier =
                    Modifier
                        .align(BiasAlignment(fractionToBias(previewFraction), -1f))
                        .offset(y = -PREVIEW_LIFT)
                        .clearAndSetSemantics {},
            )
        }
    }
}

/**
 * One keyframe marker tick — the native mirror of the web `TimelineMarkerTick`. A thin colored bar over a
 * larger invisible touch target (web `touch-target-overlay`), wrapped in the shared [Tooltip] (web `<Tooltip>`),
 * clickable to seek to [marker]`.at` (web `onSeek(marker.at)`), and announced as a focusable button labelled
 * "<name> at <pct>%". Surfaces the cluster-count badge when the marker represents more than one event.
 */
@Composable
fun TimelineMarkerTick(
    marker: TimelineMarker,
    color: Color,
    name: String,
    tooltipText: String,
    atPercentPhrase: String,
    onSeek: (Float) -> Unit,
    modifier: Modifier = Modifier,
) {
    val label = markerAccessibleLabel(name, atPercentPhrase)
    Tooltip(text = tooltipText, modifier = modifier) {
        Box(
            modifier =
                Modifier
                    .width(MARKER_TOUCH_WIDTH)
                    .height(TRACK_HEIGHT)
                    .clickable(role = Role.Button) { onSeek(clampFraction(marker.at).toFloat()) }
                    .semantics { contentDescription = label },
            contentAlignment = Alignment.Center,
        ) {
            Box(
                modifier =
                    Modifier
                        .width(MARKER_WIDTH)
                        .height(MARKER_TICK_HEIGHT)
                        .clip(RoundedCornerShape(MARKER_CORNER))
                        .background(color),
            )
            if (showCountBadge(marker.count)) {
                Surface(
                    shape = RoundedCornerShape(percent = 50),
                    color = MaterialTheme.colorScheme.surface,
                    contentColor = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.align(Alignment.TopCenter).offset(y = -COUNT_BADGE_LIFT),
                ) {
                    Text(
                        text = marker.count?.toString().orEmpty(),
                        style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
                        modifier = Modifier.padding(horizontal = Spacing.xs),
                    )
                }
            }
        }
    }
}

/**
 * The floating hover/drag preview tooltip — the native mirror of the web preview popup. Renders the m:ss
 * [clock] plus whichever pre-formatted [preview] figures are present (speed with the `⛰` glyph, power, SoC,
 * elevation), reusing the web's cyan/amber/emerald/secondary semantics as brand tokens. Purely decorative
 * (cleared from the a11y tree by the caller); the track's stateDescription already announces the time.
 */
@Composable
fun TimelinePreviewBubble(
    clock: String?,
    preview: TimelinePreviewPoint?,
    modifier: Modifier = Modifier,
) {
    val mono = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace)
    Surface(
        shape = RoundedCornerShape(Radius.sm),
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        tonalElevation = Elevation.overlay,
        shadowElevation = BUBBLE_SHADOW,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        modifier = modifier,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(BUBBLE_LINE_GAP),
        ) {
            clock?.let {
                Text(text = it, style = mono, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            preview?.speed?.let { speed ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(BUBBLE_GLYPH_GAP),
                ) {
                    Text(
                        text = PREVIEW_SPEED_GLYPH,
                        style = mono,
                        color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = GLYPH_ALPHA),
                    )
                    Text(text = speed, style = mono, color = TeslaTokens.chart.regen)
                }
            }
            preview?.power?.let {
                Text(text = it, style = mono, color = TeslaTokens.chart.energy)
            }
            preview?.soc?.let {
                Text(text = it, style = mono, color = TeslaTokens.chart.battery)
            }
            preview?.elevation?.let {
                Text(text = it, style = mono, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** Resolves a marker [kind] to its brand-token tick color (web `MARKER_COLORS`), lightening the `-300` shades. */
@Composable
private fun markerColor(kind: TimelineMarkerKind): Color {
    val style = markerStyle(kind)
    val base =
        when (style.tone) {
            MarkerTone.Battery -> TeslaTokens.chart.battery
            MarkerTone.Danger -> TeslaTokens.status.danger
            MarkerTone.Energy -> TeslaTokens.chart.energy
            MarkerTone.Regen -> TeslaTokens.chart.regen
            MarkerTone.Neutral -> MaterialTheme.colorScheme.onSurfaceVariant
        }
    return if (style.lighten) lerp(base, Color.White, MARKER_LIGHTEN) else base
}

/** The localized label for a marker [kind] (P1/S10) — the web tooltip/aria default per kind. */
@Composable
private fun markerKindLabel(kind: TimelineMarkerKind): String =
    when (kind) {
        TimelineMarkerKind.Start -> stringResource(R.string.translation_replay_markers_start)
        TimelineMarkerKind.Stop -> stringResource(R.string.translation_replay_markers_stop)
        TimelineMarkerKind.ChargeStart -> stringResource(R.string.translation_replay_markers_chargeStart)
        TimelineMarkerKind.ChargeStop -> stringResource(R.string.translation_replay_markers_chargeStop)
        TimelineMarkerKind.FastSegment -> stringResource(R.string.translation_replay_markers_fastSegment)
        TimelineMarkerKind.RegenPeak -> stringResource(R.string.translation_replay_markers_regenPeak)
        TimelineMarkerKind.LowSoc -> stringResource(R.string.translation_replay_markers_lowSoc)
        TimelineMarkerKind.Event -> stringResource(R.string.translation_automations_builder_event)
    }

// ── Previews (tooling-only; each @Preview exercises a render branch, never shipped UI) ──────────────────────

/** The fixed accessible name used by the previews (the real catalog resolves `replay.controls.progress`). */
private const val PREVIEW_LABEL: String = "Playback progress"

private val PREVIEW_MARKERS: List<TimelineMarker> =
    listOf(
        TimelineMarker(at = 0.0, kind = TimelineMarkerKind.Start, label = "Start"),
        TimelineMarker(at = 0.22, kind = TimelineMarkerKind.ChargeStart, label = "Charge start"),
        TimelineMarker(at = 0.40, kind = TimelineMarkerKind.FastSegment, label = "Fast segment", count = 3),
        TimelineMarker(at = 0.58, kind = TimelineMarkerKind.RegenPeak, label = "Regen peak"),
        TimelineMarker(at = 0.74, kind = TimelineMarkerKind.LowSoc, label = "Low battery"),
        TimelineMarker(at = 1.0, kind = TimelineMarkerKind.Stop, label = "End"),
    )

@Preview(name = "Empty (bare track)", showBackground = true)
@Composable
private fun TimelineScrubberEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Box(modifier = Modifier.padding(Spacing.md)) {
            TimelineScrubberContent(
                progress = 0f,
                durationSeconds = 0.0,
                onSeek = {},
                progressLabel = PREVIEW_LABEL,
            )
        }
    }
}

@Preview(name = "Content (markers)", showBackground = true)
@Composable
private fun TimelineScrubberContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Box(modifier = Modifier.padding(Spacing.md)) {
            TimelineScrubberContent(
                progress = 0.4f,
                durationSeconds = 1_830.0,
                onSeek = {},
                progressLabel = PREVIEW_LABEL,
                buffered = 0.7f,
                markers = PREVIEW_MARKERS,
            )
        }
    }
}

@Preview(name = "Preview bubble", showBackground = true)
@Composable
private fun TimelineScrubberBubblePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Box(modifier = Modifier.padding(Spacing.xl)) {
            TimelinePreviewBubble(
                clock = "12:45",
                preview =
                    TimelinePreviewPoint(
                        at = 0.5,
                        speed = "64 mph",
                        power = "18 kW",
                        soc = "72%",
                        elevation = "320 ft",
                    ),
            )
        }
    }
}

@Preview(name = "Content (dark)", showBackground = true)
@Composable
private fun TimelineScrubberDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        Box(modifier = Modifier.padding(Spacing.md)) {
            TimelineScrubberContent(
                progress = 0.62f,
                durationSeconds = 1_830.0,
                onSeek = {},
                progressLabel = PREVIEW_LABEL,
                markers = PREVIEW_MARKERS,
            )
        }
    }
}

@Preview(name = "Content (reduced motion)", showBackground = true)
@Composable
private fun TimelineScrubberReducedMotionPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            Box(modifier = Modifier.padding(Spacing.md)) {
                TimelineScrubberContent(
                    progress = 0.5f,
                    durationSeconds = 1_830.0,
                    onSeek = {},
                    progressLabel = PREVIEW_LABEL,
                    markers = PREVIEW_MARKERS,
                )
            }
        }
    }
}
